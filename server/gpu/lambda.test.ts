/** Lambda behind ProveedorGpu: a fake fetch, so nothing is launched and nothing is billed. */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ConfigLambda } from "../lambda.ts";
import { proveedorLambda } from "./lambda.ts";

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

test("the provider names itself and only offers our instances for shutdown", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const ruta = String(url).split("/api/v1/")[1] ?? "";
    const data =
      ruta === "instances"
        ? [
            { id: "nuestra", status: "active", ip: "1.2.3.4", name: "miuzika-gpu" },
            // 4-Nov: someone else's, stuck in "terminating" for a year on the shared account.
            { id: "ajena", status: "terminating", ip: "5.6.7.8", name: null },
            { id: "otra", status: "active", ip: "9.9.9.9", name: "otro-proyecto" },
          ]
        : {};
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
  try {
    const gpu = proveedorLambda(cfg);
    assert.equal(gpu.id, "lambda");
    assert.equal(gpu.etiqueta, "miuzika-gpu");
    assert.equal(gpu.region, "us-east-1");
    assert.deepEqual((await gpu.apagables()).map((i) => i.id), ["nuestra"]);
  } finally {
    globalThis.fetch = original;
  }
});
