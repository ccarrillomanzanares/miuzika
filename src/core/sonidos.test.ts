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

/** Catálogo de mentira con la misma forma que el que sirve /api/voces. */
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

test("el catálogo es un dato: las voces se buscan en lo que sirve el motor", () => {
  assert.equal(vozPorClave(CATALOGO, "kick")?.familia, "percusión");
  assert.equal(vozPorClave(CATALOGO, "no_existe"), undefined);
});

test("una receta nueva copia los valores por defecto que declara el motor", () => {
  const receta = recetaNueva("Bombo Gordo", "kick", CATALOGO);
  assert.equal(receta.nombre, "bombo-gordo");
  assert.equal(receta.voz, "kick");
  assert.deepEqual(receta.args, { vel: 1, seed: 0 });
  assert.deepEqual(receta.post, POST_POR_DEFECTO);
  assert.deepEqual(Object.keys(argsPorDefecto(vozPorClave(CATALOGO, "kick"))).sort(), ["seed", "vel"]);
});

test("normalizar rellena lo que falta y recorta lo que se sale", () => {
  const { receta, avisos } = normalizarReceta({ nombre: "Caja", voz: "metal_hit", args: { vel: 7 } }, CATALOGO);
  assert.equal(receta.args.vel, 1);
  assert.equal(receta.args.dur, 0.9);
  assert.equal(receta.post.cola, 1);
  assert.ok(avisos.some((a) => a.includes("fuera de rango")), avisos.join(" | "));
});

test("una voz desconocida o excluida no produce un sonido vacío", () => {
  assert.throws(() => normalizarReceta({ voz: "violin" }, CATALOGO), /Voz desconocida/);
  assert.throws(() => normalizarReceta({ voz: "guitar_loop" }, CATALOGO), /no se puede usar así/);
});

test("los acordes recortan la lista de notas al máximo declarado", () => {
  const { receta } = normalizarReceta(
    { voz: "organ_chord", args: { midis: [40, 47, 52, 55, 59, 64, 67, 71, 74, 79] } },
    CATALOGO,
  );
  assert.equal((receta.args.midis as number[]).length, 8);
});

test("el post-proceso se acota y acepta las palabras nuevas", () => {
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
  assert.equal(literalPython(0.35), "0.35");
  assert.equal(literalPython([40, 47]), "[40, 47]");
  assert.equal(literalPython("metal_hit"), '"metal_hit"');
});

test("el script lleva la voz, los args, el post y la salida del proyecto", () => {
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
  assert.match(script, /^"""Sonido «bombo-seco»/);
  assert.match(script, /VOZ = "kick"/);
  assert.match(script, /"vel": 0\.8,/);
  assert.match(script, /REPETICIONES = 2/);
  assert.match(script, /BRILLO = 0\.3/);
  assert.match(script, /SUCIEDAD = 0\.4/);
  assert.match(script, /COLA = 0\.6/);
  assert.match(script, /CUERPO = 0\.5/);
  assert.match(script, /palabras: corto, sucio/);
  // El WAV sale junto al script, dentro de proyectos/<slug>/sonidos/.
  assert.match(script, /SALIDA = os\.path\.join\(AQUI, "bombo-seco\.wav"\)/);
  assert.match(script, /proyectos\/stahl\/sonidos\/bombo-seco\.json/);
  // El bloque ARGS tiene que ser Python válido: nada de JSON.
  const bloque = script.slice(script.indexOf("ARGS = {"), script.indexOf("}", script.indexOf("ARGS = {")));
  assert.doesNotMatch(bloque, /None|true|false/);
  // El post-proceso tiene que existir y aplicarse antes de normalizar.
  assert.match(script, /def postproceso\(x\):/);
  assert.match(script, /dsp\.soft_clip/);
});

test("las rutas del script y del WAV no se salen de su sitio", () => {
  const receta = recetaNueva("Rugido", "metal_hit", CATALOGO);
  // Script, WAV y ficha juntos en el proyecto; nada dentro del motor compartido.
  assert.equal(rutaScriptDeSonido(receta), "sonidos/rugido.py");
  assert.equal(rutaWavDeSonido(receta), "sonidos/rugido.wav");
  const script = scriptDeSonido(receta, { slug: "p" });
  assert.match(script, /SALIDA = os\.path\.join\(AQUI, "rugido\.wav"\)/);
});

test("la misma receta da el mismo script (el sonido es reproducible)", () => {
  const a = scriptDeSonido(recetaNueva("x", "metal_hit", CATALOGO), { slug: "p" });
  const b = scriptDeSonido(recetaNueva("x", "metal_hit", CATALOGO), { slug: "p" });
  assert.equal(a, b);
});

test("argsPorDefecto copia la lista: tocar una receta no cambia el catálogo", () => {
  const args = argsPorDefecto(vozPorClave(CATALOGO, "organ_chord"));
  (args.midis as number[]).push(99);
  assert.deepEqual(argsPorDefecto(vozPorClave(CATALOGO, "organ_chord")).midis, [40, 47, 52]);
});
