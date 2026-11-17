import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "./project.ts";
import { applyOps } from "./ops.ts";
import { audioSoloDe, midiSoloDe, sinAssets } from "./ficheros-pista.ts";

function proyecto() {
  return applyOps(createProject({ name: "Test", bpm: 120, lengthBars: 8 }), [
    { op: "register_audio_asset", assetId: "aud_a", name: "a.wav", durationBeats: 8, ruta: "generado/a.wav" },
    { op: "register_audio_asset", assetId: "aud_b", name: "b.wav", durationBeats: 8, ruta: "generado/b.wav" },
    { op: "register_audio_asset", assetId: "aud_c", name: "c.wav", durationBeats: 8, ruta: "entrada/c.wav" },
    { op: "register_audio_asset", assetId: "aud_c2", name: "c.wav", durationBeats: 8, ruta: "entrada/c.wav" },
    { op: "register_audio_asset", assetId: "aud_mem", name: "mem.wav", durationBeats: 8 },
    { op: "add_track", id: "trk_1", name: "One", kind: "audio" },
    { op: "add_track", id: "trk_2", name: "Two", kind: "audio" },
    { op: "add_track", id: "trk_3", name: "Three", kind: "audio" },
    { op: "add_track", id: "trk_m", name: "Midi", kind: "midi" },
    { op: "add_audio_clip", trackId: "trk_1", assetId: "aud_a", startBar: 0 },
    { op: "add_audio_clip", trackId: "trk_1", assetId: "aud_b", startBar: 2 },
    { op: "add_audio_clip", trackId: "trk_1", assetId: "aud_mem", startBar: 4 },
    { op: "add_audio_clip", trackId: "trk_2", assetId: "aud_b", startBar: 0 },
    { op: "add_audio_clip", trackId: "trk_2", assetId: "aud_c", startBar: 2 },
    { op: "add_audio_clip", trackId: "trk_3", assetId: "aud_c2", startBar: 0 },
  ]).project;
}

const rutas = (p: ReturnType<typeof proyecto>, ids: string[]): string[] => audioSoloDe(p, ids).map((a) => a.ruta!);

test("only the files no other track plays, and only those on disk", () => {
  const p = proyecto();
  // b is also on Two; mem has no file.
  assert.deepEqual(rutas(p, ["trk_1"]), ["generado/a.wav"]);
  // c is the same file as Three's c2, under another entry.
  assert.deepEqual(rutas(p, ["trk_2"]), []);
  assert.deepEqual(rutas(p, ["trk_1", "trk_2"]), ["generado/a.wav", "generado/b.wav"]);
  assert.deepEqual(rutas(p, ["trk_2", "trk_3"]), ["entrada/c.wav", "entrada/c.wav"]);
  assert.deepEqual(rutas(p, ["trk_m"]), []);
  assert.deepEqual(rutas(p, []), []);
});

test("entries are removed once nothing plays them, and refused while something does", () => {
  const p = proyecto();
  assert.throws(() => sinAssets(p, ["aud_a"]), /still plays/);
  const sinPista = applyOps(p, [{ op: "remove_track", trackId: "trk_1" }]).project;
  const limpio = sinAssets(sinPista, ["aud_a"]);
  assert.deepEqual(limpio.audioAssets!.map((a) => a.id), ["aud_b", "aud_c", "aud_c2", "aud_mem"]);
  // The project handed in is not changed.
  assert.equal(sinPista.audioAssets!.length, 5);
});

test("a .mid goes only when every track read from it goes; tracks with no file recorded offer none", () => {
  const nota = [{ pitch: 60, start: 0, duration: 1, velocity: 100 }];
  const p = applyOps(createProject({ name: "Test", bpm: 120, lengthBars: 8 }), [
    { op: "add_track", id: "trk_a", name: "Melody", kind: "midi" },
    { op: "add_track", id: "trk_b", name: "Chords", kind: "midi" },
    { op: "add_track", id: "trk_c", name: "Drums", kind: "midi" },
    { op: "add_track", id: "trk_d", name: "By hand", kind: "midi" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: nota, archivo: "generado/song.mid" },
    { op: "add_notes", trackId: "trk_b", startBar: 0, notes: nota, archivo: "generado/song.mid" },
    { op: "add_notes", trackId: "trk_c", startBar: 0, notes: nota, archivo: "generado/drums.mid" },
    { op: "add_notes", trackId: "trk_d", startBar: 0, notes: nota },
  ]).project;
  assert.equal(p.tracks[0]!.clips[0]!.origin?.archivo, "generado/song.mid");
  assert.deepEqual(midiSoloDe(p, ["trk_a"]), []);
  assert.deepEqual(midiSoloDe(p, ["trk_a", "trk_b"]), ["generado/song.mid"]);
  assert.deepEqual(midiSoloDe(p, ["trk_c", "trk_d"]), ["generado/drums.mid"]);
  assert.deepEqual(midiSoloDe(p, ["trk_d"]), []);
  // A copy of the clip on another track keeps the file alive.
  const copia = applyOps(p, [{ op: "duplicate_clip", trackId: "trk_c", clipId: p.tracks[2]!.clips[0]!.id, trackDestinoId: "trk_d", startBeat: 8 }]).project;
  assert.deepEqual(midiSoloDe(copia, ["trk_c"]), []);
});
