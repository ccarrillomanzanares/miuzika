import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps } from "./ops.ts";
import { createProject } from "./project.ts";

const conToma = () =>
  applyOps(createProject({ name: "t", bpm: 96, lengthBars: 8, carpeta: "t" }), [
    { op: "register_audio_asset", assetId: "a1", name: "toma", durationBeats: 192, ruta: "generado/toma.wav" },
    { op: "add_audio_clip", assetId: "a1", startBar: 4, lengthBeats: 192, track: { name: "toma" } },
  ]).project;

test("a WAV keeps its seconds and its place in time when the tempo changes", () => {
  const antes = conToma();
  const despues = applyOps(antes, [{ op: "set_tempo", bpm: 120 }]).project;
  const a = antes.tracks[0]!.clips[0]!;
  const d = despues.tracks[0]!.clips[0]!;
  assert.equal(despues.bpm, 120);
  assert.ok(Math.abs((d.length * 60) / 120 - (a.length * 60) / 96) < 1e-9, "same duration");
  assert.ok(Math.abs((d.start * 60) / 120 - (a.start * 60) / 96) < 1e-9, "same start");
  assert.ok(Math.abs((despues.audioAssets![0]!.durationBeats * 60) / 120 - 120) < 1e-9, "the asset: 192 beats at 96 BPM are 120 s");
});

test("the project grows if the audio now takes more bars, and MIDI stays in beats", () => {
  const conNotas = applyOps(conToma(), [
    { op: "add_track", id: "m", name: "midi" },
    { op: "add_notes", trackId: "m", startBar: 0, notes: [{ pitch: 60, start: 2, duration: 1, velocity: 90 }] },
  ]).project;
  const nota = conNotas.tracks[1]!.clips[0]!.notes[0]!;
  const despues = applyOps(conNotas, [{ op: "set_tempo", bpm: 192 }]).project;
  assert.deepEqual(despues.tracks[1]!.clips[0]!.notes[0], nota);
  const clip = despues.tracks[0]!.clips[0]!;
  assert.ok(despues.lengthBars * 4 >= clip.start + clip.length - 1e-6);
});

test("an out-of-range tempo is refused and changes nothing", () => {
  const antes = conToma();
  assert.throws(() => applyOps(antes, [{ op: "set_tempo", bpm: 10 }]));
  assert.equal(antes.bpm, 96);
});
