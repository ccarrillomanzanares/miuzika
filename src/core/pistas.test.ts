import { test } from "node:test";
import assert from "node:assert/strict";

import { buscarPista } from "./pistas.ts";

const pistas = [
  { id: "trk_bateria_ab12", name: "Batería oscura" },
  { id: "trk_organo_cd34", name: "Órgano" },
  { id: "trk_bajo_ef56", name: "Bajo" },
  { id: "trk_x1", name: "Coro" },
  { id: "trk_x2", name: "Coro" },
];

test("id, name without accents or case, id prefix and index", () => {
  assert.equal(buscarPista(pistas, "trk_bajo_ef56")?.name, "Bajo");
  assert.equal(buscarPista(pistas, "  organo ")?.id, "trk_organo_cd34", "the accent no longer hides it (ops missed it before)");
  assert.equal(buscarPista(pistas, "trk_bateria")?.id, "trk_bateria_ab12");
  assert.equal(buscarPista(pistas, "pista 3")?.name, "Bajo");
  assert.equal(buscarPista(pistas, "2")?.name, "Órgano");
  assert.equal(buscarPista(pistas, ""), undefined);
});

test("part of a name only when asked, and only if it is unique", () => {
  assert.equal(buscarPista(pistas, "Batería"), undefined, "editing does not guess");
  assert.equal(buscarPista(pistas, "Batería", { parcial: true })?.id, "trk_bateria_ab12");
  assert.equal(buscarPista(pistas, "guitarra", { parcial: true }), undefined);
  assert.equal(buscarPista(pistas, "bajo y más", { parcial: true })?.name, "Bajo", "the name inside the request also counts");
  assert.equal(buscarPista(pistas, "o", { parcial: true }), undefined, "several contain it: none");
});

test("a name shared by two tracks finds neither, even with parcial", () => {
  assert.equal(buscarPista(pistas, "Coro"), undefined);
  assert.equal(buscarPista(pistas, "coro", { parcial: true }), undefined);
  assert.equal(buscarPista(pistas, "trk_x2")?.id, "trk_x2", "the id still does");
});
