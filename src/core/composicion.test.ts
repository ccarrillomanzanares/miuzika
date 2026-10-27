import assert from "node:assert/strict";
import test from "node:test";
import { acordesDe, notasDeProgresion } from "./composicion.ts";

const LA_MENOR = { tonic: "A", mode: "minor" as const };
const DO_MAYOR = { tonic: "C", mode: "major" as const };

test("los grados salen de la escala del proyecto", () => {
  assert.deepEqual(acordesDe(DO_MAYOR, { grados: [1, 6, 4, 5] }), ["C", "Am", "F", "G"]);
  assert.deepEqual(acordesDe(LA_MENOR, { grados: [1, 6, 3, 7] }), ["Am", "F", "C", "G"]);
});

test("los símbolos mandan sobre los grados y se validan", () => {
  assert.deepEqual(acordesDe(DO_MAYOR, { acordes: ["Dm7", "G7", "Cmaj7"], grados: [1] }), ["Dm7", "G7", "Cmaj7"]);
  assert.throws(() => acordesDe(DO_MAYOR, { acordes: ["Hm"] }));
  assert.throws(() => acordesDe(DO_MAYOR, { grados: [9] }));
  assert.throws(() => acordesDe(DO_MAYOR, {}));
});

test("bloque: un acorde por compás, notas del acorde", () => {
  const r = notasDeProgresion(DO_MAYOR, 4, { grados: [1, 5], patron: "bloque" });
  assert.equal(r.beats, 8);
  const primero = r.notas.filter((n) => n.start === 0).map((n) => n.pitch % 12).sort((a, b) => a - b);
  assert.deepEqual(primero, [0, 4, 7]);
  assert.ok(r.notas.every((n) => n.start + n.duration <= 8));
});

test("conducción de voces: el segundo acorde no salta de registro", () => {
  const r = notasDeProgresion(DO_MAYOR, 4, { acordes: ["C", "F", "G", "C"], patron: "bloque" });
  const medias = [0, 4, 8, 12].map((t) => {
    const ns = r.notas.filter((n) => n.start === t).map((n) => n.pitch);
    return ns.reduce((a, b) => a + b, 0) / ns.length;
  });
  for (let i = 1; i < medias.length; i += 1) {
    assert.ok(Math.abs(medias[i]! - medias[i - 1]!) <= 4, `salto de ${medias[i - 1]} a ${medias[i]}`);
  }
});

test("bajo: fundamental (o el bajo del acorde con barra) en la octava 2", () => {
  const r = notasDeProgresion(DO_MAYOR, 4, { acordes: ["C", "C/E"], patron: "bajo" });
  assert.equal(r.notas[0]!.pitch, 36);
  assert.equal(r.notas.find((n) => n.start === 4)!.pitch, 40);
  assert.equal(r.notas.length, 8); // una por negra
});

test("arpegio y pulso respetan el paso y las repeticiones", () => {
  const arp = notasDeProgresion(DO_MAYOR, 4, { acordes: ["C"], patron: "arpegio", paso: 0.5 });
  assert.equal(arp.notas.length, 8);
  const pulso = notasDeProgresion(DO_MAYOR, 4, { acordes: ["C", "G"], patron: "pulso", paso: 1, repeticiones: 2 });
  assert.equal(pulso.beats, 16);
  assert.equal(pulso.notas.length, 16 * 3);
  assert.ok(pulso.notas.every((n) => n.velocity >= 1 && n.velocity <= 127));
});
