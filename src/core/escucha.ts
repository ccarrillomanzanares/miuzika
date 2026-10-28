/**
 * «Escuchar» la mezcla con números: nivel por tramos de compases de lo que sale del
 * motor de openDAW, pista a pista, frente a dónde hay notas.
 *
 * Por qué existe (ESTADO 28-oct, pendiente 7): el agente diagnosticaba «de oído» con
 * su propio render numpy, que no es lo que suena en openDAW. En «Hard» dijo que el
 * piano sonaba mientras Carlos no lo oía, y acabó añadiendo 2 compases de silencio
 * como parche. Aquí se mide el render del motor real y se cruza con las notas: una
 * pista con notas en un tramo y sin señal es un fallo que se ve sin oírlo.
 */

import type { Track } from "./types.ts";

/** Por debajo de este pico (dBFS) un tramo cuenta como silencio. Un pad flojo a −40 dB sí suena; un SF2 que no carga da −∞. */
export const UMBRAL_SILENCIO_DB = -70;

export interface NivelTramo {
  /** RMS en dBFS (−Infinity si es cero digital). */
  rmsDb: number;
  picoDb: number;
}

export interface PistaEscuchada {
  nombre: string;
  muted: boolean;
  /** Notas (o clips de audio) que suenan en cada tramo. */
  notas: number[];
  niveles: NivelTramo[];
}

function db(valor: number): number {
  return valor > 0 ? 20 * Math.log10(valor) : -Infinity;
}

/**
 * Cuántas notas suenan en cada tramo [i·tamaño, (i+1)·tamaño) en tiempos. Una nota
 * cuenta en todos los tramos que pisa (un pad de 8 compases cuenta en dos). Un clip
 * de audio cuenta como 1 en cada tramo que cubre.
 */
export function notasPorTramo(pista: Pick<Track, "clips">, tiemposPorTramo: number, tramos: number): number[] {
  const cuenta = new Array<number>(tramos).fill(0);
  const sumar = (inicio: number, fin: number): void => {
    const primero = Math.max(0, Math.floor(inicio / tiemposPorTramo));
    // `fin` es exclusivo: una nota que acaba justo en el borde no pisa el tramo siguiente.
    const ultimo = Math.min(tramos - 1, Math.ceil(fin / tiemposPorTramo) - 1);
    for (let i = primero; i <= ultimo; i += 1) cuenta[i]! += 1;
  };
  for (const clip of pista.clips) {
    if (clip.audio) {
      sumar(clip.start, clip.start + clip.length);
      continue;
    }
    for (const nota of clip.notes) {
      // Lo que cae fuera del clip no suena: el clip recorta.
      if (nota.start >= clip.length) continue;
      const fin = Math.min(nota.start + nota.duration, clip.length);
      sumar(clip.start + nota.start, clip.start + fin);
    }
  }
  return cuenta;
}

/** RMS y pico de cada tramo, con los canales mezclados a mono para el RMS. */
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
  if (mudo) return notas > 0 ? "MUDO" : "·";
  return String(Math.round(nivel.rmsDb));
}

/**
 * El informe para el agente: una tabla (filas = mezcla y pistas, columnas = tramos)
 * con el RMS en dBFS, y debajo los problemas en palabras. «MUDO» = hay notas y no
 * sale nada; «·» = ni notas ni sonido.
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
  const nombres = ["compases", "MEZCLA", ...datos.pistas.map((p) => p.nombre + (p.muted ? " (muted)" : ""))];
  const anchoNombre = Math.min(24, Math.max(...nombres.map((n) => n.length)));
  const fila = (nombre: string, celdas: string[]): string =>
    `${nombre.slice(0, anchoNombre).padEnd(anchoNombre)} ${celdas.map((c) => c.padStart(ancho)).join(" ")}`;

  const lineas = [
    `Escucha con el motor de openDAW (el mismo que el Play). RMS en dBFS por tramos de ${datos.compasesPorTramo} compases; ` +
      `MUDO = hay notas y no sale sonido; · = ni notas ni sonido.`,
    fila("compases", rotulos),
    fila("MEZCLA", datos.mezcla.map((n) => celda(n, 1))),
    ...datos.pistas.map((p) => fila(nombres[datos.pistas.indexOf(p) + 2]!, p.niveles.map((n, i) => celda(n, p.notas[i] ?? 0)))),
  ];

  const problemas: string[] = [];
  for (const pista of datos.pistas) {
    const mudos = pista.niveles.flatMap((n, i) => ((pista.notas[i] ?? 0) > 0 && n.picoDb < UMBRAL_SILENCIO_DB ? [rotulos[i]!] : []));
    const conNotas = pista.notas.filter((n) => n > 0).length;
    if (mudos.length > 0 && mudos.length === conNotas) {
      problemas.push(`«${pista.nombre}» no suena en NINGÚN tramo con notas: el instrumento no carga o no produce señal (no es cuestión de volumen).`);
    } else if (mudos.length > 0) {
      problemas.push(`«${pista.nombre}» tiene notas y no suena en los compases ${mudos.join(", ")}.`);
    }
  }
  const picoMezcla = Math.max(...datos.mezcla.map((n) => n.picoDb));
  if (picoMezcla > 0) problemas.push(`La mezcla pasa de 0 dBFS (pico ${picoMezcla.toFixed(1)} dB): recorta. Baja el master o las pistas más fuertes.`);
  for (const archivo of datos.sinCargar ?? []) problemas.push(`No se pudo cargar ${archivo}: esa pista no tiene su instrumento en el render.`);

  lineas.push(problemas.length > 0 ? `PROBLEMAS:\n- ${problemas.join("\n- ")}` : "Sin problemas: cada pista suena donde tiene notas.");
  return lineas.join("\n");
}
