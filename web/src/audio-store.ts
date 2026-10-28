/**
 * Audio del proyecto.
 *
 * Los WAV viven en el disco (`workspace/proyectos/<slug>/…`) y aquí sólo se
 * cachean en memoria los que el engine necesita decodificados. No hay
 * IndexedDB: el proyecto es el fichero maestro (`proyecto.json`) más sus WAV,
 * así que lo que suena es exactamente lo que hay en la carpeta.
 *
 * Los cortos (≤ SEGUNDOS_STREAMING) se decodifican siempre. Los largos, mientras
 * quepan en PRESUPUESTO_DECODIFICADO_MB: así pasan por openDAW (efectos, envíos,
 * exportar). Los que no caben se reproducen con `<audio>` por streaming, con la
 * onda calculada en el servidor, y no entran en el mezclador.
 */

import type { Project } from "../../src/core/types.ts";
import { idsDeAssets } from "../../src/core/project.ts";
import { rutaEnWorkspace } from "../../src/core/rutas.ts";
import { slugDe } from "../../src/core/nombres.ts";

/** Hasta estos segundos el WAV se decodifica siempre. */
export const SEGUNDOS_STREAMING = 30;

/**
 * Memoria para WAV largos decodificados (Float32, estéreo, 48 kHz ≈ 0,37 MB/s).
 * Medido el 23-oct: diez stems de 6 min (1,3 GB) no cabían en el portátil, y por
 * eso todo lo de más de 30 s iba por streaming, fuera de openDAW. 400 MB son unos
 * 18 min de audio estéreo: tres stems de 6 min, o un proyecto entero de pocas pistas.
 * Si el navegador se queda sin memoria, bájalo.
 */
export const PRESUPUESTO_DECODIFICADO_MB = 400;
const BYTES_POR_SEGUNDO = 48_000 * 2 * 4;

/** Bytes que reservan las decodificaciones en curso (hidratarAssets va de cuatro en cuatro). */
let reservado = 0;

function bytesDecodificados(): number {
  let total = 0;
  for (const asset of audioAssets.values()) {
    if (asset.buffer) total += asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }
  return total;
}

/** ¿Se decodifica un WAV de esta duración con estos bytes ya en uso? Pura, con pruebas. */
export function decidirDecodificar(duracionSeg: number, bytesEnUso: number, presupuestoMb = PRESUPUESTO_DECODIFICADO_MB): boolean {
  if (duracionSeg <= SEGUNDOS_STREAMING) return true;
  return bytesEnUso + duracionSeg * BYTES_POR_SEGUNDO <= presupuestoMb * 1024 * 1024;
}

/**
 * Reserva memoria para decodificar un WAV. Devuelve con qué soltar la reserva una
 * vez decodificado (o fallido), o null si no cabe y debe ir por streaming.
 */
export function reservarDecodificado(duracionSeg: number): (() => void) | null {
  if (!decidirDecodificar(duracionSeg, bytesDecodificados() + reservado)) return null;
  const bytes = duracionSeg <= SEGUNDOS_STREAMING ? 0 : duracionSeg * BYTES_POR_SEGUNDO;
  reservado += bytes;
  let suelta = false;
  return () => {
    if (suelta) return;
    suelta = true;
    reservado -= bytes;
  };
}

/** Nombres de los assets del proyecto que van por streaming: no suenan en openDAW ni en el WAV exportado. */
export function assetsPorStreaming(project: Project | null): string[] {
  if (!project) return [];
  return idsDeAssets(project).flatMap((id) => {
    const asset = audioAssets.get(id);
    return asset?.streaming ? [asset.name] : [];
  });
}

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
  return slugDe(value, { separador: "_", max: 24, defecto: "audio" });
}

/** Id nuevo para un asset, con el nombre del fichero dentro (aud_kick_lz3k9). */
export function idDeAsset(nombre: string): string {
  const base = `aud_${slug(nombre)}_${Date.now().toString(36)}`;
  let id = base;
  let sufijo = 2;
  while (audioAssets.has(id)) id = `${base}_${sufijo++}`;
  return id;
}

/**
 * Ruta que entiende el servidor: lo compartido tal cual y el resto en el proyecto.
 * La lista de carpetas compartidas es la misma que usa el servidor
 * (`src/core/rutas.ts`); antes eran dos listas y a ésta le faltaba `catalogo/`.
 */
export function rutaEnProyecto(ruta: string, slugProyecto: string): string {
  return rutaEnWorkspace(ruta, slugProyecto);
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

export { idsDeAssets };

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

  const uno = async (id: string): Promise<void> => {
    const meta = project.audioAssets?.find((asset) => asset.id === id);
    const enMemoria = audioAssets.get(id);
    if (enMemoria) {
      // Ya decodificado en esta sesión: sólo se refresca el nombre.
      if (meta) enMemoria.name = meta.name;
      return;
    }
    if (!meta?.ruta) {
      // Sin ruta no hay nada que buscar: el WAV era del navegador y ya no está.
      faltan.push(meta?.name ?? id);
      return;
    }
    const completa = rutaEnProyecto(meta.ruta, slugProyecto);
    try {
      const { picos, duracionSeg } = await metadatosWav(completa);
      const durationBeats =
        meta.durationBeats > 0 ? meta.durationBeats : (duracionSeg * project.bpm) / 60;
      const soltar = reservarDecodificado(duracionSeg);
      if (!soltar) {
        registrarAssetStreaming({
          id,
          name: meta.name,
          durationBeats,
          src: meta.ruta,
          peaks: Float32Array.from(picos),
        });
      } else {
        try {
          await decodificarDeDisco({
            id,
            name: meta.name,
            ruta: meta.ruta,
            completa,
            bpm: project.bpm,
            durationBeats,
            peaks: Float32Array.from(picos),
          });
        } finally {
          soltar();
        }
      }
      cargados++;
    } catch {
      faltan.push(meta.name);
    }
  };

  // Cuatro a la vez: en serie, 21 pistas con 11 WAV tardaban 38 s en abrir (medido,
  // un viaje al servidor por asset). Más de cuatro satura el `spawn` de Python.
  const cola = [...idsDeAssets(project)];
  const A_LA_VEZ = 4;
  await Promise.all(
    Array.from({ length: Math.min(A_LA_VEZ, cola.length) }, async () => {
      for (;;) {
        const id = cola.shift();
        if (id === undefined) return;
        await uno(id);
      }
    }),
  );
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
