import { test } from "node:test";
import assert from "node:assert/strict";

import { compasesDeAudio, compasesNecesarios, largoDeClip, ultimoCompasDeClips } from "./tiempo.ts";

test("'to the end' stops at the last clip's bar, not at the render's tail", () => {
  // bateria-1 on 7-Nov: one 32-beat clip from 0 in 4/4 -> bar 8 (the render ran to 8.19).
  assert.equal(ultimoCompasDeClips([{ start: 0, length: 32 }], 4), 8);
  assert.equal(ultimoCompasDeClips([{ start: 0, length: 32 }, { start: 32, length: 2 }], 4), 9);
  assert.equal(ultimoCompasDeClips([], 4), null);
});

test("a take with a margin is placed at the asked bars; without them, whole", () => {
  // 8 bars asked + 2 of margin in 4/4: the file has 40 beats, the clip 32.
  assert.equal(largoDeClip(40, 4, 8), 32);
  assert.equal(largoDeClip(40, 4, null), 40);
  // A file shorter than asked is not stretched with silence that does not exist.
  assert.equal(largoDeClip(26, 4, 8), 28);
  assert.equal(largoDeClip(40, 3, 8), 24);
});

test("a file that ends exactly on the edge does not gain a bar", () => {
  assert.equal(compasesDeAudio(336, 4), 336);
  assert.equal(compasesDeAudio(320, 4), 320);
  assert.equal(compasesDeAudio(8, 4), 8);
});

test("a file with a tail is rounded up", () => {
  // The real case: 161.6 s stems at 125 BPM = 336.667 beats -> 340 (85 bars).
  assert.equal(compasesDeAudio(336.6666666666667, 4), 340);
  // Below two bars the exact duration is respected (one-shot).
  assert.equal(compasesDeAudio(4.1, 4), 4.1);
  // From two bars on, to the next bar.
  assert.equal(compasesDeAudio(8.1, 4), 12);
  assert.equal(compasesDeAudio(153.6, 4), 156);
});

test("a short one-shot keeps its exact duration", () => {
  // A 2 s kick at 100 BPM is 3.33 beats: it is not stretched to a bar.
  assert.equal(compasesDeAudio(3.3333, 4), 3.3333);
  // Right at the two-bar threshold it does align.
  assert.equal(compasesDeAudio(8, 4), 8);
  assert.equal(compasesDeAudio(8.2, 4), 12);
});

test("it does not invent impossible durations", () => {
  assert.equal(compasesDeAudio(0, 4), 4);
  assert.equal(compasesDeAudio(-5, 4), 4);
  assert.equal(compasesDeAudio(10, 0), 4);
});

test("the bars the project needs come from the end of the clip", () => {
  assert.equal(compasesNecesarios(0, 340, 4), 85);
  assert.equal(compasesNecesarios(0, 336.667, 4), 85);
  assert.equal(compasesNecesarios(8, 16, 4), 12);
  assert.equal(compasesNecesarios(0, 0.5, 4), 1);
});
