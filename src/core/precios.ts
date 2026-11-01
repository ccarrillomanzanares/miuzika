/**
 * Model prices and the cost of a call.
 *
 * Carlos asked on 1-Nov that any cost shown in the app for the paid ("advanced")
 * mode update by itself: no hand-kept price table. The source is OpenRouter's public
 * model list (https://openrouter.ai/api/v1/models, no key needed), which lists per-token
 * prices for every provider we offer in "Models" (452 models on 1-Nov-2026), including
 * the cached-input price and time-of-day overrides (DeepSeek charges double in some
 * UTC windows on weekdays).
 *
 * This module is pure: parsing an entry, finding the entry for a (provider, model)
 * pair, and multiplying a `usage` block by the rate. The server downloads and caches
 * the list (server/precios.ts); the browser shows the result (web/src/coste-llm.ts).
 *
 * Measured on the 28-Oct "Hard" session (tmp/llm.log): a composing turn is 23 to 46
 * calls, 1.0 to 1.7 M input tokens of which 99% are cache reads, and 12 k to 97 k
 * output tokens. So the cached-input price, not the list price, decides the cost.
 */

/** Prices in USD per token, as OpenRouter publishes them. */
export interface Tarifa {
  /** OpenRouter model id (e.g. "deepseek/deepseek-v4.1-flash-1017"), or "local". */
  id: string;
  /** Uncached input token. */
  prompt: number;
  /** Output token (reasoning tokens are counted here too). */
  completion: number;
  /** Input token read from the cache; when unknown, equals `prompt`. */
  cacheRead: number;
  /** Variants that apply in a time window or above a prompt size. */
  overrides?: TarifaOverride[];
}

export interface TarifaOverride {
  /** Lowercase English weekday names (UTC). Missing = every day. */
  utcDays?: string[];
  /** HHMM in UTC (0 = midnight, 1000 = 10:00). Missing = whole day. `utcEnd` 0 means midnight. */
  utcStart?: number;
  utcEnd?: number;
  /** Applies when the call's prompt_tokens reach this size (Anthropic >200k). */
  minPromptTokens?: number;
  prompt: number;
  completion: number;
  cacheRead: number;
}

/** Token counts of one call, in the OpenAI-compatible shape every provider returns. */
export interface UsoLlm {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  /** DeepSeek's native API names the split differently. */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

/** The cost of one call, broken down so the interface can explain the number. */
export interface Coste {
  usd: number;
  tokensNuevos: number;
  tokensCache: number;
  tokensSalida: number;
}

/** Free rate for models that run on this machine (Ollama local, LM Studio). */
export const TARIFA_LOCAL: Tarifa = { id: "local", prompt: 0, completion: 0, cacheRead: 0 };

/** Providers whose models run locally: nothing to pay, nothing to look up. */
const PROVEEDORES_LOCALES = new Set(["ollama-local", "lmstudio"]);

/** OpenRouter vendor prefix of each direct provider (to break ties and to avoid
 *  matching a different vendor's model with the same short name). */
const PREFIJO_POR_PROVEEDOR: Record<string, string> = {
  anthropic: "anthropic/",
  openai: "openai/",
  google: "google/",
  deepseek: "deepseek/",
  mistral: "mistralai/",
};

const numero = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * One entry of OpenRouter's `/api/v1/models` -> Tarifa (null if it has no usable
 * prices, e.g. image-only models or a malformed entry).
 */
export function tarifaDesdeOpenRouter(entrada: unknown): Tarifa | null {
  const e = (entrada ?? {}) as { id?: unknown; pricing?: Record<string, unknown> };
  if (typeof e.id !== "string" || e.id === "" || !e.pricing || typeof e.pricing !== "object") return null;
  const p = e.pricing;
  const prompt = numero(p.prompt);
  const completion = numero(p.completion);
  if (prompt === null || completion === null) return null;
  const base: Tarifa = { id: e.id, prompt, completion, cacheRead: numero(p.input_cache_read) ?? prompt };
  if (Array.isArray(p.overrides)) {
    const overrides: TarifaOverride[] = [];
    for (const cruda of p.overrides as Record<string, unknown>[]) {
      if (!cruda || typeof cruda !== "object") continue;
      const op = numero(cruda.prompt) ?? base.prompt;
      const oc = numero(cruda.completion) ?? base.completion;
      const o: TarifaOverride = { prompt: op, completion: oc, cacheRead: numero(cruda.input_cache_read) ?? op };
      if (Array.isArray(cruda.utc_days)) o.utcDays = cruda.utc_days.map((d) => String(d).toLowerCase());
      const inicio = numero(cruda.utc_start);
      const fin = numero(cruda.utc_end);
      if (inicio !== null) o.utcStart = inicio;
      if (fin !== null) o.utcEnd = fin;
      const minimo = numero(cruda.min_prompt_tokens);
      if (minimo !== null) o.minPromptTokens = minimo;
      overrides.push(o);
    }
    if (overrides.length > 0) base.overrides = overrides;
  }
  return base;
}

const DIAS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Does this override apply at `fecha` (UTC) for a call of `promptTokens`? */
function aplica(o: TarifaOverride, fecha: Date, promptTokens: number): boolean {
  if (o.minPromptTokens !== undefined && promptTokens < o.minPromptTokens) return false;
  if (o.utcDays && !o.utcDays.includes(DIAS[fecha.getUTCDay()])) return false;
  if (o.utcStart !== undefined || o.utcEnd !== undefined) {
    const hhmm = fecha.getUTCHours() * 100 + fecha.getUTCMinutes();
    const inicio = o.utcStart ?? 0;
    // OpenRouter writes the end of the day as 0 (observed in DeepSeek's windows on 1-Nov-2026).
    const fin = o.utcEnd === undefined || o.utcEnd === 0 ? 2400 : o.utcEnd;
    if (hhmm < inicio || hhmm >= fin) return false;
  }
  return true;
}

/** The three prices in force for a call made at `fecha` with `promptTokens` of input. */
export function tarifaVigente(
  tarifa: Tarifa,
  fecha: Date,
  promptTokens = 0,
): { prompt: number; completion: number; cacheRead: number } {
  for (const o of tarifa.overrides ?? []) {
    if (aplica(o, fecha, promptTokens)) return { prompt: o.prompt, completion: o.completion, cacheRead: o.cacheRead };
  }
  return { prompt: tarifa.prompt, completion: tarifa.completion, cacheRead: tarifa.cacheRead };
}

/**
 * Cost of one call in USD. Cache WRITES are not charged: the OpenAI-compatible
 * `usage` block does not report them, so this is a lower bound for providers that
 * bill them (Anthropic). Reasoning tokens are inside completion_tokens and paid as output.
 */
export function costeDe(tarifa: Tarifa, uso: UsoLlm | null | undefined, fecha = new Date()): Coste {
  const prompt = Math.max(0, Number(uso?.prompt_tokens) || 0);
  const salida = Math.max(0, Number(uso?.completion_tokens) || 0);
  const cacheDetalle = Number(uso?.prompt_tokens_details?.cached_tokens);
  const cacheDeepSeek = Number(uso?.prompt_cache_hit_tokens);
  const declarado = Number.isFinite(cacheDetalle) ? cacheDetalle : Number.isFinite(cacheDeepSeek) ? cacheDeepSeek : 0;
  const cache = Math.min(prompt, Math.max(0, declarado));
  const nuevos = prompt - cache;
  const precios = tarifaVigente(tarifa, fecha, prompt);
  return {
    usd: nuevos * precios.prompt + cache * precios.cacheRead + salida * precios.completion,
    tokensNuevos: nuevos,
    tokensCache: cache,
    tokensSalida: salida,
  };
}

/**
 * Comparable key of a model name: lowercase, ':' and '_' as '-', and no separator
 * between digits, so "claude-sonnet-5-5" (Anthropic's API) and "claude-sonnet-5.5"
 * (OpenRouter) are the same, as are "deepseek-v4.1-flash:1017" (Ollama) and
 * "deepseek-v4.1-flash-1017".
 */
export function claveModelo(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/[:_]/g, "-")
    .replace(/(\d)[.-](?=\d)/g, "$1")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The OpenRouter rate for the model the agent uses with a provider; null when the
 * list has no match (the interface then says "price unknown": a wrong number is
 * worse than none). Rules, in order:
 *   - local providers: free;
 *   - OpenRouter itself: the id as is;
 *   - otherwise, entries whose short name (after "vendor/") has the same key, trying
 *     also without a "-latest" suffix; among several, the provider's vendor prefix
 *     wins, then the shortest id (the plain variant over ":batch" or ":free").
 */
export function tarifaPara(proveedor: string, modelo: string, tarifas: readonly Tarifa[]): Tarifa | null {
  if (PROVEEDORES_LOCALES.has(proveedor)) return TARIFA_LOCAL;
  const nombre = modelo.trim();
  if (nombre === "") return null;
  if (proveedor === "openrouter") return tarifas.find((t) => t.id === nombre) ?? null;
  const prefijo = PREFIJO_POR_PROVEEDOR[proveedor];
  const claves = [claveModelo(nombre)];
  if (claves[0].endsWith("-latest")) claves.push(claves[0].slice(0, -"-latest".length));
  for (const clave of claves) {
    const candidatas = tarifas.filter((t) => {
      if (prefijo && !t.id.startsWith(prefijo)) return false;
      const corto = t.id.includes("/") ? t.id.slice(t.id.indexOf("/") + 1) : t.id;
      return claveModelo(corto) === clave;
    });
    if (candidatas.length === 0) continue;
    candidatas.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    return candidatas[0];
  }
  return null;
}

/**
 * A typical composing turn, measured on the 28-Oct "Hard" session (tmp/llm.log, 8
 * turns): 23 to 46 calls, 1.0 to 1.7 M input tokens of which 99% were cache reads, 12
 * to 97 k output. The middle of that range, used to show "about X $ per turn" when a
 * model is chosen in "Models". Per call (not per turn) so size-based overrides apply
 * as they would in practice: ~27 calls of 48 k.
 */
export const TURNO_TIPICO = { llamadas: 27, promptPorLlamada: 48_148, cachePorLlamada: 47_667, salidaPorLlamada: 1_852 } as const;

/** Estimated cost in USD of a typical turn (TURNO_TIPICO) at this rate, at `fecha`. */
export function costeTurnoTipico(tarifa: Tarifa, fecha = new Date()): number {
  const porLlamada = costeDe(
    tarifa,
    {
      prompt_tokens: TURNO_TIPICO.promptPorLlamada,
      completion_tokens: TURNO_TIPICO.salidaPorLlamada,
      prompt_tokens_details: { cached_tokens: TURNO_TIPICO.cachePorLlamada },
    },
    fecha,
  );
  return porLlamada.usd * TURNO_TIPICO.llamadas;
}

/** Hours since the list was downloaded (null if there is no date). */
export function antiguedadHoras(fecha: string | null | undefined, ahora = Date.now()): number | null {
  if (!fecha) return null;
  const t = Date.parse(fecha);
  return Number.isFinite(t) ? Math.max(0, (ahora - t) / 3_600_000) : null;
}

/** A price list older than this is shown with a warning (OpenRouter changes prices without notice). */
export const HORAS_PRECIOS_VIEJOS = 72;
