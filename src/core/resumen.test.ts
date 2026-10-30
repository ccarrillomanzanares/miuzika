import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, firmasDeOps, NOMBRES_OPS } from "./ops.ts";
import { createProject } from "./project.ts";
import { nombreDeNota, resumenParaAgente } from "./resumen.ts";

test("note name with C4 = 60", () => {
  assert.equal(nombreDeNota(60), "C4");
  assert.equal(nombreDeNota(21), "A0");
  assert.equal(nombreDeNota(70), "A#4");
});

test("the summary carries ids, devices, and, if requested, the clip notes", () => {
  const base = createProject({ name: "Prueba", bpm: 90 });
  const { project } = applyOps(base, [
    { op: "add_track", id: "trk_bajo", name: "Bajo", instrument: { type: "bass" } },
    { op: "add_notes", trackId: "trk_bajo", notes: [{ pitch: 40, start: 0, duration: 1, velocity: 100 }] },
    { op: "add_device", trackId: "trk_bajo", device: { type: "eq", params: { low: 3 } } },
  ]);
  const texto = resumenParaAgente(project);
  assert.match(texto, /90 BPM/);
  assert.match(texto, /trk_bajo «Bajo»/);
  assert.match(texto, /fx dev_eq_1 eq: low=3/);
  assert.match(texto, /clp_1/);
  assert.match(texto, /eq: low -24\.\.24/);
  const conNotas = resumenParaAgente(project, { clipId: "clp_1" });
  assert.match(conNotas, /compact notation/);
  assert.match(conNotas, /E2:1!100/);
  assert.match(conNotas, /Track trk_bajo «Bajo»/);
  // Only the clip: neither the rest of the tracks nor the effect ranges.
  assert.doesNotMatch(conNotas, /Ranges of the fx/);
  assert.match(resumenParaAgente(project, { clipId: "clp_99" }), /There is no clip with id clp_99\. Clips: clp_1/);
  // The device is also accepted as text.
  const conTexto = applyOps(project, [{ op: "add_device", trackId: "trk_bajo", device: "Reverb" } as never]);
  assert.match(conTexto.results.join(" "), /reverb/);
});

test("the ops cheat sheet comes from the schema and covers all of them", () => {
  const firmas = firmasDeOps();
  for (const nombre of NOMBRES_OPS) assert.match(firmas, new RegExp(`^${nombre}\\(`, "m"));
  assert.match(firmas, /add_notes\(trackId, clipId\?, startBar\?, name\?, notes\)/);
});

test("the summary shows the buses, who feeds them, and their effects", () => {
  const project = applyOps(createProject({ name: "Buses" }), [
    { op: "add_track", id: "trk_voz", name: "Voz", instrument: { type: "lead" } },
    { op: "add_bus", name: "Sala", devices: ["reverb"] },
    { op: "set_send", trackId: "Voz", busId: "Sala", levelDb: -8 },
  ]).project;
  const texto = resumenParaAgente(project);
  assert.match(texto, /sends: bus_sala -8 dB/);
  assert.match(texto, /bus_sala «Sala» 0 dB · fed by: Voz/);
  assert.match(texto, /fx dev_reverb_1 reverb: wet=0\.25 decay=0\.5 preDelayMs=75/);
});
