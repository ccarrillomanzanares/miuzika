/**
 * Project audio.
 *
 * WAVs live on disk (`workspace/proyectos/<slug>/…`) and here only the ones the
 * engine needs decoded are cached in memory. There is no IndexedDB: the project is
 * the master file (`proyecto.json`) plus its WAVs, so what sounds is exactly what
 * is in the folder.
 *
 * Short ones (≤ SEGUNDOS_STREAMING) are always decoded. Long ones, as long as they
 * fit in PRESUPUESTO_DECODIFICADO_MB: that way they go through openDAW (effects,
 * sends, export). The ones that do not fit are played with streaming `<audio>`, with
 * the waveform computed on the server, and do not enter the mixer.
 */

import type { Project } from "../../src/core/types.ts";
import { idsDeAssets } from "../../src/core/project.ts";
import { rutaEnWorkspace } from "../../src/core/rutas.ts";
import { slugDe } from "../../src/core/nombres.ts";

/** Up to these seconds the WAV is always decoded. */
export const SEGUNDOS_STREAMING = 30;

/**
 * Memory for long decoded WAVs (Float32, stereo, 48 kHz ≈ 0.37 MB/s).
 * Measured on Oct 23: ten 6-min stems (1.3 GB) did not fit on the laptop, and that
 * is why everything over 30 s went through streaming, outside openDAW. 400 MB is
 * about 18 min of stereo audio: three 6-min stems, or a whole project with few
 * tracks. If the browser runs out of memory, lower it.
 */
export const PRESUPUESTO_DECODIFICADO_MB = 400;
const BYTES_POR_SEGUNDO = 48_000 * 2 * 4;

/** Bytes reserved by decodings in progress (hidratarAssets runs four at a time). */
let reservado = 0;

function bytesDecodificados(): number {
  let total = 0;
  for (const asset of audioAssets.values()) {
    if (asset.buffer) total += asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }
  return total;
}

/** Is a WAV of this duration decoded with these bytes already in use? Pure, with tests. */
export function decidirDecodificar(duracionSeg: number, bytesEnUso: number, presupuestoMb = PRESUPUESTO_DECODIFICADO_MB): boolean {
  if (duracionSeg <= SEGUNDOS_STREAMING) return true;
  return bytesEnUso + duracionSeg * BYTES_POR_SEGUNDO <= presupuestoMb * 1024 * 1024;
}

/**
 * Reserves memory to decode a WAV. Returns a function to release the reservation
 * once decoded (or failed), or null if it does not fit and must go through
 * streaming.
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

/** Names of the project assets that go through streaming: they do not sound in openDAW or in the exported WAV. */
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
  /** null when the asset goes through streaming (it is not decoded in the browser). */
  buffer: AudioBuffer | null;
  durationBeats: number;
  peaks: Float32Array;
  /** Path inside the project folder ("entrada/kick.wav"). */
  src: string;
  streaming: boolean;
}

export const audioAssets = new Map<string, LoadedAsset>();

let decodeContext: AudioContext | null = null;

function slug(value: string): string {
  return slugDe(value, { separador: "_", max: 24, defecto: "audio" });
}

/** New id for an asset, with the file name inside it (aud_kick_lz3k9). */
export function idDeAsset(nombre: string): string {
  const base = `aud_${slug(nombre)}_${Date.now().toString(36)}`;
  let id = base;
  let sufijo = 2;
  while (audioAssets.has(id)) id = `${base}_${sufijo++}`;
  return id;
}

/**
 * Path the server understands: shared folders as is and the rest inside the
 * project. The list of shared folders is the same one the server uses
 * (`src/core/rutas.ts`); before they were two lists and this one was missing
 * `catalogo/`.
 */
export function rutaEnProyecto(ruta: string, slugProyecto: string): string {
  return rutaEnWorkspace(ruta, slugProyecto);
}

/** Duration and peaks of a WAV without decoding it in the browser (the server provides them). */
export async function metadatosWav(ruta: string): Promise<{ picos: number[]; duracionSeg: number }> {
  const res = await fetch(`/api/picos?path=${encodeURIComponent(ruta)}&cubos=1024`);
  if (!res.ok) throw new Error(`could not read ${ruta}`);
  const datos = (await res.json()) as { picos?: number[]; duracionSeg?: number };
  return { picos: datos.picos ?? [], duracionSeg: Number(datos.duracionSeg ?? 0) };
}

/**
 * Registers an asset that is NOT decoded: it is played through streaming with
 * <audio> and the waveform comes precomputed from the server. Meant for long stems.
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

/** Fetches a WAV from the server and decodes it (only short ones: openDAW needs them in memory). */
async function decodificarDeDisco(datos: {
  id: string;
  name: string;
  /** Path relative to the project folder. */
  ruta: string;
  /** Path used to request it from the server (with the project folder in front). */
  completa: string;
  bpm: number;
  durationBeats?: number;
  peaks?: Float32Array;
}): Promise<LoadedAsset> {
  const res = await fetch(`/api/audio?path=${encodeURIComponent(datos.completa)}`);
  if (!res.ok) throw new Error(`could not read ${datos.ruta}`);
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

/** Decodes a local file already uploaded to disk and leaves it ready for openDAW. */
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
 * Loads from disk the WAVs the project references and that are not in memory yet.
 * Called at startup, when opening a project, before an undo/redo and when pressing
 * play. Returns the ones that are not in the folder.
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
      // Already decoded in this session: only the name is refreshed.
      if (meta) enMemoria.name = meta.name;
      return;
    }
    if (!meta?.ruta) {
      // Without a path there is nothing to look for: the WAV came from the browser and is gone.
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

  // Four at a time: serially, 21 tracks with 11 WAVs took 38 s to open (measured,
  // one trip to the server per asset). More than four saturates Python's `spawn`.
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

/** Frees from memory what the current project no longer uses (when switching projects). */
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
