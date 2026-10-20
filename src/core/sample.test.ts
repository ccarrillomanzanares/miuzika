import { test } from "node:test";
import assert from "node:assert/strict";

import { SampleSpecSchema } from "./sample.ts";

const oneShot = {
  kind: "one_shot",
  name: "dark kick",
  duration: 0.6,
  layers: [
    {
      osc: "sine",
      freq: 165,
      glideTo: 45,
      glide: 0.11,
      env: { attack: 0.001, decay: 0.3, sustain: 0.001, release: 0.1 },
    },
    {
      osc: "noise",
      filter: { type: "highpass", freq: 2200 },
      env: { attack: 0.001, decay: 0.01, sustain: 0.001, release: 0.02 },
    },
  ],
};

const loop = {
  kind: "loop",
  name: "punk bass",
  bars: 2,
  bpm: 150,
  key: { tonic: "E", mode: "minor" },
  role: "bass",
  style: "punk",
};

test("acepta un one-shot con capas y defaults", () => {
  const spec = SampleSpecSchema.parse(oneShot);
  assert.equal(spec.kind, "one_shot");
  if (spec.kind === "one_shot") {
    assert.equal(spec.gainDb, 0);
    assert.equal(spec.layers.length, 2);
    assert.equal(spec.layers[0]!.gain, 0.7);
  }
});

test("rechaza un one-shot sin capas", () => {
  assert.throws(() => SampleSpecSchema.parse({ ...oneShot, layers: [] }));
});

test("acepta un industrial con defaults", () => {
  const spec = SampleSpecSchema.parse({ kind: "industrial", name: "stab" });
  assert.equal(spec.kind, "industrial");
  if (spec.kind === "industrial") {
    assert.equal(spec.duration, 2.4);
    assert.equal(spec.gainDb, 0);
    assert.equal(spec.params, undefined);
  }
});

test("los params industriales aplican defaults", () => {
  const spec = SampleSpecSchema.parse({
    kind: "industrial",
    name: "stab",
    params: { rootHz: 110, drive: 5 },
  });
  assert.equal(spec.kind, "industrial");
  if (spec.kind === "industrial") {
    assert.equal(spec.params?.rootHz, 110);
    assert.equal(spec.params?.drive, 5);
    assert.equal(spec.params?.cutoffStart, 8800);
    assert.equal(spec.params?.seed, 20_261_020);
  }
});

test("acepta un loop válido", () => {
  const spec = SampleSpecSchema.parse(loop);
  assert.equal(spec.kind, "loop");
  if (spec.kind === "loop") assert.equal(spec.bpm, 150);
});

test("rechaza roles y modos inválidos", () => {
  assert.throws(() => SampleSpecSchema.parse({ ...loop, role: "theremin" }));
  assert.throws(() => SampleSpecSchema.parse({ ...loop, key: { tonic: "E", mode: "blues" } }));
});
