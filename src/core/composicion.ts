/**
 * Composition as data: from a progression (symbols or degrees) to notes.
 *
 * It is the other half of `theory.ts`, which had chords, degrees, and voicings with
 * tests but nobody called it: the agent composed by writing a Python script that
 * generated a `.mid`. Here the harmony is written directly into the project, as
 * notes on a track, so it shows up in the piano roll, can be undone with Ctrl+Z, and
 * is saved in `proyecto.json` like any other edit.
 *
 * No DOM and no network: tested with `node --test`.
 */

import type { KeySignature, Note } from "./types.ts";
import { chordToMidi, diatonicTriad, parseChord } from "./theory.ts";

/** How each chord is played. */
export const PATRONES = ["bloque", "pulso", "arpegio", "bajo", "alberti"] as const;
export type Patron = (typeof PATRONES)[number];

export interface PeticionProgresion {
  /** Chord symbols: "Am", "F", "C/E", "G7", "Bbmaj7". Takes priority over `grados`. */
  acordes?: string[];
  /** Degrees of the project scale, starting at 1: [1, 6, 4, 5] = I-vi-IV-V in major. */
  grados?: number[];
  /** Bars each chord lasts (defaults to 1). */
  compasesPorAcorde?: number;
  /** Reference octave for the chord (C4 = 60). Defaults to 4; the "bajo" pattern, 2. */
  octava?: number;
  patron?: Patron;
  /** Step for pulse and arpeggio, in quarter notes (0.5 = eighth notes). Defaults to 0.5; "bajo", 1. */
  paso?: number;
  /** 1..127. Defaults to 90. */
  velocidad?: number;
  /** Repetitions of the whole progression (defaults to 1). */
  repeticiones?: number;
}

export interface ResultadoProgresion {
  notas: Note[];
  /** The chords as they were played, in order (without repetitions). */
  acordes: string[];
  /** Total duration in quarter notes. */
  beats: number;
}

function acotar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/** Resolves the list of chord symbols from the request and the key. */
export function acordesDe(key: KeySignature, peticion: PeticionProgresion): string[] {
  if (peticion.acordes && peticion.acordes.length > 0) {
    // parseChord throws a clear message if a symbol is not understood.
    for (const simbolo of peticion.acordes) parseChord(simbolo);
    return peticion.acordes.map((simbolo) => simbolo.trim());
  }
  if (peticion.grados && peticion.grados.length > 0) {
    return peticion.grados.map((grado) => {
      if (!Number.isInteger(grado) || grado < 1 || grado > 7) {
        throw new Error(`Invalid degree: ${grado} (they go from 1 to 7)`);
      }
      return diatonicTriad(key, grado - 1);
    });
  }
  throw new Error("You need `acordes` (e.g. [\"Am\",\"F\",\"C\",\"G\"]) or `grados` (e.g. [1,6,4,5]).");
}

/**
 * Voicing close to the previous one: of all inversions and octave shifts, the one
 * that moves the center of gravity the least. It is the minimal voice leading that
 * keeps a block progression from jumping around the keyboard.
 */
function voicingCercano(simbolo: string, octava: number, centro: number | null): number[] {
  const acorde = parseChord(simbolo);
  const base = chordToMidi(acorde, octava, 0);
  if (centro === null) return base;
  let mejor = base;
  let distancia = Infinity;
  for (let inversion = 0; inversion < acorde.intervals.length; inversion += 1) {
    for (const desplazamiento of [-12, 0, 12]) {
      const candidato = chordToMidi(acorde, octava, inversion).map((nota) => nota + desplazamiento);
      const media = candidato.reduce((suma, nota) => suma + nota, 0) / candidato.length;
      const d = Math.abs(media - centro);
      if (d < distancia - 1e-9) {
        distancia = d;
        mejor = candidato;
      }
    }
  }
  return mejor;
}

/** Root (or bass of the slash chord) in the requested octave. */
function bajoDe(simbolo: string, octava: number): number {
  const acorde = parseChord(simbolo);
  const clase = acorde.bass ?? acorde.root;
  return (octava + 1) * 12 + clase;
}

/**
 * Notes of a progression, with times relative to the start of the clip (in quarter
 * notes). `beatsPorCompas` comes from the project time signature (4 in 4/4).
 */
export function notasDeProgresion(
  key: KeySignature,
  beatsPorCompas: number,
  peticion: PeticionProgresion,
): ResultadoProgresion {
  const acordes = acordesDe(key, peticion);
  const patron: Patron = peticion.patron ?? "bloque";
  const compases = acotar(peticion.compasesPorAcorde ?? 1, 0.25, 64);
  const largo = compases * beatsPorCompas;
  const octava = Math.round(acotar(peticion.octava ?? (patron === "bajo" ? 2 : 4), 0, 8));
  const paso = acotar(peticion.paso ?? (patron === "bajo" ? 1 : 0.5), 0.0625, largo);
  const velocidad = Math.round(acotar(peticion.velocidad ?? 90, 1, 127));
  const repeticiones = Math.round(acotar(peticion.repeticiones ?? 1, 1, 64));

  const notas: Note[] = [];
  const poner = (pitch: number, start: number, duration: number, vel = velocidad): void => {
    if (pitch < 0 || pitch > 127 || duration <= 0) return;
    notas.push({ pitch, start: Number(start.toFixed(4)), duration: Number(duration.toFixed(4)), velocity: vel });
  };

  // The first chord is placed around the center of the requested octave (F4 for
  // octave 4), not with its root there: an A minor in octave 4 sounds as C4-E4-A4,
  // not A4-E5, which is too high for a pad.
  let centro: number | null = (octava + 1) * 12 + 5;
  let t = 0;
  for (let vuelta = 0; vuelta < repeticiones; vuelta += 1) {
    for (const simbolo of acordes) {
      const tonos = voicingCercano(simbolo, octava, centro);
      centro = tonos.reduce((suma, nota) => suma + nota, 0) / tonos.length;
      const golpes = Math.max(1, Math.round(largo / paso));

      switch (patron) {
        case "bloque":
          for (const nota of tonos) poner(nota, t, largo * 0.98);
          break;
        case "pulso":
          for (let g = 0; g < golpes; g += 1) {
            // Gentle accent on the first beat of each bar: it sounds like a musician, not a grid.
            const acento = (g * paso) % beatsPorCompas === 0 ? 0 : -12;
            for (const nota of tonos) poner(nota, t + g * paso, paso * 0.85, acotar(velocidad + acento, 1, 127));
          }
          break;
        case "arpegio": {
          const subida = [...tonos, tonos[0]! + 12];
          for (let g = 0; g < golpes; g += 1) poner(subida[g % subida.length]!, t + g * paso, paso * 0.95);
          break;
        }
        case "alberti": {
          // Low-high-middle-high: the classic left-hand accompaniment.
          const [grave, medio, agudo] = [tonos[0]!, tonos[1] ?? tonos[0]!, tonos[tonos.length - 1]!];
          const figura = [grave, agudo, medio, agudo];
          for (let g = 0; g < golpes; g += 1) poner(figura[g % 4]!, t + g * paso, paso * 0.95);
          break;
        }
        case "bajo": {
          const raiz = bajoDe(simbolo, octava);
          for (let g = 0; g < golpes; g += 1) poner(raiz, t + g * paso, paso * 0.9);
          break;
        }
      }
      t += largo;
    }
  }

  return { notas, acordes, beats: t };
}
