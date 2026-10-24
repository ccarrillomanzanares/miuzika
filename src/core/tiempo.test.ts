import { test } from "node:test";
import assert from "node:assert/strict";

import { compasesDeAudio, compasesNecesarios } from "./tiempo.ts";

test("un fichero que acaba justo en el borde no gana un compás", () => {
  assert.equal(compasesDeAudio(336, 4), 336);
  assert.equal(compasesDeAudio(320, 4), 320);
  assert.equal(compasesDeAudio(8, 4), 8);
});

test("un fichero con cola se redondea hacia arriba", () => {
  // El caso real: stems de 161,6 s a 125 BPM = 336,667 beats -> 340 (85 compases).
  assert.equal(compasesDeAudio(336.6666666666667, 4), 340);
  // Por debajo de dos compases se respeta la duración exacta (one-shot).
  assert.equal(compasesDeAudio(4.1, 4), 4.1);
  // A partir de dos compases, al compás siguiente.
  assert.equal(compasesDeAudio(8.1, 4), 12);
  assert.equal(compasesDeAudio(153.6, 4), 156);
});

test("un one-shot corto se queda con su duración exacta", () => {
  // Un bombo de 2 s a 100 BPM son 3,33 beats: no se estira a un compás.
  assert.equal(compasesDeAudio(3.3333, 4), 3.3333);
  // Justo en el umbral de dos compases sí se alinea.
  assert.equal(compasesDeAudio(8, 4), 8);
  assert.equal(compasesDeAudio(8.2, 4), 12);
});

test("no se inventa duraciones imposibles", () => {
  assert.equal(compasesDeAudio(0, 4), 4);
  assert.equal(compasesDeAudio(-5, 4), 4);
  assert.equal(compasesDeAudio(10, 0), 4);
});

test("los compases que necesita el proyecto salen del final del clip", () => {
  assert.equal(compasesNecesarios(0, 340, 4), 85);
  assert.equal(compasesNecesarios(0, 336.667, 4), 85);
  assert.equal(compasesNecesarios(8, 16, 4), 12);
  assert.equal(compasesNecesarios(0, 0.5, 4), 1);
});
