/**
 * Trajectories: one whole agent turn per file, for the dataset and the audit trail
 * (docs/PLAN-MODELO-PROPIO.md, step 2).
 *
 *   POST /api/trayectorias   {nombre, trayectoria}  -> proyectos/<slug>/trayectorias/<nombre>
 *
 * The browser assembles the record (src/core/trayectoria.ts) at the end of every turn,
 * finished, cancelled or failed, and sends it with the project header. The body limit
 * is wider than the other routes: a 46-call turn carries every tool result whole plus
 * the project after the turn (a few MB, measured ~160 KB for the "Hard" project alone).
 * Nothing here can stop a turn: a failure is logged and answered, never thrown.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { CARPETA_TRAYECTORIAS } from "../../src/core/trayectoria.ts";

const LIMITE_CUERPO = 48 * 1024 * 1024;
const NOMBRE_VALIDO = /^[\p{L}\p{N}_-]+\.json$/u;

export function rutasTrayectorias(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, leerCuerpo, slugProyecto, resolverEnTrabajo, anotar, ficheroHerramientas } = ctx;

  server.middlewares.use("/api/trayectorias", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(
      req,
      res,
      (cuerpo) => {
        try {
          const datos = JSON.parse(cuerpo) as { nombre?: unknown; trayectoria?: unknown };
          const nombre = String(datos.nombre ?? "");
          if (!NOMBRE_VALIDO.test(nombre) || !datos.trayectoria || typeof datos.trayectoria !== "object") {
            responderJson(res, 400, { error: "expected {nombre: '<file>.json', trayectoria: {...}}" });
            return;
          }
          const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
          const relativo = `proyectos/${slug}/${CARPETA_TRAYECTORIAS}/${nombre}`;
          const destino = resolverEnTrabajo(relativo, slug);
          if (!destino) {
            responderJson(res, 403, { error: "path outside workspace/" });
            return;
          }
          mkdirSync(dirname(destino), { recursive: true });
          const texto = JSON.stringify(datos.trayectoria);
          writeFileSync(destino, texto, "utf8");
          anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "trayectoria", path: relativo, bytes: texto.length }));
          responderJson(res, 200, { ok: true, path: relativo, bytes: texto.length });
        } catch (error) {
          responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
      LIMITE_CUERPO,
    );
  });
}
