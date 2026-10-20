/** Instrumentos del preview: capas, envolventes y dinámica. */

import type { InstrumentType } from "../../src/core/types.ts";
import { playDrum } from "./drum-kit.ts";

export interface VoiceHandle {
  stop: () => void;
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

const frequencyOf = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);
const velocityOf = (velocity: number): number => (clamp(velocity, 1, 127) / 127) ** 1.35;

export function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < data.length; index++) {
    const white = Math.random() * 2 - 1;
    last = 0.86 * last + 0.14 * white;
    data[index] = white * 0.75 + last * 0.25;
  }
  return buffer;
}

function stopAll(sources: AudioScheduledSourceNode[]): () => void {
  return () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* ya parada */
      }
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
    }
  };
}

function oscillator(
  context: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
  detune = 0,
): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  node.detune.value = detune;
  return node;
}

function gainNode(context: BaseAudioContext, value = 0): GainNode {
  const node = context.createGain();
  node.gain.value = value;
  return node;
}

/** Envolvente percusiva: ataque rápido y caída exponencial. */
function percussive(
  context: BaseAudioContext,
  when: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode {
  const gain = gainNode(context);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return gain;
}

function noiseSource(context: BaseAudioContext, noise: AudioBuffer): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  return source;
}

function kick(
  context: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  when: number,
  level: number,
): VoiceHandle {
  const body = oscillator(context, "sine", 165);
  body.frequency.setValueAtTime(165, when);
  body.frequency.exponentialRampToValueAtTime(46, when + 0.115);
  const bodyGain = percussive(context, when, level * 1.1, 0.004, 0.38);
  body.connect(bodyGain).connect(destination);
  body.start(when);
  body.stop(when + 0.42);

  const click = noiseSource(context, noise);
  const clickFilter = context.createBiquadFilter();
  clickFilter.type = "highpass";
  clickFilter.frequency.value = 2200;
  const clickGain = percussive(context, when, level * 0.35, 0.001, 0.012);
  click.connect(clickFilter).connect(clickGain).connect(destination);
  click.start(when);
  click.stop(when + 0.03);

  return { stop: stopAll([body, click]) };
}

function snare(
  context: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  when: number,
  level: number,
): VoiceHandle {
  const rattle = noiseSource(context, noise);
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1850;
  band.Q.value = 0.7;
  const rattleGain = percussive(context, when, level * 0.62, 0.001, 0.19);
  rattle.connect(band).connect(rattleGain).connect(destination);
  rattle.start(when);
  rattle.stop(when + 0.22);

  const tones: OscillatorNode[] = [];
  for (const [frequency, amplitude, decay] of [
    [188, 0.22, 0.08],
    [332, 0.14, 0.055],
  ] as const) {
    const tone = oscillator(context, "triangle", frequency);
    const gain = percussive(context, when, level * amplitude, 0.001, decay);
    tone.connect(gain).connect(destination);
    tone.start(when);
    tone.stop(when + decay + 0.02);
    tones.push(tone);
  }

  return { stop: stopAll([rattle, ...tones]) };
}

function clap(
  context: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  when: number,
  level: number,
): VoiceHandle {
  const sources: AudioBufferSourceNode[] = [];
  for (let burst = 0; burst < 3; burst++) {
    const at = when + burst * 0.011;
    const source = noiseSource(context, noise);
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1250;
    band.Q.value = 1.1;
    const gain = percussive(context, at, level * 0.38, 0.001, 0.035);
    source.connect(band).connect(gain).connect(destination);
    source.start(at);
    source.stop(at + 0.05);
    sources.push(source);
  }
  return { stop: stopAll(sources) };
}

function hat(
  context: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  when: number,
  level: number,
  open: boolean,
): VoiceHandle {
  const source = noiseSource(context, noise);
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 7900;
  const shimmer = context.createBiquadFilter();
  shimmer.type = "bandpass";
  shimmer.frequency.value = 10_500;
  shimmer.Q.value = 0.8;
  const gain = percussive(context, when, level * (open ? 0.16 : 0.22), 0.001, open ? 0.3 : 0.045);
  source.connect(high).connect(shimmer).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + (open ? 0.34 : 0.07));
  return { stop: stopAll([source]) };
}

function cymbal(
  context: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  when: number,
  level: number,
  ride: boolean,
): VoiceHandle {
  const source = noiseSource(context, noise);
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = ride ? 6800 : 4600;
  const gain = percussive(context, when, level * (ride ? 0.1 : 0.16), 0.002, ride ? 0.4 : 1.1);
  source.connect(high).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + (ride ? 0.45 : 1.2));
  return { stop: stopAll([source]) };
}

function tom(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  level: number,
): VoiceHandle {
  const start = pitch === 45 ? 210 : pitch === 47 ? 170 : 135;
  const body = oscillator(context, "sine", start);
  body.frequency.setValueAtTime(start, when);
  body.frequency.exponentialRampToValueAtTime(72, when + 0.22);
  const gain = percussive(context, when, level * 0.55, 0.003, 0.26);
  body.connect(gain).connect(destination);
  body.start(when);
  body.stop(when + 0.3);
  return { stop: stopAll([body]) };
}

function bass(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  duration: number,
  level: number,
): VoiceHandle {
  const frequency = frequencyOf(pitch);
  const sub = oscillator(context, "sine", frequency);
  const subGain = gainNode(context, 0.7);
  sub.connect(subGain);

  const saw = oscillator(context, "sawtooth", frequency, -4);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.6;
  filter.frequency.setValueAtTime(600 + level * 1400, when);
  filter.frequency.exponentialRampToValueAtTime(240 + level * 180, when + 0.16);
  saw.connect(filter);

  const amp = context.createGain();
  const attack = 0.005;
  const sustain = level * 0.8;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(level, when + attack);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), when + 0.16);
  amp.gain.setValueAtTime(Math.max(0.0001, sustain), when + Math.max(0.17, duration));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.09);

  subGain.connect(amp);
  filter.connect(amp);
  amp.connect(destination);

  sub.start(when);
  sub.stop(when + duration + 0.12);
  saw.start(when);
  saw.stop(when + duration + 0.12);
  return { stop: stopAll([sub, saw]) };
}

function lead(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  duration: number,
  level: number,
): VoiceHandle {
  const frequency = frequencyOf(pitch);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(4200 + level * 3200, when);
  filter.frequency.exponentialRampToValueAtTime(1900 + level * 900, when + 0.13);

  const amp = context.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(level, when + 0.01);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.72), when + 0.16);
  amp.gain.setValueAtTime(Math.max(0.0001, level * 0.72), when + Math.max(0.17, duration));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.16);

  filter.connect(amp).connect(destination);
  const sources: OscillatorNode[] = [];
  for (const [detune, pan, amplitude] of [
    [-8, -0.18, 0.42],
    [8, 0.18, 0.42],
  ] as const) {
    const osc = oscillator(context, "sawtooth", frequency, detune);
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    const gain = gainNode(context, amplitude);
    osc.connect(gain).connect(panner).connect(filter);
    osc.start(when);
    osc.stop(when + duration + 0.2);
    sources.push(osc);
  }
  const low = oscillator(context, "square", frequency / 2);
  const lowGain = gainNode(context, 0.14);
  low.connect(lowGain).connect(filter);
  low.start(when);
  low.stop(when + duration + 0.2);
  sources.push(low);
  return { stop: stopAll(sources) };
}

function pad(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  duration: number,
  level: number,
): VoiceHandle {
  const frequency = frequencyOf(pitch);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(1700, when);
  filter.frequency.linearRampToValueAtTime(900, when + Math.min(1.2, duration));

  const attack = Math.min(0.4, Math.max(0.03, duration * 0.35));
  const release = Math.max(0.45, duration * 0.9);
  const amp = context.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(level, when + attack);
  amp.gain.setValueAtTime(level, when + Math.max(attack + 0.01, duration));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration + release);
  filter.connect(amp).connect(destination);

  const sources: OscillatorNode[] = [];
  for (const [detune, pan, amplitude] of [
    [-11, -0.55, 0.34],
    [0, 0, 0.44],
    [11, 0.55, 0.34],
  ] as const) {
    const osc = oscillator(context, "sawtooth", frequency, detune);
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    const gain = gainNode(context, amplitude);
    osc.connect(gain).connect(panner).connect(filter);
    osc.start(when);
    osc.stop(when + duration + release + 0.05);
    sources.push(osc);
  }
  return { stop: stopAll(sources) };
}

function pluck(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  duration: number,
  level: number,
): VoiceHandle {
  const frequency = frequencyOf(pitch);
  const triangle = oscillator(context, "triangle", frequency);
  const square = oscillator(context, "square", frequency, 3);
  const squareGain = gainNode(context, 0.22);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2800 + level * 2600, when);
  filter.frequency.exponentialRampToValueAtTime(1000 + level * 600, when + 0.18);
  const amp = percussive(context, when, level, 0.002, Math.max(0.12, duration + 0.05));
  triangle.connect(filter);
  square.connect(squareGain).connect(filter);
  filter.connect(amp).connect(destination);
  triangle.start(when);
  triangle.stop(when + duration + 0.12);
  square.start(when);
  square.stop(when + duration + 0.12);
  return { stop: stopAll([triangle, square]) };
}

export function playInstrumentNote(
  context: BaseAudioContext,
  destination: AudioNode,
  type: InstrumentType,
  pitch: number,
  when: number,
  durationSeconds: number,
  velocity: number,
  noise: AudioBuffer,
): VoiceHandle {
  const level = velocityOf(velocity);
  const duration = Math.max(0.04, durationSeconds);

  if (type === "drumkit") {
    const sampled = playDrum(context, destination, pitch, when, velocity);
    if (sampled) return sampled;

    if (pitch === 36 || pitch === 35) return kick(context, destination, noise, when, level);
    if (pitch === 38 || pitch === 40) return snare(context, destination, noise, when, level);
    if (pitch === 39) return clap(context, destination, noise, when, level);
    if (pitch === 42 || pitch === 44) return hat(context, destination, noise, when, level, false);
    if (pitch === 46) return hat(context, destination, noise, when, level, true);
    if (pitch === 49 || pitch === 57) return cymbal(context, destination, noise, when, level, false);
    if (pitch === 51 || pitch === 59) return cymbal(context, destination, noise, when, level, true);
    return tom(context, destination, pitch, when, level);
  }

  switch (type) {
    case "bass":
      return bass(context, destination, pitch, when, duration, level * 0.55);
    case "pad":
      return pad(context, destination, pitch, when, duration, level * 0.2);
    case "arp":
      return pluck(context, destination, pitch, when, duration, level * 0.32);
    case "lead":
      return lead(context, destination, pitch, when, duration, level * 0.26);
    case "synth":
      return lead(context, destination, pitch, when, duration, level * 0.22);
    default:
      return pad(context, destination, pitch, when, duration, level * 0.18);
  }
}
