/**
 * Versiones del proyecto: una foto de `proyecto.json` al empezar cada turno del
 * agente, en `proyectos/<carpeta>/versiones/`.
 *
 * Medido el 27-oct: la persona pidió «volver a la batería de antes» después de un
 * turno que había reescrito 14 clips. El deshacer guardaba 8 estados (un turno
 * hace decenas de cambios) y el agente no tenía forma de ver el pasado: buscó en
 * los registros con seis scripts y acabó reinventando la batería. Con una foto
 * por turno, volver atrás es leer la versión y copiar las pistas pedidas.
 *
 * Sin DOM y sin red: se prueba con `node --test`.
 */

import type { Project, Track } from "./types.ts";
import { normalizarTexto, slugDe } from "./nombres.ts";

/** Fotos que se guardan por proyecto; las más viejas se borran. */
export const MAX_VERSIONES = 40;

export const CARPETA_VERSIONES = "versiones";

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * «2026-10-27_21-45-03_adelante-con-la-bateria.json»: ordenable por nombre y con
 * el pedido que vino después, para que la lista se entienda sin abrir cada foto.
 */
export function nombreDeVersion(fecha: Date, pedido: string): string {
  const sello =
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}_` +
    `${dos(fecha.getHours())}-${dos(fecha.getMinutes())}-${dos(fecha.getSeconds())}`;
  const resumen = slugDe(pedido, { max: 40, defecto: "" });
  return `${sello}${resumen ? `_${resumen}` : ""}.json`;
}

/** «2026-10-27_21-45-03_adelante-con…json» → «27-10 21:45:03 · adelante con…». */
export function describirVersion(nombre: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_(.*))?\.json$/.exec(nombre);
  if (!m) return nombre;
  const [, , mes, dia, h, min, s, resto] = m;
  return `${dia}-${mes} ${h}:${min}:${s}${resto ? ` · antes de «${resto.replace(/-/g, " ")}»` : ""}`;
}

/** Versiones a borrar para quedarse con las `max` más nuevas (los nombres se ordenan solos). */
export function versionesSobrantes(nombres: readonly string[], max = MAX_VERSIONES): string[] {
  const ordenadas = nombres.filter((n) => n.endsWith(".json")).sort();
  return ordenadas.slice(0, Math.max(0, ordenadas.length - max));
}

function buscarPista(tracks: readonly Track[], clave: string): Track | undefined {
  const limpia = clave.trim();
  const porId = tracks.find((track) => track.id === limpia);
  if (porId) return porId;
  if (/^\d+$/.test(limpia)) return tracks[Number(limpia) - 1];
  const nombre = normalizarTexto(limpia);
  return (
    tracks.find((track) => normalizarTexto(track.name) === nombre) ??
    // «Bateria» encuentra «Batería oscura» si sólo hay una que lo contenga.
    (() => {
      const parecidas = tracks.filter((track) => normalizarTexto(track.name).includes(nombre));
      return parecidas.length === 1 ? parecidas[0] : undefined;
    })()
  );
}

export interface Restauracion {
  project: Project;
  /** Una línea por pista restaurada. */
  hechas: string[];
}

/**
 * Proyecto actual con las `pistas` copiadas tal como estaban en `version` (notas,
 * clips, instrumento, efectos y mezcla). Si `pistas` está vacío, se vuelve al
 * proyecto entero, conservando la carpeta y el id del actual.
 */
export function restaurarVersion(actual: Project, version: Project, pistas: readonly string[] = []): Restauracion {
  if (pistas.length === 0) {
    const project: Project = structuredClone(version);
    project.id = actual.id;
    project.meta = { ...project.meta, ...(actual.meta.carpeta ? { carpeta: actual.meta.carpeta } : {}) };
    return { project, hechas: [`Proyecto entero restaurado (${project.tracks.length} pistas, ${project.lengthBars} compases).`] };
  }
  const project: Project = structuredClone(actual);
  const hechas: string[] = [];
  for (const clave of pistas) {
    const antigua = buscarPista(version.tracks, clave);
    if (!antigua) {
      const nombres = version.tracks.map((track, i) => `${i + 1}. ${track.name} (${track.id})`).join(", ");
      throw new Error(`En esa versión no hay ninguna pista «${clave}». Tiene: ${nombres}.`);
    }
    const copia = structuredClone(antigua);
    const indice = project.tracks.findIndex((track) => track.id === antigua.id);
    // Los ids de clip se reutilizan (el primer clp_N libre): un clip creado después
    // en otra pista puede llevar el id de uno de esta. Los repetidos se renumeran.
    const usados = new Set(
      project.tracks.filter((_, i) => i !== indice).flatMap((track) => track.clips.map((clip) => clip.id)),
    );
    for (const clip of copia.clips) {
      if (usados.has(clip.id)) {
        let n = 1;
        while (usados.has(`clp_${n}`) || copia.clips.some((otro) => otro.id === `clp_${n}`)) n += 1;
        clip.id = `clp_${n}`;
      }
      usados.add(clip.id);
    }
    const notas = copia.clips.reduce((suma, clip) => suma + clip.notes.length, 0);
    if (indice >= 0) {
      project.tracks[indice] = copia;
      hechas.push(`«${copia.name}» (${copia.id}) restaurada: ${copia.clips.length} clips, ${notas} notas.`);
    } else {
      project.tracks.push(copia);
      hechas.push(`«${copia.name}» (${copia.id}) no existía ya: añadida con ${copia.clips.length} clips, ${notas} notas.`);
    }
  }
  return { project, hechas };
}
