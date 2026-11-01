import { test } from "node:test";
import assert from "node:assert/strict";

import { ACUMULADO_CERO, avisoPrecios, detalleCosteLlm, textoCosteLlm, textoTarifa, tokens, usd, type EstadoCosteLlm } from "./coste-texto.ts";
import { TARIFA_LOCAL, type Tarifa } from "../../src/core/precios.ts";
import { fijarIdioma, olvidarIdioma } from "./i18n.ts";

const AHORA = Date.parse("2026-11-01T12:00:00Z");
const DEEPSEEK: Tarifa = { id: "deepseek/deepseek-v4.1-flash-1017", prompt: 0.00000015, completion: 0.0000006, cacheRead: 0.000000003 };

const base: EstadoCosteLlm = {
  proveedor: "ollama-cloud",
  modelo: "deepseek-v4.1-flash:1017",
  tarifa: DEEPSEEK,
  fechaPrecios: "2026-11-01T10:00:00Z",
  turno: { usd: 0.0358, llamadas: 27, turnos: 0, tokensNuevos: 13_000, tokensCache: 1_287_000, tokensSalida: 50_000 },
  sesion: { usd: 0.31, llamadas: 200, turnos: 6, tokensNuevos: 100_000, tokensCache: 9_000_000, tokensSalida: 300_000 },
};

test("usd: four decimals under a cent, two above", () => {
  fijarIdioma("en");
  assert.equal(usd(0.0036), "$0.0036");
  assert.equal(usd(0.0358), "$0.04");
  assert.equal(usd(1.2), "$1.20");
  assert.equal(usd(0), "$0.00");
  olvidarIdioma();
});

test("tokens: k and M", () => {
  fijarIdioma("en");
  assert.equal(tokens(812), "812");
  assert.equal(tokens(50_000), "50 k");
  assert.equal(tokens(1_300_000), "1.3 M");
  olvidarIdioma();
});

test("textoCosteLlm: turn and session, no warning with fresh prices; Ollama Cloud is an estimate", () => {
  fijarIdioma("en");
  assert.equal(textoCosteLlm(base, AHORA), "LLM ~$0.04 · $0.31 session");
  assert.match(detalleCosteLlm(base, AHORA), /Estimate: this provider bills a subscription/);
  const directo = { ...base, proveedor: "deepseek" };
  assert.equal(textoCosteLlm(directo, AHORA), "LLM $0.04 · $0.31 session");
  assert.doesNotMatch(detalleCosteLlm(directo, AHORA), /Estimate/);
  olvidarIdioma();
});

test("textoCosteLlm: the first turn of a session shows one number", () => {
  fijarIdioma("en");
  const e = { ...base, proveedor: "anthropic", sesion: { ...base.turno, turnos: 1 } };
  assert.equal(textoCosteLlm(e, AHORA), "LLM $0.04");
  olvidarIdioma();
});

test("textoCosteLlm: unknown model says so instead of inventing a number", () => {
  fijarIdioma("en");
  const e = { ...base, tarifa: null, modelo: "llama-3.3-70b-versatile" };
  assert.equal(textoCosteLlm(e, AHORA), "LLM price unknown · llama-3.3-70b-versatile");
  assert.match(detalleCosteLlm(e, AHORA), /Not in the OpenRouter price list/);
  olvidarIdioma();
});

test("textoCosteLlm: local models are free", () => {
  fijarIdioma("en");
  assert.equal(textoCosteLlm({ ...base, tarifa: TARIFA_LOCAL }, AHORA), "LLM local, free");
  olvidarIdioma();
});

test("avisoPrecios: warns from 72 h, and when there is no list", () => {
  fijarIdioma("en");
  assert.equal(avisoPrecios("2026-11-01T10:00:00Z", AHORA), null);
  assert.equal(avisoPrecios("2026-10-28T10:00:00Z", AHORA), "prices 4 d old");
  assert.equal(avisoPrecios(null, AHORA), "no price list");
  assert.equal(textoCosteLlm({ ...base, proveedor: "openai", fechaPrecios: "2026-10-28T10:00:00Z" }, AHORA), "LLM $0.04 · $0.31 session · ⚠ prices 4 d old");
  olvidarIdioma();
});

test("detalleCosteLlm: tokens, cache share, rate per million and the price date", () => {
  fijarIdioma("en");
  const d = detalleCosteLlm(base, AHORA);
  assert.match(d, /Model: deepseek-v4.1-flash:1017 \(ollama-cloud\)/);
  assert.match(d, /This turn: 27 calls · 1.3 M in \(99% cached\) · 50 k out · \$0.04/);
  assert.match(d, /This browser session: .* · 6 turns/);
  assert.match(d, /Rate deepseek\/deepseek-v4.1-flash-1017: \$0.15\/M in · \$0.003\/M cache · \$0.6\/M out/);
  assert.match(d, /Cache writes are not reported/);
  assert.match(d, /Prices from OpenRouter, downloaded/);
  olvidarIdioma();
});

test("detalleCosteLlm: in Spanish", () => {
  fijarIdioma("es");
  const d = detalleCosteLlm(base, AHORA);
  assert.match(d, /Modelo: /);
  assert.match(d, /Este turno: 27 llamadas/);
  assert.equal(textoCosteLlm({ ...base, tarifa: null }, AHORA), "LLM precio desconocido · deepseek-v4.1-flash:1017");
  assert.equal(avisoPrecios("2026-10-28T10:00:00Z", AHORA), "precios de hace 4 d");
  olvidarIdioma();
});

test("textoTarifa: the line under the model field in Models", () => {
  fijarIdioma("en");
  const linea = textoTarifa("deepseek", DEEPSEEK, "2026-11-01T10:00:00Z", AHORA);
  assert.match(linea, /^\$0.15\/M in · \$0.003\/M cache · \$0.6\/M out · ≈\$0.04 per typical turn/);
  assert.match(linea, /Prices from OpenRouter, downloaded/);
  assert.doesNotMatch(linea, /Estimate/);
  const nube = textoTarifa("ollama-cloud", DEEPSEEK, "2026-11-01T10:00:00Z", AHORA);
  assert.match(nube, /~\$0.04 per typical turn/);
  assert.match(nube, /Estimate: this provider bills a subscription/);
  assert.equal(textoTarifa("groq", null, "2026-11-01T10:00:00Z", AHORA), "Not in the OpenRouter price list: no cost is estimated.");
  assert.equal(textoTarifa("ollama-local", TARIFA_LOCAL, null, AHORA), "Runs on this machine: nothing to pay.");
  assert.match(textoTarifa("deepseek", DEEPSEEK, "2026-10-20T10:00:00Z", AHORA), /⚠ prices 12 d old/);
  olvidarIdioma();
});

test("ACUMULADO_CERO is all zeros", () => {
  assert.deepEqual(ACUMULADO_CERO, { usd: 0, llamadas: 0, turnos: 0, tokensNuevos: 0, tokensCache: 0, tokensSalida: 0 });
});
