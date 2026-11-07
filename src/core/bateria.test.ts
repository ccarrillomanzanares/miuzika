import { test } from "node:test";
import assert from "node:assert/strict";

import { KIT_POR_DEFECTO, notaDePieza, piezasSinSonido } from "./bateria.ts";

test("the pieces the default kit cannot play are named", () => {
  // Review 3-Nov, bug 6: 13 samples in the Playfield kit, 21 named pieces.
  assert.deepEqual(piezasSinSonido(["kick", "snare", "hat", "lowtom", "midtom", "crash"]), []);
  assert.deepEqual(
    piezasSinSonido(["Floor tom", "hightom", "shaker", "36"]).map((p) => [p.pieza, p.nota]),
    [
      ["Floor tom", 41],
      ["hightom", 50],
      ["shaker", 70],
    ],
  );
});

test("every sample of the default kit is reachable by name or number", () => {
  for (const k of KIT_POR_DEFECTO) assert.equal(notaDePieza(String(k.note)), k.note);
  assert.equal(new Set(KIT_POR_DEFECTO.map((k) => k.note)).size, 13);
});
