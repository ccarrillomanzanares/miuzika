import assert from "node:assert/strict";
import { test } from "node:test";
import { crearDetectorDoble } from "./doble-pulsacion.ts";

test("two presses inside the window are a double; far apart they are two singles", () => {
  const doble = crearDetectorDoble(350);
  assert.equal(doble(1000), false);
  assert.equal(doble(1300), true);
  const otro = crearDetectorDoble(350);
  assert.equal(otro(1000), false);
  assert.equal(otro(1500), false);
});

test("a third quick press starts over instead of stopping again", () => {
  const doble = crearDetectorDoble(350);
  assert.equal(doble(1000), false);
  assert.equal(doble(1100), true);
  assert.equal(doble(1200), false);
  assert.equal(doble(1300), true);
});
