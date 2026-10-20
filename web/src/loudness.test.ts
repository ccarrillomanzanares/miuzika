import { test } from "node:test";
import assert from "node:assert/strict";

import { measureLoudness, normalizeBuffer } from "./loudness.ts";

function sineBuffer(seconds = 5, amplitude = 0.5, sampleRate = 44_100): AudioBuffer {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    data[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / sampleRate);
  }
  // Canales independientes, como un AudioBuffer real.
  const channels = [data, data.slice()];
  return {
    sampleRate,
    length,
    numberOfChannels: channels.length,
    duration: seconds,
    getChannelData: (channel: number) => channels[channel]!,
  } as unknown as AudioBuffer;
}

test("mide loudness y pico de una señal conocida", () => {
  const loudness = measureLoudness(sineBuffer(5, 0.5));
  assert.ok(Number.isFinite(loudness.lufs));
  assert.ok(loudness.lufs > -12 && loudness.lufs < 0, `lufs ${loudness.lufs}`);
  assert.ok(loudness.peakDb < -5 && loudness.peakDb > -7, `peak ${loudness.peakDb}`);
  assert.ok(loudness.truePeakDb >= loudness.peakDb - 0.01, "el true peak no puede ser menor que el de muestra");
});

test("normaliza a -14 LUFS sin pasarse de -1 dBTP", () => {
  const buffer = sineBuffer(5, 0.5);
  const result = normalizeBuffer(buffer, -14);
  assert.ok(Math.abs(result.lufs + 14) < 0.8, `lufs ${result.lufs}`);
  assert.ok(result.truePeakDb <= -0.9, `true peak ${result.truePeakDb}`);
});

test("el silencio no rompe la medición", () => {
  const silent = {
    sampleRate: 44_100,
    length: 44_100,
    numberOfChannels: 2,
    duration: 1,
    getChannelData: () => new Float32Array(44_100),
  } as unknown as AudioBuffer;
  const loudness = measureLoudness(silent);
  assert.equal(loudness.lufs, -Infinity);
  assert.ok(loudness.peakDb < -100);
});
