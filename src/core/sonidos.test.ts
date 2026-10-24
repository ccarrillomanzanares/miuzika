import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VOCES,
  argsPorDefecto,
  literalPython,
  nombreDeSonido,
  normalizarReceta,
  recetaNueva,
  rutaScriptDeSonido,
  rutaWavDeSonido,
  scriptDeSonido,
  vozPorClave,
} from "./sonidos.ts";

test("cada voz del catálogo existe con su función y sus parámetros", () => {
  assert.ok(VOCES.length >= 10);
  for (const voz of VOCES) {
    assert.ok(voz.clave.length > 0, "clave");
    assert.ok(voz.etiqueta.length > 0, "etiqueta");
    assert.ok(voz.descripcion.length > 10, "descripcion");
    assert.ok(voz.params.length > 0, "params");
    for (const param of voz.params) {
      assert.ok(param.clave.length > 0, "clave de parámetro");
      assert.ok(param.etiqueta.length > 0, "etiqueta de parámetro");
      // Un booleano no tiene rango; el resto, sí.
      if (param.tipo !== "bool") {
        assert.equal(typeof param.min, "number", `${voz.clave}.${param.clave} sin min`);
        assert.equal(typeof param.max, "number", `${voz.clave}.${param.clave} sin max`);
        assert.ok((param.min ?? 0) < (param.max ?? 0), `${voz.clave}.${param.clave} rango vacío`);
      }
    }
  }
});

test("el catálogo cubre las voces del motor que se pueden tocar sin código", () => {
  for (const clave of ["kick", "snare", "hat", "metal_hit", "bass_note", "drone_note", "piano_note"]) {
    assert.ok(vozPorClave(clave), `falta ${clave}`);
  }
  assert.equal(vozPorClave("no_existe"), undefined);
});

test("una receta nueva trae los valores por defecto de su voz", () => {
  const receta = recetaNueva("Bombo Gordo", "kick");
  assert.equal(receta.formato, "miuzika-sonido");
  assert.equal(receta.version, 1);
  assert.equal(receta.nombre, "bombo-gordo");
  assert.equal(receta.voz, "kick");
  assert.deepEqual(Object.keys(receta.args).sort(), ["seed", "vel"]);
  assert.equal(receta.args.vel, 1);
  assert.equal(receta.post.peakDbfs, -1);
});

test("normalizar rellena lo que falta y recorta lo que se sale", () => {
  const { receta, avisos } = normalizarReceta({
    nombre: "Caja Seca",
    voz: "snare",
    args: { vel: 7 }, // fuera de rango (máximo 1)
  });
  assert.equal(receta.voz, "snare");
  assert.equal(receta.args.vel, 1);
  assert.equal(receta.args.seed, 0);
  assert.ok(avisos.some((a) => a.includes("fuera de rango")), avisos.join(" | "));
});

test("una voz desconocida es un error, no un sonido vacío", () => {
  assert.throws(() => normalizarReceta({ voz: "violin", nombre: "x" }), /Voz desconocida/);
});

test("los acordes recortan la lista de notas al máximo", () => {
  const { receta } = normalizarReceta({
    voz: "organ_chord",
    nombre: "acorde",
    args: { midis: [40, 47, 52, 55, 59, 64, 67, 71, 74, 79, 83] },
  });
  assert.equal((receta.args.midis as number[]).length, 8);
});

test("un booleano llega como booleano aunque venga como texto", () => {
  const { receta } = normalizarReceta({ voz: "hat", nombre: "abierto", args: { open_: "true" } });
  assert.equal(receta.args.open_, true);
});

test("el nombre del fichero se limpia y nunca queda vacío", () => {
  assert.equal(nombreDeSonido("  Bombo  GORDO!! "), "bombo-gordo");
  assert.equal(nombreDeSonido("ñandú/ácido"), "nandu-acido");
  assert.equal(nombreDeSonido("***"), "sonido");
  assert.equal(nombreDeSonido(""), "sonido");
});

test("literalPython escribe True/False y listas como Python, no como JSON", () => {
  assert.equal(literalPython(true), "True");
  assert.equal(literalPython(false), "False");
  assert.equal(literalPython(40), "40");
  assert.equal(literalPython(-1), "-1");
  assert.equal(literalPython(0.35), "0.35");
  assert.equal(literalPython([40, 47]), "[40, 47]");
  assert.equal(literalPython("metal_hit"), '"metal_hit"');
});

test("el script generado lleva la voz, los args y la salida del proyecto", () => {
  const receta = normalizarReceta({
    nombre: "bombo seco",
    voz: "kick",
    args: { vel: 0.8, seed: 3 },
    post: { peakDbfs: -1, fadeMs: 12, repeticiones: 2 },
  }).receta;
  const script = scriptDeSonido(receta, { slug: "stahl" });
  assert.match(script, /^"""Sonido «bombo-seco»/);
  assert.match(script, /VOZ = "kick"/);
  assert.match(script, /"vel": 0.8,/);
  assert.match(script, /"seed": 3,/);
  assert.match(script, /REPETICIONES = 2/);
  assert.match(script, /"proyectos\/stahl\/sonidos\/bombo-seco\.wav"/);
  assert.match(script, /PEAK_DBFS = -1/);
  assert.match(script, /FADE_MS = 12/);
  assert.match(script, /sys\.path\.insert\(0, os\.path\.join\(RAIZ, "codigo"\)\)/);
  // El bloque ARGS tiene que ser Python válido: nada de JSON (true/false/None).
  const bloque = script.slice(script.indexOf("ARGS = {"), script.indexOf("}", script.indexOf("ARGS = {")));
  assert.match(bloque, /"vel": 0\.8,/);
  assert.doesNotMatch(bloque, /None|true|false/);
});

test("las rutas del script y del WAV no se salen de su sitio", () => {
  const receta = recetaNueva("Rugido", "feedback_growl");
  assert.equal(rutaScriptDeSonido(receta), "codigo/experimental/sonido_rugido.py");
  assert.equal(rutaWavDeSonido(receta), "sonidos/rugido.wav");
});

test("la misma receta da el mismo script (el sonido es reproducible)", () => {
  const a = scriptDeSonido(recetaNueva("x", "metal_hit"), { slug: "p" });
  const b = scriptDeSonido(recetaNueva("x", "metal_hit"), { slug: "p" });
  assert.equal(a, b);
});

test("argsPorDefecto copia la lista: tocar una receta no cambia el catálogo", () => {
  const args = argsPorDefecto("organ_chord");
  (args.midis as number[]).push(99);
  assert.deepEqual(argsPorDefecto("organ_chord").midis, [40, 47, 52]);
});
