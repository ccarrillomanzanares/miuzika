import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BST,
  ETIQUETAS,
  etiquetaPorId,
  etiquetasDeTexto,
  etiquetasEnFrase,
} from "./taxonomia.ts";
import { buscarEnCatalogo } from "./buscar.ts";
import type { EntradaCatalogo } from "./buscar.ts";

const CATALOGO: EntradaCatalogo[] = [
  {
    clave: "kick",
    etiqueta: "Bombo sintético",
    familia: "percusión",
    descripcion: "Bombo con caída de tono.",
    destino: "cpu",
    taxonomia: "bombo",
    perfil: { duracion_s: 0.6, centroide_hz: 391, crest_db: 6.9, cola_ms: 517 },
  },
  {
    clave: "kit_bombo",
    etiqueta: "Bombo de batería",
    familia: "percusión",
    descripcion: "Bombo con cuerpo y click.",
    destino: "gpu",
    taxonomia: "bombo",
    perfil: { duracion_s: 0.75, centroide_hz: 84, crest_db: 5.5, cola_ms: 700 },
  },
  {
    clave: "kit_china",
    etiqueta: "Plato china",
    familia: "percusión",
    descripcion: "China sucio con cola gated.",
    destino: "gpu",
    taxonomia: "china",
    perfil: { duracion_s: 2.2, centroide_hz: 8730, crest_db: 8.4, cola_ms: 2196 },
  },
  {
    clave: "piano_note",
    etiqueta: "Piano",
    familia: "tonal",
    descripcion: "Piano sintético.",
    destino: "cpu",
    taxonomia: "piano",
    perfil: { duracion_s: 1.6, centroide_hz: 518, crest_db: 11.2, cola_ms: 1509 },
  },
];

test("the taxonomy covers the percussion of the GM map", () => {
  const gm = ETIQUETAS.filter((e) => e.gm !== undefined).map((e) => e.gm as number);
  for (const nota of [36, 38, 39, 42, 46, 49, 51, 52, 55, 56, 60, 70, 75, 81]) {
    assert.ok(gm.includes(nota), `missing GM note ${nota}`);
  }
  // No repeated note: one number, one name.
  assert.equal(new Set(gm).size, gm.length);
});

test("every tag has an English name, a valid BST, and at least one alias", () => {
  const bstValidas = new Set(ETIQUETAS.map((e) => e.bst));
  for (const etiqueta of ETIQUETAS) {
    assert.ok(etiqueta.en.length > 1, `no English name: ${etiqueta.id}`);
    assert.ok(bstValidas.has(etiqueta.bst), `odd BST in ${etiqueta.id}`);
    assert.ok(etiqueta.alias.length > 0, `no alias: ${etiqueta.id}`);
  }
  for (const clave of bstValidas) assert.ok(BST[clave], `undescribed BST: ${clave}`);
});

test("regionalisms find the right tag", () => {
  assert.equal(etiquetasDeTexto("tarola")[0]?.id, "caja");
  assert.equal(etiquetasDeTexto("redoblante")[0]?.id, "caja");
  assert.equal(etiquetasDeTexto("hi-hat")[0]?.id, "charles");
  assert.equal(etiquetasDeTexto("platillo crash")[0]?.id, "crash");
  assert.equal(etiquetaPorId("bombo")?.gm, 36);
});

test("the tags that appear come out of a phrase", () => {
  const ids = etiquetasEnFrase("quiero un china sucio y un bombo corto").map((e) => e.id);
  assert.ok(ids.includes("china"));
  assert.ok(ids.includes("bombo"));
  // "charles abierto" must not also resolve as "charles" and "abierto".
  const abierto = etiquetasEnFrase("charles abierto").map((e) => e.id);
  assert.ok(abierto.includes("charles-abierto"), abierto.join(","));
});

test('searching "bombo" returns the kicks, not the piano', () => {
  const r = buscarEnCatalogo(CATALOGO, "un bombo");
  assert.ok(r.length >= 2);
  assert.ok(r.every((x) => x.entrada.familia === "percusión"));
  assert.equal(r[0].entrada.taxonomia, "bombo");
  assert.ok(r[0].motivos.some((m) => m.includes("bombo")));
});

test('character filters: "un bombo corto" prefers the 0.6 s one', () => {
  const r = buscarEnCatalogo(CATALOGO, "bombo corto");
  assert.equal(r[0].entrada.clave, "kick", r.map((x) => `${x.entrada.clave}:${x.puntuacion}`).join(" "));
  assert.ok(r[0].motivos.some((m) => m.includes("corto")));
});

test('"china brillante" does not bring up the piano even if it is bright', () => {
  const r = buscarEnCatalogo(CATALOGO, "un china brillante");
  assert.equal(r[0].entrada.clave, "kit_china");
  assert.ok(!r.some((x) => x.entrada.clave === "piano_note" && x.puntuacion > 10));
});

test("searching for something that does not exist returns empty, not junk", () => {
  assert.deepEqual(buscarEnCatalogo(CATALOGO, "theremin"), []);
});

test("the options narrow by family and by number", () => {
  const r = buscarEnCatalogo(CATALOGO, "algo", { familia: "percusión", limite: 1 });
  assert.ok(r.length <= 1);
  assert.ok(r.every((x) => x.entrada.familia === "percusión"));
});
