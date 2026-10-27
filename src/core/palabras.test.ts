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

test("el vocabulario cubre las palabras que se acordaron", () => {
  for (const clave of [
    "seco", "gordo", "corto", "largo", "agudo", "grave", "brillante", "oscuro",
    "metalico", "sucio", "limpio", "agresivo", "redondo", "hueco", "chillon", "apagado",
  ]) {
    assert.ok(buscarPalabra(clave), `falta ${clave}`);
  }
  assert.equal(buscarPalabra("metálico")?.clave, "metalico", "con tilde también");
  assert.equal(buscarPalabra("Chillón")?.clave, "chillon");
});

test("las palabras mueven la receta: corto y sucio cambian el post", () => {
  const base = recetaNueva("x", "kick", [KICK]);
  const { receta, aplicadas } = aplicarPalabras(base, ["corto", "sucio"], KICK);
  assert.deepEqual(aplicadas, ["corto", "sucio"]);
  assert.ok(receta.post.cola < POST_POR_DEFECTO.cola, "corto acorta la cola");
  assert.ok(receta.post.suciedad > 0, "sucio satura");
  assert.equal(receta.post.brillo, 0, "ni corto ni sucio tocan el brillo");
  const brillante = aplicarPalabras(base, ["brillante"], KICK).receta;
  assert.ok(brillante.post.brillo > 0, "brillante sí sube los agudos");
  assert.deepEqual(receta.palabras, ["corto", "sucio"]);
});

test("una palabra mueve el parámetro de la voz si existe y el post si no", () => {
  const metal = aplicarPalabras(recetaNueva("m", "metal_hit", [METAL]), ["corto", "gordo"], METAL).receta;
  assert.ok((metal.args.dur as number) < 0.9, "el metálico sí tiene duración");
  assert.ok((metal.args.pitch as number) < 1, "gordo baja el tono");
  assert.ok(metal.post.cuerpo > 0);

  const kick = aplicarPalabras(recetaNueva("k", "kick", [KICK]), ["corto", "gordo"], KICK).receta;
  assert.equal(kick.args.dur, undefined, "el bombo no tiene duración: no se inventa");
  assert.ok(kick.post.cola < 1, "pero la palabra se cumple en el post");
  assert.ok(kick.post.cuerpo > 0);
});

test("dos palabras del mismo eje: gana la última y se dice por qué", () => {
  const { receta, descartadas, aplicadas } = aplicarPalabras(
    recetaNueva("x", "kick", [KICK]),
    ["corto", "largo"],
    KICK,
  );
  assert.deepEqual(aplicadas, ["largo"]);
  assert.equal(descartadas.length, 1);
  assert.equal(descartadas[0].palabra, "corto");
  assert.match(descartadas[0].motivo, /se contradicen/);
  assert.ok(receta.post.cola > 1, "ganó largo");
});

test("una palabra que no existe avisa y no rompe", () => {
  const { aplicadas, avisos, receta } = aplicarPalabras(recetaNueva("x", "kick", [KICK]), ["bombástico"], KICK);
  assert.deepEqual(aplicadas, []);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /No conozco/);
  assert.deepEqual(receta.post, POST_POR_DEFECTO);
});

test("sumar palabras no se pasa nunca de los límites", () => {
  const { receta } = aplicarPalabras(
    recetaNueva("x", "kick", [KICK]),
    ["sucio", "agresivo", "metalico"],
    KICK,
  );
  assert.ok(receta.post.suciedad <= 1 && receta.post.suciedad >= 0);
  assert.ok(receta.post.brillo >= -1 && receta.post.brillo <= 1);
});

