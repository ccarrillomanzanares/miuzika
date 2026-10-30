import assert from "node:assert/strict";
import test from "node:test";
import { applyOps } from "./ops.ts";
import { createProject } from "./project.ts";
import { midiDeProyecto, PPQ } from "./midi-export.ts";

function texto(bytes: Uint8Array, desde: number, n: number): string {
  return String.fromCharCode(...bytes.slice(desde, desde + n));
}

test("the MIDI carries a header, tempo, one track per MIDI track, and drums on channel 10", () => {
  const base = createProject({ name: "Prueba", bpm: 120 });
  const { project } = applyOps(base, [
    { op: "add_track", id: "trk_bajo", name: "Bajo", instrument: { type: "bass", program: 33 } },
    { op: "add_track", id: "trk_bat", name: "Batería", instrument: { type: "drumkit" } },
    { op: "add_notes", trackId: "trk_bajo", startBar: 1, notes: [{ pitch: 40, start: 0.5, duration: 1, velocity: 100 }] },
    { op: "add_notes", trackId: "trk_bat", notes: [{ pitch: 36, start: 0, duration: 0.25, velocity: 110 }] },
  ]);
  const midi = midiDeProyecto(project);
  assert.equal(texto(midi, 0, 4), "MThd");
  assert.equal(midi[9], 1); // formato 1
  assert.equal(midi[11], 3); // tempo + 2 pistas
  assert.equal((midi[12]! << 8) | midi[13]!, PPQ);
  const crudo = Array.from(midi);
  const contiene = (seq: number[]): boolean => crudo.some((_, i) => seq.every((b, j) => crudo[i + j] === b));
  // Tempo: 500,000 µs per quarter note at 120 BPM.
  assert.ok(contiene([0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]));
  // Bass: program 33 on channel 1 and its note (E2 = 40) at 100.
  assert.ok(contiene([0xc0, 33]));
  assert.ok(contiene([0x90, 40, 100]));
  // Drums on channel 10 (0x99).
  assert.ok(contiene([0x99, 36, 110]));
  assert.ok(contiene([0x89, 36, 0]));
});
