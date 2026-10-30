import assert from "node:assert/strict";
import test from "node:test";
import { aNotacion, alturaDe, leerNotacion, tramosIrregulares } from "./notacion.ts";
import { notaDePieza, notasDeBateria } from "./bateria.ts";

test("pitches: letters, solfège, accidentals, and MIDI numbers", () => {
  assert.equal(alturaDe("C4"), 60);
  assert.equal(alturaDe("D2"), 38);
  assert.equal(alturaDe("Eb4"), 63);
  assert.equal(alturaDe("bb3"), 58);
  assert.equal(alturaDe("do4"), 60);
  assert.equal(alturaDe("sol#3"), 56);
  assert.equal(alturaDe("Mib2"), 39);
  assert.equal(alturaDe("F♯3"), 54);
  assert.equal(alturaDe("38"), 38);
  assert.throws(() => alturaDe("H2"));
  assert.throws(() => alturaDe("C"));
});

test("phrase: inherited durations, rests, chords, and bar lines", () => {
  const r = leerNotacion("D2:1.5 D2:.5 F2:1 Eb2 | r:2 [D3 F3 A3]:4", 90);
  assert.equal(r.beats, 10);
  assert.deepEqual(
    r.notas.map((n) => [n.pitch, n.start, n.duration]),
    [[38, 0, 1.5], [38, 1.5, 0.5], [41, 2, 1], [39, 3, 1], [50, 6, 4], [53, 6, 4], [57, 6, 4]],
  );
  assert.ok(r.notas.every((n) => n.velocity === 90));
});

test("velocity per note, triplets, a chord with +, and ties", () => {
  const r = leerNotacion("C4:1/3!120 E4 G4 C3+G3:2 A3:1~ A3:1");
  assert.equal(r.notas[0]!.velocity, 120);
  assert.equal(r.notas[1]!.velocity, 90);
  assert.ok(Math.abs(r.notas[2]!.start - 2 / 3) < 1e-3);
  const la = r.notas.filter((n) => n.pitch === 57);
  assert.equal(la.length, 1);
  assert.equal(la[0]!.duration, 2);
});

test("errors include the failing piece", () => {
  assert.throws(() => leerNotacion("D2:0"), /duration/);
  assert.throws(() => leerNotacion("[D3 F3"), /closing/);
  assert.throws(() => leerNotacion("r r"), /no notes/);
});

test("drums: names in several languages and GM notes", () => {
  assert.equal(notaDePieza("kick"), 36);
  assert.equal(notaDePieza("Caja"), 38);
  assert.equal(notaDePieza("hi-hat"), 42);
  assert.equal(notaDePieza("Charles abierto"), 46);
  assert.equal(notaDePieza("49"), 49);
  assert.throws(() => notaDePieza("gong gigante"));
});

test("grid: it repeats until the bars are filled and final changes the last one", () => {
  const r = notasDeBateria({
    patrones: { kick: "x...x...x...x...", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.x." },
    compases: 4,
    final: { snare: "....x.x.xxxxXXXX" },
  });
  assert.equal(r.beats, 16);
  const kicks = r.notas.filter((n) => n.pitch === 36);
  assert.equal(kicks.length, 16);
  const cajasUltimo = r.notas.filter((n) => n.pitch === 38 && n.start >= 12);
  assert.equal(cajasUltimo.length, 10);
  // Pieces that are not in final keep their pattern in the last bar.
  const hatsUltimo = r.notas.filter((n) => n.pitch === 42 && n.start >= 12);
  assert.equal(hatsUltimo.length, 8);
  assert.equal(r.notas.find((n) => n.pitch === 38 && n.start === 1)!.velocity, 124);
});

test("grid: swing delays odd steps and humanize is deterministic", () => {
  const a = notasDeBateria({ patrones: { hat: "xxxx" }, compases: 1, pasosPorCompas: 4, swing: 0.25, humanizar: true });
  const b = notasDeBateria({ patrones: { hat: "xxxx" }, compases: 1, pasosPorCompas: 4, swing: 0.25, humanizar: true });
  assert.deepEqual(a, b);
  assert.equal(a.notas[1]!.start, 1.25);
  assert.throws(() => notasDeBateria({ patrones: { kick: "x?x" } }), /invalid/);
});

test("aNotacion is the inverse of leerNotacion on sequential lines", () => {
  const texto = "D2:1.5 D2:.5 F2:1 Eb2 r:2 [D3 F3 A3]:4 C4:1!110";
  const ida = leerNotacion(texto);
  const vuelta = aNotacion(ida.notas)!;
  assert.deepEqual(leerNotacion(vuelta).notas, ida.notas);
  // Overlapping polyphony: it cannot be written as one line.
  assert.equal(aNotacion([
    { pitch: 60, start: 0, duration: 4, velocity: 90 },
    { pitch: 64, start: 1, duration: 1, velocity: 90 },
  ]), null);
});

test("repetitions with ( … )xN, nested, and clear errors", () => {
  const r = leerNotacion("(E2:.5 B2 E3 B2)x2 (D2:1 (A1:.5)x2)x2");
  assert.equal(r.beats, 4 + 4);
  assert.equal(r.notas.filter((n) => n.pitch === 40).length, 2);
  assert.equal(r.notas.filter((n) => n.pitch === 33).length, 4);
  assert.throws(() => leerNotacion("(E2 B2"), /parenthesis/);
  assert.throws(() => leerNotacion("(E2)x0"), /x1/);
});

test("spans between bars: a bar that does not add up is detected", () => {
  const r = leerNotacion("C4:1 D4 E4 F4 | G4:2 A4:2 B4:1 | C5:4 | D5:2");
  assert.deepEqual(r.tramos, [4, 5, 4, 2]);
  const avisos = tramosIrregulares(r.tramos, 4);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /span 2/);
  // A span of two bars with no bar line in the middle is valid.
  assert.deepEqual(tramosIrregulares([8, 4], 4), []);
});

test("a half-bar repetition does not break the bar check", () => {
  const r = leerNotacion("(E2:.5 B2 E3 B2)x4 | D2:4");
  assert.deepEqual(r.tramos, [8, 4]);
  assert.deepEqual(tramosIrregulares(r.tramos, 4), []);
});
