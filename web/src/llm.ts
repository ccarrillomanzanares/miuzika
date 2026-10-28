/**
 * Acceso al LLM desde el navegador.
 *
 * No maneja credenciales: todo pasa por `/api/llm`, el proxy del servidor
 * (server/api/proveedores.ts), que lo reenvía al proveedor elegido en el menú
 * «Modelos» con su clave. Así ninguna clave entra en el bundle del cliente.
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
  /** Solo en respuestas del modelo que pide herramientas. */
  tool_calls?: ToolCall[];
  /** Solo en mensajes de rol "tool". */
  tool_call_id?: string;
}

export interface ChatResult {
  content: string;
  /** Latencia de la llamada, en milisegundos. */
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
  /** Se llama con cada trozo que llega: sirve para enseñar que está trabajando. */
  onProgreso?: (progreso: { tokens: number; ms: number; texto: string }) => void;
  /** Corta la petición si no contesta en este tiempo (por defecto 180 s). */
  timeoutMs?: number;
  /** Repetir la petición pidiendo al modelo que NO razone (segunda pasada rápida). */
  sinRazonamiento?: boolean;
  /** Interno: cuántas veces se ha reintentado por 'load' (modelo cargando). */
  reintentosPorCarga?: number;
  /** Tope de tokens de salida. Sin él, un turno llegó a pedir 9.692 y el proveedor
   *  contestó 'load' (saturado) en el turno siguiente, tres veces seguidas. */
  maxTokens?: number;
}

/** Prefijo del proxy: el servidor de Vite pone la clave. */
export const LLM_BASE = "/api/llm";

/**
 * Espera a que el modelo esté cargado.
 *
 * Ollama contesta `finish_reason: "load"` (cero tokens en ~250 ms) cuando la petición
 * llega mientras el modelo se está cargando: no es falta de contexto ni el modelo
 * callándose, es una instancia fría. Reintentar la petición grande no ayuda; lo que
 * ayuda es una petición diminuta hasta que contesta de verdad.
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
      /* se reintenta */
    }
    await new Promise((listo) => setTimeout(listo, 1500));
  }
  return false;
}

/** Cuántas peticiones al modelo hay en vuelo a la vez. Si pasa de 1, la app está
 *  pidiendo dos veces lo mismo y el proveedor contesta 'load' por saturación. */
let peticionesEnVuelo = 0;

/** Cada turno se apunta en tmp/llm.log (via el servidor) para poder depurar. */
function registrarTurno(registro: Record<string, unknown>): void {
  try {
    void fetch("/api/agent-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: new Date().toISOString(), ...registro }),
    }).catch(() => undefined);
  } catch {
    /* el log no debe romper una respuesta */
  }
}

/** Modelo por defecto si el servidor todavía no ha dicho cuál (Ollama Cloud). */
export const DEFAULT_MODEL = "deepseek-v4.1-flash:1017";

/** Proveedor y modelo activos: los guarda el servidor (menú «Modelos»). */
let activo: { proveedor: string; modelo: string } | null = null;

/** Lee del servidor qué proveedor y qué modelo usa el agente. */
export async function cargarConfigLlm(): Promise<{ proveedor: string; modelo: string }> {
  try {
    const datos = (await (await fetch("/api/proveedores")).json()) as { activo?: string; modelo?: string };
    activo = { proveedor: datos.activo ?? "ollama-cloud", modelo: datos.modelo || DEFAULT_MODEL };
  } catch {
    activo ??= { proveedor: "ollama-cloud", modelo: DEFAULT_MODEL };
  }
  return activo;
}

/** El menú «Modelos» avisa aquí al cambiar de proveedor o de modelo. */
export function fijarActivo(proveedor: string, modelo: string): void {
  activo = { proveedor, modelo };
}

export function getProveedor(): string {
  return activo?.proveedor ?? "ollama-cloud";
}

export function getModel(): string {
  return activo?.modelo || DEFAULT_MODEL;
}

/** Cambia el modelo del proveedor activo (se guarda en el servidor). */
export function setModel(model: string): void {
  const proveedor = getProveedor();
  fijarActivo(proveedor, model.trim() || DEFAULT_MODEL);
  void fetch("/api/proveedores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "activar", id: proveedor, modelo: getModel() }),
  }).catch(() => undefined);
}

/** Modelos que ofrece el proveedor activo. */
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

/** Comprobación de extremo a extremo: clave del servidor y LLM accesible. */
export async function health(signal?: AbortSignal): Promise<Health> {
  const modelos = await listModels(signal);
  return { ok: modelos.length > 0, models: modelos.length, model: getModel() };
}

/** Una vuelta de conversación (sin streaming), compatible con tool calling. */
/**
 * Una llamada al modelo, EN STREAMING.
 *
 * Por qué streaming y no una espera a ciegas: con `stream: false` el proveedor tiene
 * que generar todo antes de contestar; un turno largo con 10.000 tokens de entrada
 * acaba en `finish_reason: "load"` (cero palabras en 0,25 s) o en una petición
 * colgada. Con streaming llega el primer token enseguida, la conexión no se queda
 * muda y se puede enseñar el progreso: tokens y segundos en vivo.
 *
 * `timeoutMs` corta una petición que no responde (antes podía quedarse colgada para
 * siempre: eso era el «sin respuesta final»).
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
  // Pensar está bien: el problema era cortarlo a mitad. Sólo cuando un turno se queda
  // sin salida por haber razonado de más se repite SIN razonamiento (medido: pasa de
  // 22.823 caracteres de razonamiento y 8.192 tokens a 0 y respuesta inmediata).
  if (options.sinRazonamiento) body.reasoning_effort = "none";

  const t0 = Date.now();
  const peticion = Math.random().toString(36).slice(2, 8);
  const cuerpoJson = JSON.stringify(body);
  const pedido = { herramientas: Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0, bytes: cuerpoJson.length };
  peticionesEnVuelo += 1;
  const enVueloAlPedir = peticionesEnVuelo;
  const reloj = new AbortController();
  const temporizador = window.setTimeout(
    () => reloj.abort(new Error("tiempo agotado")),
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
    if (!lector) throw new Error("la respuesta no trae cuerpo");
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
        // El modelo razona antes de contestar y ese texto llega en `delta.reasoning`.
        // Se cuenta como progreso (es lo que está haciendo) y se mide, porque si el
        // razonamiento se come el presupuesto la respuesta sale vacía.
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
          // Los trozos de argumentos también son progreso: cuando el modelo escribe un
          // guion no manda texto, y sin esto la barra se quedaba muda mientras trabajaba.
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
    // Un fallo (timeout, abort, 429) también se apunta: antes no quedaba rastro y sólo
    // se veía el síntoma en la interfaz.
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

  // Sin texto pero con razonamiento y cortado por longitud: se pasó el turno pensando.
  if (texto.trim() === "" && razonamiento.length > 0 && razon === "length") {
    razon = "sin_salida";
  }

  // 'load' no es una respuesta: es el modelo cargándose. Se calienta y se repite.
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
