import { test } from "node:test";
import assert from "node:assert/strict";

import { decidirDecodificar, PRESUPUESTO_DECODIFICADO_MB } from "./audio-store.ts";

const MB = 1024 * 1024;

test("short WAVs are always decoded, even when no budget is left", () => {
  assert.equal(decidirDecodificar(12, 10_000 * MB), true);
});

test("a long stem goes into openDAW as long as it fits in the budget", () => {
  // 4 min stereo at 48 kHz in Float32 ≈ 88 MB.
  assert.equal(decidirDecodificar(240, 0), true);
  assert.equal(decidirDecodificar(240, (PRESUPUESTO_DECODIFICADO_MB - 50) * MB), false);
  // One that does not fit on its own always goes through streaming (20 min ≈ 440 MB).
  assert.equal(decidirDecodificar(1200, 0), false);
});
