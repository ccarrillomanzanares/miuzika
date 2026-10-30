import assert from "node:assert/strict";
import test from "node:test";
import { adaptarCuerpo, baseDe, claveDe, claveOculta, modelosDeRespuesta, proveedorPorId } from "./proveedores.ts";

test("the key comes from what is stored or from .env, and never whole", () => {
  const ollama = proveedorPorId("ollama-cloud")!;
  assert.equal(claveDe(ollama, undefined, { OLLAMA_API_KEY: "abc123456789" }), "abc123456789");
  assert.equal(claveDe(ollama, { apiKey: "nueva-clave-1234" }, { OLLAMA_API_KEY: "vieja" }), "nueva-clave-1234");
  assert.equal(claveOculta("sk-proj-abcdef1234"), "sk-…1234");
  assert.equal(claveOculta(""), "");
});

test("the base is editable only for those that can be edited", () => {
  assert.equal(baseDe(proveedorPorId("openai")!, { base: "http://otra" }), "https://api.openai.com/v1");
  assert.equal(baseDe(proveedorPorId("ollama-local")!, { base: "http://192.168.1.5:11434/v1/" }), "http://192.168.1.5:11434/v1");
});

test("the body loses what the provider does not understand", () => {
  const cuerpo = { model: "x", keep_alive: "30m", reasoning_effort: "none", stream_options: { include_usage: true } };
  assert.deepEqual(adaptarCuerpo(proveedorPorId("ollama-cloud")!, cuerpo), cuerpo);
  const openai = adaptarCuerpo(proveedorPorId("openai")!, cuerpo);
  assert.equal(openai.keep_alive, undefined);
  assert.equal(openai.reasoning_effort, "none");
  const anthropic = adaptarCuerpo(proveedorPorId("anthropic")!, cuerpo);
  assert.deepEqual(Object.keys(anthropic), ["model"]);
});

test("models are read from /models and /api/tags", () => {
  assert.deepEqual(modelosDeRespuesta({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] }), ["gpt-a", "gpt-b"]);
  assert.deepEqual(modelosDeRespuesta({ models: [{ name: "qwen3:8b" }] }), ["qwen3:8b"]);
  assert.deepEqual(modelosDeRespuesta({ data: [{ id: "models/gemini-2.5-flash" }] }), ["gemini-2.5-flash"]);
});
