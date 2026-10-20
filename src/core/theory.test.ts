import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalPitchClass,
  chordToMidi,
  degreeOfPitchClass,
  diatonicTriad,
  noteToMidi,
  parseChord,
  pitchClass,
  progressionFromDegrees,
} from "./theory.ts";
import { normalizeKey } from "./theory.ts";

test("pitchClass entiende solfeo y alteraciones", () => {
  assert.equal(pitchClass("re"), 2);
  assert.equal(pitchClass("si"), 11);
  assert.equal(pitchClass("F#"), 6);
  assert.equal(pitchClass("Bb"), 10);
  assert.equal(pitchClass("C"), 0);
  assert.equal(canonicalPitchClass("Db"), "C#");
});

test("noteToMidi usa C4 = 60", () => {
  assert.equal(noteToMidi("C", 4), 60);
  assert.equal(noteToMidi("A", 4), 69);
  assert.equal(noteToMidi("D", 2), 38);
});

test("parseChord admite calidades y acordes con barra", () => {
  const chord = parseChord("Bbm7");
  assert.equal(chord.root, 10);
  assert.deepEqual([...chord.intervals], [0, 3, 7, 10]);
  const slash = parseChord("Am/E");
  assert.equal(slash.root, 9);
  assert.equal(slash.bass, 4);
  assert.throws(() => parseChord("Hm"), /no válido/i);
  assert.throws(() => parseChord("Cwat"), /Calidad/i);
});

test("chordToMidi genera voicings ascendentes e inversiones", () => {
  const chord = parseChord("Dm");
  assert.deepEqual(chordToMidi(chord, 3), [50, 53, 57]);
  const inverted = chordToMidi(chord, 3, 1);
  assert.deepEqual(inverted, [53, 57, 62]);
  assert.ok(inverted.every((pitch, index) => index === 0 || pitch > inverted[index - 1]!));
});

test("tríadas diatónicas en re menor", () => {
  const dMinor = normalizeKey({ tonic: "D", mode: "minor" });
  assert.equal(diatonicTriad(dMinor, 0), "Dm");
  assert.equal(diatonicTriad(dMinor, 1), "Edim");
  assert.equal(diatonicTriad(dMinor, 2), "F");
  assert.equal(diatonicTriad(dMinor, 5), "Bb");
  assert.equal(diatonicTriad(dMinor, 6), "C");
});

test("progresión por grados se adapta a la tonalidad", () => {
  const cMajor = normalizeKey({ tonic: "C", mode: "major" });
  // En mayor: I - vi - IV - V
  assert.deepEqual(progressionFromDegrees(cMajor, [0, 5, 3, 4]), ["C", "Am", "F", "G"]);
  // El grado 2 es la tercera (III), no la cuarta.
  assert.equal(diatonicTriad(cMajor, 2), "Em");
  const fMinor = normalizeKey({ tonic: "F", mode: "minor" });
  assert.deepEqual(progressionFromDegrees(fMinor, [0, 5, 2, 6]), ["Fm", "Db", "Ab", "Eb"]);
});

test("degreeOfPitchClass identifica grados y cromatismos", () => {
  const dMinor = normalizeKey({ tonic: "D", mode: "minor" });
  assert.equal(degreeOfPitchClass(dMinor, pitchClass("D")), 0);
  assert.equal(degreeOfPitchClass(dMinor, pitchClass("F")), 2);
  assert.equal(degreeOfPitchClass(dMinor, pitchClass("C#")), null);
});
