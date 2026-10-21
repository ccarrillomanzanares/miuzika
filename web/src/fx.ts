/**
 * Cadena de efectos del mixdown. Traduce los dispositivos del IR a nodos
 * WebAudio para que lo que suena se parezca al proyecto que se exporta.
 */

import type { Device, Track } from "../../src/core/types.ts";

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

const dbToGain = (db: number): number => 10 ** (db / 20);

function tanhCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * amount);
  }
  return curve;
}

function quantizeCurve(bits: number): Float32Array<ArrayBuffer> {  const steps = 2 ** clamp(Math.round(bits), 1, 16);
  const samples = 4096;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < samples; index++) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.round(x * steps) / steps;
  }
  return curve;
}

const impulseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function impulse(context: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  let byKey = impulseCache.get(context);
  if (!byKey) {
    byKey = new Map();
    impulseCache.set(context, byKey);
  }
  const key = `${seconds.toFixed(2)}:${decay.toFixed(2)}`;
  const cached = byKey.get(key);
  if (cached) return cached;

  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      const t = index / length;
      data[index] = (Math.random() * 2 - 1) * (1 - t) ** (decay * 2.2);
    }
  }
  byKey.set(key, buffer);
  return buffer;
}

interface DeviceChain {
  out: AudioNode;
  dispose: () => void;
}

/** Mezcla seco/húmedo alrededor de una cadena de efecto. */
function wetDry(
  context: BaseAudioContext,
  input: AudioNode,
  effectIn: AudioNode,
  effectOut: AudioNode,
  wet: number,
): DeviceChain {
  const output = context.createGain();
  const dry = context.createGain();
  const wetGain = context.createGain();
  dry.gain.value = 1 - wet * 0.55;
  wetGain.gain.value = wet;
  input.connect(dry).connect(output);
  input.connect(effectIn);
  effectOut.connect(wetGain).connect(output);
  return {
    out: output,
    dispose: () => {
      for (const node of [output, dry, wetGain]) {
        try {
          node.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}

function buildDevice(
  context: BaseAudioContext,
  input: AudioNode,
  device: Device,
  secondsPerBeat: number,
): DeviceChain | null {
  const params = device.params;
  switch (device.type) {
    case "reverb": {
      const wet = clamp(params.wet ?? 0.25, 0, 1);
      const decay = clamp(params.decay ?? 0.5, 0, 1);
      const pre = context.createDelay(0.2);
      pre.delayTime.value = clamp(params.preDelay ?? 0.1, 0, 1) * 0.09;
      const convolver = context.createConvolver();
      convolver.buffer = impulse(context, 0.6 + decay * 2.5, 1.2 + decay * 2.4);
      pre.connect(convolver);
      const merged = wetDry(context, input, pre, convolver, wet);
      return {
        out: merged.out,
        dispose: () => {
          merged.dispose();
          for (const node of [pre, convolver]) {
            try {
              node.disconnect();
            } catch {
              /* noop */
            }
          }
        },
      };
    }

    case "delay": {
      const wet = clamp(params.wet ?? 0.2, 0, 1);
      const delay = context.createDelay(2);
      delay.delayTime.value = clamp(
        0.06 + (params.time ?? 0.35) * secondsPerBeat * 0.9,
        0.03,
        1.2,
      );
      const feedback = context.createGain();
      feedback.gain.value = clamp(params.feedback ?? 0.35, 0, 0.92);
      const damping = context.createBiquadFilter();
      damping.type = "lowpass";
      damping.frequency.value = 3200;
      delay.connect(damping).connect(feedback).connect(delay);
      const merged = wetDry(context, input, delay, delay, wet);
      return {
        out: merged.out,
        dispose: () => {
          merged.dispose();
          for (const node of [delay, feedback, damping]) {
            try {
              node.disconnect();
            } catch {
              /* noop */
            }
          }
        },
      };
    }

    case "chorus": {
      const wet = clamp(params.wet ?? 0.3, 0, 1);
      const delay = context.createDelay(0.08);
      delay.delayTime.value = 0.018 + clamp(params.depth ?? 0.5, 0, 1) * 0.008;
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.2 + clamp(params.rate ?? 0.25, 0, 1) * 2.6;
      const depth = context.createGain();
      depth.gain.value = 0.0015 + clamp(params.depth ?? 0.5, 0, 1) * 0.004;
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      const merged = wetDry(context, input, delay, delay, wet);
      return {
        out: merged.out,
        dispose: () => {
          merged.dispose();
          try {
            lfo.stop();
            lfo.disconnect();
            depth.disconnect();
            delay.disconnect();
          } catch {
            /* noop */
          }
        },
      };
    }

    case "distortion": {
      const drive = clamp(params.drive ?? 0.4, 0, 1);
      const shaper = context.createWaveShaper();
      shaper.curve = tanhCurve(1.2 + drive * 18);
      shaper.oversample = "2x";
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 900 + clamp(params.tone ?? 0.5, 0, 1) * 9000;
      shaper.connect(tone);
      const mixed = clamp(params.mix ?? 0.6, 0, 1);
      const merged = wetDry(context, input, shaper, tone, mixed);
      return {
        out: merged.out,
        dispose: () => {
          merged.dispose();
          for (const node of [shaper, tone]) {
            try {
              node.disconnect();
            } catch {
              /* noop */
            }
          }
        },
      };
    }

    case "filter": {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 30 * 700 ** clamp(params.cutoff ?? 0.7, 0, 1);
      filter.Q.value = 0.4 + clamp(params.resonance ?? 0.2, 0, 1) * 14;
      input.connect(filter);
      return {
        out: filter,
        dispose: () => {
          try {
            filter.disconnect();
          } catch {
            /* noop */
          }
        },
      };
    }

    case "eq": {
      const low = context.createBiquadFilter();
      low.type = "lowshelf";
      low.frequency.value = 110;
      low.gain.value = clamp(params.low ?? 0, -18, 18);
      const mid = context.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1100;
      mid.Q.value = 0.9;
      mid.gain.value = clamp(params.mid ?? 0, -18, 18);
      const high = context.createBiquadFilter();
      high.type = "highshelf";
      high.frequency.value = 7500;
      high.gain.value = clamp(params.high ?? 0, -18, 18);
      input.connect(low).connect(mid).connect(high);
      return {
        out: high,
        dispose: () => {
          for (const node of [low, mid, high]) {
            try {
              node.disconnect();
            } catch {
              /* noop */
            }
          }
        },
      };
    }

    case "compressor": {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -60 + clamp(params.threshold ?? 0.6, 0, 1) * 60;
      compressor.ratio.value = clamp(params.ratio ?? 4, 1, 20);
      compressor.knee.value = 8;
      compressor.attack.value = 0.002 + clamp(params.attack ?? 0.3, 0, 1) * 0.08;
      compressor.release.value = 0.05 + clamp(params.release ?? 0.4, 0, 1) * 0.7;
      input.connect(compressor);
      return {
        out: compressor,
        dispose: () => {
          try {
            compressor.disconnect();
          } catch {
            /* noop */
          }
        },
      };
    }

    case "bitcrusher": {
      const shaper = context.createWaveShaper();
      shaper.curve = quantizeCurve(params.bits ?? 8);
      const merged = wetDry(context, input, shaper, shaper, clamp(params.mix ?? 0.3, 0, 1));
      return {
        out: merged.out,
        dispose: () => {
          merged.dispose();
          try {
            shaper.disconnect();
          } catch {
            /* noop */
          }
        },
      };
    }

    // Sin equivalente razonable en el mixdown: se dejan pasar.
    case "gate":
    case "width":
      return null;
  }
}

export interface TrackChain {
  input: AudioNode;
  dispose: () => void;
}

export function buildTrackChain(
  context: BaseAudioContext,
  track: Track,
  destination: AudioNode,
  secondsPerBeat: number,
): TrackChain {
  const input = context.createGain();
  let current: AudioNode = input;
  const disposers: Array<() => void> = [];

  for (const device of track.devices) {
    if (!device.enabled) continue;
    const result = buildDevice(context, current, device, secondsPerBeat);
    if (!result) continue;
    current = result.out;
    disposers.push(result.dispose);
  }

  const gain = context.createGain();
  gain.gain.value = clamp(dbToGain(track.gainDb), 0, 2);
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(track.pan, -1, 1);
  current.connect(gain).connect(panner).connect(destination);

  return {
    input,
    dispose: () => {
      for (const dispose of disposers) dispose();
      for (const node of [input, gain, panner]) {
        try {
          node.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}

export interface MasterChain {
  input: AudioNode;
  dispose: () => void;
}

export interface BusChain {
  input: AudioNode;
  dispose: () => void;
}

/** Bus de mezcla: compresión de glue y saturación muy suave. */
export function buildBusChain(
  context: BaseAudioContext,
  destination: AudioNode,
  kind: "drums" | "music",
): BusChain {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  if (kind === "drums") {
    compressor.threshold.value = -16;
    compressor.knee.value = 6;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
  } else {
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 2.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
  }
  const glue = context.createWaveShaper();
  glue.curve = tanhCurve(kind === "drums" ? 1.12 : 1.06);
  glue.oversample = "2x";

  input.connect(compressor).connect(glue).connect(destination);
  return {
    input,
    dispose: () => {
      for (const node of [input, compressor, glue]) {
        try {
          node.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}

/** Compresión suave + saturación para pegar la mezcla. */
export function buildMasterChain(
  context: BaseAudioContext,
  gainDb: number,
  destination: AudioNode,
): MasterChain {
  const gain = context.createGain();
  gain.gain.value = clamp(dbToGain(gainDb), 0.05, 1.2) * 0.72;

  const rumble = context.createBiquadFilter();
  rumble.type = "highpass";
  rumble.frequency.value = 28;
  rumble.Q.value = 0.6;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 2.6;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.22;

  const shaper = context.createWaveShaper();
  shaper.curve = tanhCurve(1.35);
  shaper.oversample = "2x";

  gain.connect(rumble).connect(compressor).connect(shaper).connect(destination);
  return {
    input: gain,
    dispose: () => {
      for (const node of [gain, rumble, compressor, shaper]) {
        try {
          node.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}
