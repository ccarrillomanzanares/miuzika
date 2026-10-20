/**
 * Motor one-shot "industrial": síntesis sustractiva + FM inarmónica + ruido,
 * pitch-drop, saturación asimétrica, bitcrush, SVF con barrido y cola estéreo.
 *
 * Es DSP puro (Float32Array), sin WebAudio, para poder testearlo en Node y
 * renderizarlo después a un AudioBuffer.
 */

import {
  IndustrialParamsSchema,
  type IndustrialParams,
} from "../../src/core/sample.ts";

export interface StereoAudio {
  left: Float32Array;
  right: Float32Array;
}

const TWO_PI = Math.PI * 2;
const PEAK_DBFS = -1;
const MAX_HARMONICS = 64;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normal(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

function timeArray(frames: number, sampleRate: number): Float64Array {
  const time = new Float64Array(frames);
  for (let index = 0; index < frames; index++) time[index] = index / sampleRate;
  return time;
}

function expEnv(time: Float64Array, sampleRate: number, tau: number, attack: number): Float64Array {
  const env = new Float64Array(time.length);
  const attackFrames = Math.max(2, Math.floor(sampleRate * attack));
  for (let index = 0; index < time.length; index++) {
    let value = Math.exp(-time[index]! / tau);
    if (index < attackFrames) value *= (index / attackFrames) ** 0.6;
    env[index] = value;
  }
  return env;
}

function pitchAt(t: number, base: number, semitones: number, tau: number): number {
  return base * 2 ** ((semitones * Math.exp(-t / tau)) / 12);
}

function bandLimitedSaw(phase: number, frequency: number, fmax: number): number {
  let value = 0;
  for (let harmonic = 1; harmonic <= MAX_HARMONICS; harmonic++) {
    if (harmonic * frequency >= fmax) break;
    value += Math.sin(harmonic * phase) / harmonic;
  }
  return value * (2 / Math.PI);
}

function renderSawLayer(
  time: Float64Array,
  sampleRate: number,
  base: number,
  semitones: number,
  pitchTau: number,
  detunes: number[],
  env: Float64Array,
  fmax: number,
): Float32Array {
  const out = new Float32Array(time.length);
  const phases = new Float64Array(detunes.length);
  const ratios = detunes.map((cents) => 2 ** (cents / 1200));
  for (let index = 0; index < time.length; index++) {
    const frequency = pitchAt(time[index]!, base, semitones, pitchTau);
    let sum = 0;
    for (let layer = 0; layer < detunes.length; layer++) {
      phases[layer] = (phases[layer]! + (TWO_PI * frequency * ratios[layer]!) / sampleRate) % TWO_PI;
      sum += bandLimitedSaw(phases[layer]!, frequency * ratios[layer]!, fmax);
    }
    out[index] = (sum / detunes.length) * env[index]!;
  }
  return out;
}

function svf(
  input: Float32Array,
  sampleRate: number,
  cutoffAt: (index: number) => number,
  qAt: (index: number) => number,
  mode: "lp" | "bp" | "hp",
): Float32Array {
  const out = new Float32Array(input.length);
  let ic1 = 0;
  let ic2 = 0;
  for (let index = 0; index < input.length; index++) {
    const cutoff = Math.min(sampleRate * 0.45, Math.max(20, cutoffAt(index)));
    const q = Math.max(0.5, qAt(index));
    const g = Math.tan((Math.PI * cutoff) / sampleRate);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v0 = input[index]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[index] = mode === "lp" ? v2 : mode === "bp" ? v1 * k : v0 - k * v1 - v2;
  }
  return out;
}

function driveTanh(input: Float32Array, gain: number, bias = 0.18): void {
  const offset = Math.tanh(bias);
  for (let index = 0; index < input.length; index++) {
    input[index] = Math.tanh(gain * input[index]! + bias) - offset;
  }
}

function bitcrush(input: Float32Array, sampleRate: number, rateHz: number, levels: number): Float32Array {
  const step = Math.max(1, Math.round(sampleRate / rateHz));
  const out = new Float32Array(input.length);
  if (step <= 1) {
    for (let index = 0; index < input.length; index++) {
      out[index] = Math.round(input[index]! * levels) / levels;
    }
    return out;
  }
  for (let index = 0; index < input.length; index += step) {
    const held = Math.round(input[index]! * levels) / levels;
    for (let inner = 0; inner < step && index + inner < input.length; inner++) {
      out[index + inner] = held;
    }
  }
  return out;
}

function delayTaps(input: Float32Array, sampleRate: number, taps: Array<[number, number]>): Float32Array {
  const out = new Float32Array(input.length);
  for (const [seconds, gain] of taps) {
    const delay = Math.floor(seconds * sampleRate);
    if (delay <= 0) continue;
    for (let index = delay; index < input.length; index++) {
      out[index] += input[index - delay]! * gain;
    }
  }
  return out;
}

function buildChannel(
  time: Float64Array,
  sampleRate: number,
  params: IndustrialParams,
  side: 1 | -1,
): Float32Array {
  const width = params.width;
  const random = seededRandom(params.seed + side);
  const detunes = [-9, 0, 7.5].map((cents) => cents + side * 1.5 * width);
  const panMask = 1 + 0.05 * side * width;

  const bodyEnv = expEnv(time, sampleRate, params.decay, 0.0015);
  const shortEnv = expEnv(time, sampleRate, 0.62, 0.0015);
  const crossStart = 0.62 * (time.length / sampleRate) - 0.04;
  const envStab = new Float32Array(time.length);
  for (let index = 0; index < time.length; index++) {
    const w = Math.max(0, Math.min(1, (time[index]! - crossStart) / 0.04));
    envStab[index] = bodyEnv[index]! * (1 - w) + shortEnv[index]! * w;
  }

  const stab = renderSawLayer(
    time,
    sampleRate,
    params.rootHz,
    params.pitchDrop,
    params.pitchTau,
    detunes,
    Float64Array.from(envStab),
    16_000,
  );

  const presenceEnv = expEnv(time, sampleRate, 0.34, 0.0015);
  const presence = renderSawLayer(
    time,
    sampleRate,
    params.rootHz * 2,
    params.pitchDrop,
    params.pitchTau,
    detunes.map((cents) => cents + 4),
    presenceEnv,
    15_000,
  );

  const subEnv = expEnv(time, sampleRate, 0.4, 0.001);
  const sub = new Float32Array(time.length);
  let subPhase = 0;
  for (let index = 0; index < time.length; index++) {
    const frequency = pitchAt(time[index]!, params.rootHz / 2, 6, 0.045);
    subPhase = (subPhase + (TWO_PI * frequency) / sampleRate) % TWO_PI;
    sub[index] = Math.sin(subPhase) * subEnv[index]!;
  }

  const metal = new Float32Array(time.length);
  const metalEnv1 = expEnv(time, sampleRate, 0.42, 0.0008);
  const metalEnv2 = expEnv(time, sampleRate, 0.22, 0.0008);
  for (let index = 0; index < time.length; index++) {
    const t = time[index]!;
    const mod1 = (params.metalIndex * Math.exp(-t / 0.28) + 0.8) * Math.sin(TWO_PI * params.metalHz * params.metalRatio * t);
    const fm1 = Math.sin(TWO_PI * params.metalHz * t + mod1) * metalEnv1[index]!;
    const mod2 = (params.metalIndex * 0.43 * Math.exp(-t / 0.14) + 0.4) * Math.sin(TWO_PI * params.metalHz * 2 * 2.732 * t);
    const fm2 = Math.sin(TWO_PI * params.metalHz * 2 * t + mod2) * metalEnv2[index]!;
    metal[index] = fm1 + 0.35 * fm2;
  }
  const crushedMetal = bitcrush(metal, sampleRate, params.crushHz, params.crushLevels);
  const filteredMetal = svf(
    crushedMetal,
    sampleRate,
    () => 5200 + side * 400 * width,
    () => 1.1,
    "bp",
  );

  const noise = new Float32Array(time.length);
  for (let index = 0; index < time.length; index++) noise[index] = normal(random);
  const filteredNoise = svf(
    noise,
    sampleRate,
    () => 4200 + side * 600 * width,
    () => 0.9,
    "bp",
  );
  const noiseEnv = expEnv(time, sampleRate, 0.035, 0.0004);
  for (let index = 0; index < time.length; index++) {
    filteredNoise[index] = filteredNoise[index]! * noiseEnv[index]! * 1.6;
  }

  const mix = new Float32Array(time.length);
  for (let index = 0; index < time.length; index++) {
    const ring = 0.72 + 0.28 * Math.sin(TWO_PI * 103 * time[index]!);
    mix[index] =
      stab[index]! * panMask * ring +
      0.55 * presence[index]! * panMask +
      0.85 * sub[index]! +
      0.42 * filteredMetal[index]! +
      params.noise * filteredNoise[index]!;
  }
  driveTanh(mix, params.drive);

  const body = svf(
    mix,
    sampleRate,
    (index) =>
      params.cutoffEnd +
      (params.cutoffStart - params.cutoffEnd) * Math.exp(-time[index]! / params.cutoffTau),
    (index) =>
      params.resonance +
      1.4 * Math.exp(-time[index]! / 0.18) +
      side * 0.25 * width,
    "lp",
  );

  const tail = svf(
    delayTaps(body, sampleRate, [
      [0.093, 0.22],
      [0.147, 0.15],
    ]),
    sampleRate,
    () => 2400,
    () => 0.8,
    "lp",
  );

  const out = new Float32Array(time.length);
  for (let index = 0; index < time.length; index++) {
    out[index] = body[index]! + params.delayWet * tail[index]!;
  }

  if (side < 0) {
    const delay = Math.floor(0.0008 * width * sampleRate);
    if (delay > 0) {
      out.copyWithin(delay, 0, out.length - delay);
      out.fill(0, 0, delay);
    }
  }
  return out;
}

function normalizeStereo(left: Float32Array, right: Float32Array, sampleRate: number): void {
  const frames = left.length;
  let meanLeft = 0;
  let meanRight = 0;
  for (let index = 0; index < frames; index++) {
    meanLeft += left[index]!;
    meanRight += right[index]!;
  }
  meanLeft /= frames;
  meanRight /= frames;

  let peak = 0;
  for (let index = 0; index < frames; index++) {
    left[index] = left[index]! - meanLeft;
    right[index] = right[index]! - meanRight;
    peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  }
  if (peak > 1e-12) {
    const gain = 1 / peak;
    for (let index = 0; index < frames; index++) {
      left[index] = left[index]! * gain;
      right[index] = right[index]! * gain;
    }
  }

  let rmsLeft = 0;
  let rmsRight = 0;
  for (let index = 0; index < frames; index++) {
    rmsLeft += left[index]! ** 2;
    rmsRight += right[index]! ** 2;
  }
  rmsLeft = Math.sqrt(rmsLeft / frames);
  rmsRight = Math.sqrt(rmsRight / frames);
  if (rmsLeft > 1e-12 && rmsRight > 1e-12) {
    const target = 0.5 * (rmsLeft + rmsRight);
    const gainLeft = target / rmsLeft;
    const gainRight = target / rmsRight;
    for (let index = 0; index < frames; index++) {
      left[index] = left[index]! * gainLeft;
      right[index] = right[index]! * gainRight;
    }
  }

  peak = 0;
  for (let index = 0; index < frames; index++) {
    peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  }
  const targetPeak = 10 ** (PEAK_DBFS / 20);
  const peakGain = peak > 1e-12 ? targetPeak / peak : 0;
  const fadeFrames = Math.max(2, Math.floor(0.025 * sampleRate));
  for (let index = 0; index < frames; index++) {
    const fade = index >= frames - fadeFrames ? (frames - 1 - index) / fadeFrames : 1;
    left[index] = left[index]! * peakGain * Math.max(0, fade);
    right[index] = right[index]! * peakGain * Math.max(0, fade);
  }
}

/** Renderiza el one-shot industrial. `params` puede venir incompleto: se aplican defaults. */
export function renderIndustrialStab(
  params: Partial<IndustrialParams> | undefined,
  duration: number,
  sampleRate = 44_100,
): StereoAudio {
  const parsed = IndustrialParamsSchema.parse(params ?? {});
  const frames = Math.max(1, Math.floor(duration * sampleRate));
  const time = timeArray(frames, sampleRate);
  const left = buildChannel(time, sampleRate, parsed, 1);
  const right = buildChannel(time, sampleRate, parsed, -1);
  normalizeStereo(left, right, sampleRate);
  return { left, right };
}
