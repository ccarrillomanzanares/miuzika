/**
 * The touchpad as an instrument: from the position of each finger to notes.
 *
 * It comes from humseed's `Mapeo` (cliente_touchpad/mapeo.py), with one change: the
 * keys follow the project KEY (there they were two octaves of C major).
 * The capture (workspace/herramientas/touchpad) only sends fingers: x, y in 0..1.
 *
 * Modes:
 *   teclas    the pad width is two octaves of the scale; sliding a finger from
 *             one key to another plays the new one (glissando) and never goes out of tune.
 *   pads      4×2 grid with General MIDI drum pieces.
 *   deslizar  continuous pitch, snapped to the scale.
 *
 * The pad has no pressure: dynamics come from the finger's height, loud down low
 * (close to the person).
 *
 * No DOM and no network: tested with `node --test`.
 */

import type { KeySignature } from "./types.ts";
import { intervalosDe, pitchClass } from "./theory.ts";

export const MODOS_PAD = ["teclas", "pads", "deslizar"] as const;
export type ModoPad = (typeof MODOS_PAD)[number];

/** Pad grid: top row and bottom row, from left to right. */
export const PADS: readonly { nota: number; nombre: string }[] = [
  { nota: 36, nombre: "Bombo" },
  { nota: 38, nombre: "Caja" },
  { nota: 42, nombre: "Charles" },
  { nota: 46, nombre: "Charles abierto" },
  { nota: 45, nombre: "Tom bajo" },
  { nota: 50, nombre: "Tom alto" },
  { nota: 39, nombre: "Palmas" },
  { nota: 49, nombre: "Crash" },
];
const COLUMNAS = 4;
const FILAS = 2;

const VEL_MIN = 45;
const VEL_MAX = 127;

const NOMBRES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function nombreCorto(nota: number): string {
  return `${NOMBRES[((nota % 12) + 12) % 12]}${Math.floor(nota / 12) - 1}`;
}

export interface OpcionesPad {
  modo: ModoPad;
  key: KeySignature;
  /** Octave of the first key (C4 = 60 is in octave 4). */
  octava: number;
  /** Octaves the pad width covers. */
  octavas?: number;
}

export interface NotaPad {
  accion: "on" | "off";
  /** Finger (pad contact id). */
  dedo: number;
  nota: number;
  /** 1..127 (0 on the off events). */
  velocidad: number;
}

/** A pad zone, so the page draws the same thing that sounds. */
export interface ZonaPad {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  etiqueta: string;
  nota: number;
}

/** Notes of the keys from left to right: the project scale and the tonic on top. */
export function notasDeTeclas(key: KeySignature, octava: number, octavas = 2): number[] {
  const tonica = (octava + 1) * 12 + pitchClass(key.tonic);
  const intervalos = intervalosDe(key.mode);
  const notas: number[] = [];
  for (let o = 0; o < octavas; o += 1) for (const i of intervalos) notas.push(tonica + 12 * o + i);
  notas.push(tonica + 12 * octavas);
  return notas.filter((n) => n >= 0 && n <= 127);
}

function velocidadDe(y: number): number {
  const acotada = Math.min(1, Math.max(0, y));
  return Math.round(VEL_MIN + (VEL_MAX - VEL_MIN) * acotada);
}

export class MapeoPad {
  private opciones: Required<OpcionesPad>;
  private notas: number[];
  /** Finger → note it currently has sounding. */
  private sonando = new Map<number, number>();

  constructor(opciones: OpcionesPad) {
    this.opciones = { octavas: 2, ...opciones };
    this.notas = notasDeTeclas(this.opciones.key, this.opciones.octava, this.opciones.octavas);
  }

  get modo(): ModoPad {
    return this.opciones.modo;
  }

  /** Changes mode, key, or octave. Releases whatever was sounding. */
  configurar(cambios: Partial<OpcionesPad>): NotaPad[] {
    const soltadas = this.soltarTodo();
    this.opciones = { ...this.opciones, ...cambios };
    this.notas = notasDeTeclas(this.opciones.key, this.opciones.octava, this.opciones.octavas);
    return soltadas;
  }

  private notaEn(x: number, y: number): { nota: number; velocidad: number } {
    const cx = Math.min(1, Math.max(0, x));
    const cy = Math.min(1, Math.max(0, y));
    if (this.opciones.modo === "pads") {
      const columna = Math.min(Math.floor(cx * COLUMNAS), COLUMNAS - 1);
      const fila = Math.min(Math.floor(cy * FILAS), FILAS - 1);
      // Inside each pad as well: lower means louder.
      const dentro = cy * FILAS - fila;
      return { nota: PADS[fila * COLUMNAS + columna]!.nota, velocidad: velocidadDe(dentro) };
    }
    if (this.opciones.modo === "deslizar") {
      const primera = this.notas[0]!;
      const bruto = primera + cx * 12 * this.opciones.octavas;
      const nota = this.notas.reduce((mejor, n) => (Math.abs(n - bruto) < Math.abs(mejor - bruto) ? n : mejor));
      return { nota, velocidad: velocidadDe(cy) };
    }
    const indice = Math.min(Math.floor(cx * this.notas.length), this.notas.length - 1);
    return { nota: this.notas[Math.max(0, indice)]!, velocidad: velocidadDe(cy) };
  }

  /** One capture event → the notes that start or end. */
  dedo(tipo: "down" | "move" | "up", dedo: number, x: number, y: number): NotaPad[] {
    if (tipo === "up") return this.soltar(dedo);
    const { nota, velocidad } = this.notaEn(x, y);
    const anterior = this.sonando.get(dedo);
    if (anterior === nota) return [];
    // In pads, moving inside the pad does not retrigger the hit; moving to another pad does.
    const salida: NotaPad[] = [];
    if (anterior !== undefined) salida.push({ accion: "off", dedo, nota: anterior, velocidad: 0 });
    this.sonando.set(dedo, nota);
    salida.push({ accion: "on", dedo, nota, velocidad });
    return salida;
  }

  soltar(dedo: number): NotaPad[] {
    const nota = this.sonando.get(dedo);
    if (nota === undefined) return [];
    this.sonando.delete(dedo);
    return [{ accion: "off", dedo, nota, velocidad: 0 }];
  }

  soltarTodo(): NotaPad[] {
    return [...this.sonando.keys()].flatMap((dedo) => this.soltar(dedo));
  }

  zonas(): ZonaPad[] {
    if (this.opciones.modo === "pads") {
      return PADS.map((pad, i) => {
        const columna = i % COLUMNAS;
        const fila = Math.floor(i / COLUMNAS);
        return {
          x0: columna / COLUMNAS,
          x1: (columna + 1) / COLUMNAS,
          y0: fila / FILAS,
          y1: (fila + 1) / FILAS,
          etiqueta: pad.nombre,
          nota: pad.nota,
        };
      });
    }
    const n = this.notas.length;
    return this.notas.map((nota, i) => ({ x0: i / n, x1: (i + 1) / n, y0: 0, y1: 1, etiqueta: nombreCorto(nota), nota }));
  }
}

export interface NotaGrabada {
  pitch: number;
  /** Quarter notes since the start of the recording. */
  start: number;
  duration: number;
  velocity: number;
}

/**
 * What is played while recording → notes for a clip. The times are the real ones
 * (in quarter notes): they are NOT snapped to the grid. Measured in humseed:
 * snapping a take shifted it by a median of 543 ms and destroyed the rhythm.
 */
export class GrabadorPad {
  private abiertas = new Map<string, { pitch: number; start: number; velocity: number }>();
  private notas: NotaGrabada[] = [];

  /** `beat`: quarter notes since the start of the recording (can be negative during the count-in). */
  registrar(nota: NotaPad, beat: number): void {
    const clave = `${nota.dedo}:${nota.nota}`;
    if (nota.accion === "on") {
      this.cerrar(clave, beat);
      this.abiertas.set(clave, { pitch: nota.nota, start: beat, velocity: nota.velocidad });
    } else {
      this.cerrar(clave, beat);
    }
  }

  private cerrar(clave: string, beat: number): void {
    const abierta = this.abiertas.get(clave);
    if (!abierta) return;
    this.abiertas.delete(clave);
    const inicio = Math.max(0, abierta.start);
    const fin = Math.max(inicio, beat);
    if (fin - inicio < 1 / 64 && abierta.start < 0) return; // released before starting
    this.notas.push({
      pitch: abierta.pitch,
      start: Number(inicio.toFixed(4)),
      duration: Number(Math.max(1 / 32, fin - inicio).toFixed(4)),
      velocity: abierta.velocity,
    });
  }

  /** Closes whatever is still held at `beat` and returns the notes, in order. */
  terminar(beat: number): NotaGrabada[] {
    for (const clave of [...this.abiertas.keys()]) this.cerrar(clave, beat);
    const notas = this.notas.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    this.notas = [];
    return notas;
  }
}
