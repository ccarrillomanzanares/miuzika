/**
 * The piano roll's edits, pure: every function takes the clip's notes and the indices of the selected ones and returns
 * new notes (and, when it adds notes, the new selection). The window (web/src/editor.ts) only draws and calls these.
 * Requested 11-Nov: undo, resize, audition, keys, playback, multi-select, keyboard moves, grid and quantize, velocity
 * lane, zoom, key highlight, the openDAW menu tools (transpose, invert, reverse, x2 / /2) and drum piece names.
 */

import type { KeySignature, Note } from "./types.ts";
import { intervalosDe, pitchClass } from "./theory.ts";

export type Seleccion = ReadonlySet<number>;

/** Grid steps in beats (a beat is a quarter note). The triplets divide the straight value by 3/2. */
export const REJILLAS: readonly { etiqueta: string; beats: number }[] = [
  { etiqueta: "1/4", beats: 1 },
  { etiqueta: "1/8", beats: 0.5 },
  { etiqueta: "1/8T", beats: 1 / 3 },
  { etiqueta: "1/16", beats: 0.25 },
  { etiqueta: "1/16T", beats: 1 / 6 },
  { etiqueta: "1/32", beats: 0.125 },
];

const PITCH_MIN = 0;
const PITCH_MAX = 127;
/** Shortest note any edit leaves: a 1/64. */
export const LARGO_MINIMO = 1 / 16;

const limitarPitch = (p: number) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(p)));
const redondear = (x: number) => Math.round(x * 1e6) / 1e6;

export function ajustar(beat: number, rejilla: number): number {
  return redondear(Math.round(beat / rejilla) * rejilla);
}

/** The indices an edit acts on: the selection, or every note when nothing is selected (as openDAW's menu does). */
export function objetivo(notas: readonly Note[], sel: Seleccion): number[] {
  return sel.size > 0 ? [...sel].filter((i) => i >= 0 && i < notas.length) : notas.map((_, i) => i);
}

function cambiar(notas: readonly Note[], indices: readonly number[], f: (n: Note) => Note): Note[] {
  const set = new Set(indices);
  return notas.map((n, i) => (set.has(i) ? f(n) : { ...n }));
}

/** Semitones up or down; a note pushed past 0 or 127 stays there. */
export function transponer(notas: readonly Note[], sel: Seleccion, semitonos: number): Note[] {
  return cambiar(notas, objetivo(notas, sel), (n) => ({ ...n, pitch: limitarPitch(n.pitch + semitonos) }));
}

/** Move in time, kept inside the clip [0, largoClip]. The whole group moves by the same amount. */
export function desplazar(notas: readonly Note[], sel: Seleccion, beats: number, largoClip: number): Note[] {
  const idx = objetivo(notas, sel);
  if (idx.length === 0) return notas.map((n) => ({ ...n }));
  const inicio = Math.min(...idx.map((i) => notas[i]!.start));
  const fin = Math.max(...idx.map((i) => notas[i]!.start + notas[i]!.duration));
  const d = Math.max(-inicio, Math.min(largoClip - fin, beats));
  return cambiar(notas, idx, (n) => ({ ...n, start: redondear(n.start + d) }));
}

/** Pitch mirror inside the group's range: its lowest note becomes its highest. */
export function invertir(notas: readonly Note[], sel: Seleccion): Note[] {
  const idx = objetivo(notas, sel);
  if (idx.length === 0) return notas.map((n) => ({ ...n }));
  const bajo = Math.min(...idx.map((i) => notas[i]!.pitch));
  const alto = Math.max(...idx.map((i) => notas[i]!.pitch));
  return cambiar(notas, idx, (n) => ({ ...n, pitch: bajo + alto - n.pitch }));
}

/** Time mirror inside the group's span: the last note to end becomes the first to start. */
export function darLaVuelta(notas: readonly Note[], sel: Seleccion): Note[] {
  const idx = objetivo(notas, sel);
  if (idx.length === 0) return notas.map((n) => ({ ...n }));
  const inicio = Math.min(...idx.map((i) => notas[i]!.start));
  const fin = Math.max(...idx.map((i) => notas[i]!.start + notas[i]!.duration));
  return cambiar(notas, idx, (n) => ({ ...n, start: redondear(inicio + fin - (n.start + n.duration)) }));
}

/** x2 or /2: positions (from the group's first note) and lengths scaled; whatever would pass the clip end is cut. */
export function escalarTiempo(notas: readonly Note[], sel: Seleccion, factor: number, largoClip: number): Note[] {
  const idx = objetivo(notas, sel);
  if (idx.length === 0) return notas.map((n) => ({ ...n }));
  const inicio = Math.min(...idx.map((i) => notas[i]!.start));
  const fuera = new Set<number>();
  const res = cambiar(notas, idx, (n) => {
    const start = redondear(inicio + (n.start - inicio) * factor);
    const duration = redondear(Math.max(LARGO_MINIMO, n.duration * factor));
    return { ...n, start, duration: Math.min(duration, Math.max(LARGO_MINIMO, largoClip - start)) };
  });
  res.forEach((n, i) => {
    if (n.start >= largoClip) fuera.add(i);
  });
  return res.filter((_, i) => !fuera.has(i));
}

/** Starts snapped to the grid; lengths untouched (as openDAW's Quantize Notes). */
export function cuantizar(notas: readonly Note[], sel: Seleccion, rejilla: number, largoClip: number): Note[] {
  return cambiar(notas, objetivo(notas, sel), (n) => {
    const start = Math.min(ajustar(n.start, rejilla), Math.max(0, largoClip - LARGO_MINIMO));
    return { ...n, start: Math.max(0, start) };
  });
}

/** Lengths of the group set by a drag: each note grows or shrinks by the same amount, never under the minimum. */
export function alargar(notas: readonly Note[], sel: Seleccion, beats: number, largoClip: number): Note[] {
  return cambiar(notas, objetivo(notas, sel), (n) => ({
    ...n,
    duration: redondear(Math.max(LARGO_MINIMO, Math.min(largoClip - n.start, n.duration + beats))),
  }));
}

export function velocidad(notas: readonly Note[], sel: Seleccion, valor: number): Note[] {
  const v = Math.min(127, Math.max(1, Math.round(valor)));
  return cambiar(notas, objetivo(notas, sel), (n) => ({ ...n, velocity: v }));
}

export function borrar(notas: readonly Note[], sel: Seleccion): Note[] {
  return notas.filter((_, i) => !sel.has(i)).map((n) => ({ ...n }));
}

/**
 * Copies of the selection right after it (Ctrl+D). What would start past the clip end is not copied. Returns the
 * notes and the copies as the new selection, so a second Ctrl+D goes on from there.
 */
export function duplicar(
  notas: readonly Note[],
  sel: Seleccion,
  largoClip: number,
): { notas: Note[]; seleccion: Set<number> } {
  const idx = [...sel].filter((i) => i >= 0 && i < notas.length);
  if (idx.length === 0) return { notas: notas.map((n) => ({ ...n })), seleccion: new Set() };
  const inicio = Math.min(...idx.map((i) => notas[i]!.start));
  const fin = Math.max(...idx.map((i) => notas[i]!.start + notas[i]!.duration));
  const copias = idx
    .map((i) => ({ ...notas[i]!, start: redondear(notas[i]!.start + (fin - inicio)) }))
    .filter((n) => n.start < largoClip)
    .map((n) => ({ ...n, duration: Math.min(n.duration, redondear(largoClip - n.start)) }));
  const res = [...notas.map((n) => ({ ...n })), ...copias];
  return { notas: res, seleccion: new Set(copias.map((_, k) => notas.length + k)) };
}

/** Pitch classes (0-11) of the project's key. */
export function clasesDeLaTonalidad(key: KeySignature): Set<number> {
  const tonica = pitchClass(key.tonic);
  return new Set(intervalosDe(key.mode).map((i) => (tonica + i) % 12));
}

/** General MIDI percussion names (channel 10), for the keys of a drum track. */
const PIEZAS_GM: Record<number, string> = {
  35: "Kick 2", 36: "Kick", 37: "Side stick", 38: "Snare", 39: "Clap", 40: "Snare 2", 41: "Floor tom low",
  42: "Closed hi-hat", 43: "Floor tom", 44: "Pedal hi-hat", 45: "Low tom", 46: "Open hi-hat", 47: "Low-mid tom",
  48: "Hi-mid tom", 49: "Crash", 50: "High tom", 51: "Ride", 52: "China", 53: "Ride bell", 54: "Tambourine",
  55: "Splash", 56: "Cowbell", 57: "Crash 2", 58: "Vibraslap", 59: "Ride 2", 60: "Hi bongo", 61: "Low bongo",
  62: "Mute hi conga", 63: "Open hi conga", 64: "Low conga", 65: "High timbale", 66: "Low timbale", 67: "High agogo",
  68: "Low agogo", 69: "Cabasa", 70: "Maracas", 71: "Short whistle", 72: "Long whistle", 73: "Short guiro",
  74: "Long guiro", 75: "Claves", 76: "Hi wood block", 77: "Low wood block", 78: "Mute cuica", 79: "Open cuica",
  80: "Mute triangle", 81: "Open triangle",
};

export function nombrePiezaGm(pitch: number): string | undefined {
  return PIEZAS_GM[pitch];
}

/** Undo and redo of the editor's own edits, before Apply: snapshots of the notes. */
export class Historial {
  private atras: Note[][] = [];
  private adelante: Note[][] = [];

  /** Call BEFORE changing the notes, with the state that an undo should bring back. */
  guardar(notas: readonly Note[]): void {
    this.atras.push(notas.map((n) => ({ ...n })));
    if (this.atras.length > 200) this.atras.shift();
    this.adelante = [];
  }

  deshacer(actuales: readonly Note[]): Note[] | null {
    const previo = this.atras.pop();
    if (!previo) return null;
    this.adelante.push(actuales.map((n) => ({ ...n })));
    return previo;
  }

  rehacer(actuales: readonly Note[]): Note[] | null {
    const siguiente = this.adelante.pop();
    if (!siguiente) return null;
    this.atras.push(actuales.map((n) => ({ ...n })));
    return siguiente;
  }

  get puedeDeshacer(): boolean {
    return this.atras.length > 0;
  }

  get puedeRehacer(): boolean {
    return this.adelante.length > 0;
  }
}
