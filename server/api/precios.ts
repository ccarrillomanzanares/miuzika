/**
 * Model prices for the interface.
 *
 *   GET  /api/precios                       state of the list: date, age in hours, how many models
 *   GET  /api/precios?proveedor=&modelo=    the rate for that pair (null when unknown) + the state
 *   POST /api/precios/refrescar             downloads the list now
 *
 * The browser prices each call with src/core/precios.ts and this rate; the server
 * writes the same number into tmp/llm.log (contexto.ts, `tarifarLinea`).
 */

import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasPrecios(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, precios } = ctx;

  server.middlewares.use("/api/precios/refrescar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    precios
      .refrescar()
      .then((estado) => responderJson(res, 200, { ok: estado.error === null, ...estado }))
      .catch((error: unknown) => responderJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }));
  });

  server.middlewares.use("/api/precios", (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/") {
      next();
      return;
    }
    const proveedor = url.searchParams.get("proveedor");
    const modelo = url.searchParams.get("modelo");
    const estado = precios.estado();
    if (proveedor === null && modelo === null) {
      responderJson(res, 200, { ok: true, ...estado });
      return;
    }
    responderJson(res, 200, { ok: true, ...estado, tarifa: precios.tarifaPara(proveedor ?? "", modelo ?? "") });
  });
}
