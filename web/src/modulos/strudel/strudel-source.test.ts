import { test } from "node:test";
import assert from "node:assert/strict";

import { expandLabeledPatterns, stripVisualMethods } from "./strudel-source.ts";

test("$: blocks become one stack, the preamble kept before it", () => {
  const codigo = 'setcps(1)\n$: s("bd*4")\n$: note("c2 e2")\n  .s("sawtooth")';
  assert.equal(expandLabeledPatterns(codigo), 'setcps(1)\nstack(\n  (s("bd*4")),\n  (note("c2 e2")\n  .s("sawtooth"))\n)');
});

test("code without $: is left as it is", () => {
  assert.equal(expandLabeledPatterns('s("bd sd")'), 's("bd sd")');
});

test("the REPL's visual methods are removed", () => {
  assert.equal(stripVisualMethods('note("c e g")._pianoroll({ fold: 1 }).s("piano")._scope()'), 'note("c e g").s("piano")');
});
