/**
 * Renderiza una receta de sample a WAV usando WebAudio offline.
 * One-shots: capas de osciladores/ruido + filtros + FX.
 * Loops: patrón del motor + instrumentos + master.
 */

import type { InstrumentType } from "../../src/core/types.ts";
import type { IndustrialSpec, LoopSpec, OneShotSpec, SampleSpec } from "../../src/core/sample.ts";
import { SampleSpecSchema } from "../../src/core/sample.ts";
import { renderIndustrialStab } from "./industrial.ts";
import { expandPattern } from "../../src/core/patterns.ts";
import { tonicChordSymbol } from "../../src/core/theory.ts";
import { audioBufferToWav } from "./render.ts";
import { buildMasterChain } from "./fx.ts";
import { createNoiseBuffer, playInstrumentNote } from "./synth.ts";
import { loadDrumKit } from "./drum-kit.ts";

export interface SampleResult {
  spec: SampleSpec;
  name: string;
  buffer: AudioBuffer;
  blob: Blob;
  durationBeats: number;
}

const dbToGainLocal = (db: number) => 10 ** (db / 20);

function tanhCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * amount);
  }
  return curve;
}

function quantizeCurve(levels: number): Float32Array<ArrayBuffer> {
  const samples = 4096;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.round(x * levels) / levels;
  }
  return curve;
}

function impulse(context: BaseAudioContext, decay: number): AudioBuffer {
  const seconds = 0.4 + decay * 2.2;
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      const t = index / length;
      data[index] = (Math.random() * 2 - 1) * (1 - t) ** (1.5 + decay * 3);
    }
  }
  return buffer;
}

function mergeWet(
  context: BaseAudioContext,
  input: AudioNode,
  effectIn: AudioNode,
  effectOut: AudioNode,
  wet: number,
): AudioNode {
  const output = context.createGain();
  const dry = context.createGain();
  const wetGain = context.createGain();
  dry.gain.value = 1 - wet * 0.4;
  wetGain.gain.value = wet;
  input.connect(dry).connect(output);
  input.connect(effectIn);
  effectOut.connect(wetGain).connect(output);
  return output;
}

function buildFx(
  context: BaseAudioContext,
  destination: AudioNode,
  fx: OneShotSpec["fx"] | LoopSpec["fx"],
): AudioNode {
  const input = context.createGain();
  let current: AudioNode = input;

  if (fx?.drive !== undefined && fx.drive > 0) {
    const shaper = context.createWaveShaper();
    shaper.curve = tanhCurve(1.2 + fx.drive * 16);
    shaper.oversample = "2x";
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 9000;
    current.connect(shaper).connect(tone);
    current = tone;
  }

  if (fx?.bitcrush) {
    const crusher = context.createWaveShaper();
    crusher.curve = quantizeCurve(fx.bitcrush.levels);
    crusher.oversample = "none";
    current.connect(crusher);
    current = crusher;
  }

  if (fx?.eq) {
    const low = context.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 120;
    low.gain.value = fx.eq.low;
    const mid = context.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1100;
    mid.Q.value = 0.9;
    mid.gain.value = fx.eq.mid;
    const high = context.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 7500;
    high.gain.value = fx.eq.high;
    current.connect(low).connect(mid).connect(high);
    current = high;
  }

  if (fx?.delay) {
    const delay = context.createDelay(2);
    delay.delayTime.value = fx.delay.time;
    const feedback = context.createGain();
    feedback.gain.value = fx.delay.feedback;
    const damping = context.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 3500;
    delay.connect(damping).connect(feedback).connect(delay);
    current = mergeWet(context, current, delay, delay, fx.delay.wet);
  }

  if (fx?.reverb) {
    const convolver = context.createConvolver();
    convolver.buffer = impulse(context, fx.reverb.decay);
    current = mergeWet(context, current, convolver, convolver, fx.reverb.wet);
  }

  current.connect(destination);
  return input;
}

function fadeAndNormalize(buffer: AudioBuffer, fadeSeconds = 0.02): void {
  const fade = Math.max(1, Math.floor(buffer.sampleRate * fadeSeconds));
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      let value = data[index]!;
      if (index < fade) value *= index / fade;
      const remaining = data.length - 1 - index;
      if (remaining < fade) value *= remaining / fade;
      data[index] = value;
      peak = Math.max(peak, Math.abs(value));
    }
  }
  const gain = peak > 1e-9 ? 10 ** (-1 / 20) / peak : 0;
  if (gain === 0) return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] = data[index]! * gain;
  }
}

const ROLE_INSTRUMENT: Record<LoopSpec["role"], InstrumentType> = {
  drums: "drumkit",
  bass: "bass",
  chords: "pad",
  pad: "pad",
  lead: "lead",
  arp: "arp",
};

async function renderOneShot(spec: OneShotSpec, sampleRate: number): Promise<AudioBuffer> {
  const maxRelease = Math.max(...spec.layers.map((layer) => layer.env.release), 0.05);
  const tail =
    0.25 +
    (spec.fx?.delay ? spec.fx.delay.time * 4 : 0) +
    (spec.fx?.reverb ? 0.6 + spec.fx.reverb.decay * 1.6 : 0);
  const total = spec.duration + maxRelease + tail;
  const context = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);

  const master = context.createGain();
  master.gain.value = dbToGainLocal(spec.gainDb);
  master.connect(context.destination);
  const input = buildFx(context, master, spec.fx);
  const noise = createNoiseBuffer(context);

  for (const layer of spec.layers) {
    const gain = context.createGain();
    const attack = Math.max(0.001, layer.env.attack);
    const decay = Math.max(0.001, layer.env.decay);
    const sustain = Math.max(0.001, layer.env.sustain);
    const release = Math.max(0.01, layer.env.release);
    const level = layer.gain;
    const holdEnd = Math.max(attack + decay, spec.duration);
    const end = Math.min(total - 0.01, holdEnd + release + 0.02);

    gain.gain.setValueAtTime(0.0001, 0);
    gain.gain.linearRampToValueAtTime(level, attack);
    gain.gain.linearRampToValueAtTime(level * sustain, attack + decay);
    gain.gain.setValueAtTime(level * sustain, holdEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    const panner = context.createStereoPanner();
    panner.pan.value = layer.pan ?? 0;
    gain.connect(panner).connect(input);

    const filterConfig = layer.filter ?? (layer.filterEnv ? { type: "lowpass" as const, freq: 12_000, q: 0.7 } : null);
    const filter = filterConfig ? context.createBiquadFilter() : null;
    if (filter && filterConfig) {
      filter.type = filterConfig.type;
      filter.Q.value = filterConfig.q;
      const base = Math.max(20, Math.min(context.sampleRate * 0.45, filterConfig.freq));
      filter.frequency.setValueAtTime(base, 0);
      if (layer.filterEnv) {
        const peak = Math.max(20, Math.min(context.sampleRate * 0.45, base + layer.filterEnv.amount));
        const tail = Math.max(
          20,
          Math.min(context.sampleRate * 0.45, base + layer.filterEnv.amount * layer.filterEnv.sustain),
        );
        const attackTime = Math.max(0.001, layer.filterEnv.attack);
        const decayTime = Math.max(attackTime + 0.001, attackTime + layer.filterEnv.decay);
        filter.frequency.linearRampToValueAtTime(peak, attackTime);
        filter.frequency.exponentialRampToValueAtTime(tail, decayTime);
      }
      filter.connect(gain);
    }

    const voices = layer.osc === "noise" ? 1 : Math.max(1, Math.min(4, layer.voices ?? 1));
    const spread = layer.spread ?? 7;
    for (let voice = 0; voice < voices; voice++) {
      const voiceGain = context.createGain();
      voiceGain.gain.value = 1 / voices;
      if (filter) voiceGain.connect(filter);
      else voiceGain.connect(gain);

      if (layer.osc === "noise") {
        const source = context.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        source.connect(voiceGain);
        source.start(0);
        source.stop(end);
        continue;
      }

      const oscillator = context.createOscillator();
      oscillator.type = layer.osc === "saw" ? "sawtooth" : layer.osc;
      const frequency = layer.freq ?? 440;
      oscillator.frequency.setValueAtTime(Math.max(20, frequency), 0);
      if (layer.glideTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(20, layer.glideTo),
          Math.max(0.01, layer.glide ?? 0.2),
        );
      }
      const offset = voices > 1 ? (voice / (voices - 1) - 0.5) * 2 * spread : 0;
      const detune = (layer.detune ?? 0) + offset;
      if (detune !== 0) oscillator.detune.value = detune;

      if (layer.fm && layer.fm.index > 0) {
        const modulator = context.createOscillator();
        modulator.type = "sine";
        modulator.frequency.setValueAtTime(Math.max(20, frequency * layer.fm.ratio), 0);
        const modGain = context.createGain();
        const depth = Math.max(0.001, frequency * layer.fm.index);
        modGain.gain.setValueAtTime(depth, 0);
        modGain.gain.exponentialRampToValueAtTime(
          Math.max(0.001, depth * 0.001),
          Math.max(0.02, layer.fm.decay),
        );
        modulator.connect(modGain).connect(oscillator.frequency);
        modulator.start(0);
        modulator.stop(end);
      }

      oscillator.connect(voiceGain);
      oscillator.start(0);
      oscillator.stop(end);
    }
  }

  const rendered = await context.startRendering();
  fadeAndNormalize(rendered, 0.003);
  return rendered;
}

function renderIndustrial(spec: IndustrialSpec, sampleRate: number): AudioBuffer {
  const { left, right } = renderIndustrialStab(spec.params, spec.duration, sampleRate);
  const context = new OfflineAudioContext(2, left.length, sampleRate);
  const buffer = context.createBuffer(2, left.length, sampleRate);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  return buffer;
}

async function renderLoop(spec: LoopSpec, sampleRate: number): Promise<AudioBuffer> {
  const beatsPerBar = 4;
  const secondsPerBeat = 60 / spec.bpm;
  const seconds = spec.bars * beatsPerBar * secondsPerBeat;
  const context = new OfflineAudioContext(2, Math.ceil((seconds + 0.4) * sampleRate), sampleRate);

  const master = buildMasterChain(context, spec.gainDb, context.destination);
  const input = buildFx(context, master.input, spec.fx);
  const noise = createNoiseBuffer(context);
  await loadDrumKit();

  const notes = expandPattern(
    {
      role: spec.role,
      style: spec.style,
      bars: spec.bars,
      chords: spec.chords ?? [tonicChordSymbol(spec.key)],
      octave: spec.octave,
      density: spec.density,
      energy: spec.energy,
      seed: spec.seed ?? 1,
    },
    { key: spec.key, beatsPerBar, stepsPerBar: 16, seed: spec.seed ?? 1 },
  );

  const instrument = ROLE_INSTRUMENT[spec.role];
  for (const note of notes) {
    playInstrumentNote(
      context,
      input,
      instrument,
      note.pitch,
      note.start * secondsPerBeat,
      note.duration * secondsPerBeat,
      note.velocity,
      noise,
    );
  }

  const rendered = await context.startRendering();
  fadeAndNormalize(rendered, 0.005);
  return rendered;
}

export async function renderSample(
  spec: SampleSpec,
  options: { sampleRate?: number; projectBpm?: number } = {},
): Promise<SampleResult> {
  // Normaliza defaults (gain, q, gainDb...) venga de donde venga.
  const normalized = SampleSpecSchema.parse(spec);
  const sampleRate = options.sampleRate ?? 48_000;
  const projectBpm = options.projectBpm ?? 120;
  const buffer =
    normalized.kind === "loop"
      ? await renderLoop(normalized, sampleRate)
      : normalized.kind === "industrial"
        ? renderIndustrial(normalized, sampleRate)
        : await renderOneShot(normalized, sampleRate);

  const durationBeats =
    normalized.kind === "loop" ? normalized.bars * 4 : (buffer.duration * projectBpm) / 60;

  return {
    spec: normalized,
    name: normalized.name,
    buffer,
    blob: new Blob([audioBufferToWav(buffer) as BlobPart], { type: "audio/wav" }),
    durationBeats,
  };
}
