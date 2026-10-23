/**
 * Audio del proyecto.
 *
 * Los WAV viven en el disco (`workspace/proyectos/<slug>/…`) y aquí sólo se
 * cachean en memoria los que el engine necesita decodificados. No hay
 * IndexedDB: el proyecto es el fichero maestro (`proyecto.json`) más sus WAV,
 * así que lo que suena es exactamente lo que hay en la carpeta.
 *
 * Los ficheros largos (> SEGUNDOS_STREAMING) no se decodifican nunca: se
 * reproducen con `<audio>` por streaming y la onda la calcula el servidor.
 */

import type { Project } from "../../src/core/types.ts";

/** Por encima de estos segundos el WAV no se decodifica: se reproduce por streaming. */
export const SEGUNDOS_STREAMING = 30;

interface LoadedAsset {
  id: string;
  name: string;
  /** null cuando el asset va por streaming (no se decodifica en el navegador). */
  buffer: AudioBuffer | null;
  durationBeats: number;
  peaks: Float32Array;
  /** Ruta dentro de la carpeta del proyecto ("entrada/kick.wav"). */
  src: string;
  streaming: boolean;
}

export const audioAssets = new Map<string, LoadedAsset>();

let decodeContext: AudioContext | null = null;

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "audio"
  );
}

/** Id nuevo para un asset, con el nombre del fichero dentro (aud_kick_lz3k9). */
export function idDeAsset(nombre: string): string {
  const base = `aud_${slug(nombre)}_${Date.now().toString(36)}`;
  let id = base;
  let sufijo = 2;
  while (audioAssets.has(id)) id = `${base}_${sufijo++}`;
  return id;
}

/** Ruta que entiende el servidor: lo compartido tal cual y el resto en el proyecto. */
export function rutaEnProyecto(ruta: string, slugProyecto: string): string {
  if (/^(codigo|herramientas|plantillas|proyectos|_archivo)\//.test(ruta)) return ruta;
  return `proyectos/${slugProyecto}/${ruta}`;
}

/** Duración y picos de un WAV sin decodificarlo en el navegador (los da el servidor). */
export async function metadatosWav(ruta: string): Promise<{ picos: number[]; duracionSeg: number }> {
  const res = await fetch(`/api/picos?path=${encodeURIComponent(ruta)}&cubos=1024`);
  if (!res.ok) throw new Error(`no se pudo leer ${ruta}`);
  const datos = (await res.json()) as { picos?: number[]; duracionSeg?: number };
  return { picos: datos.picos ?? [], duracionSeg: Number(datos.duracionSeg ?? 0) };
}

/**
 * Registra un asset que NO se decodifica: se reproduce por streaming con <audio>
 * y la onda viene calculada del servidor. Pensado para stems largos.
 */
export function registrarAssetStreaming(datos: {
  id: string;
  name: string;
  durationBeats: number;
  src: string;
  peaks: Float32Array;
}): void {
  audioAssets.set(datos.id, {
    id: datos.id,
    name: datos.name,
    buffer: null,
    durationBeats: datos.durationBeats,
    peaks: datos.peaks,
    src: datos.src,
    streaming: true,
  });
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  decodeContext ??= new AudioContext();
  return decodeContext.decodeAudioData(await blob.arrayBuffer());
}

/** Trae un WAV del servidor y lo decodifica (sólo los cortos: openDAW los necesita en memoria). */
async function decodificarDeDisco(datos: {
  id: string;
  name: string;
  /** Ruta relativa a la carpeta del proyecto. */
  ruta: string;
  /** Ruta con la que se pide al servidor (con la carpeta del proyecto delante). */
  completa: string;
  bpm: number;
  durationBeats?: number;
  peaks?: Float32Array;
}): Promise<LoadedAsset> {
  const res = await fetch(`/api/audio?path=${encodeURIComponent(datos.completa)}`);
  if (!res.ok) throw new Error(`no se pudo leer ${datos.ruta}`);
  const buffer = await decodeAudioBlob(await res.blob());
  const asset: LoadedAsset = {
    id: datos.id,
    name: datos.name,
    buffer,
    durationBeats: datos.durationBeats ?? (buffer.duration * datos.bpm) / 60,
    peaks: datos.peaks ?? computePeaks(buffer, 1024),
    src: datos.ruta,
    streaming: false,
  };
  audioAssets.set(asset.id, asset);
  return asset;
}

/** Decodifica un fichero local ya subido al disco y lo deja listo para openDAW. */
export async function loadAudioFile(file: File, bpm: number, src: string): Promise<LoadedAsset> {
  const buffer = await decodeAudioBlob(file);
  const name = file.name.replace(/\.[^.]+$/, "");
  const asset: LoadedAsset = {
    id: idDeAsset(name),
    name,
    buffer,
    durationBeats: (buffer.duration * bpm) / 60,
    peaks: computePeaks(buffer, 1024),
    src,
    streaming: false,
  };
  audioAssets.set(asset.id, asset);
  return asset;
}

/** Ids de asset que el proyecto referencia (declarados o dentro de un clip). */
export function idsDeAssets(project: Project): string[] {
  const ids = new Set<string>();
  for (const asset of project.audioAssets ?? []) ids.add(asset.id);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio) ids.add(clip.audio.assetId);
    }
  }
  return [...ids];
}

/**
 * Carga del disco los WAV que el proyecto referencia y aún no están en memoria.
 * Se llama al arrancar, al abrir un proyecto, antes de un undo/redo y al darle
 * al play. Devuelve los que no están en la carpeta.
 */
export async function hidratarAssets(
  project: Project | null,
  slugProyecto: string,
): Promise<{ cargados: number; faltan: string[] }> {
  if (!project) return { cargados: 0, faltan: [] };
  let cargados = 0;
  const faltan: string[] = [];

  for (const id of idsDeAssets(project)) {
    const meta = project.audioAssets?.find((asset) => asset.id === id);
    const enMemoria = audioAssets.get(id);
    if (enMemoria) {
      // Ya decodificado en esta sesión: sólo se refresca el nombre.
      if (meta) enMemoria.name = meta.name;
      continue;
    }
    if (!meta?.ruta) {
      // Sin ruta no hay nada que buscar: el WAV era del navegador y ya no está.
      faltan.push(meta?.name ?? id);
      continue;
    }
    const completa = rutaEnProyecto(meta.ruta, slugProyecto);
    try {
      const { picos, duracionSeg } = await metadatosWav(completa);
      const durationBeats =
        meta.durationBeats > 0 ? meta.durationBeats : (duracionSeg * project.bpm) / 60;
      if (duracionSeg > SEGUNDOS_STREAMING) {
        registrarAssetStreaming({
          id,
          name: meta.name,
          durationBeats,
          src: meta.ruta,
          peaks: Float32Array.from(picos),
        });
      } else {
        await decodificarDeDisco({
          id,
          name: meta.name,
          ruta: meta.ruta,
          completa,
          bpm: project.bpm,
          durationBeats,
          peaks: Float32Array.from(picos),
        });
      }
      cargados++;
    } catch {
      faltan.push(meta.name);
    }
  }
  return { cargados, faltan };
}

/** Suelta de la memoria lo que el proyecto actual ya no usa (al cambiar de proyecto). */
export function liberarAssetsNoUsados(project: Project | null): void {
  const vivos = new Set(project ? idsDeAssets(project) : []);
  for (const id of [...audioAssets.keys()]) {
    if (!vivos.has(id)) audioAssets.delete(id);
  }
}

export function computePeaks(buffer: AudioBuffer, buckets = 1024): Float32Array {
  const peaks = new Float32Array(buckets);
  const channels = Math.min(2, buffer.numberOfChannels);
  const block = Math.max(1, Math.floor(buffer.length / buckets));
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = bucket * block;
    const end = Math.min(buffer.length, start + block);
    let peak = 0;
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = start; index < end; index += 4) {
        const value = Math.abs(data[index]!);
        if (value > peak) peak = value;
      }
    }
    peaks[bucket] = peak;
  }
  return peaks;
}
