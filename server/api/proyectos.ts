/** The master file of each project: `proyectos/<slug>/proyecto.json`. */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasProyectos(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, leerCuerpo, resolverEnTrabajo, listarProyectosDisco } = ctx;

  // Master file per project: proyectos/<slug>/proyecto.json.
  // GET without path -> inventory; GET with path -> full content (without the
  // 20 KB cut of /api/fs/read: a project with thousands of notes does not fit).
  // POST -> writes the master (creates the project folder).
  server.middlewares.use("/api/proyectos", (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.searchParams.get("path") ?? "";

    if (req.method === "GET") {
      if (!rel) {
        responderJson(res, 200, { ok: true, raiz: "workspace/proyectos/", proyectos: listarProyectosDisco() });
        return;
      }
      const destino = resolverEnTrabajo(rel);
      if (!destino || !existsSync(destino)) {
        responderJson(res, 404, { error: `${rel} does not exist` });
        return;
      }
      if (!destino.endsWith("proyecto.json")) {
        responderJson(res, 400, { error: "only proyecto.json files are read through here" });
        return;
      }
      if (statSync(destino).size > 64 * 1024 * 1024) {
        responderJson(res, 413, { error: "the project is over 64 MB: it is not a miuzika project" });
        return;
      }
      responderJson(res, 200, { ok: true, path: rel, contenido: readFileSync(destino, "utf8") });
      return;
    }

    if (req.method === "POST") {
      leerCuerpo(req, res, (cuerpo) => {
        try {
          const datos = JSON.parse(cuerpo) as { path?: string; contenido?: string };
          if (!datos.path || typeof datos.contenido !== "string" || datos.contenido.trim() === "") {
            responderJson(res, 400, { error: "missing 'path' or 'contenido'" });
            return;
          }
          const destino = resolverEnTrabajo(datos.path);
          if (!destino || !destino.endsWith("proyecto.json")) {
            responderJson(res, 403, { error: "the master file has to be proyectos/<slug>/proyecto.json" });
            return;
          }
          // No garbage is written: if it does not parse or is not from miuzika, the disk is not touched.
          let validado: { formato?: string; proyecto?: { schemaVersion?: number } };
          try {
            validado = JSON.parse(datos.contenido) as typeof validado;
          } catch (error) {
            responderJson(res, 400, {
              error: `the project is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            });
            return;
          }
          if (validado.formato !== "miuzika-proyecto" || validado.proyecto?.schemaVersion !== 1) {
            responderJson(res, 400, {
              error: 'the master file has to be { formato: "miuzika-proyecto", proyecto: { schemaVersion: 1 } }',
            });
            return;
          }
          mkdirSync(dirname(destino), { recursive: true });
          writeFileSync(destino, datos.contenido, "utf8");
          responderJson(res, 200, {
            ok: true,
            path: datos.path,
            bytes: Buffer.byteLength(datos.contenido, "utf8"),
          });
        } catch (error) {
          responderJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    responderJson(res, 405, { error: "use GET or POST" });
  });
}
