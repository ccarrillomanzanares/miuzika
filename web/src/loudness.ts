/** Medición y normalización de loudness (ITU-R BS.1770, simplificado). */

export interface Loudness {
  /** LUFS integrados (aproximación BS.1770 con gating). */
  lufs: number;
  /** Pico de muestra en dBFS. */
  peakDb: number;
  /** Pico entre muestras (4x, interpolación lineal). */
  truePeakDb: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Etapa 1 de K-weighting: shelf. */
function shelf(fs: number): Biquad {
  const f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / fs);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** Etapa 2 de K-weighting: high-pass. */
function highPass(fs: number): Biquad {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + k / q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

function apply(data: Float32Array, filter: Biquad): Float32Array {
  const output = new Float32Array(data.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < data.length; index++) {
    const x = data[index]!;
    const y = filter.b0 * x + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
    output[index] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return output;
}

function weighted(data: Float32Array, fs: number): Float32Array {
  return apply(apply(data, shelf(fs)), highPass(fs));
}

/**
 * Loudness integrado con bloques de 400 ms (75% solape) y doble gating
 * (absoluto a −70 LUFS, relativo a −10 LU).
 */
export function measureLoudness(buffer: AudioBuffer): Loudness {
  const fs = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);
  const blockSize = Math.max(1, Math.round(0.4 * fs));
  const hop = Math.max(1, Math.round(0.1 * fs));
  const energies: number[] = [];

  const weightedChannels = Array.from({ length: channels }, (_, channel) =>
    weighted(buffer.getChannelData(channel), fs),
  );

  const length = weightedChannels[0]?.length ?? 0;
  for (let start = 0; start + blockSize <= length; start += hop) {
    let energy = 0;
    for (const data of weightedChannels) {
      let sum = 0;
      for (let index = start; index < start + blockSize; index++) sum += data[index]! ** 2;
      energy += sum / blockSize;
    }
    energies.push(energy);
  }

  const toLufs = (energy: number) => -0.691 + 10 * Math.log10(Math.max(energy, 1e-12));

  const absolute = energies
    .map((energy) => ({ energy, lufs: toLufs(energy) }))
    .filter((block) => block.lufs > -70);
  let integrated = -Infinity;
  if (absolute.length > 0) {
    const mean = absolute.reduce((sum, block) => sum + block.energy, 0) / absolute.length;
    const relativeGate = toLufs(mean) - 10;
    const gated = absolute.filter((block) => block.lufs > relativeGate);
    const gatedMean =
      gated.reduce((sum, block) => sum + block.energy, 0) / Math.max(1, gated.length);
    integrated = toLufs(gatedMean);
  }

  let peak = 0;
  let truePeak = 0;
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const value = Math.abs(data[index]!);
      if (value > peak) peak = value;
      if (value > truePeak) truePeak = value;
      for (let step = 1; step < 4; step++) {
        const previous = data[index - 1] ?? 0;
        const interpolated = Math.abs(previous + (data[index]! - previous) * (step / 4));
        if (interpolated > truePeak) truePeak = interpolated;
      }
    }
  }

  return {
    lufs: Number.isFinite(integrated) ? Number(integrated.toFixed(2)) : -Infinity,
    peakDb: Number((20 * Math.log10(Math.max(peak, 1e-9))).toFixed(2)),
    truePeakDb: Number((20 * Math.log10(Math.max(truePeak, 1e-9))).toFixed(2)),
  };
}

/** Aplica ganancia para acercarse al target sin pasarse del techo de pico. */
export function normalizeBuffer(
  buffer: AudioBuffer,
  targetLufs = -14,
  ceilingDb = -1,
): Loudness {
  const before = measureLoudness(buffer);
  if (!Number.isFinite(before.lufs)) return before;

  let gainDb = targetLufs - before.lufs;
  if (before.truePeakDb + gainDb > ceilingDb) {
    gainDb = ceilingDb - before.truePeakDb;
  }
  const gain = 10 ** (gainDb / 20);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index]! *= gain;
  }
  return measureLoudness(buffer);
}
