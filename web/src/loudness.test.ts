import { test } from "node:test";
import assert from "node:assert/strict";

import { measureLoudness, normalizeBuffer } from "./loudness.ts";
import { limitBuffer } from "./limiter.ts";

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

test("el limitador recorta picos al techo", () => {
  const buffer = sineBuffer(1, 0.95);
  const before = measureLoudness(buffer);
  limitBuffer(buffer, -1);
  const after = measureLoudness(buffer);
  assert.ok(after.truePeakDb <= -0.7, `true peak ${after.truePeakDb}`);
  assert.ok(after.lufs <= before.lufs, "limitar no debe subir el loudness");
});

test("normaliza a -10 LUFS con limitador", () => {
  const buffer = sineBuffer(5, 0.5);
  const result = normalizeBuffer(buffer, -10, -1, true);
  assert.ok(Math.abs(result.lufs + 10) < 0.8, `lufs ${result.lufs}`);
  assert.ok(result.truePeakDb <= -0.5, `true peak ${result.truePeakDb}`);
});

test("con transitorios fuertes no hay clipping tras limitar", () => {
  const length = 44_100 * 3;
  const data = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    data[index] = 0.01 * Math.sin((2 * Math.PI * 220 * index) / 44_100);
  }
  for (let index = 44_100; index < 44_100 + 200; index++) {
    data[index] = 0.95 * Math.sin((2 * Math.PI * 1000 * index) / 44_100);
  }
  const buffer = {
    sampleRate: 44_100,
    length,
    numberOfChannels: 2,
    duration: 3,
    getChannelData: (channel: number) => (channel === 0 ? data : data.slice()),
  } as unknown as AudioBuffer;

  const result = normalizeBuffer(buffer, -10, -1, true);
  assert.ok(result.truePeakDb <= -0.5, `true peak ${result.truePeakDb}`);
  assert.ok(Number.isFinite(result.lufs) && result.lufs < 0, `lufs ${result.lufs}`);
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
