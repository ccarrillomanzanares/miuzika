import { test } from "node:test";
import assert from "node:assert/strict";

import { ejecutarHerramienta, resumenLlamada } from "./tools.ts";

/** Runs escribir_fichero against a fake /api/fs/write and returns what the server got. */
async function escribir(args: Record<string, unknown>): Promise<{ ok: boolean; texto: string; cuerpo: unknown }> {
  const original = globalThis.fetch;
  let cuerpo: unknown = null;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    cuerpo = JSON.parse(String(init?.body ?? "null"));
    const c = cuerpo as { path: string; contenido: string };
    return new Response(JSON.stringify({ path: c.path, bytes: c.contenido.length }));
  }) as typeof fetch;
  try {
    const r = await ejecutarHerramienta("escribir_fichero", JSON.stringify(args));
    return { ok: r.ok, texto: r.texto, cuerpo };
  } finally {
    globalThis.fetch = original;
  }
}

test("escribir_fichero takes `content` as an alias of `contenido`", async () => {
  // 2-Nov: DeepSeek v4.1 flash sent `content` six times; three in a row aborted the turn.
  const r = await escribir({ path: "codigo/x.py", content: "print(1)\n" });
  assert.equal(r.ok, true, r.texto);
  assert.deepEqual(r.cuerpo, { path: "codigo/x.py", contenido: "print(1)\n" });
  assert.equal(resumenLlamada("escribir_fichero", JSON.stringify({ path: "a/x.py", content: "abc" })), "writing x.py (3 chars)");
});

test("escribir_fichero without text says what is missing and writes nothing", async () => {
  const r = await escribir({ path: "codigo/x.py" });
  assert.equal(r.ok, false);
  assert.match(r.texto, /Missing `contenido`/);
  assert.equal(r.cuerpo, null);
});
