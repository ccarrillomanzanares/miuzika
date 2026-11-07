import { test } from "node:test";
import assert from "node:assert/strict";

import { PROGRAMAS_GM, instrumentoGm, nombrePistaMidi } from "./gm-nombres.ts";

test("the GM table has the 128 programs in order", () => {
  assert.equal(PROGRAMAS_GM.length, 128);
  assert.equal(PROGRAMAS_GM[0], "acoustic grand piano");
  assert.equal(PROGRAMAS_GM[30], "distortion guitar");
  assert.equal(PROGRAMAS_GM[33], "electric bass (finger)");
  assert.equal(PROGRAMAS_GM[127], "gunshot");
});

test("channel 10 is the drum kit whatever its program says", () => {
  // 2-Nov, ideas-riff-1.mid: drums on channel index 9 with program 0 (which is "piano").
  assert.equal(instrumentoGm(0, 9), "drums (GM kit)");
  assert.equal(instrumentoGm(0, 0), "acoustic grand piano");
});

test("unnamed MIDI tracks are named after their instrument, named ones keep their name", () => {
  assert.equal(nombrePistaMidi({ name: "Track 1", program: 30, channel: 0 }), "Distortion guitar");
  assert.equal(nombrePistaMidi({ name: "", program: 0, channel: 9 }), "Drums");
  assert.equal(nombrePistaMidi({ name: "Riff", program: 30, channel: 0 }), "Riff");
});
