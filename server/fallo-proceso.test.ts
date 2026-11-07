import { test } from "node:test";
import assert from "node:assert/strict";

import { explicarFalloMudo } from "./fallo-proceso.ts";

test("a silent Windows DLL-init failure says Python did not start", () => {
  // 2-Nov night: every Python child exited 3221225794 with empty stderr.
  const texto = explicarFalloMudo(3221225794, "", "");
  assert.match(texto, /0xC0000142/);
  assert.match(texto, /Python could not start/);
});

test("real stderr and successes pass through untouched", () => {
  assert.equal(explicarFalloMudo(1, "", "Traceback ..."), "Traceback ...");
  assert.equal(explicarFalloMudo(0, "", ""), "");
  assert.match(explicarFalloMudo(2, "", ""), /code 2 \(0x00000002\)/);
});
