/**
 * Integration check against the real SDK.
 * Run with `npm run test:opendaw` (esbuild + Node).
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
  { op: "add_device", trackId: "trk_drums", device: { type: "compressor", params: { thresholdDb: -24, ratio: 4 } } },
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
console.log(`source: ${source.tracks.length} tracks, ${expectedNotes} notes`);

const exported = await projectToOpenDaw(source);
console.log(
  `exported: ${exported.bytes.byteLength} bytes · ${exported.stats.tracks} tracks · ${exported.stats.regions} clips · ${exported.stats.notes} notes · ${exported.stats.devices} FX`,
);
assert.ok(exported.bytes.byteLength > 1_000, "the serialized project must have content");
assert.equal(exported.stats.tracks, source.tracks.length);
assert.equal(exported.stats.notes, expectedNotes);
assert.ok(exported.stats.regions >= source.tracks.length);
assert.ok(exported.stats.devices > 0, "it should map some effect");

const imported = await openDawToProject(exported.bytes);
console.log(
  `imported: ${imported.project.tracks.length} tracks · ${imported.stats.regions} clips · ${imported.stats.notes} notes`,
);
assert.equal(imported.project.bpm, source.bpm, "the tempo must survive");
assert.equal(imported.project.tracks.length, source.tracks.length, "the tracks must survive");
assert.equal(imported.stats.notes, expectedNotes, "the notes must survive");
assert.equal(imported.project.lengthBars, source.lengthBars, "the duration must survive");

for (const original of source.tracks) {
  const restored = imported.project.tracks.find((track) => track.name === original.name);
  assert.ok(restored, `missing track "${original.name}"`);
  const originalNotes = original.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
  const restoredNotes = restored.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
  assert.equal(restoredNotes, originalNotes, `notes of "${original.name}"`);
  assert.ok(Math.abs(restored.gainDb - original.gainDb) < 0.01, `gain of "${original.name}"`);
}

if (exported.warnings.length > 0) {
  console.log("warnings:");
  for (const warning of exported.warnings) console.log(`  - ${warning}`);
}

// --- General MIDI: tracks with a program play through the GM SoundFont, with their
// notes and effects (before, the SoundFont branch exported neither notes nor effects).
const conGm = applyOps(createProject({ name: "openDAW GM", lengthBars: 2 }), [
  { op: "add_track", id: "trk_bajo", name: "Bajo GM", instrument: { type: "bass", program: 33 } },
  { op: "add_device", trackId: "trk_bajo", device: { type: "compressor" } },
  { op: "add_notes", trackId: "trk_bajo", startBar: 0, notes: [
    { pitch: 38, start: 0, duration: 1, velocity: 100 },
    { pitch: 41, start: 1, duration: 1, velocity: 100 },
  ] },
  { op: "add_track", id: "trk_bat", name: "Batería GM", instrument: { type: "drumkit", program: 0 } },
  { op: "add_notes", trackId: "trk_bat", startBar: 0, notes: [{ pitch: 36, start: 0, duration: 0.25, velocity: 110 }] },
]).project;
const gm = {
  uuid: new Uint8Array(16).fill(7),
  name: "gm.sf2",
  bytes: new ArrayBuffer(0),
  presets: [{ bank: 0, preset: 0 }, { bank: 0, preset: 33 }, { bank: 128, preset: 0 }],
};
const exportadoGm = await projectToOpenDaw(conGm, { gm });
console.log(
  `GM: ${exportadoGm.stats.tracks} tracks · ${exportadoGm.stats.notes} notes · ${exportadoGm.stats.devices} FX`,
);
assert.equal(exportadoGm.stats.notes, 3, "GM tracks carry their notes");
assert.equal(exportadoGm.stats.devices, 1, "GM tracks carry their effects");
const reimportadoGm = await openDawToProject(exportadoGm.bytes);
assert.equal(reimportadoGm.stats.notes, 3, "GM notes survive the .odw");

// --- Buses: a shared reverb on an aux bus, with sends from two tracks. The .odw
// has to load back (Project.load validates the graph pointers).
const conBus = applyOps(createProject({ name: "openDAW buses", lengthBars: 2 }), [
  { op: "add_track", id: "trk_a", name: "A", instrument: { type: "pad" } },
  { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 60, start: 0, duration: 4, velocity: 90 }] },
  { op: "add_track", id: "trk_b", name: "B", instrument: { type: "lead" } },
  { op: "add_notes", trackId: "trk_b", startBar: 0, notes: [{ pitch: 67, start: 0, duration: 1, velocity: 90 }] },
  { op: "add_bus", name: "Sala", devices: [{ type: "reverb", params: { wet: 1, preDelayMs: 20 } }] },
  { op: "set_send", trackId: "trk_a", busId: "Sala", levelDb: -6 },
  { op: "set_send", trackId: "trk_b", busId: "bus_sala", levelDb: -12 },
]).project;
const exportadoBus = await projectToOpenDaw(conBus);
console.log(`buses: ${exportadoBus.stats.buses} bus · ${exportadoBus.stats.sends} sends · ${exportadoBus.stats.devices} FX`);
assert.equal(exportadoBus.stats.buses, 1);
assert.equal(exportadoBus.stats.sends, 2);
assert.equal(exportadoBus.stats.devices, 1, "the bus reverb");
const reimportadoBus = await openDawToProject(exportadoBus.bytes);
assert.equal(reimportadoBus.project.tracks.length, 2, "the bus does not sneak in as a track when reimporting");

console.log("OPENDAW OK");
