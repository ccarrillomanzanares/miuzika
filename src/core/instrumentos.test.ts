import { test } from "node:test";
import assert from "node:assert/strict";

import { OPCIONES, buscar, esActual, etiquetaInstrumento, instrumentoDe } from "./instrumentos.ts";

test("128 GM programs, 12 kits and 5 openDAW synths", () => {
  assert.equal(OPCIONES.filter((o) => o.clase === "gm").length, 128);
  assert.equal(OPCIONES.filter((o) => o.clase === "kit").length, 12);
  assert.equal(OPCIONES.filter((o) => o.clase === "synth").length, 5);
});

test("each option sets the instrument the engine plays", () => {
  const bajo = OPCIONES.find((o) => o.clase === "gm" && o.programa === 38)!;
  assert.deepEqual(instrumentoDe(bajo), { type: "bass", program: 38 });
  const pad = OPCIONES.find((o) => o.clase === "gm" && o.programa === 89)!;
  assert.deepEqual(instrumentoDe(pad), { type: "pad", program: 89 });
  const kit = OPCIONES.find((o) => o.clase === "kit" && o.programa === 25)!;
  assert.deepEqual(instrumentoDe(kit), { type: "drumkit", program: 25 });
  const synth = OPCIONES.find((o) => o.clase === "synth" && o.tipo === "lead")!;
  assert.deepEqual(instrumentoDe(synth), { type: "lead" });
});

test("the current one is recognised, a kit is not mistaken for program 0's piano", () => {
  const piano = OPCIONES.find((o) => o.clase === "gm" && o.programa === 0)!;
  const kit0 = OPCIONES.find((o) => o.clase === "kit" && o.programa === 0)!;
  assert.equal(esActual({ type: "drumkit", program: 0 }, piano), false);
  assert.equal(esActual({ type: "drumkit", program: 0 }, kit0), true);
  // A drumkit with no program plays the standard kit.
  assert.equal(esActual({ type: "drumkit" }, kit0), true);
  assert.equal(esActual({ type: "synth", program: 0 }, piano), true);
});

test("labels for the track head", () => {
  assert.equal(etiquetaInstrumento({ type: "bass", program: 38 }), "Synth bass 1");
  assert.equal(etiquetaInstrumento({ type: "drumkit", program: 8 }), "Drums · Room");
  assert.equal(etiquetaInstrumento({ type: "drumkit" }), "Drums · Standard 1");
  assert.equal(etiquetaInstrumento({ type: "pad" }), "Pad synth (openDAW)");
});

test("search by name and family, every word", () => {
  assert.ok(buscar("synth bass").some((o) => o.nombre === "Synth bass 1"));
  assert.ok(buscar("organ").every((o) => /organ/i.test(o.nombre) || (o.clase === "gm" && o.familia === "Organ")));
  assert.equal(buscar("808").length, 1);
  assert.ok(buscar("kit").every((o) => o.clase === "kit"));
  // "drums" finds the kits and GM's steel drums.
  assert.equal(buscar("drums").length, 13);
  assert.equal(buscar("").length, OPCIONES.length);
});
