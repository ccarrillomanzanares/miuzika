/**
 * Acceso al LLM (Ollama Cloud) desde el navegador.
 *
 * No maneja credenciales: todo pasa por `/api/llm`, el proxy del servidor de
 * Vite, que inyecta la clave leyéndola del `.env`. Así la clave nunca entra en
 * el bundle del cliente. El modelo es intercambiable en caliente.
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
}

/** Prefijo del proxy: el servidor de Vite pone la clave. */
export const LLM_BASE = "/api/llm";

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

const MODEL_KEY = "miuzika.llm.model";

/** Modelo por defecto (el mismo que se usa en el escritorio de Hermes). */
export const DEFAULT_MODEL = "deepseek-v4.1-flash:1017";

export function getModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** Cambia el modelo del agente sin tocar código (se recuerda entre sesiones). */
export function setModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model.trim() || DEFAULT_MODEL);
  } catch {
    /* sin persistencia */
  }
}

/** Modelos disponibles en la cuenta (endpoint nativo de Ollama). */
export async function listModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${LLM_BASE}/api/tags`, { signal });
  if (!res.ok) throw new Error(`/api/llm/api/tags -> HTTP ${res.status}`);
  const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
  return (data.models ?? [])
    .map((m) => m.name ?? m.model ?? "")
    .filter((n) => n !== "")
    .sort();
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
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const modelo = options.model ?? getModel();
  const body: Record<string, unknown> = { model: modelo, messages, stream: false };
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (options.jsonMode) body.response_format = { type: "json_object" };

  const t0 = Date.now();
  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 300)}`);

  const data = JSON.parse(texto) as {
    model?: string;
    choices?: {
      message?: { content?: string; tool_calls?: ToolCall[] };
      finish_reason?: string;
    }[];
    usage?: ChatResult["usage"];
  };
  const eleccion = data.choices?.[0];
  registrarTurno({
    modelo,
    ms: Date.now() - t0,
    mensajes: messages,
    respuesta: eleccion?.message?.content ?? "",
    tool_calls: eleccion?.message?.tool_calls ?? [],
    usage: data.usage ?? null,
  });
  return {
    content: eleccion?.message?.content ?? "",
    ms: Date.now() - t0,
    toolCalls: eleccion?.message?.tool_calls ?? [],
    finishReason: eleccion?.finish_reason ?? "",
    model: data.model ?? modelo,
    usage: data.usage,
  };
}
