import { test } from "node:test";
import assert from "node:assert/strict";

import type { Note } from "./types.ts";
import {
  Historial,
  alargar,
  borrar,
  clasesDeLaTonalidad,
  cuantizar,
  darLaVuelta,
  desplazar,
  duplicar,
  escalarTiempo,
  invertir,
  nombrePiezaGm,
  transponer,
  velocidad,
} from "./editor-notas.ts";

const n = (pitch: number, start: number, duration = 0.25, velocity = 100): Note => ({ pitch, start, duration, velocity });
const notas = [n(60, 0), n(64, 1), n(67, 2, 0.5)];
const nada = new Set<number>();

test("transpose acts on the selection, or on all with none, and stays in 0-127", () => {
  assert.deepEqual(transponer(notas, new Set([1]), 12).map((x) => x.pitch), [60, 76, 67]);
  assert.deepEqual(transponer(notas, nada, -1).map((x) => x.pitch), [59, 63, 66]);
  assert.equal(transponer([n(125, 0)], nada, 12)[0]!.pitch, 127);
});

test("moving keeps the group inside the clip", () => {
  assert.deepEqual(desplazar(notas, new Set([0, 1]), 0.25, 4).map((x) => x.start), [0.25, 1.25, 2]);
  // The group cannot start before 0 or end after the clip.
  assert.deepEqual(desplazar(notas, new Set([0]), -1, 4).map((x) => x.start), [0, 1, 2]);
  assert.deepEqual(desplazar(notas, new Set([2]), 5, 4).map((x) => x.start), [0, 1, 3.5]);
});

test("invert mirrors pitch, reverse mirrors time, inside the group", () => {
  assert.deepEqual(invertir(notas, nada).map((x) => x.pitch), [67, 63, 60]);
  assert.deepEqual(darLaVuelta(notas, nada).map((x) => x.start), [2.25, 1.25, 0]);
});

test("x2 and /2 scale from the group's first note; past the clip end is cut", () => {
  assert.deepEqual(escalarTiempo(notas, nada, 2, 8).map((x) => [x.start, x.duration]), [[0, 0.5], [2, 0.5], [4, 1]]);
  assert.deepEqual(escalarTiempo(notas, nada, 0.5, 8).map((x) => [x.start, x.duration]), [[0, 0.125], [0.5, 0.125], [1, 0.25]]);
  assert.equal(escalarTiempo(notas, nada, 2, 3).length, 2);
});

test("quantize snaps starts only", () => {
  const sueltas = [n(60, 0.13, 0.3), n(62, 0.9, 0.2)];
  assert.deepEqual(cuantizar(sueltas, nada, 0.25, 4).map((x) => [x.start, x.duration]), [[0.25, 0.3], [1, 0.2]]);
  assert.deepEqual(cuantizar(sueltas, nada, 1 / 3, 4)[0]!.start, 0);
});

test("resize, velocity and delete", () => {
  assert.deepEqual(alargar(notas, new Set([0]), 0.5, 4).map((x) => x.duration), [0.75, 0.25, 0.5]);
  assert.equal(alargar(notas, new Set([0]), -5, 4)[0]!.duration, 1 / 16);
  assert.deepEqual(velocidad(notas, new Set([1]), 200).map((x) => x.velocity), [100, 127, 100]);
  assert.deepEqual(borrar(notas, new Set([0, 2])).map((x) => x.pitch), [64]);
});

test("duplicate places copies right after the selection and selects them", () => {
  const { notas: res, seleccion } = duplicar(notas, new Set([0, 1]), 8);
  assert.deepEqual(res.slice(3).map((x) => [x.pitch, x.start]), [[60, 1.25], [64, 2.25]]);
  assert.deepEqual([...seleccion], [3, 4]);
  // Nothing past the clip end.
  assert.equal(duplicar(notas, new Set([2]), 2.5).notas.length, 3);
});

test("key classes and drum names", () => {
  assert.deepEqual([...clasesDeLaTonalidad({ tonic: "D", mode: "minor" })].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 10]);
  assert.equal(nombrePiezaGm(50), "High tom");
  assert.equal(nombrePiezaGm(20), undefined);
});

test("undo and redo go back and forth through the snapshots", () => {
  const h = new Historial();
  let actual = notas;
  h.guardar(actual);
  actual = transponer(actual, nada, 1);
  h.guardar(actual);
  actual = borrar(actual, new Set([0]));
  actual = h.deshacer(actual)!;
  assert.equal(actual.length, 3);
  actual = h.deshacer(actual)!;
  assert.equal(actual[0]!.pitch, 60);
  assert.equal(h.deshacer(actual), null);
  actual = h.rehacer(actual)!;
  assert.equal(actual[0]!.pitch, 61);
  h.guardar(actual);
  assert.equal(h.puedeRehacer, false);
});
