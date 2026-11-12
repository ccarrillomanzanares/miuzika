/** The SoundFonts a project needs, fetched from the server for the engine. */

import type { Project } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { cabeceraDeProyecto } from "./proyecto-disco.ts";

export type SoundfontCargado = { uuid: Uint8Array; name: string; bytes: ArrayBuffer };

/** The project's own .sf2 files: they live in its folder, so it sounds the same on another machine. */
export async function cargarSoundfontsDelProyecto(view: Project): Promise<Map<string, SoundfontCargado>> {
  const mapa = new Map<string, SoundfontCargado>();
  for (const track of view.tracks) {
    const archivo = track.instrument.type === "soundfont" ? track.instrument.archivo : undefined;
    if (!archivo || mapa.has(archivo)) continue;
    const respuesta = await fetch(`/api/audio?path=${encodeURIComponent(archivo)}`, {
      headers: cabeceraDeProyecto(carpetaDeProyecto(view)),
    }).catch(() => null);
    if (!respuesta || !respuesta.ok) continue;
    mapa.set(archivo, {
      uuid: uuidDeSoundfont(archivo),
      name: archivo.split("/").pop() ?? "instrumento.sf2",
      bytes: await respuesta.arrayBuffer(),
    });
  }
  return mapa;
}

/** The General MIDI SoundFont, once per session (~30 MB). */
let gmEnMemoria: { ruta: string; sf: SoundfontCargado } | null = null;

/**
 * The GM SoundFont from `workspace/catalogo/gm/`, if any track uses it: a MIDI track with
 * `instrument.program`, or any drum track (without program it plays the GM standard kit). Without
 * the file, melodic tracks sound with openDAW's synths and drum tracks are silent.
 * Bug 36 (10-Nov): a drum track without program did not count, so a project whose only drums
 * were the Pad's never loaded the GM and fell back to a 13-sample kit with no high tom (heard: silent).
 */
export async function cargarGm(
  view: Project,
  avisarSinGm: (texto: string) => void,
  estado: (texto: string) => void,
): Promise<SoundfontCargado | null> {
  const loUsa = view.tracks.some(
    (t) =>
      t.kind === "midi" &&
      (t.instrument.program !== undefined || t.instrument.type === "drumkit") &&
      !(t.instrument.type === "soundfont" && t.instrument.archivo),
  );
  if (!loUsa) return null;
  try {
    const info = (await (await fetch("/api/gm")).json()) as { ruta?: string | null; nombre?: string };
    if (!info.ruta) {
      avisarSinGm("Some tracks use a General MIDI instrument but there is no GM SoundFont in workspace/catalogo/gm/: they play with openDAW's synths, and drum tracks are silent.");
      return null;
    }
    if (gmEnMemoria?.ruta === info.ruta) return gmEnMemoria.sf;
    estado(`Loading the General MIDI SoundFont (${info.nombre ?? info.ruta})…`);
    const respuesta = await fetch(`/api/audio?path=${encodeURIComponent(info.ruta)}`);
    if (!respuesta.ok) return null;
    gmEnMemoria = {
      ruta: info.ruta,
      sf: { uuid: uuidDeSoundfont(info.ruta), name: info.nombre ?? "gm.sf2", bytes: await respuesta.arrayBuffer() },
    };
    return gmEnMemoria.sf;
  } catch {
    return null;
  }
}

/** 16 stable bytes from the path: the adapter and the engine must match. */
function uuidDeSoundfont(texto: string): Uint8Array {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    h1 = Math.imul(h1 ^ texto.charCodeAt(i), 16777619) >>> 0;
    h2 = (h2 + Math.imul(texto.charCodeAt(i) + i, 2654435761)) >>> 0;
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const fuente = i < 8 ? h1 : h2;
    bytes[i] = (fuente >>> ((i % 4) * 8)) & 0xff;
  }
  return bytes;
}
