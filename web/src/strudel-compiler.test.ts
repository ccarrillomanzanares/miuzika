import { test } from "node:test";
import assert from "node:assert/strict";

import { expandLabeledPatterns } from "./strudel-compiler.ts";

test("convierte bloques $: en un stack", () => {
  const expanded = expandLabeledPatterns(`
$: s("hh*8")
$: s("bd sd")
`);
  assert.doesNotMatch(expanded, /\$:/);
  assert.match(expanded, /stack\(/);
  assert.match(expanded, /s\("hh\*8"\)/);
  assert.match(expanded, /s\("bd sd"\)/);
});

test("deja intacto un patrón normal", () => {
  const code = 'note("c3 e3").s("sawtooth")';
  assert.equal(expandLabeledPatterns(code), code);
});
