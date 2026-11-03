/**
 * What is on disk in workspace/: the projects with a proyecto.json, the files of a folder
 * (without the hidden ones) and what changed in a project since a moment.
 * Moved out of contexto.ts on 3-Nov (review step 4) without changes, so it can be tested
 * against a temporary folder.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { CARPETAS_OCULTAS } from "../src/core/rutas.ts";
import { dentroDe } from "./dentro.ts";

/** Inventory of the projects on disk: those that have proyecto.json. */
export function proyectosEnDisco(carpetaTrabajo: string): Record<string, unknown>[] {
  const carpeta = resolve(carpetaTrabajo, "proyectos");
  if (!existsSync(carpeta)) return [];
  const salida: Record<string, unknown>[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const maestro = resolve(carpeta, entrada.name, "proyecto.json");
    if (!existsSync(maestro)) continue;
    const ruta = `proyectos/${entrada.name}/proyecto.json`;
    const bytes = statSync(maestro).size;
    const actualizado = statSync(maestro).mtime.toISOString();
    try {
      // Only the header is read: the file with all the notes can be large.
      const datos = JSON.parse(readFileSync(maestro, "utf8")) as {
        guardadoEn?: string;
        proyecto?: { name?: string; bpm?: number; lengthBars?: number; tracks?: unknown[] };
      };
      const proyecto = datos.proyecto ?? {};
      salida.push({
        slug: entrada.name,
        ruta,
        nombre: String(proyecto.name ?? entrada.name),
        bpm: Number(proyecto.bpm ?? 0),
        compases: Number(proyecto.lengthBars ?? 0),
        pistas: Array.isArray(proyecto.tracks) ? proyecto.tracks.length : 0,
        guardadoEn: String(datos.guardadoEn ?? ""),
        actualizado,
        bytes,
      });
    } catch (error) {
      salida.push({
        slug: entrada.name,
        ruta,
        nombre: entrada.name,
        bpm: 0,
        compases: 0,
        pistas: 0,
        guardadoEn: "",
        actualizado,
        bytes,
        error: error instanceof Error ? error.message : "unreadable proyecto.json",
      });
    }
  }
  return salida.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
}

/**
 * Inventory of files in the workspace.
 *
 * Optional `carpeta`: "" = the root (without hidden folders), "proyectos/<slug>",
 * "codigo"… CARPETAS_OCULTAS folders are never traversed: `catalogo/`
 * is 4,231 files and put 573 KB into the model context, which arrives
 * trimmed to head and tail (that is: the agent did not see the middle, which is where
 * its files were). It is queried with `buscar_sonido`, not by listing.
 */
export const MAX_LISTADO = 2000;

export function ficherosDeTrabajo(carpetaTrabajo: string, carpeta = ""): { path: string; bytes: number }[] {
  if (!existsSync(carpetaTrabajo)) return [];
  const relativa = carpeta.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const inicio = relativa === "" ? carpetaTrabajo : resolve(carpetaTrabajo, relativa);
  const dentro = dentroDe(carpetaTrabajo, inicio, { incluirRaiz: true });
  if (!dentro || !existsSync(inicio)) return [];
  const salida: { path: string; bytes: number }[] = [];
  const recorrer = (dir: string): void => {
    if (salida.length >= MAX_LISTADO) return;
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (salida.length >= MAX_LISTADO) return;
      const completo = resolve(dir, entrada.name);
      if (entrada.isDirectory()) {
        if ((CARPETAS_OCULTAS as readonly string[]).includes(entrada.name)) continue;
        recorrer(completo);
      } else {
        salida.push({
          path: relative(carpetaTrabajo, completo).split(sep).join("/"),
          bytes: statSync(completo).size,
        });
      }
    }
  };
  recorrer(inicio);
  return salida;
}

/** Files in the project folder that changed since `desde` (ms). */
export function cambiadosDesde(carpetaTrabajo: string, slug: string, desde: number): string[] {
  const carpeta = resolve(carpetaTrabajo, "proyectos", slug);
  if (!existsSync(carpeta)) return [];
  return ficherosDeTrabajo(carpetaTrabajo, `proyectos/${slug}`)
    .filter((f) => {
      try {
        return statSync(resolve(carpetaTrabajo, f.path)).mtimeMs >= desde;
      } catch {
        return false;
      }
    })
    .map((f) => f.path.slice(`proyectos/${slug}/`.length));
}

