import { test } from "node:test";
import assert from "node:assert/strict";

import { argumentosBasicPitch } from "./api/audio.ts";

test("basic-pitch writes the .mid at the project tempo", () => {
  // 2-Nov, Stahl at 125 BPM: without it the file said 120 and onsets landed 4 % early.
  assert.deepEqual(argumentosBasicPitch("out", "in.wav", 125), [
    "out",
    "in.wav",
    "--model-serialization",
    "onnx",
    "--midi-tempo",
    "125",
  ]);
});

test("without a sane tempo basic-pitch keeps its default", () => {
  for (const malo of [undefined, "x", 0, 1000, Number.NaN]) {
    assert.ok(!argumentosBasicPitch("out", "in.wav", malo).includes("--midi-tempo"));
  }
});
