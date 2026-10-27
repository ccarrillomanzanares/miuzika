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

test("la taxonomía cubre la percusión del mapa GM", () => {
  const gm = ETIQUETAS.filter((e) => e.gm !== undefined).map((e) => e.gm as number);
  for (const nota of [36, 38, 39, 42, 46, 49, 51, 52, 55, 56, 60, 70, 75, 81]) {
    assert.ok(gm.includes(nota), `falta la nota GM ${nota}`);
  }
  // Ninguna nota repetida: un número, un nombre.
  assert.equal(new Set(gm).size, gm.length);
});

test("cada etiqueta tiene nombre en inglés, BST válida y al menos un alias", () => {
  const bstValidas = new Set(ETIQUETAS.map((e) => e.bst));
  for (const etiqueta of ETIQUETAS) {
    assert.ok(etiqueta.en.length > 1, `sin nombre en inglés: ${etiqueta.id}`);
    assert.ok(bstValidas.has(etiqueta.bst), `BST rara en ${etiqueta.id}`);
    assert.ok(etiqueta.alias.length > 0, `sin alias: ${etiqueta.id}`);
  }
  for (const clave of bstValidas) assert.ok(BST[clave], `BST sin describir: ${clave}`);
});

test("los regionalismos encuentran la etiqueta correcta", () => {
  assert.equal(etiquetasDeTexto("tarola")[0]?.id, "caja");
  assert.equal(etiquetasDeTexto("redoblante")[0]?.id, "caja");
  assert.equal(etiquetasDeTexto("hi-hat")[0]?.id, "charles");
  assert.equal(etiquetasDeTexto("platillo crash")[0]?.id, "crash");
  assert.equal(etiquetaPorId("bombo")?.gm, 36);
});

test("de una frase salen las etiquetas que aparecen", () => {
  const ids = etiquetasEnFrase("quiero un china sucio y un bombo corto").map((e) => e.id);
  assert.ok(ids.includes("china"));
  assert.ok(ids.includes("bombo"));
  // «charles abierto» no debe resolverse también como «charles» y «abierto».
  const abierto = etiquetasEnFrase("charles abierto").map((e) => e.id);
  assert.ok(abierto.includes("charles-abierto"), abierto.join(","));
});

test("buscar «bombo» devuelve los bombos, no el piano", () => {
  const r = buscarEnCatalogo(CATALOGO, "un bombo");
  assert.ok(r.length >= 2);
  assert.ok(r.every((x) => x.entrada.familia === "percusión"));
  assert.equal(r[0].entrada.taxonomia, "bombo");
  assert.ok(r[0].motivos.some((m) => m.includes("bombo")));
});

test("el carácter filtra: «un bombo corto» prefiere el de 0,6 s", () => {
  const r = buscarEnCatalogo(CATALOGO, "bombo corto");
  assert.equal(r[0].entrada.clave, "kick", r.map((x) => `${x.entrada.clave}:${x.puntuacion}`).join(" "));
  assert.ok(r[0].motivos.some((m) => m.includes("corto")));
});

test("«china brillante» no saca el piano aunque sea brillante", () => {
  const r = buscarEnCatalogo(CATALOGO, "un china brillante");
  assert.equal(r[0].entrada.clave, "kit_china");
  assert.ok(!r.some((x) => x.entrada.clave === "piano_note" && x.puntuacion > 10));
});

test("buscar algo que no existe devuelve vacío, no basura", () => {
  assert.deepEqual(buscarEnCatalogo(CATALOGO, "theremin"), []);
});

test("las opciones acotan por familia y por número", () => {
  const r = buscarEnCatalogo(CATALOGO, "algo", { familia: "percusión", limite: 1 });
  assert.ok(r.length <= 1);
  assert.ok(r.every((x) => x.entrada.familia === "percusión"));
});
