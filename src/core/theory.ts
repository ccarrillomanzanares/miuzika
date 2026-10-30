/** Minimal but sufficient music theory: scales, chords, and voicings. */

import type { KeySignature, Mode } from "./types.ts";

class MusicError extends Error {}

const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const LETTER_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Spanish names that people write in prompts. */
const SOLFEGE: Record<string, string> = {
  do: "C",
  re: "D",
  mi: "E",
  fa: "F",
  sol: "G",
  la: "A",
  si: "B",
};

const SCALES: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMinor: [0, 3, 5, 7, 10],
};

export const MODES = Object.keys(SCALES) as Mode[];

/** Scale intervals of a mode, in semitones from the tonic. */
export function intervalosDe(mode: Mode): readonly number[] {
  return SCALES[mode] ?? SCALES.major;
}

/** Tuple for `z.enum`. */
export const MODE_NAMES = Object.keys(SCALES) as [Mode, ...Mode[]];

export function pitchClass(name: string): number {
  const cleaned = name.trim();
  const solfege = SOLFEGE[cleaned.toLowerCase()];
  const source = solfege ?? cleaned;
  const match = /^([A-Ga-g])([#b]{0,2})$/.exec(source);
  if (!match) throw new MusicError(`Invalid note: "${name}"`);
  const letter = match[1]!.toUpperCase();
  let semitones = LETTER_SEMITONES[letter]!;
  for (const char of match[2] ?? "") semitones += char === "#" ? 1 : -1;
  return ((semitones % 12) + 12) % 12;
}

export function canonicalPitchClass(name: string): string {
  return PITCH_CLASSES[pitchClass(name)]!;
}

/** Semitones from the tonic for a degree (0 = tonic, 7 = octave). */
function degreeToSemitones(mode: Mode, degree: number): number {
  const scale = SCALES[mode];
  const size = scale.length;
  const octave = Math.floor(degree / size);
  const index = ((degree % size) + size) % size;
  return octave * 12 + scale[index]!;
}

const CHORD_QUALITIES: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  "5": [0, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  "11": [0, 4, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
};

interface Chord {
  symbol: string;
  /** Pitch class of the root. */
  root: number;
  intervals: readonly number[];
  /** Alternate bass (slash chord). */
  bass?: number;
}

export function parseChord(symbol: string): Chord {
  const cleaned = symbol.replace(/\s+/g, "");
  const [head, bassPart] = cleaned.split("/");
  if (!head) throw new MusicError(`Invalid chord: "${symbol}"`);
  const match = /^([A-Ga-g])([#b]?)(.*)$/.exec(head);
  if (!match) throw new MusicError(`Invalid chord: "${symbol}"`);
  const root = pitchClass(`${match[1]}${match[2] ?? ""}`);
  const quality = (match[3] ?? "").toLowerCase();
  const intervals = CHORD_QUALITIES[quality];
  if (!intervals) throw new MusicError(`Unknown chord quality: "${quality}" in "${symbol}"`);
  const chord: Chord = { symbol: cleaned, root, intervals };
  if (bassPart) chord.bass = pitchClass(bassPart);
  return chord;
}

/** Ascending voicing. `octave` is the octave of the root. */
export function chordToMidi(chord: Chord, octave: number, inversion = 0): number[] {
  const base = (octave + 1) * 12 + chord.root;
  let pitches = chord.intervals.map((interval) => base + interval);
  for (let i = 0; i < inversion % pitches.length; i++) {
    const lowest = pitches.shift();
    if (lowest !== undefined) pitches.push(lowest + 12);
  }
  return pitches;
}


/** Flat names for flat keys (more readable than A#). */
const MAJOR_SIGNATURE_BY_PC: Record<number, number> = {
  0: 0, // C
  1: 7, // C#
  2: 2, // D
  3: -3, // Eb
  4: 4, // E
  5: -1, // F
  6: 6, // F#
  7: 1, // G
  8: -4, // Ab
  9: 3, // A
  10: -2, // Bb
  11: 5, // B
};

/** Key signature: positive = sharps, negative = flats. */
function keyAccidentals(key: KeySignature): number {
  const pc = pitchClass(key.tonic);
  if (key.mode === "major") return MAJOR_SIGNATURE_BY_PC[pc] ?? 0;
  if (key.mode === "minor" || key.mode === "harmonicMinor") {
    return MAJOR_SIGNATURE_BY_PC[(pc + 3) % 12] ?? 0;
  }
  return 0;
}

function prefersFlats(key: KeySignature): boolean {
  return keyAccidentals(key) < 0;
}

const FLAT_PITCH_CLASSES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

function pitchClassName(pc: number, flats: boolean): string {
  const normalized = ((pc % 12) + 12) % 12;
  return flats ? FLAT_PITCH_CLASSES[normalized]! : PITCH_CLASSES[normalized]!;
}

/**
 * Diatonic triad of a degree (0 = tonic). The quality comes from the scale,
 * so a degree-based progression works in any key.
 */
export function diatonicTriad(key: KeySignature, degree: number): string {
  const rootSemitones = degreeToSemitones(key.mode, degree);
  const third = degreeToSemitones(key.mode, degree + 2) - rootSemitones;
  const fifth = degreeToSemitones(key.mode, degree + 4) - rootSemitones;
  const quality = third === 3 ? (fifth === 6 ? "dim" : "m") : fifth === 8 ? "aug" : "";
  const pc = (pitchClass(key.tonic) + rootSemitones) % 12;
  return `${pitchClassName(pc, prefersFlats(key))}${quality}`;
}

