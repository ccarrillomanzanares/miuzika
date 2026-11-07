import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { dentroDe } from "./dentro.ts";

const raiz = resolve("workspace", "proyectos", "hard");

test("a file under the folder is inside", () => {
  assert.equal(dentroDe(raiz, join(raiz, "generado", "a.wav")), true);
});

test("a sibling folder that starts the same is not inside", () => {
  assert.equal(dentroDe(raiz, resolve("workspace", "proyectos", "hard-copia", "a.wav")), false);
});

test("climbing out with .. is not inside", () => {
  assert.equal(dentroDe(raiz, join(raiz, "..", "otro", "proyecto.json")), false);
});

test("the folder itself only counts when asked", () => {
  assert.equal(dentroDe(raiz, raiz), false);
  assert.equal(dentroDe(raiz, raiz, { incluirRaiz: true }), true);
});
