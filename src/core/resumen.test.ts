import assert from "node:assert/strict";
import test from "node:test";
import { applyOps, firmasDeOps, NOMBRES_OPS } from "./ops.ts";
import { createProject } from "./project.ts";
import { nombreDeNota, resumenParaAgente } from "./resumen.ts";

test("nombre de nota con C4 = 60", () => {
  assert.equal(nombreDeNota(60), "C4");
  assert.equal(nombreDeNota(21), "A0");
  assert.equal(nombreDeNota(70), "A#4");
});

test("el resumen lleva ids, dispositivos y, si se pide, las notas del clip", () => {
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
  assert.match(conNotas, /notación compacta/);
  assert.match(conNotas, /E2:1!100/);
});

test("la chuleta de ops sale del esquema y cubre todas", () => {
  const firmas = firmasDeOps();
  for (const nombre of NOMBRES_OPS) assert.match(firmas, new RegExp(`^${nombre}\\(`, "m"));
  assert.match(firmas, /add_notes\(trackId, clipId\?, startBar\?, name\?, notes\)/);
});
