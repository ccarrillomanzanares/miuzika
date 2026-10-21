/**
 * Verificación de integración contra el SDK real.
 * Se ejecuta con `npm run test:opendaw` (esbuild + Node).
 */

import assert from "node:assert/strict";

import { applyOps } from "../../core/ops.ts";
import { createProject } from "../../core/project.ts";
import { projectToOpenDaw, openDawToProject } from "./adapter.ts";

function countNotes(project: ReturnType<typeof createProject>): number {
  return project.tracks.reduce(
    (sum, track) => sum + track.clips.reduce((clipSum, clip) => clipSum + clip.notes.length, 0),
    0,
  );
}

const source = applyOps(createProject({ name: "openDAW check", lengthBars: 4 }), [
  { op: "add_track", id: "trk_drums", name: "Drums", instrument: { type: "drumkit" }, gainDb: -2 },
  { op: "add_device", trackId: "trk_drums", device: { type: "compressor", params: { threshold: 0.6, ratio: 4 } } },
  { op: "add_notes", trackId: "trk_drums", startBar: 0, notes: [
    { pitch: 36, start: 0, duration: 0.25, velocity: 110 },
    { pitch: 38, start: 1, duration: 0.25, velocity: 100 },
    { pitch: 36, start: 2, duration: 0.25, velocity: 110 },
    { pitch: 38, start: 3, duration: 0.25, velocity: 100 },
  ] },
  { op: "add_track", id: "trk_bass", name: "Bass", instrument: { type: "bass" } },
  { op: "add_notes", trackId: "trk_bass", startBar: 0, notes: [
    { pitch: 38, start: 0, duration: 1, velocity: 90 },
    { pitch: 41, start: 1, duration: 1, velocity: 90 },
    { pitch: 43, start: 2, duration: 2, velocity: 90 },
  ] },
  { op: "add_track", id: "trk_pad", name: "Pad", instrument: { type: "pad" } },
  { op: "add_device", trackId: "trk_pad", device: { type: "reverb", params: { wet: 0.3 } } },
  { op: "add_notes", trackId: "trk_pad", startBar: 0, notes: [
    { pitch: 62, start: 0, duration: 4, velocity: 80 },
  ] },
]).project;
const expectedNotes = countNotes(source);
console.log(`origen: ${source.tracks.length} pistas, ${expectedNotes} notas`);

const exported = await projectToOpenDaw(source);
console.log(
  `exportado: ${exported.bytes.byteLength} bytes · ${exported.stats.tracks} pistas · ${exported.stats.regions} clips · ${exported.stats.notes} notas · ${exported.stats.devices} FX`,
);
assert.ok(exported.bytes.byteLength > 1_000, "el proyecto serializado debe tener contenido");
assert.equal(exported.stats.tracks, source.tracks.length);
assert.equal(exported.stats.notes, expectedNotes);
assert.ok(exported.stats.regions >= source.tracks.length);
assert.ok(exported.stats.devices > 0, "debería mapear algún efecto");

const imported = await openDawToProject(exported.bytes);
console.log(
  `importado: ${imported.project.tracks.length} pistas · ${imported.stats.regions} clips · ${imported.stats.notes} notas`,
);
assert.equal(imported.project.bpm, source.bpm, "el tempo debe sobrevivir");
assert.equal(imported.project.tracks.length, source.tracks.length, "las pistas deben sobrevivir");
assert.equal(imported.stats.notes, expectedNotes, "las notas deben sobrevivir");
assert.equal(imported.project.lengthBars, source.lengthBars, "la duración debe sobrevivir");

for (const original of source.tracks) {
  const restored = imported.project.tracks.find((track) => track.name === original.name);
  assert.ok(restored, `falta la pista "${original.name}"`);
  const originalNotes = original.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
  const restoredNotes = restored.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
  assert.equal(restoredNotes, originalNotes, `notas de "${original.name}"`);
  assert.ok(Math.abs(restored.gainDb - original.gainDb) < 0.01, `ganancia de "${original.name}"`);
}

if (exported.warnings.length > 0) {
  console.log("avisos:");
  for (const warning of exported.warnings) console.log(`  - ${warning}`);
}

console.log("OPENDAW OK");
