import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MULACOVER_COMMIT } from "./receta.ts";
import { DEMUCS_VERSION } from "../demucs/receta.ts";

// The window shows a version and the GPU script installs one: they must be the same, as with ACE-Step.
test("the GPU scripts install the versions the windows show", () => {
  const mulacover = readFileSync(new URL("../../../workspace/gpu/generar_mulacover.py", import.meta.url), "utf8");
  assert.match(mulacover, new RegExp(`^COMMIT = "${MULACOVER_COMMIT}"$`, "m"));
  const demucs = readFileSync(new URL("../../../workspace/gpu/separar_demucs.py", import.meta.url), "utf8");
  assert.match(demucs, new RegExp(`^VERSION = "${DEMUCS_VERSION.replace(/\./g, "\\.")}"$`, "m"));
});
