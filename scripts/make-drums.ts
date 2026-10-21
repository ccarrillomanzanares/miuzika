/**
 * Genera el kit de batería propio (16-bit/48 kHz) para Playfield/openDAW.
 * Sin samples de terceros: todo es síntesis offline con procesado.
 *
 *   node scripts/make-drums.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SR = 48_000;
const OUT = join("web", "public", "drums");

type Signal = Float32Array;

const seconds = (duration: number) => Math.max(1, Math.floor(duration * SR));

function render(duration: number, fn: (t: number, index: number) => number): Signal {
  const data = new Float32Array(seconds(duration));
  for (let index = 0; index < data.length; index++) data[index] = fn(index / SR, index);
  return data;
}

function mix(...parts: Array<[Signal, number]>): Signal {
  const length = Math.max(...parts.map(([signal]) => signal.length));
  const output = new Float32Array(length);
  for (const [signal, gain] of parts) {
    for (let index = 0; index < signal.length; index++) output[index] += signal[index]! * gain;
  }
  return output;
}

function lowpass(input: Signal, cutoff: number): Signal {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);
  const output = new Float32Array(input.length);
  let previous = 0;
  for (let index = 0; index < input.length; index++) {
    previous += alpha * (input[index]! - previous);
    output[index] = previous;
  }
  return output;
}

function highpass(input: Signal, cutoff: number): Signal {
  const low = lowpass(input, cutoff);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index++) output[index] = input[index]! - low[index]!;
  return output;
}

function bandpass(input: Signal, center: number, width = 0.6): Signal {
  return lowpass(highpass(input, center * width), center / width);
}

function softClip(input: Signal, drive: number): Signal {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index++) {
    output[index] = Math.tanh(input[index]! * drive);
  }
  return output;
}

function normalize(input: Signal, peakDb = -1.2): Signal {
  let peak = 0;
  for (const sample of input) peak = Math.max(peak, Math.abs(sample));
  const target = 10 ** (peakDb / 20);
  const gain = peak > 1e-9 ? target / peak : 0;
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index++) output[index] = input[index]! * gain;
  return output;
}

function envelope(t: number, attack: number, decay: number): number {
  if (t < attack) return t / Math.max(1e-6, attack);
  return Math.exp(-(t - attack) * decay);
}

const noise = () => Math.random() * 2 - 1;

function metallic(t: number, frequencies: readonly number[]): number {
  let value = 0;
  for (let index = 0; index < frequencies.length; index++) {
    value += Math.sign(Math.sin(2 * Math.PI * frequencies[index]! * t + index));
  }
  return value / frequencies.length;
}

function writeWav(path: string, data: Signal): void {
  const buffer = Buffer.alloc(44 + data.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data.length * 2, 40);
  for (let index = 0; index < data.length; index++) {
    const sample = Math.max(-1, Math.min(1, data[index]!));
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2);
  }
  writeFileSync(path, buffer);
}

function kick(intensity: number): Signal {
  const duration = 0.55;
  let phase = 0;
  const body = render(duration, (t) => {
    const frequency = 46 + (150 - 30 * intensity) * Math.exp(-t * 26);
    phase += (2 * Math.PI * frequency) / SR;
    return Math.sin(phase) * envelope(t, 0.002, 5.2 + intensity * 1.5);
  });
  const sub = render(duration, (t) => Math.sin(2 * Math.PI * 52 * t) * envelope(t, 0.004, 4.2) * 0.5);
  const click = highpass(
    render(0.03, (t) => noise() * envelope(t, 0.0005, 160 + intensity * 120)),
    2400,
  );
  return normalize(softClip(mix([body, 1], [sub, 0.45], [click, 0.25 + intensity * 0.25]), 1.35));
}

function snare(intensity: number): Signal {
  const duration = 0.35;
  const rattle = bandpass(
    render(duration, (t) => noise() * envelope(t, 0.001, 14 + intensity * 6)),
    1850,
    0.55,
  );
  const tone1 = render(duration, (t) => Math.sin(2 * Math.PI * 188 * t) * envelope(t, 0.001, 32));
  const tone2 = render(duration, (t) => Math.sin(2 * Math.PI * 332 * t) * envelope(t, 0.001, 42));
  return normalize(
    softClip(highpass(mix([rattle, 0.9], [tone1, 0.4], [tone2, 0.25 + intensity * 0.15]), 120), 1.2),
  );
}

function clap(intensity: number): Signal {
  const duration = 0.32;
  const output = new Float32Array(seconds(duration));
  const offsets = [0, 0.011, 0.022, 0.033];
  offsets.forEach((offset, index) => {
    const start = Math.floor(offset * SR);
    const burst = bandpass(
      render(0.09, (t) => noise() * envelope(t, 0.0008, 55 + intensity * 20)),
      1150 + index * 60,
      0.7,
    );
    for (let sample = 0; sample < burst.length && start + sample < output.length; sample++) {
      output[start + sample]! += burst[sample]! * (1 - index * 0.12);
    }
  });
  const tail = bandpass(render(duration, (t) => noise() * envelope(t, 0.002, 18)), 1400, 0.8);
  return normalize(softClip(highpass(mix([output, 0.9], [tail, 0.35]), 300), 1.1));
}

function hat(open: boolean, intensity: number): Signal {
  const duration = open ? 0.5 : 0.13;
  const metal = render(duration, (t) =>
    metallic(t, [2450, 3170, 4210, 5370, 6830, 7930]) * envelope(t, 0.001, open ? 7 : 55),
  );
  const air = highpass(
    render(duration, (t) => noise() * envelope(t, 0.001, open ? 6 : 48 + intensity * 20)),
    7200,
  );
  return normalize(
    softClip(highpass(mix([metal, 0.55 + intensity * 0.2], [air, 0.7]), 6200), 1.1),
    -3,
  );
}

function tom(frequency: number, duration: number, intensity: number): Signal {
  let phase = 0;
  const body = render(duration, (t) => {
    const current = frequency * (0.55 + 0.45 * Math.exp(-t * 8));
    phase += (2 * Math.PI * current) / SR;
    return Math.sin(phase) * envelope(t, 0.002, 7 + intensity * 2);
  });
  const noisePart = lowpass(
    render(duration, (t) => noise() * envelope(t, 0.001, 35)),
    1400,
  );
  return normalize(softClip(mix([body, 1], [noisePart, 0.18]), 1.2));
}

function cymbal(ride: boolean): Signal {
  const duration = ride ? 0.9 : 1.6;
  const metal = render(duration, (t) =>
    metallic(t, [3150, 4410, 5630, 6890, 8170, 9470]) * envelope(t, 0.002, ride ? 5 : 2.6),
  );
  const air = highpass(
    render(duration, (t) => noise() * envelope(t, 0.001, ride ? 4.5 : 2.2)),
    4200,
  );
  return normalize(softClip(highpass(mix([metal, 0.5], [air, 0.6]), 3200), 1.05), -3.5);
}

function rim(): Signal {
  const click = highpass(render(0.02, (t) => noise() * envelope(t, 0.0005, 220)), 1800);
  const tone = render(0.09, (t) =>
    Math.sin(2 * Math.PI * 1720 * t) * envelope(t, 0.001, 55),
  );
  return normalize(softClip(mix([click, 0.7], [tone, 0.5]), 1.2), -3);
}

function cowbell(): Signal {
  const duration = 0.35;
  const tone = render(duration, (t) => {
    const a = Math.sign(Math.sin(2 * Math.PI * 540 * t));
    const b = Math.sign(Math.sin(2 * Math.PI * 812 * t));
    return (a + b) * 0.5 * envelope(t, 0.001, 11);
  });
  return normalize(softClip(bandpass(tone, 800, 0.5), 1.2), -4);
}

mkdirSync(OUT, { recursive: true });
const files: Array<[string, Signal]> = [
  ["kick-soft", kick(0.55)],
  ["kick-hard", kick(1)],
  ["snare-soft", snare(0.5)],
  ["snare-hard", snare(1)],
  ["clap-soft", clap(0.55)],
  ["clap-hard", clap(1)],
  ["hat-soft", hat(false, 0.5)],
  ["hat-mid", hat(false, 0.8)],
  ["hat-hard", hat(false, 1)],
  ["hat-open", hat(true, 0.8)],
  ["tom-low", tom(120, 0.4, 0.8)],
  ["tom-mid", tom(155, 0.36, 0.8)],
  ["tom-high", tom(195, 0.32, 0.8)],
  ["crash", cymbal(false)],
  ["ride", cymbal(true)],
  ["rim", rim()],
  ["cowbell", cowbell()],
];

for (const [name, signal] of files) {
  writeWav(join(OUT, `${name}.wav`), signal);
  console.log(`${name}.wav`, Math.round((signal.length * 2) / 1024), "KB");
}
