import { test } from "node:test";
import assert from "node:assert/strict";

import { audioBufferToWav } from "./wav.ts";

function fakeBuffer(samples: number[], sampleRate = 8000): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    duration: samples.length / sampleRate,
    getChannelData: () => Float32Array.from(samples),
  } as unknown as AudioBuffer;
}

test("el WAV exportado tiene cabecera RIFF/WAVE y datos PCM", () => {
  const wav = audioBufferToWav(fakeBuffer([0, 0.5, -0.5]));
  const view = new DataView(wav);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(wav, offset, length));

  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 8000, "sample rate");
  assert.equal(view.getUint16(34, true), 16, "16 bits");
  assert.equal(view.getUint32(40, true), 6, "3 muestras × 2 bytes");
  assert.equal(view.byteLength, 44 + 6);
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), Math.round(0.5 * 0x7fff));
  assert.equal(view.getInt16(48, true), Math.round(-0.5 * 0x8000));});

test("el WAV recorta muestras fuera de rango", () => {
  const wav = audioBufferToWav(fakeBuffer([2, -2]));
  const view = new DataView(wav);
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
});
