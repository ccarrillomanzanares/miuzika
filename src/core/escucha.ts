/**
 * "Listening" to the mix with numbers: level per bar span of what comes out of the
 * openDAW engine, track by track, compared with where there are notes.
 *
 * Why it exists (STATUS Oct 28, pending item 7): the agent diagnosed "by ear" with
 * its own numpy render, which is not what plays in openDAW. On "Hard" it said the
 * piano was sounding while Carlos could not hear it, and ended up adding 2 bars of
 * silence as a patch. Here the real engine's render is measured and cross-checked
 * with the notes: a track with notes in a span and no signal is a bug you can see
 * without hearing it.
 */

import type { Track } from "./types.ts";

/** Below this peak (dBFS) a span counts as silence. A quiet pad at −40 dB still plays; an SF2 that fails to load gives −∞. */
export const UMBRAL_SILENCIO_DB = -70;

export interface NivelTramo {
  /** RMS in dBFS (−Infinity if it is digital zero). */
  rmsDb: number;
  picoDb: number;
}

export interface PistaEscuchada {
  nombre: string;
  muted: boolean;
  /** Notes (or audio clips) that play in each span. */
  notas: number[];
  niveles: NivelTramo[];
}

function db(valor: number): number {
  return valor > 0 ? 20 * Math.log10(valor) : -Infinity;
}

/**
 * How many notes play in each span [i·size, (i+1)·size) in beats. A note counts in
 * every span it crosses (an 8-bar pad counts in two). An audio clip counts as 1 in
 * each span it covers.
 */
export function notasPorTramo(pista: Pick<Track, "clips">, tiemposPorTramo: number, tramos: number): number[] {
  const cuenta = new Array<number>(tramos).fill(0);
  const sumar = (inicio: number, fin: number): void => {
    const primero = Math.max(0, Math.floor(inicio / tiemposPorTramo));
    // `fin` is exclusive: a note that ends exactly on the edge does not cross into the next span.
    const ultimo = Math.min(tramos - 1, Math.ceil(fin / tiemposPorTramo) - 1);
    for (let i = primero; i <= ultimo; i += 1) cuenta[i]! += 1;
  };
  for (const clip of pista.clips) {
    if (clip.audio) {
      sumar(clip.start, clip.start + clip.length);
      continue;
    }
    for (const nota of clip.notes) {
      // What falls outside the clip does not play: the clip trims it.
      if (nota.start >= clip.length) continue;
      const fin = Math.min(nota.start + nota.duration, clip.length);
      sumar(clip.start + nota.start, clip.start + fin);
    }
  }
  return cuenta;
}

/** RMS and peak of each span, with channels mixed to mono for the RMS. */
export function nivelesPorTramo(
  canales: readonly Float32Array[],
  sampleRate: number,
  bpm: number,
  tiemposPorTramo: number,
  tramos: number,
): NivelTramo[] {
  const muestrasPorTramo = (tiemposPorTramo * 60 * sampleRate) / bpm;
  const largo = canales[0]?.length ?? 0;
  const salida: NivelTramo[] = [];
  for (let i = 0; i < tramos; i += 1) {
    const desde = Math.min(largo, Math.round(i * muestrasPorTramo));
    const hasta = Math.min(largo, Math.round((i + 1) * muestrasPorTramo));
    let suma = 0;
    let pico = 0;
    for (let n = desde; n < hasta; n += 1) {
      let mono = 0;
      for (const canal of canales) {
        const v = canal[n]!;
        mono += v;
        const a = Math.abs(v);
        if (a > pico) pico = a;
      }
      mono /= canales.length || 1;
      suma += mono * mono;
    }
    const n = hasta - desde;
    salida.push({ rmsDb: n > 0 ? db(Math.sqrt(suma / n)) : -Infinity, picoDb: db(pico) });
  }
  return salida;
}

function celda(nivel: NivelTramo, notas: number): string {
  const mudo = nivel.picoDb < UMBRAL_SILENCIO_DB;
  if (mudo) return notas > 0 ? "SILENT" : "·";
  return String(Math.round(nivel.rmsDb));
}

/**
 * The report for the agent: a table (rows = mix and tracks, columns = spans) with
 * the RMS in dBFS, and the problems in words below. "SILENT" = there are notes and
 * nothing comes out; "·" = neither notes nor sound.
 */
export function informeEscucha(datos: {
  compasesPorTramo: number;
  mezcla: NivelTramo[];
  pistas: PistaEscuchada[];
  sinCargar?: string[];
}): string {
  const tramos = datos.mezcla.length;
  const rotulos = Array.from({ length: tramos }, (_, i) => `${i * datos.compasesPorTramo + 1}-${(i + 1) * datos.compasesPorTramo}`);
  const ancho = Math.max(5, ...rotulos.map((r) => r.length));
  const nombres = ["bars", "MIX", ...datos.pistas.map((p) => p.nombre + (p.muted ? " (muted)" : ""))];
  const anchoNombre = Math.min(24, Math.max(...nombres.map((n) => n.length)));
  const fila = (nombre: string, celdas: string[]): string =>
    `${nombre.slice(0, anchoNombre).padEnd(anchoNombre)} ${celdas.map((c) => c.padStart(ancho)).join(" ")}`;

  const lineas = [
    `Listening through the openDAW engine (the same one as Play). RMS in dBFS per span of ${datos.compasesPorTramo} bars; ` +
      `SILENT = there are notes and no sound comes out; · = neither notes nor sound.`,
    fila("bars", rotulos),
    fila("MIX", datos.mezcla.map((n) => celda(n, 1))),
    ...datos.pistas.map((p) => fila(nombres[datos.pistas.indexOf(p) + 2]!, p.niveles.map((n, i) => celda(n, p.notas[i] ?? 0)))),
  ];

  const problemas: string[] = [];
  for (const pista of datos.pistas) {
    const mudos = pista.niveles.flatMap((n, i) => ((pista.notas[i] ?? 0) > 0 && n.picoDb < UMBRAL_SILENCIO_DB ? [rotulos[i]!] : []));
    const conNotas = pista.notas.filter((n) => n > 0).length;
    if (mudos.length > 0 && mudos.length === conNotas) {
      problemas.push(`"${pista.nombre}" does not play in ANY span with notes: the instrument does not load or produces no signal (it is not a volume issue).`);
    } else if (mudos.length > 0) {
      problemas.push(`"${pista.nombre}" has notes and does not play in bars ${mudos.join(", ")}.`);
    }
  }
  const picoMezcla = Math.max(...datos.mezcla.map((n) => n.picoDb));
  if (picoMezcla > 0) problemas.push(`The mix goes above 0 dBFS (peak ${picoMezcla.toFixed(1)} dB): it clips. Lower the master or the loudest tracks.`);
  for (const archivo of datos.sinCargar ?? []) problemas.push(`Could not load ${archivo}: that track does not have its instrument in the render.`);

  lineas.push(problemas.length > 0 ? `PROBLEMS:\n- ${problemas.join("\n- ")}` : "No problems: every track plays where it has notes.");
  return lineas.join("\n");
}
