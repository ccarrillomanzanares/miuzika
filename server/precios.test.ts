import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearAlmacenPrecios } from "./precios.ts";

const LISTA = {
  data: [
    { id: "deepseek/deepseek-v4.1-flash-1017", pricing: { prompt: "0.00000015", completion: "0.0000006", input_cache_read: "0.000000003" } },
    { id: "anthropic/claude-sonnet-5.5", pricing: { prompt: "0.000003", completion: "0.000015" } },
    { id: "openai/gpt-image-2", pricing: { image: "0.01" } },
  ],
};

const carpeta = (): string => mkdtempSync(join(tmpdir(), "miuzika-precios-"));

test("downloads at start-up when there is no copy, writes it and answers rates", async () => {
  const dir = carpeta();
  const fichero = join(dir, "precios.json");
  let descargas = 0;
  const almacen = crearAlmacenPrecios(fichero, async () => {
    descargas += 1;
    return LISTA;
  });
  await almacen.refrescar();
  assert.equal(descargas, 1, "the start-up download and the explicit one are the same in-flight request");
  assert.ok(existsSync(fichero));
  const estado = almacen.estado();
  assert.equal(estado.modelos, 2, "the image-only model has no token prices and is dropped");
  assert.equal(estado.error, null);
  assert.ok(estado.antiguedadHoras !== null && estado.antiguedadHoras < 0.1);
  assert.equal(almacen.tarifaPara("ollama-cloud", "deepseek-v4.1-flash:1017")?.id, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(almacen.tarifaPara("anthropic", "claude-sonnet-5-5")?.cacheRead, 0.000003);
  assert.equal(almacen.tarifaPara("groq", "llama-3.3-70b-versatile"), null);
  rmSync(dir, { recursive: true, force: true });
});

test("a fresh copy on disk is used without downloading", async () => {
  const dir = carpeta();
  const fichero = join(dir, "precios.json");
  writeFileSync(
    fichero,
    JSON.stringify({ fecha: new Date().toISOString(), fuente: "openrouter", tarifas: [{ id: "x/y", prompt: 1e-6, completion: 2e-6, cacheRead: 1e-7 }] }),
  );
  let descargas = 0;
  const almacen = crearAlmacenPrecios(fichero, async () => {
    descargas += 1;
    return LISTA;
  });
  await new Promise((listo) => setTimeout(listo, 20));
  assert.equal(descargas, 0);
  assert.equal(almacen.tarifaPara("openrouter", "x/y")?.prompt, 1e-6);
  rmSync(dir, { recursive: true, force: true });
});

test("a failed or empty download keeps the previous copy and reports the error", async () => {
  const dir = carpeta();
  const fichero = join(dir, "precios.json");
  const vieja = new Date(Date.now() - 48 * 3_600_000).toISOString();
  writeFileSync(fichero, JSON.stringify({ fecha: vieja, fuente: "openrouter", tarifas: [{ id: "x/y", prompt: 1e-6, completion: 2e-6, cacheRead: 1e-7 }] }));
  let respuesta: unknown = { data: [] };
  const almacen = crearAlmacenPrecios(fichero, async () => {
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  });
  // The copy is 48 h old: the start-up refresh runs, gets an empty list and keeps the copy.
  const estado = await almacen.refrescar();
  assert.equal(estado.modelos, 1);
  assert.equal(estado.fecha, vieja);
  assert.match(String(estado.error), /empty/);
  respuesta = new Error("HTTP 503");
  const estado2 = await almacen.refrescar();
  assert.equal(estado2.modelos, 1);
  assert.match(String(estado2.error), /503/);
  assert.equal(JSON.parse(readFileSync(fichero, "utf8")).fecha, vieja, "the file is untouched");
  // Local models never need the list.
  assert.equal(almacen.tarifaPara("ollama-local", "qwen3:8b")?.id, "local");
  rmSync(dir, { recursive: true, force: true });
});
