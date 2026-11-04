import { test } from "node:test";
import assert from "node:assert/strict";

import { ajustesEfectivos, gpuActiva, limpiarAjustesGpu } from "./proveedores-gpu.ts";

test("with only .env, everything stays as it was (MIUZIKA_LAMBDA=on and LAMBDA_*)", () => {
  const env = { MIUZIKA_LAMBDA: "on", LAMBDA_API_KEY: "k-env", LAMBDA_SSH_KEY: "/ruta/id" };
  assert.equal(gpuActiva(undefined, env), "lambda");
  assert.equal(gpuActiva(undefined, {}), "");
  const r = ajustesEfectivos("lambda", undefined, env);
  assert.equal(r.variables.LAMBDA_API_KEY, "k-env");
  assert.equal(r.origen.apiKey, "env");
  assert.equal(r.origen.region, "defecto");
  assert.equal(r.variables.LAMBDA_REGION, undefined, "defaults are left to the provider's reader");
});

test("the settings win over .env, field by field, and can switch the GPU off", () => {
  const env = { MIUZIKA_LAMBDA: "on", LAMBDA_API_KEY: "k-env", LAMBDA_REGION: "us-east-1" };
  const config = { activo: "", proveedores: { lambda: { region: "us-west-1" } } };
  assert.equal(gpuActiva(config, env), "", "activo: '' turns it off even with MIUZIKA_LAMBDA=on");
  assert.equal(gpuActiva({ activo: "lambda", proveedores: {} }, {}), "lambda");
  assert.equal(gpuActiva({ activo: "nadie", proveedores: {} }, env), "");
  const r = ajustesEfectivos("lambda", config, env);
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
