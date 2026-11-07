import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { registroApi, rutaJson } from "./ruta.ts";

async function servir(
  manejador: (req: IncomingMessage, res: ServerResponse) => void,
  prueba: (base: string) => Promise<void>,
): Promise<void> {
  const servidor = createServer(manejador);
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  const { port } = servidor.address() as AddressInfo;
  try {
    await prueba(`http://127.0.0.1:${port}`);
  } finally {
    servidor.close();
  }
}

test("POST: parses the body and answers", async () => {
  const ruta = rutaJson<{ a?: number }>({ metodo: "POST" }, ({ datos, responder }) => {
    responder(200, { doble: (datos.a ?? 0) * 2 });
  });
  await servir(ruta, async (base) => {
    const r = await fetch(`${base}/api/x`, { method: "POST", body: JSON.stringify({ a: 21 }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { doble: 42 });
  });
});

test("wrong method is 405, bad JSON is 400, an exception is 500 with its message", async () => {
  const ruta = rutaJson({ metodo: "POST" }, () => {
    throw new Error("broke");
  });
  await servir(ruta, async (base) => {
    const g = await fetch(`${base}/api/x`);
    assert.equal(g.status, 405);
    assert.deepEqual(await g.json(), { error: "use POST" });
    const mal = await fetch(`${base}/api/x`, { method: "POST", body: "{no" });
    assert.equal(mal.status, 400);
    assert.match(((await mal.json()) as { error: string }).error, /^invalid JSON/);
    const e = await fetch(`${base}/api/x`, { method: "POST", body: "{}" });
    assert.equal(e.status, 500);
    assert.deepEqual(await e.json(), { ok: false, error: "broke" });
  });
});

test("an empty POST body is {} and a body over the limit names the route's own limit", async () => {
  const ruta = rutaJson({ metodo: "POST", limite: 2 * 1024 * 1024 }, ({ datos, responder }) => {
    responder(200, datos);
  });
  await servir(ruta, async (base) => {
    const vacio = await fetch(`${base}/api/x`, { method: "POST" });
    assert.deepEqual(await vacio.json(), {});
    const grande = await fetch(`${base}/api/x`, { method: "POST", body: "x".repeat(3 * 1024 * 1024) });
    assert.equal(grande.status, 413);
    assert.deepEqual(await grande.json(), { error: "body too large (max. 2 MB)" });
  });
});

test("GET gets the query in url", async () => {
  const ruta = rutaJson({ metodo: "GET" }, ({ url, responder }) => {
    responder(200, { c: url.searchParams.get("c") });
  });
  await servir(ruta, async (base) => {
    const r = await fetch(`${base}/api/x?c=hola`);
    assert.deepEqual(await r.json(), { c: "hola" });
  });
});

test("registroApi logs route, method, status and ms, and skips the polled routes", async () => {
  const lineas: string[] = [];
  const registro = registroApi((l) => lineas.push(l), new Set(["/api/build"]));
  const manejador = (req: IncomingMessage, res: ServerResponse): void =>
    registro(req, res, () => {
      res.statusCode = req.url?.startsWith("/api/no") ? 404 : 200;
      res.end("x");
    });
  await servir(manejador, async (base) => {
    await (await fetch(`${base}/api/fs/read?c=1`, { method: "POST" })).text();
    await (await fetch(`${base}/api/no`)).text();
    await (await fetch(`${base}/api/build`)).text();
    await (await fetch(`${base}/index.html`)).text();
  });
  const leidas = lineas.map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(
    leidas.map((l) => [l.ruta, l.metodo, l.estado]),
    [
      ["/api/fs/read", "POST", 200],
      ["/api/no", "GET", 404],
    ],
  );
  assert.equal(typeof leidas[0].ms, "number");
});
