import { test } from "node:test";
import assert from "node:assert/strict";

import { ajustesEfectivos, claveOculta, faltanLegibles, limpiarAjustesGpu } from "./proveedores-gpu.ts";

test("with only .env, its values are the ones in force", () => {
  const env = { LAMBDA_API_KEY: "k-env", LAMBDA_SSH_KEY: "/ruta/id" };
  const r = ajustesEfectivos("lambda", undefined, env);
  assert.equal(r.variables.LAMBDA_API_KEY, "k-env");
  assert.equal(r.origen.apiKey, "env");
  assert.equal(r.origen.region, "defecto");
  assert.equal(r.variables.LAMBDA_REGION, undefined, "defaults are left to the provider's reader");
});

test("the settings win over .env, field by field", () => {
  const env = { LAMBDA_API_KEY: "k-env", LAMBDA_REGION: "us-east-1" };
  const r = ajustesEfectivos("lambda", { proveedores: { lambda: { region: "us-west-1" } } }, env);
  assert.equal(r.variables.LAMBDA_REGION, "us-west-1");
  assert.equal(r.origen.region, "ajustes");
  assert.equal(r.variables.LAMBDA_API_KEY, "k-env");
  assert.equal(r.origen.sshKey, "falta");
});

test("saving keeps the secret when the form leaves it empty, and an empty field falls back", () => {
  const previos = { apiKey: "secreta", region: "us-west-1" };
  const s = limpiarAjustesGpu("lambda", { apiKey: "", region: "", tipo: " gpu_1x_a100 ", inventado: "x" }, previos);
  assert.deepEqual(s, { apiKey: "secreta", tipo: "gpu_1x_a100" });
  assert.deepEqual(limpiarAjustesGpu("nadie", { apiKey: "x" }), {});
});

test("a path copied with Windows' Copy as path loses its quotes", () => {
  assert.equal(limpiarAjustesGpu("lambda", { sshKey: ' "C:\\Users\\x\\key" ' }).sshKey, "C:\\Users\\x\\key");
});

test("a secret shows only its last digits, and nothing of a short one", () => {
  assert.equal(claveOculta(""), "");
  assert.equal(claveOculta("12345678"), "••••");
  assert.equal(claveOculta("secret_abcdefghijkl"), "…ijkl");
});

test("what is missing is said with the form's labels", () => {
  assert.deepEqual(faltanLegibles("lambda", ["LAMBDA_API_KEY", "LAMBDA_SSH_KEY (does not exist: C:/k)"]), ["API key", "SSH key file (does not exist: C:/k)"]);
});
