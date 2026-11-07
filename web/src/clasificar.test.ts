import assert from "node:assert/strict";
import { test } from "node:test";
import { esAudio, esMidi } from "./clasificar.ts";

test("a .mid is MIDI whatever type the browser gives it", () => {
  for (const type of ["audio/midi", "audio/mid", "audio/x-midi", ""]) {
    assert.equal(esMidi({ name: "tema.mid", type }), true, type);
    assert.equal(esAudio({ name: "tema.mid", type }), false, type);
  }
});

test("audio is recognized by type or by extension; a project file is neither", () => {
  assert.equal(esAudio({ name: "x.bin", type: "audio/wav" }), true);
  assert.equal(esAudio({ name: "x.FLAC", type: "" }), true);
  assert.equal(esAudio({ name: "proyecto.json", type: "application/json" }), false);
  assert.equal(esMidi({ name: "proyecto.json", type: "application/json" }), false);
});
