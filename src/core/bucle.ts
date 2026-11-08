/**
 * Loop recording for the Pad panel (the user, 8-Nov-2026: "teclados midi que llevan pads… se usan para en bucle
 * ir grabando ritmos o sonidos y que vayan quedando grabados y al tempo").
 *
 * A loop of N bars repeats; each pass adds what is played (overdub) and it sounds from the next pass on.
 * Every pass is a layer that can be undone on its own. When it stops, ONE clip per track with all the
 * layers (his choice "A", 8-Nov) goes into the project.
 *
 * Also here: the computer keyboard as an instrument (nine keys, numpad or letters) and its configurable keys.
 *
 * Times are in quarter notes ("beats"). `beat` below is absolute since the loop's first downbeat (pass 0
 * starts at 0, pass 1 at `longitud`…); negative during the count-in.
 *
 * Quantize is off by default: measured in humseed, snapping a whole take after the fact shifted it by a
 * median of 543 ms and destroyed the rhythm (see GrabadorPad). Here it is an option, applied note by note.
 *
 * No DOM and no network: tested with `node --test`.
 */

import type { KeySignature, Note } from "./types.ts";
import { intervalosDe, nombreDeNota, pitchClass } from "./theory.ts";

// ------------------------------------------------------------------ the loop

export interface NotaBucle {
  /** Track it belongs to (each source records into its own track). */
  pista: string;
  pitch: number;
  /** Position inside the loop, 0 ≤ start < longitud. */
  start: number;
  duration: number;
  velocity: number;
  /** Pass in which it was recorded: it sounds from the next one on. */
  pasada: number;
}

export interface EventoBucle {
  pista: string;
  pitch: number;
  /** 1..127 starts the note, 0 releases it. */
  velocidad: number;
  /** Absolute beat at which it must sound. */
  beat: number;
}

/** A note pressed before the downbeat by less than this still counts as on it (an early hit in the count-in). */
const ADELANTO_MAX = 0.5;
const DURACION_MIN = 1 / 32;

export class CapasBucle {
  private notas: NotaBucle[] = [];
  private abiertas = new Map<string, { pista: string; pitch: number; beat: number; velocity: number }>();

  /**
   * @param longitud loop length in beats; `Infinity` = no loop (a free take: nothing repeats).
   * @param rejilla quantize step in beats (0.25 = 1/16); 0 = off.
   */
  readonly longitud: number;
  private readonly rejilla: number;

  constructor(longitud: number, rejilla = 0) {
    if (!(longitud > 0)) throw new Error("the loop needs a length");
    this.longitud = longitud;
    this.rejilla = rejilla;
  }

  get vacia(): boolean {
    return this.notas.length === 0;
  }

  get total(): number {
    return this.notas.length;
  }

  /** Layers with notes (passes that recorded something). */
  get capas(): number {
    return new Set(this.notas.map((n) => n.pasada)).size;
  }

  pasadaEn(beat: number): number {
    return Number.isFinite(this.longitud) ? Math.floor(Math.max(0, beat) / this.longitud) : 0;
  }

  posicionEn(beat: number): number {
    return Number.isFinite(this.longitud) ? ((beat % this.longitud) + this.longitud) % this.longitud : beat;
  }

  /** `clave` tells apart two presses of the same pitch (finger, key). */
  pulsar(pista: string, clave: string, pitch: number, velocity: number, beat: number): void {
    this.soltar(clave, beat);
    this.abiertas.set(clave, { pista, pitch, beat, velocity });
  }

  soltar(clave: string, beat: number): void {
    const abierta = this.abiertas.get(clave);
    if (!abierta) return;
    this.abiertas.delete(clave);
    this.anotar(abierta.pista, abierta.pitch, abierta.velocity, abierta.beat, beat);
  }

  soltarTodo(beat: number): void {
    for (const clave of [...this.abiertas.keys()]) this.soltar(clave, beat);
  }

  /** A note with both ends known (note repeat records like this). */
  anotar(pista: string, pitch: number, velocity: number, desde: number, hasta: number): void {
    if (desde < -ADELANTO_MAX) return; // played during the count-in, not on the downbeat
    let inicio = Math.max(0, desde);
    if (this.rejilla > 0) inicio = Math.round(inicio / this.rejilla) * this.rejilla;
    let pasada = this.pasadaEn(Math.max(0, desde));
    let start = this.posicionEn(inicio);
    // Snapped forward onto the next downbeat: it belongs to the loop start. Counted in that next pass, so it
    // is not replayed a few ms after the live hit (a flam) but from the pass after.
    if (Number.isFinite(this.longitud) && this.pasadaEn(inicio) > pasada) pasada += 1;
    if (Number.isFinite(this.longitud) && start >= this.longitud - 1e-9) start = 0;
    let duration = Math.max(DURACION_MIN, hasta - Math.max(0, desde));
    // Held across the loop end: cut at the end (the next pass starts clean).
    if (Number.isFinite(this.longitud)) duration = Math.min(duration, this.longitud - start);
    this.notas.push({
      pista,
      pitch,
      start: redondear(start),
      duration: redondear(Math.max(DURACION_MIN, duration)),
      velocity: Math.min(127, Math.max(1, Math.round(velocity))),
      pasada,
    });
  }

  /** Undoes the last layer with notes. Returns how many notes went (0 = nothing to undo). */
  deshacer(): number {
    if (this.notas.length === 0) return 0;
    const ultima = Math.max(...this.notas.map((n) => n.pasada));
    const antes = this.notas.length;
    this.notas = this.notas.filter((n) => n.pasada !== ultima);
    return antes - this.notas.length;
  }

  /**
   * Erase while it plays: removes the notes of `pitch` on `pista` that START between two absolute beats
   * (the stretch the playhead has crossed while erase and the note were held). Returns how many.
   */
  borrar(pista: string, pitch: number, desde: number, hasta: number): number {
    if (!(hasta > desde)) return 0;
    const dentro = (pos: number): boolean => {
      if (!Number.isFinite(this.longitud)) return pos >= desde && pos < hasta;
      if (hasta - desde >= this.longitud) return true;
      const a = this.posicionEn(desde);
      const b = this.posicionEn(hasta);
      return a <= b ? pos >= a && pos < b : pos >= a || pos < b;
    };
    const antes = this.notas.length;
    this.notas = this.notas.filter((n) => !(n.pista === pista && n.pitch === pitch && dentro(n.start)));
    return antes - this.notas.length;
  }

  /**
   * What the loop must play in (desde, hasta]: every layer from the pass after the one that recorded it
   * (in its own pass it was already heard live). Note-offs too, so nothing hangs.
   */
  sonarEntre(desde: number, hasta: number): EventoBucle[] {
    if (!Number.isFinite(this.longitud) || !(hasta > desde)) return [];
    const eventos: EventoBucle[] = [];
    const primera = Math.max(0, Math.floor(desde / this.longitud) - 1);
    const ultima = Math.floor(hasta / this.longitud);
    for (const n of this.notas) {
      for (let p = Math.max(primera, n.pasada + 1); p <= ultima; p += 1) {
        const on = p * this.longitud + n.start;
        // Released a hair before the next start, so a note filling the loop retriggers.
        const off = on + Math.max(DURACION_MIN / 2, n.duration - 1e-3);
        if (on > desde && on <= hasta) eventos.push({ pista: n.pista, pitch: n.pitch, velocidad: n.velocity, beat: on });
        if (off > desde && off <= hasta) eventos.push({ pista: n.pista, pitch: n.pitch, velocidad: 0, beat: off });
      }
    }
    // Offs before ons at the same instant: a released note does not cut the one that starts.
    return eventos.sort((a, b) => a.beat - b.beat || a.velocidad - b.velocidad);
  }

  /** The tracks that recorded something. */
  pistas(): string[] {
    return [...new Set(this.notas.map((n) => n.pista))];
  }

  /** The notes of one track for its clip, in order. */
  notasDe(pista: string): Note[] {
    return this.notas
      .filter((n) => n.pista === pista)
      .map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
}

function redondear(x: number): number {
  return Number(x.toFixed(4));
}

/** Absolute beats of the note-repeat steps in (desde, hasta]: on the grid of `paso`, from the loop start. */
export function pasosDeRepeticion(desde: number, hasta: number, paso: number): number[] {
  if (!(paso > 0) || !(hasta > desde)) return [];
  const pasos: number[] = [];
  for (let k = Math.floor(desde / paso) + 1; k * paso <= hasta + 1e-9; k += 1) pasos.push(redondear(k * paso));
  return pasos;
}

// ------------------------------------------------------- the keyboard as an instrument

/** Nine drum pieces for keys 1-9, laid out like the numpad (1 at the bottom left). GM numbers. */
export const PIEZAS_TECLADO: readonly { nota: number; nombre: string }[] = [
  { nota: 36, nombre: "Kick" },
  { nota: 38, nombre: "Snare" },
  { nota: 39, nombre: "Clap" },
  { nota: 42, nombre: "Closed HH" },
  { nota: 44, nombre: "Pedal HH" },
  { nota: 46, nombre: "Open HH" },
  { nota: 45, nombre: "Low tom" },
  { nota: 50, nombre: "High tom" },
  { nota: 49, nombre: "Crash" },
];

/**
 * Keys 1-9 → notes. A drum track: the nine pieces. Any other: nine steps of the project scale from its
 * tonic in `octava`, so it never goes out of key (in D minor: D E F / G A Bb / C D' E').
 */
export function notasDelTeclado(bateria: boolean, key: KeySignature, octava: number): { nota: number; etiqueta: string }[] {
  if (bateria) return PIEZAS_TECLADO.map((p) => ({ nota: p.nota, etiqueta: p.nombre }));
  const intervalos = intervalosDe(key.mode);
  const tonica = (octava + 1) * 12 + pitchClass(key.tonic);
  return Array.from({ length: 9 }, (_, i) => {
    const nota = Math.min(127, Math.max(0, tonica + 12 * Math.floor(i / intervalos.length) + intervalos[i % intervalos.length]!));
    return { nota, etiqueta: nombreDeNota(nota) };
  });
}

// ------------------------------------------------------------------ the keys

export const ACCIONES = [
  "nota1", "nota2", "nota3", "nota4", "nota5", "nota6", "nota7", "nota8", "nota9",
  "grabar", "reproducir", "deshacer", "octavaMenos", "octavaMas", "metronomo", "repetir", "borrar",
] as const;
export type Accion = (typeof ACCIONES)[number];
/** Action → `KeyboardEvent.code` (the physical key, whatever the layout). "" = no key. */
export type MapaTeclas = Record<Accion, string>;

export const NOMBRE_ACCION: Record<Accion, string> = {
  nota1: "Note 1", nota2: "Note 2", nota3: "Note 3", nota4: "Note 4", nota5: "Note 5",
  nota6: "Note 6", nota7: "Note 7", nota8: "Note 8", nota9: "Note 9",
  grabar: "Record / overdub",
  reproducir: "Play / stop the loop",
  deshacer: "Undo the last pass",
  octavaMenos: "Octave down",
  octavaMas: "Octave up",
  metronomo: "Metronome on/off",
  repetir: "Note repeat (hold)",
  borrar: "Erase (hold + note)",
};

export const ESQUEMAS: Record<"numerico" | "letras", MapaTeclas> = {
  numerico: {
    nota1: "Numpad1", nota2: "Numpad2", nota3: "Numpad3",
    nota4: "Numpad4", nota5: "Numpad5", nota6: "Numpad6",
    nota7: "Numpad7", nota8: "Numpad8", nota9: "Numpad9",
    grabar: "NumpadEnter", reproducir: "Numpad0", deshacer: "NumpadDecimal",
    octavaMenos: "NumpadSubtract", octavaMas: "NumpadAdd",
    metronomo: "NumpadMultiply", repetir: "NumpadDivide", borrar: "Delete",
  },
  // The same 3×3 shape on the left hand: Z X C at the bottom, like 1 2 3.
  letras: {
    nota1: "KeyZ", nota2: "KeyX", nota3: "KeyC",
    nota4: "KeyA", nota5: "KeyS", nota6: "KeyD",
    nota7: "KeyQ", nota8: "KeyW", nota9: "KeyE",
    grabar: "KeyF", reproducir: "KeyV", deshacer: "KeyG",
    octavaMenos: "Digit1", octavaMas: "Digit2",
    metronomo: "KeyM", repetir: "KeyR", borrar: "KeyT",
  },
};

export const NOMBRE_ESQUEMA = { numerico: "Numpad", letras: "Letters" } as const;

export function accionDeTecla(mapa: MapaTeclas, code: string): Accion | null {
  if (!code) return null;
  return ACCIONES.find((a) => mapa[a] === code) ?? null;
}

/** Gives `code` to `accion`; whatever action had that key is left without one. */
export function asignarTecla(mapa: MapaTeclas, accion: Accion, code: string): MapaTeclas {
  const nuevo = { ...mapa };
  for (const a of ACCIONES) if (nuevo[a] === code) nuevo[a] = "";
  nuevo[accion] = code;
  return nuevo;
}

/** Which preset this map is, if any. */
export function esquemaDe(mapa: MapaTeclas): keyof typeof ESQUEMAS | null {
  for (const nombre of Object.keys(ESQUEMAS) as (keyof typeof ESQUEMAS)[]) {
    if (ACCIONES.every((a) => ESQUEMAS[nombre][a] === mapa[a])) return nombre;
  }
  return null;
}

/** A saved map (localStorage), checked: anything unreadable gives the numpad. */
export function leerMapa(texto: string | null): MapaTeclas {
  if (!texto) return { ...ESQUEMAS.numerico };
  try {
    const datos = JSON.parse(texto) as Record<string, unknown>;
    const mapa = { ...ESQUEMAS.numerico };
    for (const a of ACCIONES) if (typeof datos[a] === "string") mapa[a] = datos[a] as string;
    return mapa;
  } catch {
    return { ...ESQUEMAS.numerico };
  }
}

/** "Numpad7" → "7", "NumpadEnter" → "Enter", "KeyQ" → "Q", "Digit1" → "1". */
export function nombreTecla(code: string): string {
  if (!code) return "—";
  const especiales: Record<string, string> = {
    NumpadEnter: "Enter", NumpadDecimal: ".", NumpadAdd: "+", NumpadSubtract: "−",
    NumpadMultiply: "*", NumpadDivide: "/", Delete: "Del", Backspace: "⌫", Space: "Space",
  };
  if (especiales[code]) return especiales[code]!;
  if (code.startsWith("Numpad")) return code.slice(6);
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
