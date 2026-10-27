/** El fichero maestro de cada proyecto: `proyectos/<slug>/proyecto.json`. */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasProyectos(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, leerCuerpo, resolverEnTrabajo, listarProyectosDisco } = ctx;

  // Fichero maestro por proyecto: proyectos/<slug>/proyecto.json.
  // GET sin path -> inventario; GET con path -> contenido completo (sin el
  // recorte de 20 KB de /api/fs/read: un proyecto con miles de notas no cabe).
  // POST -> escribe el maestro (crea la carpeta del proyecto).
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
        responderJson(res, 404, { error: `no existe ${rel}` });
        return;
      }
      if (!destino.endsWith("proyecto.json")) {
        responderJson(res, 400, { error: "sólo se leen ficheros proyecto.json por aquí" });
        return;
      }
      if (statSync(destino).size > 64 * 1024 * 1024) {
        responderJson(res, 413, { error: "el proyecto pasa de 64 MB: no es un proyecto de miuzika" });
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
            responderJson(res, 400, { error: "faltan 'path' o 'contenido'" });
            return;
          }
          const destino = resolverEnTrabajo(datos.path);
          if (!destino || !destino.endsWith("proyecto.json")) {
            responderJson(res, 403, { error: "el fichero maestro tiene que ser proyectos/<slug>/proyecto.json" });
            return;
          }
          // No se escribe basura: si no parsea o no es de miuzika, no se toca el disco.
          let validado: { formato?: string; proyecto?: { schemaVersion?: number } };
          try {
            validado = JSON.parse(datos.contenido) as typeof validado;
          } catch (error) {
            responderJson(res, 400, {
              error: `el proyecto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
            });
            return;
          }
          if (validado.formato !== "miuzika-proyecto" || validado.proyecto?.schemaVersion !== 1) {
            responderJson(res, 400, {
              error: 'el fichero maestro tiene que ser { formato: "miuzika-proyecto", proyecto: { schemaVersion: 1 } }',
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

    responderJson(res, 405, { error: "usa GET o POST" });
  });
}
