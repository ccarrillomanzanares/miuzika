import { test } from "node:test";
import assert from "node:assert/strict";

import { compasesDeAudio, compasesNecesarios } from "./tiempo.ts";

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
