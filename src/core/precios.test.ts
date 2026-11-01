import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TARIFA_LOCAL,
  antiguedadHoras,
  claveModelo,
  costeDe,
  costeTurnoTipico,
  tarifaDesdeOpenRouter,
  tarifaPara,
  tarifaVigente,
  type Tarifa,
} from "./precios.ts";

// Real entries from https://openrouter.ai/api/v1/models on 1-Nov-2026 (trimmed).
const DEEPSEEK_FLASH = {
  id: "deepseek/deepseek-v4.1-flash-1017",
  pricing: {
    prompt: "0.00000015",
    completion: "0.0000006",
    input_cache_read: "0.000000003",
    overrides: [
      { utc_days: ["saturday", "sunday"], prompt: "0.00000015", completion: "0.0000006", input_cache_read: "0.000000003" },
      { utc_days: ["monday", "tuesday", "wednesday", "thursday", "friday"], utc_start: 100, utc_end: 400, prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.000000006" },
      { utc_days: ["monday", "tuesday", "wednesday", "thursday", "friday"], utc_start: 1000, utc_end: 0, prompt: "0.00000015", completion: "0.0000006", input_cache_read: "0.000000003" },
    ],
  },
};
const SONNET = {
  id: "anthropic/claude-sonnet-4.5",
  pricing: {
    prompt: "0.000003",
    completion: "0.000015",
    input_cache_read: "0.0000003",
    input_cache_write: "0.00000375",
    overrides: [{ min_prompt_tokens: 200000, prompt: "0.000006", completion: "0.0000225", input_cache_read: "0.0000006" }],
  },
};
const LISTA: Tarifa[] = [
  tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!,
  tarifaDesdeOpenRouter({ id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.000000045", completion: "0.0000005" } })!,
  tarifaDesdeOpenRouter({ id: "deepseek/deepseek-v4.1-flash:batch", pricing: { prompt: "0.00000005", completion: "0.00000015" } })!,
  tarifaDesdeOpenRouter(SONNET)!,
  tarifaDesdeOpenRouter({ id: "anthropic/claude-sonnet-5.5", pricing: { prompt: "0.000003", completion: "0.000015" } })!,
  tarifaDesdeOpenRouter({ id: "anthropic/claude-sonnet-5.5:batch", pricing: { prompt: "0.0000015", completion: "0.0000075" } })!,
  tarifaDesdeOpenRouter({ id: "mistralai/mistral-large", pricing: { prompt: "0.000002", completion: "0.000006" } })!,
  tarifaDesdeOpenRouter({ id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } })!,
  // Same short name under another vendor: must not be picked for Google.
  tarifaDesdeOpenRouter({ id: "someone/gemini-2.5-flash", pricing: { prompt: "0", completion: "0" } })!,
];

test("tarifaDesdeOpenRouter: parses prices, cache price and overrides", () => {
  const t = tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!;
  assert.equal(t.id, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(t.prompt, 0.00000015);
  assert.equal(t.cacheRead, 0.000000003);
  assert.equal(t.overrides?.length, 3);
  assert.deepEqual(t.overrides?.[1].utcDays, ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  assert.equal(t.overrides?.[1].utcStart, 100);
  assert.equal(t.overrides?.[2].utcEnd, 0);
});

test("tarifaDesdeOpenRouter: without a cache price, cached input costs as new input", () => {
  const t = tarifaDesdeOpenRouter({ id: "x/y", pricing: { prompt: "0.000001", completion: "0.000002" } })!;
  assert.equal(t.cacheRead, 0.000001);
  assert.equal(t.overrides, undefined);
});

test("tarifaDesdeOpenRouter: rejects entries without prices", () => {
  assert.equal(tarifaDesdeOpenRouter({ id: "x/y" }), null);
  assert.equal(tarifaDesdeOpenRouter({ id: "x/y", pricing: { image: "0.01" } }), null);
  assert.equal(tarifaDesdeOpenRouter(null), null);
  assert.equal(tarifaDesdeOpenRouter({ pricing: { prompt: "1", completion: "1" } }), null);
});

test("tarifaVigente: DeepSeek doubles between 01:00 and 04:00 UTC on weekdays only", () => {
  const t = tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!;
  // Tuesday 3-Nov-2026 02:30 UTC: inside the expensive window.
  assert.equal(tarifaVigente(t, new Date("2026-11-03T02:30:00Z")).prompt, 0.0000003);
  // Tuesday 12:00 UTC: window "1000 to 0" (until midnight), base price.
  assert.equal(tarifaVigente(t, new Date("2026-11-03T12:00:00Z")).prompt, 0.00000015);
  // Tuesday 23:59 UTC: still inside "1000 to 0".
  assert.equal(tarifaVigente(t, new Date("2026-11-03T23:59:00Z")).prompt, 0.00000015);
  // Sunday 02:30 UTC: the weekend override wins (base price).
  assert.equal(tarifaVigente(t, new Date("2026-11-01T02:30:00Z")).prompt, 0.00000015);
  // Tuesday 05:00 UTC: no window matches, base price.
  assert.equal(tarifaVigente(t, new Date("2026-11-03T05:00:00Z")).prompt, 0.00000015);
});

test("tarifaVigente: Anthropic charges more from 200k prompt tokens", () => {
  const t = tarifaDesdeOpenRouter(SONNET)!;
  const fecha = new Date("2026-11-03T12:00:00Z");
  assert.equal(tarifaVigente(t, fecha, 48_000).prompt, 0.000003);
  assert.equal(tarifaVigente(t, fecha, 250_000).prompt, 0.000006);
  assert.equal(tarifaVigente(t, fecha, 250_000).cacheRead, 0.0000006);
});

test("costeDe: a typical Hard turn with DeepSeek (1.3 M input, 99% cached, 50 k output)", () => {
  const t = tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!;
  const uso = { prompt_tokens: 1_300_000, completion_tokens: 50_000, prompt_tokens_details: { cached_tokens: 1_287_000 } };
  const c = costeDe(t, uso, new Date("2026-11-01T12:00:00Z"));
  assert.equal(c.tokensNuevos, 13_000);
  assert.equal(c.tokensCache, 1_287_000);
  assert.equal(c.tokensSalida, 50_000);
  // 13k*0.15e-6 + 1.287M*3e-9 + 50k*0.6e-6 = 0.00195 + 0.003861 + 0.03
  assert.ok(Math.abs(c.usd - 0.035811) < 1e-9, String(c.usd));
});

test("costeDe: the same turn with Sonnet 4.5 is ~1.2 USD", () => {
  const t = tarifaDesdeOpenRouter(SONNET)!;
  const uso = { prompt_tokens: 1_300_000, completion_tokens: 50_000, prompt_tokens_details: { cached_tokens: 1_287_000 } };
  // 1.3 M prompt tokens in ONE call would trigger the >200k override; a real turn is
  // ~27 calls of 48k each, so the cost is computed per call. Here: one 48k call × 27.
  const porLlamada = costeDe(t, { prompt_tokens: 48_148, completion_tokens: 1_852, prompt_tokens_details: { cached_tokens: 47_667 } }, new Date("2026-11-01T12:00:00Z"));
  const total = porLlamada.usd * 27;
  assert.ok(total > 1.0 && total < 1.4, String(total));
  assert.equal(costeDe(t, uso).tokensCache, 1_287_000);
});

test("costeDe: DeepSeek's native usage shape and missing usage", () => {
  const t = tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!;
  const c = costeDe(t, { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 }, new Date("2026-11-01T12:00:00Z"));
  assert.equal(c.tokensCache, 900);
  assert.equal(c.tokensNuevos, 100);
  const vacio = costeDe(t, null);
  assert.equal(vacio.usd, 0);
  assert.equal(vacio.tokensSalida, 0);
});

test("costeDe: cached tokens never exceed prompt tokens (a provider bug must not go negative)", () => {
  const t = tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!;
  const c = costeDe(t, { prompt_tokens: 100, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 500 } });
  assert.equal(c.tokensNuevos, 0);
  assert.equal(c.tokensCache, 100);
});

test("claveModelo: Anthropic, Ollama and OpenRouter spellings collapse to one key", () => {
  assert.equal(claveModelo("claude-sonnet-5-5"), claveModelo("claude-sonnet-5.5"));
  assert.equal(claveModelo("deepseek-v4.1-flash:1017"), claveModelo("deepseek-v4.1-flash-1017"));
  assert.equal(claveModelo("models/gemini-2.5-flash"), "gemini-25-flash");
  assert.notEqual(claveModelo("deepseek-v4.1-flash:batch"), claveModelo("deepseek-v4.1-flash"));
});

test("tarifaPara: Ollama Cloud's default model finds its OpenRouter twin", () => {
  assert.equal(tarifaPara("ollama-cloud", "deepseek-v4.1-flash:1017", LISTA)?.id, "deepseek/deepseek-v4.1-flash-1017");
});

test("tarifaPara: the plain variant beats :batch, and the vendor prefix is enforced", () => {
  assert.equal(tarifaPara("anthropic", "claude-sonnet-5-5", LISTA)?.id, "anthropic/claude-sonnet-5.5");
  assert.equal(tarifaPara("google", "gemini-2.5-flash", LISTA)?.id, "google/gemini-2.5-flash");
  assert.equal(tarifaPara("deepseek", "claude-sonnet-5-5", LISTA), null);
});

test("tarifaPara: '-latest' falls back to the bare name; unknown models give null", () => {
  assert.equal(tarifaPara("mistral", "mistral-large-latest", LISTA)?.id, "mistralai/mistral-large");
  assert.equal(tarifaPara("groq", "llama-3.3-70b-versatile", LISTA), null);
  assert.equal(tarifaPara("openai", "", LISTA), null);
});

test("tarifaPara: OpenRouter ids are looked up as they are; local providers are free", () => {
  assert.equal(tarifaPara("openrouter", "deepseek/deepseek-v4.1-flash:batch", LISTA)?.completion, 0.00000015);
  assert.equal(tarifaPara("openrouter", "deepseek-v4.1-flash:batch", LISTA), null);
  assert.equal(tarifaPara("ollama-local", "qwen3:8b", LISTA), TARIFA_LOCAL);
  assert.equal(tarifaPara("lmstudio", "", []), TARIFA_LOCAL);
});

test("costeTurnoTipico: ~0.04 $ with DeepSeek Flash, ~1.2 $ with Sonnet 4.5, 0 locally", () => {
  const fecha = new Date("2026-11-01T12:00:00Z");
  const flash = costeTurnoTipico(tarifaDesdeOpenRouter(DEEPSEEK_FLASH)!, fecha);
  assert.ok(flash > 0.03 && flash < 0.05, String(flash));
  const sonnet = costeTurnoTipico(tarifaDesdeOpenRouter(SONNET)!, fecha);
  assert.ok(sonnet > 1.0 && sonnet < 1.4, String(sonnet));
  assert.equal(costeTurnoTipico(TARIFA_LOCAL, fecha), 0);
});

test("antiguedadHoras", () => {
  const ahora = Date.parse("2026-11-01T12:00:00Z");
  assert.equal(antiguedadHoras("2026-11-01T00:00:00Z", ahora), 12);
  assert.equal(antiguedadHoras(null, ahora), null);
  assert.equal(antiguedadHoras("not a date", ahora), null);
  // A clock skew must not give a negative age.
  assert.equal(antiguedadHoras("2026-11-02T00:00:00Z", ahora), 0);
});
