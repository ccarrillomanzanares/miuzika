/**
 * The project's master file: `workspace/proyectos/<slug>/proyecto.json`.
 *
 * It is the source of truth, the only one: the project state (tracks, clips, notes,
 * faders, mute/solo, BPM and key) and, inside each asset, the **path relative to the
 * project folder** of its WAV. Audio is never embedded: a song's stems weigh ~95 MB
 * each and in base64 a 6-stem master would be ~760 MB of JSON.
 *
 * This module touches neither the network nor the DOM: it only builds and validates the
 * JSON, so it can be tested with `node --test`.
 */

import type { AudioAsset, Project } from "../../src/core/types.ts";
import { carpetaDeNombre, idsDeAssets, migrarProyecto } from "../../src/core/project.ts";

export const FORMATO = "miuzika-proyecto";
export const VERSION = 1;

export interface ProyectoEnDisco {
  formato: typeof FORMATO;
  version: number;
  guardadoEn: string;
  proyecto: Project;
}

/** What the module needs from a loaded asset (audio-store satisfies it). */
interface AssetVivo {
  name: string;
  durationBeats: number;
  /** Path on the server, relative to the project folder. */
  src?: string;
}

export interface ResultadoGuardado {
  datos: ProyectoEnDisco;
  /** Assets with no path on disk: they only existed in the browser. */
  sinRuta: string[];
}

/** Project folder in `workspace/proyectos/`. Same slug the app uses. */
export function slugDeNombre(nombre: string): string {
  return carpetaDeNombre(nombre);
}

/** Path of the master file for a slug ("vitrina" -> proyectos/vitrina/proyecto.json). */
export function rutaDeProyecto(slug: string): string {
  return `proyectos/${slug}/proyecto.json`;
}

/** "proyectos/vitrina/proyecto.json" -> "vitrina". */
export function carpetaDeRuta(ruta: string): string {
  const trozos = ruta.replace(/\\/g, "/").split("/").filter(Boolean);
  if (trozos.length >= 3 && trozos[0] === "proyectos") return trozos[1]!;
  return trozos.length >= 2 ? trozos[trozos.length - 2]! : "";
}

/** Normalizes an asset path: no leading slash, no "..", no "proyectos/<slug>/". */
export function rutaRelativa(src: string): string {
  const limpia = src
    .replace(/\\/g, "/")
    .split("/")
    .filter((trozo) => trozo !== "" && trozo !== "." && trozo !== "..");

  // An asset may already come with the project folder in front.
  if (limpia[0] === "proyectos" && limpia.length > 2) return limpia.slice(2).join("/");
  return limpia.join("/");
}

export { idsDeAssets };

/**
 * Builds the master file's contents. Each referenced asset is given its `ruta` (from
 * the live path if there is one, otherwise the one it already had); the ones that have
 * none are listed in `sinRuta` to warn the user.
 */
export function serializarProyecto(
  project: Project,
  assets: ReadonlyMap<string, AssetVivo>,
  ahora: Date = new Date(),
): ResultadoGuardado {
  const sinRuta: string[] = [];
  const audioAssets: AudioAsset[] = [];

  for (const id of idsDeAssets(project)) {
    const vivo = assets.get(id);
    const meta = project.audioAssets?.find((asset) => asset.id === id);
    const nombre = vivo?.name ?? meta?.name ?? id;
    const durationBeats = vivo?.durationBeats ?? meta?.durationBeats ?? 0;
    const cruda = vivo?.src ?? meta?.ruta ?? "";
    const ruta = cruda ? rutaRelativa(cruda) : "";
    if (!ruta) sinRuta.push(nombre);
    audioAssets.push({ id, name: nombre, durationBeats, ...(ruta ? { ruta } : {}) });
  }

  return {
    datos: {
      formato: FORMATO,
      version: VERSION,
      guardadoEn: ahora.toISOString(),
      proyecto: { ...project, audioAssets },
    },
    sinRuta,
  };
}

/** Old path (previous format): the master carried the WAV list separately. */
interface AssetsAntiguos {
  id: string;
  nombre?: string;
  nombreWav?: string;
  duracionBeats?: number;
  ruta?: string;
}

/**
 * Reads and validates the master file. It also accepts a loose `Project` (a .json
 * exported by hand) and files from the previous format, which carried the WAV list in
 * `assets[]` instead of `proyecto.audioAssets[].ruta`.
 */
export function interpretarProyectoEnDisco(texto: string): ProyectoEnDisco {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error("proyecto.json is not valid JSON.");
  }
  if (!crudo || typeof crudo !== "object") {
    throw new Error("proyecto.json is empty or is not an object.");
  }
  const datos = crudo as Partial<ProyectoEnDisco> & Partial<Project> & { assets?: AssetsAntiguos[] };

  // Loose project: what used to be imported from "Open".
  if (datos.schemaVersion === 1) {
    return { formato: FORMATO, version: VERSION, guardadoEn: "", proyecto: migrarProyecto(datos as Project) };
  }

  if (datos.formato !== FORMATO) {
    throw new Error(`not a miuzika project (missing "formato": "${FORMATO}").`);
  }
  const proyecto = datos.proyecto;
  if (!proyecto || proyecto.schemaVersion !== 1 || !Array.isArray(proyecto.tracks)) {
    throw new Error("the project in the file is not valid (schemaVersion 1 and tracks are required).");
  }

  // Path written where it belongs: first the new format's, otherwise the old list.
  if (Array.isArray(proyecto.audioAssets)) {
    for (const asset of proyecto.audioAssets) {
      if (!asset || typeof asset.id !== "string") continue;
      if (typeof asset.ruta === "string" && asset.ruta.trim() !== "") {
        asset.ruta = rutaRelativa(asset.ruta);
        continue;
      }
      const antiguo = datos.assets?.find((otro) => otro?.id === asset.id);
      if (antiguo && typeof antiguo.ruta === "string" && antiguo.ruta.trim() !== "") {
        asset.ruta = rutaRelativa(antiguo.ruta);
      }
    }
  }

  return {
    formato: FORMATO,
    version: Number(datos.version) || VERSION,
    guardadoEn: typeof datos.guardadoEn === "string" ? datos.guardadoEn : "",
    proyecto: migrarProyecto(proyecto),
  };
}

/** Typical output folders: their name is no good as a project name. */
const GENERICAS = /^(salida|output|audio|stems?|wav|wavs|midi|export|exports|mix|mezcla|master)$/;

/**
 * Name for a new project from the chosen files. It uses the picker's folder ("Open
 * folder" leaves `proyectos/vitrina/salida/x.wav` in `webkitRelativePath`); if only loose
 * files come, the first one's name. It never returns "salida": that would be a folder,
 * not a song.
 */
export function nombreDeProyectoDesdeFicheros(
  files: { name: string; webkitRelativePath?: string }[],
): string {
  const primero = files[0];
  if (!primero) return "proyecto";

  const trozos = (primero.webkitRelativePath ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const carpetas = trozos.slice(0, -1); // drop the file name
  let elegida = carpetas[carpetas.length - 1] ?? "";
  if (elegida && GENERICAS.test(elegida.toLowerCase())) {
    // "salida" is never a song name: the parent folder is used and, if there is none
    // (the user chose the salida/ folder directly), the file.
    elegida = carpetas.length > 1 ? carpetas[carpetas.length - 2]! : "";
  }
  if (!elegida) elegida = primero.name.replace(/\.[^.]+$/, "");
  if (/^midi[_-]/i.test(elegida)) elegida = elegida.replace(/^midi[_-]/i, "");
  if (/[_-](multitrack|master|mix|stems?)$/i.test(elegida)) {
    elegida = elegida.replace(/[_-](multitrack|master|mix|stems?)$/i, "");
  }
  const limpio = elegida.replace(/[-_]+/g, " ").trim();
  return (limpio || "proyecto").slice(0, 40);
}
