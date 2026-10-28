import { test } from "node:test";
import assert from "node:assert/strict";

import { decidirDecodificar, PRESUPUESTO_DECODIFICADO_MB } from "./audio-store.ts";

const MB = 1024 * 1024;

test("los WAV cortos se decodifican siempre, aunque no quede presupuesto", () => {
  assert.equal(decidirDecodificar(12, 10_000 * MB), true);
});

test("un stem largo entra en openDAW mientras quepa en el presupuesto", () => {
  // 4 min estéreo a 48 kHz en Float32 ≈ 88 MB.
  assert.equal(decidirDecodificar(240, 0), true);
  assert.equal(decidirDecodificar(240, (PRESUPUESTO_DECODIFICADO_MB - 50) * MB), false);
  // Uno que solo ya no cabe va siempre por streaming (20 min ≈ 440 MB).
  assert.equal(decidirDecodificar(1200, 0), false);
});
