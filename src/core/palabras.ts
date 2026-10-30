/**
 * The vocabulary of sound: what the user says, translated into movements.
 *
 * Each word is not a button, it is a **push** on a few parameters. Adding up
 * "short, fat, and dirty" means adding up their pushes. Opposites work by axes: if
 * you ask for two on the same axis, the last one wins and you are told about it
 * (they are not canceled silently).
 *
 * Pushes are applied first to the voice parameter, if it exists, and always to the
 * post-processing, which works on any voice. So "shorter" does something even on a
 * kick, whose duration is fixed in code.
 */

import { normalizarTexto } from "./nombres.ts";
import type { ArgsSonido, PostSonido, RecetaSonido, VozSonido } from "./sonidos.ts";

export type Eje = "duracion" | "tono" | "brillo" | "suciedad" | "caracter" | "cuerpo";

export interface Movimiento {
  /** Voice parameter (`arg`) or post-processing parameter (`post`). */
  destino: "arg" | "post";
  clave: string;
  /** Multiplies the current value (for relative parameters). */
  factor?: number;
  /** Adds to the current value (for post parameters). */
  suma?: number;
}

export interface Palabra {
  clave: string;
  etiqueta: string;
  /** If it belongs to an axis, its opposite occupies the same one. */
  eje?: Eje;
  movimientos: Movimiento[];
}

export const PALABRAS: Palabra[] = [
  {
    clave: "corto",
    etiqueta: "Corto",
    eje: "duracion",
    movimientos: [
      { destino: "arg", clave: "dur", factor: 0.6 },
      { destino: "post", clave: "cola", factor: 0.7 },
    ],
  },
  {
    clave: "largo",
    etiqueta: "Largo",
    eje: "duracion",
    movimientos: [
      { destino: "arg", clave: "dur", factor: 1.6 },
      { destino: "post", clave: "cola", factor: 1.4 },
    ],
  },
  {
    clave: "grave",
    etiqueta: "Grave",
    eje: "tono",
    movimientos: [
      { destino: "arg", clave: "pitch", factor: 0.8 },
      { destino: "arg", clave: "f0", factor: 0.85 },
      { destino: "arg", clave: "midi", suma: -5 },
      { destino: "arg", clave: "cutoff", factor: 0.7 },
    ],
  },
  {
    clave: "agudo",
    etiqueta: "Agudo",
    eje: "tono",
    movimientos: [
      { destino: "arg", clave: "pitch", factor: 1.25 },
      { destino: "arg", clave: "f0", factor: 1.2 },
      { destino: "arg", clave: "midi", suma: 5 },
      { destino: "arg", clave: "cutoff", factor: 1.4 },
    ],
  },
  {
    clave: "gordo",
    etiqueta: "Gordo",
    eje: "cuerpo",
    movimientos: [
      { destino: "arg", clave: "pitch", factor: 0.9 },
      { destino: "post", clave: "cuerpo", suma: 0.5 },
    ],
  },
  {
    clave: "hueco",
    etiqueta: "Hueco",
    eje: "cuerpo",
    movimientos: [{ destino: "post", clave: "cuerpo", suma: -0.5 }],
  },
  {
    clave: "seco",
    etiqueta: "Seco",
    movimientos: [
      { destino: "post", clave: "cola", factor: 0.5 },
      { destino: "post", clave: "brillo", suma: 0.15 },
    ],
  },
  {
    clave: "brillante",
    etiqueta: "Brillante",
    eje: "brillo",
    movimientos: [
      { destino: "post", clave: "brillo", suma: 0.5 },
      { destino: "arg", clave: "bright", factor: 1.3 },
      { destino: "arg", clave: "cutoff", factor: 1.4 },
    ],
  },
  {
    clave: "oscuro",
    etiqueta: "Oscuro",
    eje: "brillo",
    movimientos: [
      { destino: "post", clave: "brillo", suma: -0.5 },
      { destino: "arg", clave: "bright", factor: 0.7 },
      { destino: "arg", clave: "cutoff", factor: 0.7 },
    ],
  },
  {
    clave: "sucio",
    etiqueta: "Sucio",
    eje: "suciedad",
    movimientos: [{ destino: "post", clave: "suciedad", suma: 0.5 }],
  },
  {
    clave: "limpio",
    etiqueta: "Limpio",
    eje: "suciedad",
    movimientos: [{ destino: "post", clave: "suciedad", suma: -0.5 }],
  },
  {
    clave: "metalico",
    etiqueta: "Metálico",
    movimientos: [
      { destino: "post", clave: "brillo", suma: 0.3 },
      { destino: "post", clave: "suciedad", suma: 0.1 },
    ],
  },
  {
    clave: "agresivo",
    etiqueta: "Agresivo",
    eje: "caracter",
    movimientos: [
      { destino: "post", clave: "suciedad", suma: 0.3 },
      { destino: "post", clave: "brillo", suma: 0.2 },
    ],
  },
  {
    clave: "redondo",
    etiqueta: "Redondo",
    eje: "caracter",
    movimientos: [
      { destino: "post", clave: "suciedad", suma: -0.2 },
      { destino: "post", clave: "brillo", suma: -0.1 },
      { destino: "post", clave: "cola", factor: 1.2 },
    ],
  },
  {
    clave: "chillon",
    etiqueta: "Chillón",
    movimientos: [{ destino: "post", clave: "brillo", suma: 0.7 }],
  },
  {
    clave: "apagado",
    etiqueta: "Apagado",
    movimientos: [
      { destino: "post", clave: "brillo", suma: -0.6 },
      { destino: "post", clave: "cola", factor: 0.8 },
    ],
  },
];

/** Range of each post parameter, so adding does not go outside it. */
const LIMITES_POST: Record<string, [number, number]> = {
  brillo: [-1, 1],
  suciedad: [0, 1],
  cola: [0.25, 4],
  cuerpo: [-1, 1],
};

const normalizar = normalizarTexto;

/** Looks up a vocabulary word by its key or its label, with or without accents. */
export function buscarPalabra(texto: string): Palabra | undefined {
  const buscado = normalizar(texto);
  return PALABRAS.find((p) => p.clave === buscado || normalizar(p.etiqueta) === buscado);
}

export interface ResultadoPalabras {
  receta: RecetaSonido;
  aplicadas: string[];
  descartadas: { palabra: string; motivo: string }[];
  avisos: string[];
}

/**
 * Applies the words to a recipe. Returns a new recipe (it does not touch the input
 * one), the words that were applied, those discarded due to conflict, and warnings
 * for words that do not exist.
 */
export function aplicarPalabras(
  receta: RecetaSonido,
  pedidas: string[],
  voz: VozSonido | undefined,
): ResultadoPalabras {
  const args: ArgsSonido = { ...receta.args };
  const post: PostSonido = { ...receta.post };
  const avisos: string[] = [];
  const descartadas: { palabra: string; motivo: string }[] = [];

  const resueltas: Palabra[] = [];
  for (const pedida of pedidas) {
    const palabra = buscarPalabra(pedida);
    if (!palabra) {
      avisos.push(`I don't know "${pedida}". Available: ${PALABRAS.map((p) => p.clave).join(", ")}.`);
      continue;
    }
    resueltas.push(palabra);
  }

  // One axis, one word: the last one wins and the previous one is discarded with a reason.
  const porEje = new Map<Eje, Palabra>();
  for (const palabra of resueltas) {
    if (!palabra.eje) continue;
    const previa = porEje.get(palabra.eje);
    if (previa) {
      descartadas.push({
        palabra: previa.clave,
        motivo: `"${previa.clave}" and "${palabra.clave}" contradict each other (${palabra.eje}); the last one applies`,
      });
      resueltas.splice(resueltas.indexOf(previa), 1);
    }
    porEje.set(palabra.eje, palabra);
  }

  const aplicadas: string[] = [];
  for (const palabra of resueltas) {
    for (const mov of palabra.movimientos) {
      if (mov.destino === "arg") {
        const param = voz?.params.find((p) => p.clave === mov.clave);
        const actual = args[mov.clave];
        if (!param || typeof actual !== "number") continue; // the voice does not have it: post will handle it
        let valor = actual;
        if (mov.factor !== undefined) valor *= mov.factor;
        if (mov.suma !== undefined) valor += mov.suma;
        const min = param.min ?? -Infinity;
        const max = param.max ?? Infinity;
        args[mov.clave] = Math.min(max, Math.max(min, valor));
        continue;
      }
      const limites = LIMITES_POST[mov.clave];
      if (!limites) continue;
      let valor = post[mov.clave as keyof PostSonido] as number;
      if (mov.factor !== undefined) valor *= mov.factor;
      if (mov.suma !== undefined) valor += mov.suma;
      (post as unknown as Record<string, number>)[mov.clave] = Math.min(
        limites[1],
        Math.max(limites[0], valor),
      );
    }
    aplicadas.push(palabra.clave);
  }

  return {
    receta: { ...receta, args, post, palabras: aplicadas },
    aplicadas,
    descartadas,
    avisos,
  };
}

