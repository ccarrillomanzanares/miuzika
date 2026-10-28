/**
 * Proveedores de modelos para el agente.
 *
 * Todos hablan el protocolo de chat de OpenAI (`POST {base}/chat/completions`, con
 * herramientas y streaming), así que el agente no cambia: sólo cambia a dónde
 * reenvía el servidor y con qué clave. Las claves NUNCA llegan al navegador: se
 * guardan en el servidor (.miuzika/proveedores.json, fuera de git) o en el .env.
 *
 * La búsqueda web (buscar_web, leer_web) es un servicio de Ollama: sigue usando la
 * clave de Ollama Cloud aunque el agente hable con otro proveedor.
 *
 * Sin DOM y sin red: se prueba con `node --test`.
 */

export interface Proveedor {
  id: string;
  nombre: string;
  /** Base OpenAI-compatible: `${base}/chat/completions` y `${base}/models`. */
  base: string;
  /** false = local (Ollama, LM Studio): no hace falta clave. */
  necesitaClave: boolean;
  /** Cómo se listan sus modelos. */
  listado: "openai" | "ollama";
  /** Modelo que se propone si no se ha elegido ninguno. */
  modeloPorDefecto: string;
  /** Dónde se consigue la clave (se enseña en el menú). */
  ayuda: string;
  /** Variable del .env que también vale como clave. */
  variableEnv?: string;
  /** Se puede cambiar la base (servidores propios). */
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
    ayuda: "ollama.com → Settings → API keys. Es la que usa la búsqueda web.",
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
    ayuda: "openrouter.ai → Keys. Da acceso a muchos modelos con una sola clave.",
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
    nombre: "Ollama (este equipo)",
    base: "http://localhost:11434/v1",
    necesitaClave: false,
    listado: "ollama",
    modeloPorDefecto: "qwen3:8b",
    ayuda: "Ollama instalado en este equipo (ollama serve). Sin clave.",
    baseEditable: true,
  },
  {
    id: "lmstudio",
    nombre: "LM Studio (este equipo)",
    base: "http://localhost:1234/v1",
    necesitaClave: false,
    listado: "openai",
    modeloPorDefecto: "",
    ayuda: "LM Studio con el servidor local encendido. Sin clave.",
    baseEditable: true,
  },
  {
    id: "personalizado",
    nombre: "Otro (compatible con OpenAI)",
    base: "",
    necesitaClave: true,
    listado: "openai",
    modeloPorDefecto: "",
    ayuda: "Cualquier servicio con /chat/completions al estilo OpenAI: pon su URL base y su clave.",
    baseEditable: true,
  },
];

export const PROVEEDOR_POR_DEFECTO = "ollama-cloud";

export function proveedorPorId(id: string): Proveedor | undefined {
  return PROVEEDORES.find((p) => p.id === id);
}

/** Lo que se guarda de cada proveedor en el servidor. */
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

/** Base efectiva (la editada si se puede editar), sin barra final. */
export function baseDe(p: Proveedor, ajustes: AjustesProveedor | undefined): string {
  const editada = p.baseEditable ? (ajustes?.base ?? "").trim() : "";
  return (editada || p.base).replace(/\/+$/, "");
}

/** Clave efectiva: la guardada o la del .env. */
export function claveDe(p: Proveedor, ajustes: AjustesProveedor | undefined, env: Record<string, string | undefined>): string {
  return (ajustes?.apiKey ?? "").trim() || (p.variableEnv ? (env[p.variableEnv] ?? "").trim() : "");
}

/** «sk-…f3a9»: para enseñar que hay clave sin enseñarla. */
export function claveOculta(clave: string): string {
  if (clave === "") return "";
  return clave.length <= 8 ? "••••" : `${clave.slice(0, 3)}…${clave.slice(-4)}`;
}

/**
 * El cuerpo de la petición, adaptado al proveedor. El agente lo escribe pensando
 * en Ollama; los demás rechazan campos que no conocen (OpenAI contesta 400 con
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

/** Nombres de modelo de la respuesta de `/models` (OpenAI) o `/api/tags` (Ollama). */
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
