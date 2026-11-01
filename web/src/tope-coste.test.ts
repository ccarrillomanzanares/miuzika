import { test } from "node:test";
import assert from "node:assert/strict";

import { motivoDeTope } from "./tope-coste.ts";
import { fijarIdioma, olvidarIdioma } from "./i18n.ts";

test("motivoDeTope: nothing while under the cap, with no cap, or with an unknown rate", () => {
  assert.equal(motivoDeTope(0.03, 0.5), null);
  assert.equal(motivoDeTope(3, null), null);
  assert.equal(motivoDeTope(null, 0.5), null);
});

test("motivoDeTope: the notice names both numbers", () => {
  fijarIdioma("en");
  const aviso = motivoDeTope(0.52, 0.5);
  assert.match(String(aviso), /I stopped: this turn has already cost \$0.52 and the cap set in Models is \$0.50\./);
  assert.match(String(aviso), /tell me “continue”/);
  fijarIdioma("es");
  assert.match(String(motivoDeTope(0.5, 0.5)), /^Me he parado: este turno ya ha costado \$0,50 y el tope puesto en Modelos es \$0,50\./);
  olvidarIdioma();
});
