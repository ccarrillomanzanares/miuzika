import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalPitchClass,
  chordToMidi,
  diatonicTriad,
  parseChord,
  pitchClass,
} from "./theory.ts";

test("pitchClass understands solfège and accidentals", () => {
  assert.equal(pitchClass("re"), 2);
  assert.equal(pitchClass("si"), 11);
  assert.equal(pitchClass("F#"), 6);
  assert.equal(pitchClass("Bb"), 10);
  assert.equal(pitchClass("C"), 0);
  assert.equal(canonicalPitchClass("Db"), "C#");
});

test("parseChord accepts qualities and slash chords", () => {
  const chord = parseChord("Bbm7");
  assert.equal(chord.root, 10);
  assert.deepEqual([...chord.intervals], [0, 3, 7, 10]);
  const slash = parseChord("Am/E");
  assert.equal(slash.root, 9);
  assert.equal(slash.bass, 4);
  assert.throws(() => parseChord("Hm"), /invalid/i);
  assert.throws(() => parseChord("Cwat"), /quality/i);
});

test("chordToMidi generates ascending voicings and inversions", () => {
  const chord = parseChord("Dm");
  assert.deepEqual(chordToMidi(chord, 3), [50, 53, 57]);
  const inverted = chordToMidi(chord, 3, 1);
  assert.deepEqual(inverted, [53, 57, 62]);
  assert.ok(inverted.every((pitch, index) => index === 0 || pitch > inverted[index - 1]!));
});

test("diatonic triads in D minor", () => {
  const dMinor = { tonic: "D", mode: "minor" as const };
  assert.equal(diatonicTriad(dMinor, 0), "Dm");
  assert.equal(diatonicTriad(dMinor, 1), "Edim");
  assert.equal(diatonicTriad(dMinor, 2), "F");
  assert.equal(diatonicTriad(dMinor, 5), "Bb");
  assert.equal(diatonicTriad(dMinor, 6), "C");
});


test("degree 2 is the third (III), not the fourth", () => {
  assert.equal(diatonicTriad({ tonic: "C", mode: "major" }, 2), "Em");
  assert.equal(diatonicTriad({ tonic: "F", mode: "minor" }, 5), "Db");
});
