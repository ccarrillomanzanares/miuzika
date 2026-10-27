/**
 * El touchpad como instrumento: de la posición de cada dedo a notas.
 *
 * Viene del `Mapeo` de humseed (cliente_touchpad/mapeo.py), con un cambio: las
 * teclas siguen la TONALIDAD del proyecto (allí eran dos octavas de Do mayor).
 * La captura (workspace/herramientas/touchpad) sólo manda dedos: x, y en 0..1.
 *
 * Modos:
 *   teclas    el ancho del pad son dos octavas de la escala; deslizar el dedo de
 *             una tecla a otra toca la nueva (glissando) y nunca desafina.
 *   pads      rejilla de 4×2 con piezas de batería General MIDI.
 *   deslizar  altura continua, pegada a la escala.
 *
 * El pad no tiene presión: la dinámica sale de la altura del dedo, abajo (cerca
 * de la persona) fuerte.
 *
 * Sin DOM y sin red: se prueba con `node --test`.
 */

import type { KeySignature } from "./types.ts";
import { intervalosDe, pitchClass } from "./theory.ts";

export const MODOS_PAD = ["teclas", "pads", "deslizar"] as const;
export type ModoPad = (typeof MODOS_PAD)[number];

/** Rejilla de pads: fila de arriba y fila de abajo, de izquierda a derecha. */
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
  /** Octava de la primera tecla (C4 = 60 está en la octava 4). */
  octava: number;
  /** Octavas que cubre el ancho del pad. */
  octavas?: number;
}

export interface NotaPad {
  accion: "on" | "off";
  /** Dedo (id de contacto del pad). */
  dedo: number;
  nota: number;
  /** 1..127 (0 en los off). */
  velocidad: number;
}

/** Una zona del pad, para que la página dibuje lo mismo que suena. */
export interface ZonaPad {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  etiqueta: string;
  nota: number;
}

/** Notas de las teclas de izquierda a derecha: la escala del proyecto y la tónica de arriba. */
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
  /** Dedo → nota que tiene sonando. */
  private sonando = new Map<number, number>();

  constructor(opciones: OpcionesPad) {
    this.opciones = { octavas: 2, ...opciones };
    this.notas = notasDeTeclas(this.opciones.key, this.opciones.octava, this.opciones.octavas);
  }

  get modo(): ModoPad {
    return this.opciones.modo;
  }

  /** Cambia modo, tonalidad u octava. Suelta lo que estuviera sonando. */
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
      // Dentro de cada pad, también: más abajo, más fuerte.
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

  /** Un evento de la captura → las notas que empiezan o acaban. */
  dedo(tipo: "down" | "move" | "up", dedo: number, x: number, y: number): NotaPad[] {
    if (tipo === "up") return this.soltar(dedo);
    const { nota, velocidad } = this.notaEn(x, y);
    const anterior = this.sonando.get(dedo);
    if (anterior === nota) return [];
    // En pads, moverse dentro del pad no repite el golpe; pasar a otro pad sí.
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
  /** Negras desde el inicio de la grabación. */
  start: number;
  duration: number;
  velocity: number;
}

/**
 * Lo que se toca mientras se graba → notas para un clip. Los tiempos son los
 * reales (en negras): NO se cuadran a la rejilla. Medido en humseed: cuadrar una
 * toma la desviaba una mediana de 543 ms y destruía el ritmo.
 */
export class GrabadorPad {
  private abiertas = new Map<string, { pitch: number; start: number; velocity: number }>();
  private notas: NotaGrabada[] = [];

  /** `beat`: negras desde el inicio de la grabación (puede ser negativo en la cuenta atrás). */
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
    if (fin - inicio < 1 / 64 && abierta.start < 0) return; // soltada antes de empezar
    this.notas.push({
      pitch: abierta.pitch,
      start: Number(inicio.toFixed(4)),
      duration: Number(Math.max(1 / 32, fin - inicio).toFixed(4)),
      velocity: abierta.velocity,
    });
  }

  /** Cierra lo que siga pulsado en `beat` y devuelve las notas, en orden. */
  terminar(beat: number): NotaGrabada[] {
    for (const clave of [...this.abiertas.keys()]) this.cerrar(clave, beat);
    const notas = this.notas.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    this.notas = [];
    return notas;
  }
}
