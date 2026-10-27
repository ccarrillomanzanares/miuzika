/**
 * Composición como dato: de una progresión (símbolos o grados) a notas.
 *
 * Es la otra mitad de `theory.ts`, que tenía acordes, grados y voicings con tests
 * pero nadie lo llamaba: el agente componía escribiendo un script de Python que
 * generaba un `.mid`. Aquí la armonía se escribe directamente en el proyecto, como
 * notas de una pista, y por tanto se ve en el piano roll, se deshace con Ctrl+Z y
 * se guarda en `proyecto.json` como cualquier otra edición.
 *
 * Sin DOM y sin red: se prueba con `node --test`.
 */

import type { KeySignature, Note } from "./types.ts";
import { chordToMidi, diatonicTriad, parseChord } from "./theory.ts";

/** Cómo se toca cada acorde. */
export const PATRONES = ["bloque", "pulso", "arpegio", "bajo", "alberti"] as const;
export type Patron = (typeof PATRONES)[number];

export interface PeticionProgresion {
  /** Símbolos de acorde: "Am", "F", "C/E", "G7", "Bbmaj7". Tiene prioridad sobre `grados`. */
  acordes?: string[];
  /** Grados de la escala del proyecto, desde 1: [1, 6, 4, 5] = I-vi-IV-V en mayor. */
  grados?: number[];
  /** Compases que dura cada acorde (por defecto 1). */
  compasesPorAcorde?: number;
  /** Octava de referencia del acorde (C4 = 60). Por defecto 4; el patrón «bajo», 2. */
  octava?: number;
  patron?: Patron;
  /** Paso de pulso y arpegio, en negras (0.5 = corcheas). Por defecto 0.5; «bajo», 1. */
  paso?: number;
  /** 1..127. Por defecto 90. */
  velocidad?: number;
  /** Repeticiones de la progresión entera (por defecto 1). */
  repeticiones?: number;
}

export interface ResultadoProgresion {
  notas: Note[];
  /** Los acordes tal como se han tocado, en orden (sin repeticiones). */
  acordes: string[];
  /** Duración total en negras. */
  beats: number;
}

function acotar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/** Resuelve la lista de símbolos de acorde a partir de la petición y la tonalidad. */
export function acordesDe(key: KeySignature, peticion: PeticionProgresion): string[] {
  if (peticion.acordes && peticion.acordes.length > 0) {
    // parseChord lanza con un mensaje claro si un símbolo no se entiende.
    for (const simbolo of peticion.acordes) parseChord(simbolo);
    return peticion.acordes.map((simbolo) => simbolo.trim());
  }
  if (peticion.grados && peticion.grados.length > 0) {
    return peticion.grados.map((grado) => {
      if (!Number.isInteger(grado) || grado < 1 || grado > 7) {
        throw new Error(`Grado no válido: ${grado} (van del 1 al 7)`);
      }
      return diatonicTriad(key, grado - 1);
    });
  }
  throw new Error("Hace falta `acordes` (p. ej. [\"Am\",\"F\",\"C\",\"G\"]) o `grados` (p. ej. [1,6,4,5]).");
}

/**
 * Voicing cercano al anterior: de todas las inversiones y desplazamientos de
 * octava, el que menos mueve el centro de gravedad. Es la conducción de voces
 * mínima que hace que una progresión de bloques no salte por el teclado.
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

/** Fundamental (o bajo del acorde con barra) en la octava pedida. */
function bajoDe(simbolo: string, octava: number): number {
  const acorde = parseChord(simbolo);
  const clase = acorde.bass ?? acorde.root;
  return (octava + 1) * 12 + clase;
}

/**
 * Notas de una progresión, con tiempos relativos al inicio del clip (en negras).
 * `beatsPorCompas` sale del compás del proyecto (4 en 4/4).
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

  // El primer acorde se coloca alrededor del centro de la octava pedida (F4 con la
  // octava 4), no con la fundamental en ella: un La menor en octava 4 suena en
  // C4-E4-A4, no en A4-E5, que para un pad es demasiado agudo.
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
            // Acento suave en la primera de cada compás: suena a músico, no a rejilla.
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
          // Grave-agudo-medio-agudo: el acompañamiento clásico de mano izquierda.
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
