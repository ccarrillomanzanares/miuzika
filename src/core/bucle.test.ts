import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCIONES,
  CapasBucle,
  ESQUEMAS,
  accionDeTecla,
  asignarTecla,
  esquemaDe,
  leerMapa,
  nombreTecla,
  notasDelTeclado,
  pasosDeRepeticion,
} from "./bucle.ts";

test("each pass is a layer that sounds from the next pass on", () => {
  const capas = new CapasBucle(8); // 2 bars of 4/4
  capas.pulsar("bat", "k1", 36, 100, 0.02); // pass 0: kick, a bit late
  capas.soltar("k1", 0.3);
  capas.anotar("bat", 38, 90, 8 + 4, 8 + 4.2); // pass 1: snare on beat 4
  // During pass 0 nothing of the loop sounds (it was heard live).
  assert.deepEqual(capas.sonarEntre(0, 7.99), []);
  // Pass 1: the kick, not the snare (recorded in pass 1).
  const p1 = capas.sonarEntre(7.99, 15.99).filter((e) => e.velocidad > 0);
  assert.deepEqual(p1.map((e) => [e.pitch, e.beat]), [[36, 8.02]]);
  // Pass 2: both.
  const p2 = capas.sonarEntre(15.99, 23.99).filter((e) => e.velocidad > 0);
  assert.deepEqual(p2.map((e) => [e.pitch, e.beat]), [[36, 16.02], [38, 20]]);
  assert.equal(capas.capas, 2);
  // The clip: positions inside the loop, real times (no quantize).
  assert.deepEqual(capas.notasDe("bat"), [
    { pitch: 36, start: 0.02, duration: 0.28, velocity: 100 },
    { pitch: 38, start: 4, duration: 0.2, velocity: 90 },
  ]);
});

test("undo takes away the last layer only", () => {
  const capas = new CapasBucle(4);
  capas.anotar("a", 60, 100, 0, 0.5);
  capas.anotar("a", 62, 100, 4 + 1, 4 + 1.5);
  capas.anotar("a", 64, 100, 4 + 2, 4 + 2.5);
  assert.equal(capas.deshacer(), 2);
  assert.deepEqual(capas.notasDe("a").map((n) => n.pitch), [60]);
  assert.equal(capas.deshacer(), 1);
  assert.equal(capas.deshacer(), 0);
  assert.ok(capas.vacia);
});

test("quantize, the count-in and the loop end", () => {
  const capas = new CapasBucle(4, 0.25);
  capas.anotar("a", 60, 100, 1.13, 1.4); // → 1.25
  capas.anotar("a", 61, 100, -0.1, 0.2); // early on the downbeat → 0
  capas.anotar("a", 62, 100, -2, -1.5); // in the middle of the count-in: dropped
  capas.anotar("a", 63, 100, 3.5, 6); // held across the end: cut at 4
  assert.deepEqual(
    capas.notasDe("a").map((n) => [n.pitch, n.start, n.duration]),
    [[61, 0, 0.2], [60, 1.25, 0.27], [63, 3.5, 0.5]],
  );
  // Snapped forward onto the next downbeat: sounds at 0 but from two passes later, so the live hit is not doubled.
  const otra = new CapasBucle(4, 0.25);
  otra.anotar("a", 36, 100, 3.95, 4.1);
  assert.deepEqual(otra.notasDe("a").map((n) => n.start), [0]);
  assert.deepEqual(otra.sonarEntre(3.9, 4.1), []);
  assert.deepEqual(otra.sonarEntre(7.9, 8.1).map((e) => e.beat), [8]);
});

test("erase while it plays removes only that pitch in the crossed stretch, also across the loop end", () => {
  const capas = new CapasBucle(4);
  for (const b of [0, 1, 2, 3]) capas.anotar("a", 42, 80, b, b + 0.1);
  capas.anotar("a", 36, 100, 1, 1.1);
  assert.equal(capas.borrar("a", 42, 4 + 0.5, 4 + 2.5), 2); // the hats at 1 and 2
  assert.equal(capas.borrar("a", 42, 4 + 3.5, 8 + 0.5), 1); // the hat at 0, across the end
  assert.deepEqual(capas.notasDe("a").map((n) => [n.pitch, n.start]), [[36, 1], [42, 3]]);
});

test("offs come before ons at the same beat, and a full-length note is released before it restarts", () => {
  const capas = new CapasBucle(1);
  capas.anotar("a", 60, 100, 0, 5);
  const ev = capas.sonarEntre(0.5, 2.5);
  assert.deepEqual(ev.map((e) => [e.velocidad > 0 ? "on" : "off", e.beat]), [["on", 1], ["off", 1.999], ["on", 2]]);
});

test("no loop: a free take never repeats", () => {
  const capas = new CapasBucle(Infinity);
  capas.anotar("a", 60, 100, 9.5, 10);
  assert.deepEqual(capas.sonarEntre(0, 1000), []);
  assert.deepEqual(capas.notasDe("a").map((n) => n.start), [9.5]);
});

test("note repeat steps fall on the grid from the loop start", () => {
  assert.deepEqual(pasosDeRepeticion(0.9, 1.6, 0.25), [1, 1.25, 1.5]);
  assert.deepEqual(pasosDeRepeticion(1, 1, 0.25), []);
});

test("the keyboard plays the scale of the project, or nine drum pieces", () => {
  const re = notasDelTeclado(false, { tonic: "D", mode: "minor" }, 4);
  assert.deepEqual(re.map((n) => n.etiqueta), ["D4", "E4", "F4", "G4", "A4", "Bb4", "C5", "D5", "E5"]);
  const bat = notasDelTeclado(true, { tonic: "D", mode: "minor" }, 4);
  assert.equal(bat[0]!.nota, 36);
  assert.equal(bat.length, 9);
});

test("keys: presets, reassigning and reading back", () => {
  assert.equal(accionDeTecla(ESQUEMAS.numerico, "Numpad7"), "nota7");
  assert.equal(accionDeTecla(ESQUEMAS.letras, "KeyZ"), "nota1");
  assert.equal(accionDeTecla(ESQUEMAS.numerico, "KeyZ"), null);
  // Each preset uses every key once.
  for (const mapa of Object.values(ESQUEMAS)) assert.equal(new Set(ACCIONES.map((a) => mapa[a])).size, ACCIONES.length);
  // Giving a used key to another action takes it from the first.
  const mapa = asignarTecla(ESQUEMAS.numerico, "grabar", "Numpad0");
  assert.equal(mapa.grabar, "Numpad0");
  assert.equal(mapa.reproducir, "");
  assert.equal(esquemaDe(mapa), null);
  assert.equal(esquemaDe(ESQUEMAS.letras), "letras");
  assert.deepEqual(leerMapa(JSON.stringify(mapa)), mapa);
  assert.deepEqual(leerMapa("{roto"), ESQUEMAS.numerico);
  assert.equal(nombreTecla("NumpadEnter"), "Enter");
  assert.equal(nombreTecla("KeyQ"), "Q");
});
