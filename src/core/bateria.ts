/**
 * Batería en rejilla: como en una caja de ritmos, una fila por pieza.
 *
 *     { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." }
 *
 * Cada carácter es un paso (16 por compás por defecto: semicorcheas en 4/4):
 *   `x` golpe normal · `X` acento · `o` medio · `g` nota fantasma · `.` o `-` nada.
 *   `|` se ignora (sirve para separar compases o tiempos al leer).
 * Una fila más larga que un compás ocupa varios; las filas se repiten hasta llenar
 * los compases pedidos. `final` cambia el último compás (el redoble): las piezas
 * que trae se sustituyen ahí; las demás siguen su patrón.
 *
 * Las piezas tienen nombre en varios idiomas (el modelo traduce, pero así falla
 * menos) y siempre se puede dar la nota General MIDI directamente ("36").
 */

import type { Note } from "./types.ts";
import { hashString } from "./rng.ts";

export class ErrorBateria extends Error {}

/** Mapa de percusión General MIDI (canal 10). */
const PIEZAS: Record<number, string[]> = {
  35: ["bombo2", "kick2", "acoustickick"],
  36: ["kick", "bombo", "bd", "bassdrum", "kickdrum"],
  37: ["rim", "aro", "sidestick", "rimshot"],
  38: ["snare", "caja", "sd", "tarola", "redoblante", "snaredrum"],
  39: ["clap", "palmas", "palmada", "handclap"],
  40: ["snare2", "caja2", "electricsnare"],
  41: ["floortom", "tomsuelo", "tom4", "lowfloortom", "tomfloor"],
  42: ["hat", "hh", "hihat", "charles", "closedhat", "chc", "hihatclosed", "closedhihat", "hatclosed"],
  44: ["pedal", "pedalhat", "charlespedal"],
  45: ["lowtom", "tombajo", "tom3", "tomlow", "lotom", "tomlo", "tomgrave"],
  46: ["openhat", "oh", "charlesabierto", "hatabierto", "hihatopen", "openhihat", "hatopen"],
  47: ["midtom", "tommedio", "tom2", "tommid", "lowmidtom", "tom"],
  49: ["crash", "platocrash"],
  50: ["hightom", "tomalto", "tom1", "tomhigh", "hitom", "tomhi", "tomagudo"],
  51: ["ride", "platoride"],
  52: ["china"],
  53: ["bell", "ridebell", "campana"],
  54: ["tambourine", "pandereta"],
  55: ["splash"],
  56: ["cowbell", "cencerro"],
  70: ["shaker", "maracas"],
};

const POR_NOMBRE = new Map<string, number>(
  Object.entries(PIEZAS).flatMap(([nota, nombres]) => nombres.map((n) => [n, Number(nota)] as const)),
);

/** «Caja», «hi-hat», «Tom alto» o «38» → nota General MIDI. */
export function notaDePieza(nombre: string): number {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (/^\d{1,3}$/.test(limpio) && Number(limpio) <= 127) return Number(limpio);
  const nota = POR_NOMBRE.get(limpio);
  if (nota === undefined) {
    const nombres = Object.values(PIEZAS).map((n) => n[0]).join(", ");
    throw new ErrorBateria(`no conozco la pieza «${nombre}». Usa: ${nombres}, o la nota GM (36…81)`);
  }
  return nota;
}

const GOLPES: Record<string, number> = { x: 100, X: 124, o: 76, g: 42 };

export interface PeticionBateria {
  /** pieza → fila de pasos. */
  patrones: Record<string, string>;
  /** Compases que hay que llenar (por defecto, lo que dure la fila más larga). */
  compases?: number;
  /** Pasos por compás (16 = semicorcheas en 4/4; 12 = tresillos de corchea). */
  pasosPorCompas?: number;
  /** Filas para el ÚLTIMO compás (redoble): sustituyen a las de esas piezas. */
  final?: Record<string, string>;
  /** 0..0.5: retrasa los pasos pares (swing). */
  swing?: number;
  /** Pequeña variación determinista de velocidad, para que no suene a máquina. */
  humanizar?: boolean;
}

function pasosDe(fila: string): string[] {
  const pasos = fila.replace(/[|\s]/g, "").split("");
  for (const p of pasos) {
    if (!(p in GOLPES) && p !== "." && p !== "-") {
      throw new ErrorBateria(`carácter «${p}» no válido en «${fila}»: usa x X o g . -`);
    }
  }
  return pasos;
}

export function notasDeBateria(peticion: PeticionBateria, beatsPorCompas = 4): { notas: Note[]; beats: number } {
  const pasosPorCompas = Math.round(peticion.pasosPorCompas ?? 16);
  if (pasosPorCompas < 1 || pasosPorCompas > 64) throw new ErrorBateria("pasosPorCompas va de 1 a 64");
  const paso = beatsPorCompas / pasosPorCompas;
  const filas = Object.entries(peticion.patrones ?? {});
  if (filas.length === 0) throw new ErrorBateria("faltan los patrones (pieza → fila de pasos)");
  const leidas = filas.map(([pieza, fila]) => ({ pieza, nota: notaDePieza(pieza), pasos: pasosDe(fila) }));
  const maxPasos = Math.max(...leidas.map((f) => f.pasos.length));
  const compases = Math.max(1, Math.round(peticion.compases ?? Math.ceil(maxPasos / pasosPorCompas)));
  const totalPasos = compases * pasosPorCompas;
  const final = peticion.final
    ? Object.entries(peticion.final).map(([pieza, fila]) => ({ nota: notaDePieza(pieza), pasos: pasosDe(fila) }))
    : null;
  const inicioFinal = final ? (compases - 1) * pasosPorCompas : Infinity;
  const swing = Math.min(0.5, Math.max(0, peticion.swing ?? 0));

  const notas: Note[] = [];
  const poner = (nota: number, i: number, golpe: string): void => {
    let velocidad = GOLPES[golpe]!;
    if (peticion.humanizar) velocidad += (hashString(`${nota}:${i}`) % 13) - 6;
    const retraso = i % 2 === 1 ? swing * paso : 0;
    notas.push({
      pitch: nota,
      start: Number((i * paso + retraso).toFixed(4)),
      duration: Number(Math.min(paso, 0.25).toFixed(4)),
      velocity: Math.min(127, Math.max(1, velocidad)),
    });
  };
  const enFinal = new Set((final ?? []).map((f) => f.nota));
  for (const fila of leidas) {
    if (fila.pasos.length === 0) continue;
    const hasta = enFinal.has(fila.nota) ? Math.min(totalPasos, inicioFinal) : totalPasos;
    for (let i = 0; i < hasta; i += 1) {
      const golpe = fila.pasos[i % fila.pasos.length]!;
      if (golpe in GOLPES) poner(fila.nota, i, golpe);
    }
  }
  if (final) {
    for (const fila of final) {
      for (let j = 0; j < pasosPorCompas && j < fila.pasos.length; j += 1) {
        const golpe = fila.pasos[j]!;
        if (golpe in GOLPES) poner(fila.nota, inicioFinal + j, golpe);
      }
    }
  }
  notas.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notas, beats: compases * beatsPorCompas };
}
