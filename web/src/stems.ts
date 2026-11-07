/**
 * The long WAVs that do not fit openDAW's memory budget and play through <audio>: which ones
 * sound, and how they enter the export. One definition for Play and for the export, so the two
 * cannot disagree on mute, solo, gain or pan.
 */

import type { Project } from "../../src/core/types.ts";

export interface StemDeProyecto {
  clave: string;
  /** Path inside the project folder. */
  src: string;
  nombrePista: string;
  startBeat: number;
  lengthBeat: number;
  offsetBeat: number;
  /** Clip + track gain; the master is applied apart. */
  gainDb: number;
  pan: number;
  /** The track has effects or sends that a stem cannot go through. */
  sinSusEfectos: boolean;
}

interface AssetSonoro {
  streaming: boolean;
  src: string;
}

function suena(view: Project, track: Project["tracks"][number]): boolean {
  const haySolo = view.tracks.some((t) => t.solo);
  return !track.muted && (!haySolo || track.solo);
}

export function stemsDeProyecto(view: Project, assets: ReadonlyMap<string, AssetSonoro>): StemDeProyecto[] {
  const stems: StemDeProyecto[] = [];
  for (const track of view.tracks) {
    if (!suena(view, track)) continue;
    for (const clip of track.clips) {
      if (!clip.audio) continue;
      const asset = assets.get(clip.audio.assetId);
      if (!asset?.streaming || !asset.src) continue;
      stems.push({
        clave: `${clip.audio.assetId}:${clip.id}`,
        src: asset.src,
        nombrePista: track.name,
        startBeat: clip.start,
        lengthBeat: clip.length,
        offsetBeat: clip.audio.offset,
        gainDb: clip.audio.gainDb + track.gainDb,
        pan: track.pan,
        sinSusEfectos: track.devices.some((d) => d.enabled) || (track.sends?.length ?? 0) > 0,
      });
    }
  }
  return stems;
}

/** Does the engine's render have to produce sound? A silent one with this true is a failure. */
export function motorDebeSonar(view: Project, assets: ReadonlyMap<string, AssetSonoro>): boolean {
  return view.tracks.some(
    (track) =>
      suena(view, track) &&
      track.clips.some((clip) => (clip.audio ? assets.get(clip.audio.assetId)?.streaming !== true : clip.notes.length > 0)),
  );
}

/**
 * Adds a stem to a stereo mix, with the same pan law as the StereoPannerNode that plays it:
 * the export has to sound like Play.
 */
export function mezclarStem(
  destino: [Float32Array, Float32Array],
  fuente: readonly Float32Array[],
  o: { inicio: number; desdeFuente: number; muestras: number; ganancia: number; pan: number },
): void {
  const izq = fuente[0];
  if (!izq) return;
  const der = fuente[1] ?? izq;
  const pan = Math.min(1, Math.max(-1, o.pan));
  const x = ((pan <= 0 ? pan + 1 : pan) * Math.PI) / 2;
  const [cos, sen] = [Math.cos(x), Math.sin(x)];
  const n = Math.min(o.muestras, izq.length - o.desdeFuente, destino[0].length - o.inicio);
  for (let i = 0; i < n; i += 1) {
    const l = izq[o.desdeFuente + i]! * o.ganancia;
    const r = der[o.desdeFuente + i]! * o.ganancia;
    const j = o.inicio + i;
    if (pan <= 0) {
      destino[0][j] += l + r * cos;
      destino[1][j] += r * sen;
    } else {
      destino[0][j] += l * cos;
      destino[1][j] += r + l * sen;
    }
  }
}
