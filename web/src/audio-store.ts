/** Assets de audio cargados en la sesión; los bytes se guardan en IndexedDB. */

import type { Project } from "../../src/core/types.ts";
import { getAudioAsset, putAudioAsset } from "./audio-db.ts";

export interface LoadedAsset {
  id: string;
  name: string;
  buffer: AudioBuffer;
  durationBeats: number;
  peaks: Float32Array;
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

export async function loadAudioFile(file: File, bpm: number): Promise<LoadedAsset> {
  decodeContext ??= new AudioContext();
  const buffer = await decodeContext.decodeAudioData(await file.arrayBuffer());
  const name = file.name.replace(/\.[^.]+$/, "");
  const base = `aud_${slug(name)}_${Date.now().toString(36)}`;
  let id = base;
  let suffix = 2;
  while (audioAssets.has(id)) id = `${base}_${suffix++}`;

  const asset: LoadedAsset = {
    id,
    name,
    buffer,
    durationBeats: (buffer.duration * bpm) / 60,
    peaks: computePeaks(buffer, 1024),
  };
  audioAssets.set(id, asset);
  return asset;
}

/** Guarda los bytes de un asset para poder restaurarlo al recargar. */
export async function persistAudioAsset(
  id: string,
  name: string,
  durationBeats: number,
  blob: Blob,
): Promise<boolean> {
  return putAudioAsset({ id, name, durationBeats, blob, savedAt: Date.now() });
}

export interface HydrateResult {
  loaded: number;
  missing: string[];
}

/**
 * Carga desde IndexedDB los WAV que referencia el proyecto. Se llama al arrancar y
 * antes de un undo/redo; si un asset no está guardado se devuelve en `missing`.
 */
export async function hydrateProjectAudio(project: Project | null): Promise<HydrateResult> {
  if (!project) return { loaded: 0, missing: [] };

  const ids = new Set<string>();
  for (const asset of project.audioAssets ?? []) ids.add(asset.id);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio) ids.add(clip.audio.assetId);
    }
  }

  const missing: string[] = [];
  let loaded = 0;
  for (const id of ids) {
    const meta = project.audioAssets?.find((asset) => asset.id === id);
    const existing = audioAssets.get(id);
    if (existing) {
      if (meta) {
        existing.name = meta.name;
        existing.durationBeats = meta.durationBeats;
      }
      continue;
    }

    const stored = await getAudioAsset(id);
    if (!stored || !(stored.blob instanceof Blob)) {
      missing.push(meta?.name ?? stored?.name ?? id);
      continue;
    }

    try {
      decodeContext ??= new AudioContext();
      const buffer = await decodeContext.decodeAudioData(await stored.blob.arrayBuffer());
      audioAssets.set(id, {
        id,
        name: meta?.name ?? stored.name,
        buffer,
        durationBeats: meta?.durationBeats ?? stored.durationBeats,
        peaks: computePeaks(buffer),
      });
      loaded++;
    } catch {
      missing.push(meta?.name ?? stored.name);
    }
  }

  return { loaded, missing };
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
