import { test } from "node:test";
import assert from "node:assert/strict";

import { renderIndustrialStab } from "./industrial.ts";

function measure(left: Float32Array, right: Float32Array) {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let index = 0; index < left.length; index++) {
    const l = left[index]!;
    const r = right[index]!;
    if (!Number.isFinite(l) || !Number.isFinite(r)) finite = false;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sum += l * l + r * r;
  }
  return {
    peak,
    rms: Math.sqrt(sum / (left.length * 2)),
    finite,
    length: left.length,
  };
}

test("el stab industrial suena, normaliza y no recorta", () => {
  const { left, right } = renderIndustrialStab({}, 0.4, 22_050);
  const stats = measure(left, right);
  assert.equal(stats.length, 8820);
  assert.equal(stats.finite, true);
  assert.ok(stats.peak <= 10 ** (-1 / 20) + 1e-6);
  assert.ok(stats.peak > 0.88);
  assert.ok(stats.rms > 0.01);
  assert.notDeepEqual(Array.from(left.slice(0, 200)), Array.from(right.slice(0, 200)));
});

test("es determinista con la misma semilla", () => {
  const a = renderIndustrialStab({ seed: 1234 }, 0.2, 8000);
  const b = renderIndustrialStab({ seed: 1234 }, 0.2, 8000);
  assert.deepEqual(Array.from(a.left), Array.from(b.left));
  assert.deepEqual(Array.from(a.right), Array.from(b.right));
});
