/** The master file of each project: `proyectos/<slug>/proyecto.json`. */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { FORMATO } from "../../src/core/proyecto-archivo.ts";
import { otroOrigen, rutaJson } from "../ruta.ts";
import { borrarProyecto, carpetaDeSlug, duplicarProyecto, ficherosDeProyecto, tamanoDeCarpeta } from "../proyectos-disco.ts";

export function rutasProyectos(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, leerCuerpo, resolverEnTrabajo, listarProyectosDisco, carpetaTrabajo } = ctx;

  const slugsDe = (datos: { slugs?: unknown }): string[] | null =>
    Array.isArray(datos.slugs) && datos.slugs.length > 0 && datos.slugs.every((s) => carpetaDeSlug(carpetaTrabajo, s)) ? (datos.slugs as string[]) : null;

  // What "Projects" does to folders. Before /api/proyectos: routes match by prefix.
  // What deleting each folder would take away, asked before the question is put.
  server.middlewares.use(
    "/api/proyectos/tamano",
    rutaJson<{ slugs?: unknown }>({ metodo: "POST" }, ({ datos, responder }) => {
      const slugs = slugsDe(datos);
      if (!slugs) return responder(400, { ok: false, error: "'slugs': the folders of existing projects" });
      responder(200, { ok: true, proyectos: slugs.map((slug) => ({ slug, ...tamanoDeCarpeta(carpetaDeSlug(carpetaTrabajo, slug)!) })) });
    }),
  );

  server.middlewares.use(
    "/api/proyectos/duplicar",
    rutaJson<{ slug?: unknown }>({ metodo: "POST" }, ({ datos, responder }) => {
      if (!carpetaDeSlug(carpetaTrabajo, datos.slug)) return responder(400, { ok: false, error: "'slug': the folder of an existing project" });
      responder(200, { ok: true, ...duplicarProyecto(carpetaTrabajo, datos.slug) });
    }),
  );

  // The audio of deleted tracks: sizes for the question, and with `borrar` the files go.
  server.middlewares.use(
    "/api/proyectos/ficheros",
    rutaJson<{ slug?: unknown; rutas?: unknown; borrar?: unknown }>({ metodo: "POST" }, ({ datos, responder }) => {
      if (!carpetaDeSlug(carpetaTrabajo, datos.slug)) return responder(400, { ok: false, error: "'slug': the folder of an existing project" });
      if (!Array.isArray(datos.rutas) || datos.rutas.length === 0 || !datos.rutas.every((r) => typeof r === "string")) {
        return responder(400, { ok: false, error: "'rutas': the files, as the project names them" });
      }
      responder(200, { ok: true, ficheros: ficherosDeProyecto(carpetaTrabajo, datos.slug, datos.rutas, datos.borrar === true) });
    }),
  );

  // All the folders are checked before the first one is touched: a bad name deletes nothing.
  server.middlewares.use(
    "/api/proyectos/borrar",
    rutaJson<{ slugs?: unknown; carpeta?: unknown }>({ metodo: "POST" }, ({ datos, responder }) => {
      const slugs = slugsDe(datos);
      if (!slugs) return responder(400, { ok: false, error: "'slugs': the folders of existing projects" });
      if (typeof datos.carpeta !== "boolean") return responder(400, { ok: false, error: "'carpeta': true to delete the folder and its contents, false for the project file only" });
      responder(200, { ok: true, borrados: slugs.map((slug) => borrarProyecto(carpetaTrabajo, slug, datos.carpeta as boolean)) });
    }),
  );

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
      // Bug 16: this overwrites a project's master file; another site's page must not.
      if (otroOrigen(req)) {
        responderJson(res, 403, { error: "only from the app itself" });
        return;
      }
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
          // The same format the browser writes (src/core/proyecto-archivo.ts), not a copy of it.
          if (validado.formato !== FORMATO || validado.proyecto?.schemaVersion !== 1) {
            responderJson(res, 400, {
              error: `the master file has to be { formato: "${FORMATO}", proyecto: { schemaVersion: 1 } }`,
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
