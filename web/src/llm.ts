/**
 * LLM access from the browser.
 *
 * It does not handle credentials: everything goes through `/api/llm`, the server
 * proxy (server/api/proveedores.ts), which forwards it to the provider chosen in the
 * "Models" menu with its key. That way no key enters the client bundle.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Only in model responses that request tools. */
  tool_calls?: ToolCall[];
  /** Only in messages with the "tool" role. */
  tool_call_id?: string;
}

export interface ChatResult {
  content: string;
  /** Latency of the call, in milliseconds. */
  ms: number;
  toolCalls: ToolCall[];
  finishReason: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatOptions {
  model?: string;
  tools?: ToolSpec[];
  temperature?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
  /** Called with each chunk that arrives: it is used to show that it is working. */
  onProgreso?: (progreso: { tokens: number; ms: number; texto: string }) => void;
  /** Cuts the request if it does not answer within this time (180 s by default). */
  timeoutMs?: number;
  /** Repeats the request asking the model NOT to reason (quick second pass). */
  sinRazonamiento?: boolean;
  /** Internal: how many times it has been retried because of 'load' (model loading). */
  reintentosPorCarga?: number;
  /** Output token cap. Without it, one turn asked for 9,692 and the provider
   *  answered 'load' (saturated) on the next turn, three times in a row. */
  maxTokens?: number;
}

/** Proxy prefix: the Vite server sets the key. */
export const LLM_BASE = "/api/llm";

/**
 * Waits for the model to be loaded.
 *
 * Ollama answers `finish_reason: "load"` (zero tokens in ~250 ms) when the request
 * arrives while the model is loading: it is not a lack of context nor the model
 * going silent, it is a cold instance. Retrying the big request does not help; what
 * helps is a tiny request until it really answers.
 */
async function esperarModeloCargado(modelo: string, intentos = 12): Promise<boolean> {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelo,
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
          stream: false,
          keep_alive: "30m",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const datos = (await res.json()) as { choices?: { finish_reason?: string }[] };
        const razon = datos.choices?.[0]?.finish_reason ?? "";
        if (razon !== "load") return true;
      }
    } catch {
      /* it retries */
    }
    await new Promise((listo) => setTimeout(listo, 1500));
  }
  return false;
}

/** How many requests to the model are in flight at once. If it goes above 1, the app
 *  is asking for the same thing twice and the provider answers 'load' due to overload. */
let peticionesEnVuelo = 0;

/** Every turn is logged in tmp/llm.log (via the server) so it can be debugged. */
function registrarTurno(registro: Record<string, unknown>): void {
  try {
    void fetch("/api/agent-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: new Date().toISOString(), ...registro }),
    }).catch(() => undefined);
  } catch {
    /* logging must not break a response */
  }
}

/** Default model if the server has not said which one yet (Ollama Cloud). */
export const DEFAULT_MODEL = "deepseek-v4.1-flash:1017";

/** Active provider and model: stored by the server ("Models" menu). */
let activo: { proveedor: string; modelo: string } | null = null;

/** Reads from the server which provider and which model the agent uses. */
export async function cargarConfigLlm(): Promise<{ proveedor: string; modelo: string }> {
  try {
    const datos = (await (await fetch("/api/proveedores")).json()) as { activo?: string; modelo?: string };
    activo = { proveedor: datos.activo ?? "ollama-cloud", modelo: datos.modelo || DEFAULT_MODEL };
  } catch {
    activo ??= { proveedor: "ollama-cloud", modelo: DEFAULT_MODEL };
  }
  return activo;
}

/** The "Models" menu notifies here when the provider or the model changes. */
export function fijarActivo(proveedor: string, modelo: string): void {
  activo = { proveedor, modelo };
}

export function getProveedor(): string {
  return activo?.proveedor ?? "ollama-cloud";
}

export function getModel(): string {
  return activo?.modelo || DEFAULT_MODEL;
}

/** Changes the active provider's model (stored on the server). */
export function setModel(model: string): void {
  const proveedor = getProveedor();
  fijarActivo(proveedor, model.trim() || DEFAULT_MODEL);
  void fetch("/api/proveedores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "activar", id: proveedor, modelo: getModel() }),
  }).catch(() => undefined);
}

/** Models offered by the active provider. */
export async function listModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`/api/proveedores/modelos?id=${encodeURIComponent(getProveedor())}`, { signal });
  const datos = (await res.json()) as { ok?: boolean; modelos?: string[]; error?: string };
  if (!datos.ok) throw new Error(datos.error ?? `HTTP ${res.status}`);
  return datos.modelos ?? [];
}

export interface Health {
  ok: boolean;
  models: number;
  model: string;
}

/** End-to-end check: server key and LLM reachable. */
export async function health(signal?: AbortSignal): Promise<Health> {
  const modelos = await listModels(signal);
  return { ok: modelos.length > 0, models: modelos.length, model: getModel() };
}

/** One conversation turn (no streaming), compatible with tool calling. */
/**
 * One call to the model, IN STREAMING.
 *
 * Why streaming instead of a blind wait: with `stream: false` the provider has to
 * generate everything before answering; a long turn with 10,000 input tokens ends
 * in `finish_reason: "load"` (zero words in 0.25 s) or in a hung request. With
 * streaming the first token arrives right away, the connection does not go silent
 * and progress can be shown: tokens and seconds live.
 *
 * `timeoutMs` cuts a request that does not respond (before, it could hang forever:
 * that was the "no final answer").
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const modelo = options.model ?? getModel();
  const body: Record<string, unknown> = {
    model: modelo,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    keep_alive: "30m",
  };
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (options.jsonMode) body.response_format = { type: "json_object" };
  if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;
  // Thinking is fine: the problem was cutting it off halfway. Only when a turn ends up
  // with no output after reasoning too much is it repeated WITHOUT reasoning (measured:
  // from 22,823 characters of reasoning and 8,192 tokens to 0 and an immediate answer).
  if (options.sinRazonamiento) body.reasoning_effort = "none";

  const t0 = Date.now();
  const peticion = Math.random().toString(36).slice(2, 8);
  const cuerpoJson = JSON.stringify(body);
  const pedido = { herramientas: Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0, bytes: cuerpoJson.length };
  peticionesEnVuelo += 1;
  const enVueloAlPedir = peticionesEnVuelo;
  const reloj = new AbortController();
  const temporizador = window.setTimeout(
    () => reloj.abort(new Error("timed out")),
    options.timeoutMs ?? 180_000,
  );
  const cualquier = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  const senal = options.signal
    ? cualquier
      ? cualquier([options.signal, reloj.signal])
      : reloj.signal
    : reloj.signal;

  let texto = "";
  let razonamiento = "";
  let razon = "";
  let uso: ChatResult["usage"];
  let modeloDevuelto = modelo;
  let tokens = 0;
  const parciales = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: cuerpoJson,
      signal: senal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const lector = res.body?.getReader();
    if (!lector) throw new Error("the response has no body");
    const decodificador = new TextDecoder();
    let buzon = "";

    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      buzon += decodificador.decode(value, { stream: true });
      let corte = buzon.indexOf("\n");
      while (corte >= 0) {
        const linea = buzon.slice(0, corte).trim();
        buzon = buzon.slice(corte + 1);
        corte = buzon.indexOf("\n");
        if (!linea.startsWith("data:")) continue;
        const carga = linea.slice(5).trim();
        if (carga === "[DONE]") continue;
        let trozo: {
          model?: string;
          choices?: {
            delta?: {
              content?: string;
              reasoning?: string;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: string;
          }[];
          usage?: ChatResult["usage"];
        };
        try {
          trozo = JSON.parse(carga);
        } catch {
          continue;
        }
        if (trozo.model) modeloDevuelto = trozo.model;
        if (trozo.usage) uso = trozo.usage;
        const eleccion = trozo.choices?.[0];
        if (!eleccion) continue;
        const delta = eleccion.delta ?? {};
        // The model reasons before answering and that text arrives in `delta.reasoning`.
        // It counts as progress (it is what it is doing) and it is measured, because if
        // the reasoning eats the budget the answer comes out empty.
        const trozoRazon = (delta as { reasoning?: string }).reasoning;
        if (typeof trozoRazon === "string" && trozoRazon.length > 0) {
          razonamiento += trozoRazon;
          tokens += 1;
          options.onProgreso?.({ tokens, ms: Date.now() - t0, texto });
        }
        if (typeof delta.content === "string" && delta.content.length > 0) {
          texto += delta.content;
          tokens += 1;
          options.onProgreso?.({ tokens, ms: Date.now() - t0, texto });
        }
        for (const llamada of delta.tool_calls ?? []) {
          // Argument chunks are progress too: when the model writes a script it sends no
          // text, and without this the bar stayed silent while it worked.
          tokens += 1;
          options.onProgreso?.({ tokens, ms: Date.now() - t0, texto });
          const indice = llamada.index ?? 0;
          const previo = parciales.get(indice) ?? { id: "", name: "", arguments: "" };
          parciales.set(indice, {
            id: llamada.id || previo.id,
            name: llamada.function?.name || previo.name,
            arguments: previo.arguments + (llamada.function?.arguments ?? ""),
          });
        }
        if (eleccion.finish_reason) razon = eleccion.finish_reason;
      }
    }
  } catch (error) {
    // A failure (timeout, abort, 429) is logged too: before, no trace was left and only
    // the symptom was visible in the interface.
    registrarTurno({
      peticion,
      en_vuelo: enVueloAlPedir,
      modelo: modeloDevuelto,
      ms: Date.now() - t0,
      mensajes: messages,
      respuesta: texto,
      tool_calls: [],
      finish_reason: "excepcion",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      usage: uso ?? null,
    });
    throw error;
  } finally {
    window.clearTimeout(temporizador);
    peticionesEnVuelo = Math.max(0, peticionesEnVuelo - 1);
  }

  const toolCalls: ToolCall[] = [...parciales.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, valor]) => valor.name !== "")
    .map(([indice, valor]) => ({
      id: valor.id || `call_${indice}_${Math.round(t0)}`,
      type: "function",
      function: { name: valor.name, arguments: valor.arguments || "{}" },
    }));

  const ms = Date.now() - t0;

  // No text but with reasoning and cut off by length: the turn spent itself thinking.
  if (texto.trim() === "" && razonamiento.length > 0 && razon === "length") {
    razon = "sin_salida";
  }

  // 'load' is not an answer: it is the model loading. It is warmed up and repeated.
  if (razon === "load" && (options.reintentosPorCarga ?? 0) < 4) {
    await esperarModeloCargado(modelo);
    return chat(messages, {
      ...options,
      reintentosPorCarga: (options.reintentosPorCarga ?? 0) + 1,
    });
  }

  registrarTurno({
    peticion,
    en_vuelo: enVueloAlPedir,
    pedido,
    modelo: modeloDevuelto,
    ms,
    mensajes: messages,
    respuesta: texto,
    razonamiento: razonamiento.length,
    tool_calls: toolCalls,
    finish_reason: razon,
    usage: uso ?? null,
  });
  return {
    content: texto,
    ms,
    toolCalls,
    finishReason: razon,
    model: modeloDevuelto,
    usage: uso,
  };
}
