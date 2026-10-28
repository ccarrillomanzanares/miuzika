/**
 * El fichero maestro del proyecto: `workspace/proyectos/<slug>/proyecto.json`.
 *
 * Es la fuente de verdad, la única: el estado del proyecto (pistas, clips,
 * notas, faders, mute/solo, BPM y tonalidad) y, dentro de cada asset, la
 * **ruta relativa a la carpeta del proyecto** de su WAV. El audio nunca se
 * incrusta: los stems de un tema pesan ~95 MB cada uno y en base64 un máster
 * de 6 stems serían ~760 MB de JSON.
 *
 * Este módulo no toca la red ni el DOM: sólo construye y valida el JSON, para
 * poder probarlo con `node --test`.
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

/** Lo que el módulo necesita de un asset cargado (audio-store lo cumple). */
interface AssetVivo {
  name: string;
  durationBeats: number;
  /** Ruta en el servidor, relativa a la carpeta del proyecto. */
  src?: string;
}

export interface ResultadoGuardado {
  datos: ProyectoEnDisco;
  /** Assets sin ruta en disco: sólo existían en el navegador. */
  sinRuta: string[];
}

/** Carpeta del proyecto en `workspace/proyectos/`. Mismo slug que usa la app. */
export function slugDeNombre(nombre: string): string {
  return carpetaDeNombre(nombre);
}

/** Ruta del fichero maestro para un slug ("vitrina" -> proyectos/vitrina/proyecto.json). */
export function rutaDeProyecto(slug: string): string {
  return `proyectos/${slug}/proyecto.json`;
}

/** "proyectos/vitrina/proyecto.json" -> "vitrina". */
export function carpetaDeRuta(ruta: string): string {
  const trozos = ruta.replace(/\\/g, "/").split("/").filter(Boolean);
  if (trozos.length >= 3 && trozos[0] === "proyectos") return trozos[1]!;
  return trozos.length >= 2 ? trozos[trozos.length - 2]! : "";
}

/** Normaliza la ruta de un asset: sin barra inicial, sin "..", sin "proyectos/<slug>/". */
export function rutaRelativa(src: string): string {
  const limpia = src
    .replace(/\\/g, "/")
    .split("/")
    .filter((trozo) => trozo !== "" && trozo !== "." && trozo !== "..");

  // Un asset puede venir ya con la carpeta del proyecto delante.
  if (limpia[0] === "proyectos" && limpia.length > 2) return limpia.slice(2).join("/");
  return limpia.join("/");
}

export { idsDeAssets };

/**
 * Construye el contenido del fichero maestro. A cada asset referenciado se le
 * escribe su `ruta` (de la ruta viva si la hay, si no la que ya tuviera); los
 * que no tienen ninguna se listan en `sinRuta` para avisar al usuario.
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

/** Ruta antigua (formato previo): el master llevaba la lista de WAV aparte. */
interface AssetsAntiguos {
  id: string;
  nombre?: string;
  nombreWav?: string;
  duracionBeats?: number;
  ruta?: string;
}

/**
 * Lee y valida el fichero maestro. Admite también un `Project` suelto (un .json
 * exportado a mano) y los ficheros del formato anterior, que llevaban la lista
 * de WAV en `assets[]` en vez de `proyecto.audioAssets[].ruta`.
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

  // Proyecto suelto: lo que se importaba antes desde «Abrir».
  if (datos.schemaVersion === 1) {
    return { formato: FORMATO, version: VERSION, guardadoEn: "", proyecto: migrarProyecto(datos as Project) };
  }

  if (datos.formato !== FORMATO) {
    throw new Error(`no es un proyecto de miuzika (falta "formato": "${FORMATO}").`);
  }
  const proyecto = datos.proyecto;
  if (!proyecto || proyecto.schemaVersion !== 1 || !Array.isArray(proyecto.tracks)) {
    throw new Error("the project in the file is not valid (schemaVersion 1 and tracks are required).");
  }

  // Ruta escrita donde toque: primero la del formato nuevo, si no la lista vieja.
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

/** Carpetas de salida típicas: su nombre no sirve como nombre de proyecto. */
const GENERICAS = /^(salida|output|audio|stems?|wav|wavs|midi|export|exports|mix|mezcla|master)$/;

/**
 * Nombre para un proyecto nuevo a partir de los ficheros elegidos. Usa la
 * carpeta del selector («Abrir carpeta» deja `proyectos/vitrina/salida/x.wav`
 * en `webkitRelativePath`); si sólo vienen ficheros sueltos, el nombre del
 * primero. Nunca devuelve "salida": eso sería una carpeta, no un tema.
 */
export function nombreDeProyectoDesdeFicheros(
  files: { name: string; webkitRelativePath?: string }[],
): string {
  const primero = files[0];
  if (!primero) return "proyecto";

  const trozos = (primero.webkitRelativePath ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const carpetas = trozos.slice(0, -1); // fuera el nombre del fichero
  let elegida = carpetas[carpetas.length - 1] ?? "";
  if (elegida && GENERICAS.test(elegida.toLowerCase())) {
    // "salida" nunca es un nombre de tema: se usa la carpeta padre y, si no la
    // hay (el usuario eligió la carpeta salida/ directamente), el fichero.
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
