/**
 * POST /api/nota — one note from the app's "Note" box, appended to `.miuzika/notas.log` (see server/notas.ts).
 * Only the route reaches tmp/api.log, never the words.
 */

import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { rutaJson } from "../ruta.ts";
import { anotarNota, notaDe } from "../notas.ts";

export function rutasNotas(server: ViteDevServer, _ctx: Contexto): void {
  server.middlewares.use(
    "/api/nota",
    rutaJson({ metodo: "POST", limite: 256 * 1024 }, ({ datos, responder }) => {
      const r = notaDe(datos, new Date());
      if ("error" in r) {
        responder(400, { ok: false, error: r.error });
        return;
      }
      anotarNota(r.nota);
      responder(200, { ok: true, t: r.nota.t });
    }),
  );
}
