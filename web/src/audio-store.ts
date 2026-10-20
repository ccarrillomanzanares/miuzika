/** Assets de audio cargados en la sesión (los bytes no viven en el JSON). */

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
  const base = `aud_${slug(name)}`;
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
