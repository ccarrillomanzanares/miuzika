/**
 * What "Projects" does to a project's folder besides reading it: measure it, duplicate it, delete it.
 * Pure over a workspace folder, so it is tested against a temporary one. A project is named by its folder
 * (`proyectos/<slug>/`); a slug that is not one plain folder name is refused before the disk is touched.
 */

import { randomBytes } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { carpetaLibre } from "../src/core/project.ts";
import { dentroDe } from "./dentro.ts";

/** The project's folder, or null if `slug` is not the name of one existing folder right under proyectos/. */
export function carpetaDeSlug(carpetaTrabajo: string, slug: unknown): string | null {
  if (typeof slug !== "string" || slug === "" || slug === "." || slug === ".." || /[\\/:*?"<>|\0]/.test(slug)) return null;
  const raiz = resolve(carpetaTrabajo, "proyectos");
  const carpeta = resolve(raiz, slug);
  if (!dentroDe(raiz, carpeta) || !existsSync(carpeta) || !statSync(carpeta).isDirectory()) return null;
  return carpeta;
}

/** Every file under the folder, whatever it is: this is what deleting the folder takes away. */
export function tamanoDeCarpeta(carpeta: string): { ficheros: number; bytes: number } {
  let ficheros = 0;
  let bytes = 0;
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completo = resolve(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else {
        ficheros += 1;
        bytes += statSync(completo).size;
      }
    }
  };
  recorrer(carpeta);
  return { ficheros, bytes };
}

/**
 * Copies the whole folder (the master file and every WAV, take and export) to a free `<slug>-copy`, and gives the
 * copy its own name, id and folder in its master file, so the two are told apart in the list and never share a
 * history. A master file that cannot be read is copied as it is.
 */
export function duplicarProyecto(carpetaTrabajo: string, slug: unknown): { slug: string; nombre: string; ficheros: number; bytes: number } {
  const origen = carpetaDeSlug(carpetaTrabajo, slug);
  if (!origen) throw new Error(`there is no project folder “${String(slug)}”`);
  const raiz = resolve(carpetaTrabajo, "proyectos");
  const ocupadas = new Set(readdirSync(raiz));
  const nuevo = carpetaLibre(`${String(slug)}-copy`, ocupadas);
  const destino = resolve(raiz, nuevo);
  cpSync(origen, destino, { recursive: true, errorOnExist: true, force: false });
  let nombre = nuevo;
  const maestro = resolve(destino, "proyecto.json");
  try {
    const datos = JSON.parse(readFileSync(maestro, "utf8")) as { guardadoEn?: string; proyecto?: { id?: string; name?: string; meta?: Record<string, unknown> } };
    if (datos.proyecto) {
      nombre = `${datos.proyecto.name ?? String(slug)} (copy)`;
      datos.proyecto.name = nombre;
      datos.proyecto.id = `prj_${randomBytes(4).toString("hex")}`;
      datos.proyecto.meta = { ...datos.proyecto.meta, carpeta: nuevo };
      writeFileSync(maestro, JSON.stringify(datos, null, 2), "utf8");
    }
  } catch {
    /* unreadable master file: the copy is as unreadable as its source, and says so in the list */
  }
  return { slug: nuevo, nombre, ...tamanoDeCarpeta(destino) };
}

/**
 * Without `conCarpeta`, only the master file goes: the project leaves the list and its audio stays where it was
 * (a folder left empty goes too). With it, the folder and everything in it.
 */
export function borrarProyecto(carpetaTrabajo: string, slug: unknown, conCarpeta: boolean): { slug: string; carpetaBorrada: boolean; quedan: number } {
  const carpeta = carpetaDeSlug(carpetaTrabajo, slug);
  if (!carpeta) throw new Error(`there is no project folder “${String(slug)}”`);
  if (conCarpeta) {
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return { slug: String(slug), carpetaBorrada: true, quedan: 0 };
  }
  rmSync(resolve(carpeta, "proyecto.json"), { force: true });
  const quedan = tamanoDeCarpeta(carpeta).ficheros;
  if (quedan === 0) rmSync(carpeta, { recursive: true, force: true });
  return { slug: String(slug), carpetaBorrada: quedan === 0, quedan };
}

/**
 * Files of ONE project, named as its master file names them ("generado/x.wav"): their sizes, and with `borrar` they are
 * deleted (bug 45: a deleted track's audio). A path outside the project's own folder, the master file or something
 * that is not a file is answered as missing and never touched; the shared folders (catalogo/) are outside by definition.
 */
export function ficherosDeProyecto(
  carpetaTrabajo: string,
  slug: unknown,
  rutas: readonly unknown[],
  borrar: boolean,
): { ruta: string; bytes: number | null; borrado: boolean; error?: string }[] {
  const carpeta = carpetaDeSlug(carpetaTrabajo, slug);
  if (!carpeta) throw new Error(`there is no project folder “${String(slug)}”`);
  return [...new Set(rutas.map(String))].map((ruta) => {
    const limpia = ruta.replace(/^\/+/, "");
    const destino = resolve(carpeta, limpia);
    const valida = !ruta.includes("\\") && !ruta.includes("..") && !/^[a-zA-Z]:/.test(limpia) && dentroDe(carpeta, destino) && destino !== resolve(carpeta, "proyecto.json");
    if (!valida || !existsSync(destino) || !statSync(destino).isFile()) return { ruta, bytes: null, borrado: false };
    const bytes = statSync(destino).size;
    if (!borrar) return { ruta, bytes, borrado: false };
    try {
      rmSync(destino, { maxRetries: 3, retryDelay: 100 });
      return { ruta, bytes, borrado: true };
    } catch (error) {
      return { ruta, bytes, borrado: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
