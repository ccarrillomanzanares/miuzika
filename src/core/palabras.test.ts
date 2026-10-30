import { test } from "node:test";
import assert from "node:assert/strict";

import { aplicarPalabras, buscarPalabra } from "./palabras.ts";
import { POST_POR_DEFECTO, recetaNueva } from "./sonidos.ts";
import type { VozSonido } from "./sonidos.ts";

const KICK: VozSonido = {
  clave: "kick",
  etiqueta: "Bombo",
  familia: "percusión",
  descripcion: "Bombo sintético.",
  params: [
    { clave: "vel", etiqueta: "Intensidad", tipo: "num", defecto: 1, min: 0.05, max: 1 },
    { clave: "seed", etiqueta: "Semilla", tipo: "num", defecto: 0, min: 0, max: 9999 },
  ],
};

const METAL: VozSonido = {
  clave: "metal_hit",
  etiqueta: "Golpe metálico",
  familia: "percusión",
  descripcion: "Chapa metálica.",
  params: [
    { clave: "vel", etiqueta: "Intensidad", tipo: "num", defecto: 1, min: 0.05, max: 1 },
    { clave: "pitch", etiqueta: "Tono", tipo: "num", defecto: 1, min: 0.4, max: 2.5 },
    { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 0.9, min: 0.05, max: 4 },
  ],
};

test("the vocabulary covers the agreed words", () => {
  for (const clave of [
    "seco", "gordo", "corto", "largo", "agudo", "grave", "brillante", "oscuro",
    "metalico", "sucio", "limpio", "agresivo", "redondo", "hueco", "chillon", "apagado",
  ]) {
    assert.ok(buscarPalabra(clave), `missing ${clave}`);
  }
  assert.equal(buscarPalabra("metálico")?.clave, "metalico", "with an accent too");
  assert.equal(buscarPalabra("Chillón")?.clave, "chillon");
});

test("the words move the recipe: corto and sucio change the post", () => {
  const base = recetaNueva("x", "kick", [KICK]);
  const { receta, aplicadas } = aplicarPalabras(base, ["corto", "sucio"], KICK);
  assert.deepEqual(aplicadas, ["corto", "sucio"]);
  assert.ok(receta.post.cola < POST_POR_DEFECTO.cola, "corto shortens the tail");
  assert.ok(receta.post.suciedad > 0, "sucio saturates");
  assert.equal(receta.post.brillo, 0, "neither corto nor sucio touches the brightness");
  const brillante = aplicarPalabras(base, ["brillante"], KICK).receta;
  assert.ok(brillante.post.brillo > 0, "brillante does raise the highs");
  assert.deepEqual(receta.palabras, ["corto", "sucio"]);
});

test("a word moves the voice parameter if it exists and the post if not", () => {
  const metal = aplicarPalabras(recetaNueva("m", "metal_hit", [METAL]), ["corto", "gordo"], METAL).receta;
  assert.ok((metal.args.dur as number) < 0.9, "the metallic one does have duration");
  assert.ok((metal.args.pitch as number) < 1, "gordo lowers the pitch");
  assert.ok(metal.post.cuerpo > 0);

  const kick = aplicarPalabras(recetaNueva("k", "kick", [KICK]), ["corto", "gordo"], KICK).receta;
  assert.equal(kick.args.dur, undefined, "the kick has no duration: it is not invented");
  assert.ok(kick.post.cola < 1, "but the word is honored in the post");
  assert.ok(kick.post.cuerpo > 0);
});

test("two words on the same axis: the last one wins and it says why", () => {
  const { receta, descartadas, aplicadas } = aplicarPalabras(
    recetaNueva("x", "kick", [KICK]),
    ["corto", "largo"],
    KICK,
  );
  assert.deepEqual(aplicadas, ["largo"]);
  assert.equal(descartadas.length, 1);
  assert.equal(descartadas[0].palabra, "corto");
  assert.match(descartadas[0].motivo, /contradict/);
  assert.ok(receta.post.cola > 1, "largo won");
});

test("a word that does not exist warns and does not break", () => {
  const { aplicadas, avisos, receta } = aplicarPalabras(recetaNueva("x", "kick", [KICK]), ["bombástico"], KICK);
  assert.deepEqual(aplicadas, []);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /I don't know/);
  assert.deepEqual(receta.post, POST_POR_DEFECTO);
});

test("adding words never goes past the limits", () => {
  const { receta } = aplicarPalabras(
    recetaNueva("x", "kick", [KICK]),
    ["sucio", "agresivo", "metalico"],
    KICK,
  );
  assert.ok(receta.post.suciedad <= 1 && receta.post.suciedad >= 0);
  assert.ok(receta.post.brillo >= -1 && receta.post.brillo <= 1);
});

