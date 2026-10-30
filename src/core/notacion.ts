/**
 * Compact note notation, so the agent can write music without JSON.
 *
 * Measured on Oct 27: writing 8 bars of bass, drums, and guitar as lists like
 * `{"pitch":38,"start":0,"duration":2,"velocity":96}` cost 10,348 tokens and 41 s
 * in ONE response, and every following call resent those lists. In this notation
 * the same thing takes 5 to 10 times less space and reads like a score:
 *
 *     "D2:1.5 D2:.5 F2 Eb2 | D2 C2 D2 r | [D3 F3 A3]:4"
 *
 * Rules (the same ones the model reads in the description of escribir_notas):
 *  - note = letter (A-G) or solfège (do re mi fa sol la si), accidental (# b), octave
 *    with C4 = 60 (do4 = 60). A MIDI number (38) also works.
 *  - `:dur` in quarter notes (1 = quarter, .5 = eighth, 1/3 = triplet, 4 = whole in 4/4).
 *    If omitted, the previous one repeats (at the start, 1).
 *  - `!vel` velocity 1-127 for that note only (`D2!115`).
 *  - `r` (or `-`) is silence; `[D3 F3 A3]` or `D3+F3+A3` is a chord.
 *  - `|` is a bar line: it is ignored (it only helps reading).
 *  - `~` at the end of a note ties it to the next one if it is the same pitch.
 *  - `( … )x4` repeats the group 4 times (they can be nested): a one-bar riff played
 *    four times is no longer 32 written notes, it is 8 and an `x4`.
 */

import type { Note } from "./types.ts";

const LETRAS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SOLFEO: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };

export class ErrorNotacion extends Error {}

/** "D2" → 38, "Eb4" → 63, "do4" → 60, "sol#3" → 56, "38" → 38. */
export function alturaDe(texto: string): number {
  const limpio = texto.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (/^\d{1,3}$/.test(limpio)) {
    const n = Number(limpio);
    if (n > 127) throw new ErrorNotacion(`"${texto}" is not a MIDI note (0-127)`);
    return n;
  }
  const m = /^(do|re|mi|fa|sol|la|si|[a-g])(#{1,2}|b{1,2})?(-?\d)$/i.exec(limpio);
  if (!m) throw new ErrorNotacion(`"${texto}" is not a note: use a letter or solfège, accidental, and octave (D2, Eb4, sol3)`);
  const nombre = m[1]!.toLowerCase();
  const base = SOLFEO[nombre] ?? LETRAS[nombre]!;
  const alteracion = (m[2] ?? "").split("").reduce((suma, c) => suma + (c === "#" ? 1 : -1), 0);
  const pitch = (Number(m[3]) + 1) * 12 + base + alteracion;
  if (pitch < 0 || pitch > 127) throw new ErrorNotacion(`"${texto}" is outside the MIDI range`);
  return pitch;
}

function duracionDe(texto: string, token: string): number {
  const fraccion = /^(\d+)\/(\d+)$/.exec(texto);
  const valor = fraccion ? Number(fraccion[1]) / Number(fraccion[2]) : Number(texto);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 64) {
    throw new ErrorNotacion(`invalid duration in "${token}" (quarter notes: 1, .5, 1/3, 4…)`);
  }
  return valor;
}

/** Splits into items, respecting the brackets of chords. */
function trocear(texto: string): string[] {
  const elementos: string[] = [];
  let actual = "";
  let dentro = false;
  for (const c of texto) {
    if (c === "[") dentro = true;
    if (c === "]") dentro = false;
    if (/\s/.test(c) && !dentro) {
      if (actual) elementos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  if (dentro) throw new ErrorNotacion('missing a closing "]" for a chord');
  if (actual) elementos.push(actual);
  return elementos;
}

export interface ResultadoNotacion {
  notas: Note[];
  /** Quarter notes the phrase takes (including rests). */
  beats: number;
  /** Quarter notes of each span between "|" bars, in order (to check the bars). */
  tramos: number[];
}

/**
 * Spans between bars that do not fit the time signature: each span must measure a
 * whole number of bars. The last one may fall short (the phrase ends earlier).
 * Measured on Oct 27: two bars of 5 quarter notes in a chorus shifted everything
 * that came after them.
 */
export function tramosIrregulares(tramos: readonly number[], beatsPorCompas: number): string[] {
  const avisos: string[] = [];
  tramos.forEach((beats, i) => {
    const compases = beats / beatsPorCompas;
    const entero = Math.abs(compases - Math.round(compases)) < 1e-3 && Math.round(compases) >= 1;
    const ultimo = i === tramos.length - 1;
    if (!entero && !(ultimo && beats < beatsPorCompas)) {
      avisos.push(`span ${i + 1} (between bars) measures ${Number(beats.toFixed(3))} quarter notes and the bar has ${beatsPorCompas}`);
    }
  });
  return avisos;
}

/** Maximum items after expanding repetitions (an `x1000` will not hang anything). */
const MAX_ELEMENTOS = 8000;

/** Expands `( … )xN` (also `*N` or `×N`), from the inside out. */
export function desplegarRepeticiones(texto: string): string {
  let actual = texto;
  const grupo = /\(([^()]*)\)\s*[x×*]\s*(\d{1,3})/;
  for (let vuelta = 0; vuelta < 100 && grupo.test(actual); vuelta += 1) {
    actual = actual.replace(grupo, (_, dentro: string, veces: string) => {
      const n = Number(veces);
      if (n < 1) throw new ErrorNotacion("a repetition needs x1 or more");
      // Joined with a space, not a bar: the group may not measure a whole bar
      // ("(E2:.5 B2 E3 B2)x4" is four half-bars that make two bars).
      return Array.from({ length: n }, () => dentro.trim()).join(" ");
    });
    if (actual.length > MAX_ELEMENTOS * 12) throw new ErrorNotacion("too many repetitions: split the phrase");
  }
  if (/[()]/.test(actual)) throw new ErrorNotacion('unclosed parenthesis or missing "xN" after it');
  return actual;
}

export function leerNotacion(texto: string, velocidad = 90): ResultadoNotacion {
  texto = desplegarRepeticiones(texto);
  const notas: Note[] = [];
  let t = 0;
  let duracion = 1;
  /** Notes waiting for a tie: pitch → index in `notas`. */
  let ligadas = new Map<number, number>();
  const tramos: number[] = [];
  let inicioTramo = 0;
  for (const token of trocear(texto)) {
    if (token === "|") {
      if (t > inicioTramo + 1e-9) tramos.push(Number((t - inicioTramo).toFixed(4)));
      inicioTramo = t;
      continue;
    }
    const m = /^(\[[^\]]+\]|[^:!~]+)(?::([^!~]+))?(?:!(\d{1,3}))?(~)?$/.exec(token);
    if (!m) throw new ErrorNotacion(`I don't understand "${token}"`);
    const [, cabeza, dur, vel, liga] = m;
    if (dur !== undefined) duracion = duracionDe(dur, token);
    const v = vel !== undefined ? Math.min(127, Math.max(1, Number(vel))) : velocidad;
    const nombres = cabeza!.startsWith("[")
      ? cabeza!.slice(1, -1).trim().split(/\s+/)
      : cabeza!.split("+");
    const siguientesLigadas = new Map<number, number>();
    if (!(nombres.length === 1 && /^(r|-)$/i.test(nombres[0]!))) {
      for (const nombre of nombres) {
        const pitch = alturaDe(nombre);
        const previa = ligadas.get(pitch);
        if (previa !== undefined) {
          // Tie: the previous note is lengthened instead of repeated.
          notas[previa]!.duration = Number((notas[previa]!.duration + duracion).toFixed(4));
          if (liga) siguientesLigadas.set(pitch, previa);
          continue;
        }
        notas.push({ pitch, start: Number(t.toFixed(4)), duration: Number(duracion.toFixed(4)), velocity: v });
        if (liga) siguientesLigadas.set(pitch, notas.length - 1);
      }
    }
    ligadas = siguientesLigadas;
    t += duracion;
  }
  if (notas.length === 0) throw new ErrorNotacion("the phrase has no notes");
  if (t > inicioTramo + 1e-9) tramos.push(Number((t - inicioTramo).toFixed(4)));
  return { notas, beats: Number(t.toFixed(4)), tramos };
}

const NOMBRES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function nombreCorto(pitch: number): string {
  return `${NOMBRES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function numero(valor: number): string {
  const redondo = Number(valor.toFixed(3));
  return String(redondo).replace(/^0\./, ".");
}

/**
 * Notes → compact notation, so the agent READS a clip the same way it writes it.
 * Only if the line is sequential (each note or chord starts when the previous one
 * ends, or later with a rest). If there is overlapping polyphony, null.
 */
export function aNotacion(notas: readonly Note[]): string | null {
  const ordenadas = [...notas].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const grupos: Note[][] = [];
  for (const nota of ordenadas) {
    const ultimo = grupos.at(-1);
    if (ultimo && Math.abs(ultimo[0]!.start - nota.start) < 1e-6) ultimo.push(nota);
    else grupos.push([nota]);
  }
  const partes: string[] = [];
  let t = 0;
  let durAnterior = -1;
  for (const grupo of grupos) {
    const inicio = grupo[0]!.start;
    const dur = grupo[0]!.duration;
    if (grupo.some((n) => Math.abs(n.duration - dur) > 1e-6)) return null;
    if (inicio < t - 1e-6) return null;
    if (inicio > t + 1e-6) {
      const silencio = inicio - t;
      partes.push(`r${Math.abs(silencio - durAnterior) < 1e-6 ? "" : `:${numero(silencio)}`}`);
      durAnterior = silencio;
    }
    const cabeza = grupo.length === 1 ? nombreCorto(grupo[0]!.pitch) : `[${grupo.map((n) => nombreCorto(n.pitch)).join(" ")}]`;
    const vel = grupo[0]!.velocity;
    partes.push(`${cabeza}${Math.abs(dur - durAnterior) < 1e-6 ? "" : `:${numero(dur)}`}${vel !== 90 ? `!${vel}` : ""}`);
    durAnterior = dur;
    t = inicio + dur;
  }
  return partes.join(" ");
}
