/**
 * Cancelling a GPU run (review 3-Nov, bug 3): the Lambda API is replaced by a fake
 * `fetch`, so no machine is launched and no money is spent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Cancelado, encender, ejecutarEnLambda, type ConfigLambda } from "./lambda.ts";

const cfg: ConfigLambda = {
  apiKey: "falsa",
  sshKey: "no-existe",
  sshKeyName: "k",
  usuario: "ubuntu",
  region: "us-east-1",
  tipo: "gpu_1x_a10",
  nombre: "miuzika-gpu",
  precioHora: 0.75,
};

/** Fake Lambda API: the instance list it is given, and a record of every call. */
function lambdaFalsa(lista: Record<string, unknown>[]) {
  const llamadas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const ruta = String(url).split("/api/v1/")[1] ?? "";
    llamadas.push(ruta);
    const cuerpo = ruta === "instances" ? { data: lista } : ruta === "instance-types" ? { data: {} } : { data: { instance_ids: ["nueva"] } };
    return new Response(JSON.stringify(cuerpo), { status: 200 });
  }) as typeof fetch;
  return { llamadas, restaurar: () => (globalThis.fetch = original) };
}

test("a cancel during the boot wait stops polling at once instead of waiting up to 9 minutes", async () => {
  const api = lambdaFalsa([{ id: "abc", status: "booting", ip: null, name: "miuzika-gpu" }]);
  try {
    const corte = new AbortController();
    const t0 = Date.now();
    setTimeout(() => corte.abort(), 50);
    await assert.rejects(encender(cfg, () => {}, corte.signal), Cancelado);
    assert.ok(Date.now() - t0 < 2000, "it did not sit in the 6 s poll");
    assert.ok(!api.llamadas.includes("instance-operations/launch"), "the booting instance is reused, not launched again");
  } finally {
    api.restaurar();
  }
});

test("a turn already cancelled never launches a machine", async () => {
  const api = lambdaFalsa([]);
  try {
    const corte = new AbortController();
    corte.abort();
    await assert.rejects(
      ejecutarEnLambda(cfg, { scriptRel: "gpu/generar_audio.py", argumentos: [], segundos: 60, carpetaTrabajo: ".", slug: "x", aviso: () => {}, senal: corte.signal }),
      Cancelado,
    );
    assert.deepEqual(api.llamadas.filter((r) => r.startsWith("instance-operations")), []);
  } finally {
    api.restaurar();
  }
});

test("a cancel while the instance list loads stops before the launch call that starts billing", async () => {
  const api = lambdaFalsa([]);
  const corte = new AbortController();
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const r = await original(url, init);
    corte.abort(); // the user cancels while the list is in flight
    return r;
  }) as typeof fetch;
  try {
    await assert.rejects(encender(cfg, () => {}, corte.signal), Cancelado);
    assert.ok(!api.llamadas.includes("instance-operations/launch"));
  } finally {
    globalThis.fetch = original;
    api.restaurar();
  }
});
