/**
 * Playable instruments from the sample library (VCSL's .sfz files).
 *
 * Measured on Oct 27: the library has two real grand pianos (Steinway B and
 * Kawai), organs, harpsichords, harps, saxophone, and mallets, but the agent only
 * saw the General MIDI list and never used them. This builds the list it sees
 * (grouped and without technical variants) and resolves the name it asks for to
 * its .sfz file.
 *
 * No DOM and no network: tested with `node --test`.
 */

import { normalizarTexto } from "./nombres.ts";

export interface InstrumentoBiblioteca {
  /** "Grand Piano, Steinway B" or "Pipe Organ - Quiet": what the agent asks for. */
  nombre: string;
  /** Path from workspace/: "catalogo/VCSL-1.2.2-RC/…/Grand Piano, Steinway B.sfz". */
  ruta: string;
  familia: string;
}

/** Families in the order they are shown (the first matching rule wins). */
const FAMILIAS: [string, RegExp][] = [
  ["Pianos and keyboards", /piano|harpsichord|tx81z|clavisynth/i],
  ["Organs", /organ/i],
  ["Plucked strings", /harp|strumstick|dan tranh|psaltery|kalimba|mbira|nyunga/i],
  ["Winds", /recorder|ocarina|harmonica|saxello|saxophone|didgeridoo|whistle|siren/i],
  ["Mallets and bells", /glockenspiel|marimba|vibraphone|xylophone|tubular bells|hand bells|hand chimes|balafon|wine glasses|mark trees/i],
  ["Percussion", /./],
];

/** Variants that are not useful when playing from the piano roll. */
const DESCARTE = /keyswitch|legacy/i;

/** .sfz paths (from workspace/) → instruments that can be used. */
export function instrumentosDeSfz(rutas: readonly string[]): InstrumentoBiblioteca[] {
  return rutas
    .filter((ruta) => ruta.toLowerCase().endsWith(".sfz"))
    .map((ruta) => {
      const nombre = (ruta.split("/").pop() ?? ruta).replace(/\.sfz$/i, "");
      const familia = FAMILIAS.find(([, patron]) => patron.test(nombre))![0];
      return { nombre, ruta, familia };
    })
    .filter((instrumento) => !DESCARTE.test(instrumento.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Compact list for the model: by family, with the variants of the same
 * instrument together ("Pipe Organ - Loud/Quiet/…").
 */
export function textoDeBiblioteca(instrumentos: readonly InstrumentoBiblioteca[]): string {
  if (instrumentos.length === 0) return "";
  const lineas = [
    `SAMPLE LIBRARY (${instrumentos.length} real recorded instruments, VCSL). They sound better than ` +
      "General MIDI on piano, organ, harpsichord, harp, saxophone, and mallets. Use them with " +
      "usar_instrumento(sfz = the exact name, e.g. \"Grand Piano, Steinway B\"):",
  ];
  for (const [familia] of FAMILIAS) {
    const deFamilia = instrumentos.filter((i) => i.familia === familia);
    if (deFamilia.length === 0) continue;
    const bases = new Map<string, string[]>();
    for (const { nombre } of deFamilia) {
      const [base, variante] = nombre.split(/ - (.+)/);
      const lista = bases.get(base!) ?? [];
      if (variante) lista.push(variante);
      bases.set(base!, lista);
    }
    const partes = [...bases.entries()].map(([base, variantes]) =>
      variantes.length === 0 ? base : `${base} - ${variantes.join("/")}`,
    );
    lineas.push(`${familia}: ${partes.join(" · ")}`);
  }
  return lineas.join("\n");
}

/** Preferred variant when only the base is requested ("Pipe Organ" → "… - Quiet"). */
const PREFERIDAS = ["normal", "sustain", "sus", "non-vibrato", "quiet", "pluck", "soft mallets", "hit"];

/**
 * Name (or path) requested by the model → the instrument. Accepts the exact name,
 * without accents or capitalization, just the base of an instrument with variants,
 * or part of the name if only one instrument contains it.
 */
export function resolverInstrumento(
  pedido: string,
  instrumentos: readonly InstrumentoBiblioteca[],
): { instrumento?: InstrumentoBiblioteca; error?: string } {
  const limpio = normalizarTexto(pedido.replace(/\\/g, "/").split("/").pop()!.replace(/\.sfz$/i, ""));
  if (limpio === "") return { error: "missing the instrument name" };
  const exacto = instrumentos.find((i) => normalizarTexto(i.nombre) === limpio);
  if (exacto) return { instrumento: exacto };
  const variantes = instrumentos.filter((i) => normalizarTexto(i.nombre).startsWith(`${limpio} - `));
  if (variantes.length > 0) {
    const preferida = PREFERIDAS.map((p) =>
      variantes.find((i) => normalizarTexto(i.nombre).endsWith(` - ${p}`)),
    ).find(Boolean);
    return { instrumento: preferida ?? variantes[0]! };
  }
  const contienen = instrumentos.filter((i) => normalizarTexto(i.nombre).includes(limpio));
  if (contienen.length === 1) return { instrumento: contienen[0]! };
  const sugerencias = (contienen.length > 0 ? contienen : instrumentos)
    .slice(0, 12)
    .map((i) => i.nombre)
    .join(" · ");
  return {
    error:
      contienen.length > 1
        ? `"${pedido}" matches several: ${sugerencias}. Pick one.`
        : `There is no instrument "${pedido}" in the library. See the list with listar_instrumentos.`,
  };
}
