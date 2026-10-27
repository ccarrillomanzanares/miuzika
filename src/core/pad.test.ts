import assert from "node:assert/strict";
import test from "node:test";
import { GrabadorPad, MapeoPad, notasDeTeclas } from "./pad.ts";

test("las teclas siguen la tonalidad del proyecto", () => {
  // Si menor desde B3: B C# D E F# G A, B4 C#5 … y la tónica arriba.
  assert.deepEqual(notasDeTeclas({ tonic: "B", mode: "minor" }, 3, 1), [59, 61, 62, 64, 66, 67, 69, 71]);
  assert.equal(notasDeTeclas({ tonic: "C", mode: "major" }, 4).length, 15);
});

test("teclas: glissando sin repetir y suelta al levantar", () => {
  const mapeo = new MapeoPad({ modo: "teclas", key: { tonic: "C", mode: "major" }, octava: 4, octavas: 1 });
  const primera = mapeo.dedo("down", 0, 0.01, 1);
  assert.deepEqual(primera, [{ accion: "on", dedo: 0, nota: 60, velocidad: 127 }]);
  assert.deepEqual(mapeo.dedo("move", 0, 0.02, 0.5), []); // misma tecla
  const cambio = mapeo.dedo("move", 0, 0.99, 0);
  assert.deepEqual(cambio.map((n) => `${n.accion}${n.nota}`), ["off60", "on72"]);
  assert.equal(cambio[1]!.velocidad, 45);
  assert.deepEqual(mapeo.dedo("up", 0, 0.99, 0), [{ accion: "off", dedo: 0, nota: 72, velocidad: 0 }]);
});

test("pads: rejilla de batería GM y dos dedos a la vez", () => {
  const mapeo = new MapeoPad({ modo: "pads", key: { tonic: "C", mode: "major" }, octava: 4 });
  assert.equal(mapeo.dedo("down", 0, 0.1, 0.4)[0]!.nota, 36); // arriba izquierda: bombo
  assert.equal(mapeo.dedo("down", 1, 0.9, 0.9)[0]!.nota, 49); // abajo derecha: crash
  assert.equal(mapeo.soltarTodo().length, 2);
  assert.equal(mapeo.zonas().length, 8);
});

test("la grabación guarda los tiempos reales, sin cuadrar", () => {
  const grabador = new GrabadorPad();
  grabador.registrar({ accion: "on", dedo: 0, nota: 60, velocidad: 100 }, 0.07);
  grabador.registrar({ accion: "off", dedo: 0, nota: 60, velocidad: 0 }, 0.93);
  grabador.registrar({ accion: "on", dedo: 1, nota: 64, velocidad: 80 }, 1.51);
  const notas = grabador.terminar(2.2);
  assert.deepEqual(notas, [
    { pitch: 60, start: 0.07, duration: 0.86, velocity: 100 },
    { pitch: 64, start: 1.51, duration: 0.69, velocity: 80 },
  ]);
});
