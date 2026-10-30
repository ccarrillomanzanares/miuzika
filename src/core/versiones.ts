/**
 * Project versions: a snapshot of `proyecto.json` at the start of each agent turn,
 * in `proyectos/<carpeta>/versiones/`.
 *
 * Measured on Oct 27: the person asked to "go back to the drums from before" after a
 * turn that had rewritten 14 clips. Undo kept 8 states (a turn makes dozens of
 * changes) and the agent had no way to see the past: it searched the logs with six
 * scripts and ended up reinventing the drums. With one snapshot per turn, going back
 * means reading the version and copying the requested tracks.
 *
 * No DOM and no network: tested with `node --test`.
 */

import type { Project, Track } from "./types.ts";
import { normalizarTexto, slugDe } from "./nombres.ts";

/** Snapshots kept per project; the oldest ones are deleted. */
export const MAX_VERSIONES = 40;

export const CARPETA_VERSIONES = "versiones";

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "2026-10-27_21-45-03_adelante-con-la-bateria.json": sortable by name and with the
 * request that came after it, so the list makes sense without opening each snapshot.
 */
export function nombreDeVersion(fecha: Date, pedido: string): string {
  const sello =
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}_` +
    `${dos(fecha.getHours())}-${dos(fecha.getMinutes())}-${dos(fecha.getSeconds())}`;
  const resumen = slugDe(pedido, { max: 40, defecto: "" });
  return `${sello}${resumen ? `_${resumen}` : ""}.json`;
}

/** "2026-10-27_21-45-03_adelante-con…json" → "27-10 21:45:03 · before «adelante con…»". */
export function describirVersion(nombre: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_(.*))?\.json$/.exec(nombre);
  if (!m) return nombre;
  const [, , mes, dia, h, min, s, resto] = m;
  return `${dia}-${mes} ${h}:${min}:${s}${resto ? ` · before «${resto.replace(/-/g, " ")}»` : ""}`;
}

/** Versions to delete to keep the `max` newest ones (the names sort themselves). */
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
    // "Bateria" finds "Batería oscura" if only one contains it.
    (() => {
      const parecidas = tracks.filter((track) => normalizarTexto(track.name).includes(nombre));
      return parecidas.length === 1 ? parecidas[0] : undefined;
    })()
  );
}

export interface Restauracion {
  project: Project;
  /** One line per restored track. */
  hechas: string[];
}

/**
 * Current project with the `pistas` copied as they were in `version` (notes, clips,
 * instrument, effects, and mix). If `pistas` is empty, the whole project is restored,
 * keeping the current folder and id.
 */
export function restaurarVersion(actual: Project, version: Project, pistas: readonly string[] = []): Restauracion {
  if (pistas.length === 0) {
    const project: Project = structuredClone(version);
    project.id = actual.id;
    project.meta = { ...project.meta, ...(actual.meta.carpeta ? { carpeta: actual.meta.carpeta } : {}) };
    return { project, hechas: [`Whole project restored (${project.tracks.length} tracks, ${project.lengthBars} bars).`] };
  }
  const project: Project = structuredClone(actual);
  const hechas: string[] = [];
  for (const clave of pistas) {
    const antigua = buscarPista(version.tracks, clave);
    if (!antigua) {
      const nombres = version.tracks.map((track, i) => `${i + 1}. ${track.name} (${track.id})`).join(", ");
      throw new Error(`That version has no track «${clave}». It has: ${nombres}.`);
    }
    const copia = structuredClone(antigua);
    const indice = project.tracks.findIndex((track) => track.id === antigua.id);
    // Clip ids are reused (the first free clp_N): a clip created later on another
    // track may carry the id of one of these. Duplicates are renumbered.
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
      hechas.push(`«${copia.name}» (${copia.id}) restored: ${copia.clips.length} clips, ${notas} notes.`);
    } else {
      project.tracks.push(copia);
      hechas.push(`«${copia.name}» (${copia.id}) no longer existed: added with ${copia.clips.length} clips, ${notas} notes.`);
    }
  }
  return { project, hechas };
}
