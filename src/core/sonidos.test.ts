import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POST_POR_DEFECTO,
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
import type { VozSonido } from "./sonidos.ts";

/** Fake catalog with the same shape as the one served by /api/voces. */
const CATALOGO: VozSonido[] = [
  {
    clave: "kick",
    etiqueta: "Bombo sintético",
    familia: "percusión",
    descripcion: "Bombo sintético: seno con caída de tono.",
    params: [
      { clave: "vel", etiqueta: "Intensidad", tipo: "num", defecto: 1, min: 0.05, max: 1 },
      { clave: "seed", etiqueta: "Semilla", tipo: "num", defecto: 0, min: 0, max: 9999 },
    ],
  },
  {
    clave: "metal_hit",
    etiqueta: "Golpe metálico",
    familia: "percusión",
    descripcion: "Chapa metálica con parciales inarmónicos.",
    params: [
      { clave: "vel", etiqueta: "Intensidad", tipo: "num", defecto: 1, min: 0.05, max: 1 },
      { clave: "pitch", etiqueta: "Tono", tipo: "num", defecto: 1, min: 0.4, max: 2.5, unidad: "x" },
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 0.9, min: 0.05, max: 4, unidad: "s" },
      { clave: "seed", etiqueta: "Semilla", tipo: "num", defecto: 0, min: 0, max: 9999 },
    ],
  },
  {
    clave: "organ_chord",
    etiqueta: "Acorde de órgano",
    familia: "tonal",
    descripcion: "Acorde de órgano con vibrato.",
    params: [
      {
        clave: "midis",
        etiqueta: "Notas",
        tipo: "enteros",
        defecto: [40, 47, 52],
        min: 21,
        max: 108,
        maximo_elementos: 8,
      },
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 2, min: 0.1, max: 16 },
    ],
  },
  {
    clave: "guitar_loop",
    etiqueta: "Riff",
    familia: "tonal",
    descripcion: "Riff completo.",
    params: [],
    excluida: "pide un patrón de notas",
  },
];

test("the catalog is data: voices are looked up in what the engine serves", () => {
  assert.equal(vozPorClave(CATALOGO, "kick")?.familia, "percusión");
  assert.equal(vozPorClave(CATALOGO, "no_existe"), undefined);
});

test("a new recipe copies the default values declared by the engine", () => {
  const receta = recetaNueva("Bombo Gordo", "kick", CATALOGO);
  assert.equal(receta.nombre, "bombo-gordo");
  assert.equal(receta.voz, "kick");
  assert.deepEqual(receta.args, { vel: 1, seed: 0 });
  assert.deepEqual(receta.post, POST_POR_DEFECTO);
  assert.deepEqual(Object.keys(argsPorDefecto(vozPorClave(CATALOGO, "kick"))).sort(), ["seed", "vel"]);
});

test("normalizing fills in what is missing and trims what is out of range", () => {
  const { receta, avisos } = normalizarReceta({ nombre: "Caja", voz: "metal_hit", args: { vel: 7 } }, CATALOGO);
  assert.equal(receta.args.vel, 1);
  assert.equal(receta.args.dur, 0.9);
  assert.equal(receta.post.cola, 1);
  assert.ok(avisos.some((a) => a.includes("out of range")), avisos.join(" | "));
});

test("an unknown or excluded voice does not produce an empty sound", () => {
  assert.throws(() => normalizarReceta({ voz: "violin" }, CATALOGO), /Unknown voice/);
  assert.throws(() => normalizarReceta({ voz: "guitar_loop" }, CATALOGO), /cannot be used like this/);
});

test("chords trim the note list to the declared maximum", () => {
  const { receta } = normalizarReceta(
    { voz: "organ_chord", args: { midis: [40, 47, 52, 55, 59, 64, 67, 71, 74, 79] } },
    CATALOGO,
  );
  assert.equal((receta.args.midis as number[]).length, 8);
});

test("post-processing is bounded and accepts the new words", () => {
  const { receta } = normalizarReceta(
    { voz: "kick", post: { brillo: 9, suciedad: -3, cola: 99, cuerpo: -9, repeticiones: 3 } },
    CATALOGO,
  );
  assert.equal(receta.post.brillo, 1);
  assert.equal(receta.post.suciedad, 0);
  assert.equal(receta.post.cola, 4);
  assert.equal(receta.post.cuerpo, -1);
  assert.equal(receta.post.repeticiones, 3);
});

test("the file name is cleaned and never left empty", () => {
  assert.equal(nombreDeSonido("  Bombo  GORDO!! "), "bombo-gordo");
  assert.equal(nombreDeSonido("ñandú/ácido"), "nandu-acido");
  assert.equal(nombreDeSonido("***"), "sonido");
  assert.equal(nombreDeSonido(""), "sonido");
});

test("literalPython writes True/False and lists like Python, not like JSON", () => {
  assert.equal(literalPython(true), "True");
  assert.equal(literalPython(false), "False");
  assert.equal(literalPython(40), "40");
  assert.equal(literalPython(0.35), "0.35");
  assert.equal(literalPython([40, 47]), "[40, 47]");
  assert.equal(literalPython("metal_hit"), '"metal_hit"');
});

test("the script carries the voice, the args, the post, and the project output", () => {
  const { receta } = normalizarReceta(
    {
      nombre: "bombo seco",
      voz: "kick",
      args: { vel: 0.8, seed: 3 },
      post: { peakDbfs: -1, fadeMs: 12, repeticiones: 2, brillo: 0.3, suciedad: 0.4, cola: 0.6, cuerpo: 0.5 },
      palabras: ["corto", "sucio"],
    },
    CATALOGO,
  );
  const script = scriptDeSonido(receta, { slug: "stahl" });
  assert.match(script, /^"""Sound "bombo-seco"/);
  assert.match(script, /VOZ = "kick"/);
  assert.match(script, /"vel": 0\.8,/);
  assert.match(script, /REPETICIONES = 2/);
  assert.match(script, /BRILLO = 0\.3/);
  assert.match(script, /SUCIEDAD = 0\.4/);
  assert.match(script, /COLA = 0\.6/);
  assert.match(script, /CUERPO = 0\.5/);
  assert.match(script, /words: corto, sucio/);
  // The WAV comes out next to the script, inside proyectos/<slug>/sonidos/.
  assert.match(script, /SALIDA = os\.path\.join\(AQUI, "bombo-seco\.wav"\)/);
  assert.match(script, /proyectos\/stahl\/sonidos\/bombo-seco\.json/);
  // The ARGS block has to be valid Python: no JSON.
  const bloque = script.slice(script.indexOf("ARGS = {"), script.indexOf("}", script.indexOf("ARGS = {")));
  assert.doesNotMatch(bloque, /None|true|false/);
  // The post-processing has to exist and be applied before normalizing.
  assert.match(script, /def postproceso\(x\):/);
  assert.match(script, /dsp\.soft_clip/);
});

test("the script and WAV paths do not leave their place", () => {
  const receta = recetaNueva("Rugido", "metal_hit", CATALOGO);
  // Script, WAV, and metadata together in the project; nothing inside the shared engine.
  assert.equal(rutaScriptDeSonido(receta), "sonidos/rugido.py");
  assert.equal(rutaWavDeSonido(receta), "sonidos/rugido.wav");
  const script = scriptDeSonido(receta, { slug: "p" });
  assert.match(script, /SALIDA = os\.path\.join\(AQUI, "rugido\.wav"\)/);
});

test("the same recipe gives the same script (the sound is reproducible)", () => {
  const a = scriptDeSonido(recetaNueva("x", "metal_hit", CATALOGO), { slug: "p" });
  const b = scriptDeSonido(recetaNueva("x", "metal_hit", CATALOGO), { slug: "p" });
  assert.equal(a, b);
});

test("argsPorDefecto copies the list: touching a recipe does not change the catalog", () => {
  const args = argsPorDefecto(vozPorClave(CATALOGO, "organ_chord"));
  (args.midis as number[]).push(99);
  assert.deepEqual(argsPorDefecto(vozPorClave(CATALOGO, "organ_chord")).midis, [40, 47, 52]);
});
