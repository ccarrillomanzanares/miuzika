import assert from "node:assert/strict";
import test from "node:test";
import { applyOps } from "./ops.ts";
import { createProject } from "./project.ts";
import { describirVersion, nombreDeVersion, restaurarVersion, versionesSobrantes } from "./versiones.ts";

test("a version name sorts by date and carries the request", () => {
  const nombre = nombreDeVersion(new Date(2026, 9, 27, 21, 45, 3), "Adelante con la batería también!");
  assert.equal(nombre, "2026-10-27_21-45-03_adelante-con-la-bateria-tambien.json");
  assert.equal(describirVersion(nombre), "27-10 21:45:03 · before «adelante con la bateria tambien»");
  assert.deepEqual(versionesSobrantes(["b.json", "a.json", "c.json", "x.txt"], 2), ["a.json"]);
});

test("restoring a track leaves the rest as it is and renumbers duplicate clips", () => {
  const base = createProject({ name: "Prueba", bpm: 100 });
  const antes = applyOps(base, [
    { op: "add_track", id: "trk_bat", name: "Batería", instrument: { type: "drumkit" } },
    { op: "add_track", id: "trk_bajo", name: "Bajo", instrument: { type: "bass" } },
    { op: "add_notes", trackId: "trk_bat", notes: [{ pitch: 36, start: 0, duration: 0.25, velocity: 100 }] },
  ]).project;
  const clipAntiguo = antes.tracks[0]!.clips[0]!.id;
  // Afterward: the drums are deleted and the bass takes the id that was left free.
  const despues = applyOps(antes, [
    { op: "remove_clip", trackId: "trk_bat", clipId: clipAntiguo },
    { op: "add_notes", trackId: "trk_bat", notes: [{ pitch: 38, start: 0, duration: 1, velocity: 90 }] },
    { op: "add_notes", trackId: "trk_bajo", notes: [{ pitch: 40, start: 0, duration: 1, velocity: 90 }] },
    { op: "set_track", trackId: "trk_bajo", gainDb: -4 },
  ]).project;

  const { project, hechas } = restaurarVersion(despues, antes, ["bateria"]);
  const bateria = project.tracks.find((t) => t.id === "trk_bat")!;
  assert.equal(bateria.clips.length, 1);
  assert.equal(bateria.clips[0]!.notes[0]!.pitch, 36);
  const bajo = project.tracks.find((t) => t.id === "trk_bajo")!;
  assert.equal(bajo.gainDb, -4);
  const ids = project.tracks.flatMap((t) => t.clips.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.match(hechas[0]!, /Batería.*restored: 1 clips, 1 notes/);
  assert.throws(() => restaurarVersion(despues, antes, ["Coro"]), /no track «Coro»/);
});

test("restoring with no tracks returns the whole project and keeps the folder", () => {
  const antes = createProject({ name: "Uno", bpm: 90 });
  const ahora = { ...structuredClone(antes), bpm: 130, meta: { ...antes.meta, carpeta: "uno" } };
  const { project } = restaurarVersion(ahora, antes);
  assert.equal(project.bpm, 90);
  assert.equal(project.meta.carpeta, "uno");
});
