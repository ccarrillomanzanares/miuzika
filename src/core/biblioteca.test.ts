import assert from "node:assert/strict";
import test from "node:test";
import { instrumentosDeSfz, resolverInstrumento, textoDeBiblioteca } from "./biblioteca.ts";

const RAIZ = "catalogo/VCSL-1.2.2-RC";
const RUTAS = [
  `${RAIZ}/Chordophones/Zithers/Grand Piano, Steinway B.sfz`,
  `${RAIZ}/Chordophones/Zithers/Grand Piano, Kawai.sfz`,
  `${RAIZ}/Chordophones/Zithers/Grand Piano, Kawai - Legacy.sfz`,
  `${RAIZ}/Aerophones/Edge-blown Aerophones/Pipe Organ - Loud.sfz`,
  `${RAIZ}/Aerophones/Edge-blown Aerophones/Pipe Organ - Quiet.sfz`,
  `${RAIZ}/Aerophones/Edge-blown Aerophones/Pipe Organ - Keyswitch.sfz`,
  `${RAIZ}/Aerophones/Reed Aerophones/Tenor Saxophone - Vibrato.sfz`,
  `${RAIZ}/Idiophones/Struck Idiophones/Vibraphone - Soft Mallets.sfz`,
  `${RAIZ}/Membranophones/Struck Membranophones/Conga.sfz`,
  `${RAIZ}/README.md`,
];

test("la lista agrupa por familia y quita keyswitch y legacy", () => {
  const instrumentos = instrumentosDeSfz(RUTAS);
  assert.equal(instrumentos.length, 7);
  const texto = textoDeBiblioteca(instrumentos);
  assert.match(texto, /Pianos y teclados: Grand Piano, Kawai · Grand Piano, Steinway B/);
  assert.match(texto, /Órganos: Pipe Organ - Loud\/Quiet/);
  assert.match(texto, /Láminas y campanas: Vibraphone - Soft Mallets/);
  assert.match(texto, /Percusión: Conga/);
  assert.doesNotMatch(texto, /Keyswitch|Legacy/);
});

test("el nombre se resuelve sin ruta, sin mayúsculas y por su base", () => {
  const instrumentos = instrumentosDeSfz(RUTAS);
  assert.equal(resolverInstrumento("grand piano, steinway b", instrumentos).instrumento?.ruta, RUTAS[0]);
  assert.equal(resolverInstrumento("Pipe Organ", instrumentos).instrumento?.nombre, "Pipe Organ - Quiet");
  assert.equal(resolverInstrumento("steinway", instrumentos).instrumento?.nombre, "Grand Piano, Steinway B");
  assert.equal(resolverInstrumento(RUTAS[6]!, instrumentos).instrumento?.nombre, "Tenor Saxophone - Vibrato");
  assert.match(resolverInstrumento("Grand Piano", instrumentos).error ?? "", /encaja con varios/);
  assert.match(resolverInstrumento("theremin", instrumentos).error ?? "", /No hay ningún instrumento/);
});
