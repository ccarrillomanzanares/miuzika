import assert from "node:assert/strict";
import test from "node:test";
import { aNotacion, alturaDe, leerNotacion, tramosIrregulares } from "./notacion.ts";
import { notaDePieza, notasDeBateria } from "./bateria.ts";

test("alturas: letras, solfeo, alteraciones y números MIDI", () => {
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

test("frase: duraciones que se heredan, silencios, acordes y barras", () => {
  const r = leerNotacion("D2:1.5 D2:.5 F2:1 Eb2 | r:2 [D3 F3 A3]:4", 90);
  assert.equal(r.beats, 10);
  assert.deepEqual(
    r.notas.map((n) => [n.pitch, n.start, n.duration]),
    [[38, 0, 1.5], [38, 1.5, 0.5], [41, 2, 1], [39, 3, 1], [50, 6, 4], [53, 6, 4], [57, 6, 4]],
  );
  assert.ok(r.notas.every((n) => n.velocity === 90));
});

test("velocidad por nota, tresillos, acorde con + y ligaduras", () => {
  const r = leerNotacion("C4:1/3!120 E4 G4 C3+G3:2 A3:1~ A3:1");
  assert.equal(r.notas[0]!.velocity, 120);
  assert.equal(r.notas[1]!.velocity, 90);
  assert.ok(Math.abs(r.notas[2]!.start - 2 / 3) < 1e-3);
  const la = r.notas.filter((n) => n.pitch === 57);
  assert.equal(la.length, 1);
  assert.equal(la[0]!.duration, 2);
});

test("errores con el trozo que falla", () => {
  assert.throws(() => leerNotacion("D2:0"), /duración/);
  assert.throws(() => leerNotacion("[D3 F3"), /cerrar/);
  assert.throws(() => leerNotacion("r r"), /ninguna nota/);
});

test("batería: nombres en varios idiomas y notas GM", () => {
  assert.equal(notaDePieza("kick"), 36);
  assert.equal(notaDePieza("Caja"), 38);
  assert.equal(notaDePieza("hi-hat"), 42);
  assert.equal(notaDePieza("Charles abierto"), 46);
  assert.equal(notaDePieza("49"), 49);
  assert.throws(() => notaDePieza("gong gigante"));
});

test("rejilla: se repite hasta llenar los compases y el final cambia el último", () => {
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
  // Las piezas que no están en el final siguen su patrón en el último compás.
  const hatsUltimo = r.notas.filter((n) => n.pitch === 42 && n.start >= 12);
  assert.equal(hatsUltimo.length, 8);
  assert.equal(r.notas.find((n) => n.pitch === 38 && n.start === 1)!.velocity, 124);
});

test("rejilla: swing retrasa los pasos impares y humanizar es determinista", () => {
  const a = notasDeBateria({ patrones: { hat: "xxxx" }, compases: 1, pasosPorCompas: 4, swing: 0.25, humanizar: true });
  const b = notasDeBateria({ patrones: { hat: "xxxx" }, compases: 1, pasosPorCompas: 4, swing: 0.25, humanizar: true });
  assert.deepEqual(a, b);
  assert.equal(a.notas[1]!.start, 1.25);
  assert.throws(() => notasDeBateria({ patrones: { kick: "x?x" } }), /no válido/);
});

test("aNotacion es la inversa de leerNotacion en líneas secuenciales", () => {
  const texto = "D2:1.5 D2:.5 F2:1 Eb2 r:2 [D3 F3 A3]:4 C4:1!110";
  const ida = leerNotacion(texto);
  const vuelta = aNotacion(ida.notas)!;
  assert.deepEqual(leerNotacion(vuelta).notas, ida.notas);
  // Polifonía solapada: no se puede escribir como una línea.
  assert.equal(aNotacion([
    { pitch: 60, start: 0, duration: 4, velocity: 90 },
    { pitch: 64, start: 1, duration: 1, velocity: 90 },
  ]), null);
});

test("repeticiones con ( … )xN, anidadas, y errores claros", () => {
  const r = leerNotacion("(E2:.5 B2 E3 B2)x2 (D2:1 (A1:.5)x2)x2");
  assert.equal(r.beats, 4 + 4);
  assert.equal(r.notas.filter((n) => n.pitch === 40).length, 2);
  assert.equal(r.notas.filter((n) => n.pitch === 33).length, 4);
  assert.throws(() => leerNotacion("(E2 B2"), /paréntesis/);
  assert.throws(() => leerNotacion("(E2)x0"), /x1/);
});

test("tramos entre barras: se detecta el compás que no cuadra", () => {
  const r = leerNotacion("C4:1 D4 E4 F4 | G4:2 A4:2 B4:1 | C5:4 | D5:2");
  assert.deepEqual(r.tramos, [4, 5, 4, 2]);
  const avisos = tramosIrregulares(r.tramos, 4);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /tramo 2/);
  // Un tramo de dos compases sin barra en medio es válido.
  assert.deepEqual(tramosIrregulares([8, 4], 4), []);
});

test("una repetición de medio compás no rompe la comprobación de compases", () => {
  const r = leerNotacion("(E2:.5 B2 E3 B2)x4 | D2:4");
  assert.deepEqual(r.tramos, [8, 4]);
  assert.deepEqual(tramosIrregulares(r.tramos, 4), []);
});
