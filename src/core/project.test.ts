import assert from "node:assert/strict";
import { test } from "node:test";
import { carpetaLibre } from "./project.ts";

test("a new project never takes a folder in use", () => {
  assert.equal(carpetaLibre("tema", new Set()), "tema");
  assert.equal(carpetaLibre("tema", new Set(["tema"])), "tema-2");
  assert.equal(carpetaLibre("tema", new Set(["tema", "tema-2"])), "tema-3");
});
