import { test } from "node:test";
import assert from "node:assert/strict";

import { notaDePieza } from "./bateria.ts";

test("named pieces map to their General MIDI notes", () => {
  assert.equal(notaDePieza("kick"), 36);
  assert.equal(notaDePieza("High tom"), 50);
  assert.equal(notaDePieza("Floor tom"), 41);
  assert.equal(notaDePieza("36"), 36);
});
