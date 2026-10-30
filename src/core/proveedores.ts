/**
 * Model providers for the agent.
 *
 * They all speak OpenAI's chat protocol (`POST {base}/chat/completions`, with tools
 * and streaming), so the agent does not change: only where the server forwards to
 * and with which key changes. Keys NEVER reach the browser: they are stored on the
 * server (.miuzika/proveedores.json, outside git) or in .env.
 *
 * Web search (buscar_web, leer_web) is an Ollama service: it keeps using the Ollama
 * Cloud key even if the agent talks to another provider.
 *
 * No DOM and no network: tested with `node --test`.
 */

export interface Proveedor {
  id: string;
  nombre: string;
  /** OpenAI-compatible base: `${base}/chat/completions` and `${base}/models`. */
  base: string;
  /** false = local (Ollama, LM Studio): no key needed. */
  necesitaClave: boolean;
  /** How its models are listed. */
  listado: "openai" | "ollama";
  /** Model proposed if none has been chosen. */
  modeloPorDefecto: string;
  /** Where to get the key (shown in the menu). */
  ayuda: string;
  /** .env variable that also works as a key. */
  variableEnv?: string;
  /** The base can be changed (self-hosted servers). */
  baseEditable?: boolean;
}

export const PROVEEDORES: readonly Proveedor[] = [
  {
    id: "ollama-cloud",
    nombre: "Ollama Cloud",
    base: "https://ollama.com/v1",
    necesitaClave: true,
    listado: "ollama",
    modeloPorDefecto: "deepseek-v4.1-flash:1017",
    ayuda: "ollama.com → Settings → API keys. This is the one web search uses.",
    variableEnv: "OLLAMA_API_KEY",
  },
  {
    id: "anthropic",
    nombre: "Anthropic (Claude)",
    base: "https://api.anthropic.com/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "claude-sonnet-5-5",
    ayuda: "console.anthropic.com → API keys.",
    variableEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    nombre: "OpenAI",
    base: "https://api.openai.com/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "",
    ayuda: "platform.openai.com → API keys.",
    variableEnv: "OPENAI_API_KEY",
  },
  {
    id: "google",
    nombre: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "gemini-2.5-flash",
    ayuda: "aistudio.google.com → Get API key.",
    variableEnv: "GEMINI_API_KEY",
  },
  {
    id: "openrouter",
    nombre: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "deepseek/deepseek-chat",
    ayuda: "openrouter.ai → Keys. One key gives access to many models.",
    variableEnv: "OPENROUTER_API_KEY",
  },
  {
    id: "deepseek",
    nombre: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "deepseek-chat",
    ayuda: "platform.deepseek.com → API keys.",
    variableEnv: "DEEPSEEK_API_KEY",
  },
  {
    id: "mistral",
    nombre: "Mistral",
    base: "https://api.mistral.ai/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "mistral-large-latest",
    ayuda: "console.mistral.ai → API keys.",
    variableEnv: "MISTRAL_API_KEY",
  },
  {
    id: "groq",
    nombre: "Groq",
    base: "https://api.groq.com/openai/v1",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "llama-3.3-70b-versatile",
    ayuda: "console.groq.com → API keys.",
    variableEnv: "GROQ_API_KEY",
  },
  {
    id: "ollama-local",
    nombre: "Ollama (this machine)",
    base: "http://localhost:11434/v1",
    necesitaClave: false,
    listado: "ollama",
    modeloPorDefecto: "qwen3:8b",
    ayuda: "Ollama installed on this machine (ollama serve). No key needed.",
    baseEditable: true,
  },
  {
    id: "lmstudio",
    nombre: "LM Studio (this machine)",
    base: "http://localhost:1234/v1",
    necesitaClave: false,
    listado: "openai",
    modeloPorDefecto: "",
    ayuda: "LM Studio with its local server running. No key needed.",
    baseEditable: true,
  },
  {
    id: "personalizado",
    nombre: "Other (OpenAI-compatible)",
    base: "",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "",
    ayuda: "Any service with OpenAI-style /chat/completions: give its base URL and key.",
    baseEditable: true,
  },
];

export const PROVEEDOR_POR_DEFECTO = "ollama-cloud";

export function proveedorPorId(id: string): Proveedor | undefined {
  return PROVEEDORES.find((p) => p.id === id);
}

/** What is stored for each provider on the server. */
export interface AjustesProveedor {
  apiKey?: string;
  base?: string;
  modelo?: string;
}

export interface ConfigProveedores {
  activo: string;
  proveedores: Record<string, AjustesProveedor>;
}

export const CONFIG_VACIA: ConfigProveedores = { activo: PROVEEDOR_POR_DEFECTO, proveedores: {} };

/** Effective base (the edited one if editable), without a trailing slash. */
export function baseDe(p: Proveedor, ajustes: AjustesProveedor | undefined): string {
  const editada = p.baseEditable ? (ajustes?.base ?? "").trim() : "";
  return (editada || p.base).replace(/\/+$/, "");
}

/** Effective key: the stored one or the one from .env. */
export function claveDe(p: Proveedor, ajustes: AjustesProveedor | undefined, env: Record<string, string | undefined>): string {
  return (ajustes?.apiKey ?? "").trim() || (p.variableEnv ? (env[p.variableEnv] ?? "").trim() : "");
}

/** "sk-…f3a9": to show that a key exists without showing it. */
export function claveOculta(clave: string): string {
  if (clave === "") return "";
  return clave.length <= 8 ? "••••" : `${clave.slice(0, 3)}…${clave.slice(-4)}`;
}

/**
 * The request body, adapted to the provider. The agent writes it thinking of
 * Ollama; the others reject fields they do not know (OpenAI answers 400 with
 * `keep_alive`).
 */
export function adaptarCuerpo(p: Proveedor, cuerpo: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...cuerpo };
  if (p.listado !== "ollama") delete salida.keep_alive;
  if (salida.reasoning_effort === "none" && !["ollama-cloud", "ollama-local", "openai", "openrouter"].includes(p.id)) {
    delete salida.reasoning_effort;
  }
  if (p.id === "anthropic" || p.id === "google") delete salida.stream_options;
  return salida;
}

/** Model names from the `/models` (OpenAI) or `/api/tags` (Ollama) response. */
export function modelosDeRespuesta(datos: unknown): string[] {
  const d = (datos ?? {}) as { data?: { id?: string }[]; models?: { name?: string; model?: string }[] };
  const nombres = [
    ...(d.data ?? []).map((m) => m.id ?? ""),
    ...(d.models ?? []).map((m) => m.name ?? m.model ?? ""),
  ]
    .map((n) => n.replace(/^models\//, ""))
    .filter((n) => n !== "");
  return [...new Set(nombres)].sort((a, b) => a.localeCompare(b));
}
