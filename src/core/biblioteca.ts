/**
 * Instrumentos tocables de la biblioteca de samples (los .sfz de VCSL).
 *
 * Medido el 27-oct: la biblioteca tiene dos pianos de cola reales (Steinway B y
 * Kawai), órganos, clavecines, arpas, saxo y láminas, pero el agente sólo veía la
 * lista General MIDI y nunca los usaba. Aquí se arma la lista que ve (agrupada y
 * sin variantes técnicas) y se resuelve el nombre que pida a su .sfz.
 *
 * Sin DOM y sin red: se prueba con `node --test`.
 */

import { normalizarTexto } from "./nombres.ts";

export interface InstrumentoBiblioteca {
  /** «Grand Piano, Steinway B» o «Pipe Organ - Quiet»: lo que pide el agente. */
  nombre: string;
  /** Ruta desde workspace/: «catalogo/VCSL-1.2.2-RC/…/Grand Piano, Steinway B.sfz». */
  ruta: string;
  familia: string;
}

/** Familias en el orden en que se enseñan (la primera regla que encaja gana). */
const FAMILIAS: [string, RegExp][] = [
  ["Pianos y teclados", /piano|harpsichord|tx81z|clavisynth/i],
  ["Órganos", /organ/i],
  ["Cuerda pulsada", /harp|strumstick|dan tranh|psaltery|kalimba|mbira|nyunga/i],
  ["Viento", /recorder|ocarina|harmonica|saxello|saxophone|didgeridoo|whistle|siren/i],
  ["Láminas y campanas", /glockenspiel|marimba|vibraphone|xylophone|tubular bells|hand bells|hand chimes|balafon|wine glasses|mark trees/i],
  ["Percusión", /./],
];

/** Variantes que no sirven tocando desde el piano roll. */
const DESCARTE = /keyswitch|legacy/i;

/** Rutas de .sfz (desde workspace/) → instrumentos que se pueden usar. */
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
 * Lista compacta para el modelo: por familia, y las variantes de un mismo
 * instrumento juntas («Pipe Organ - Loud/Quiet/…»).
 */
export function textoDeBiblioteca(instrumentos: readonly InstrumentoBiblioteca[]): string {
  if (instrumentos.length === 0) return "";
  const lineas = [
    `BIBLIOTECA DE SAMPLES (${instrumentos.length} instrumentos grabados de verdad, VCSL). Suenan mejor que ` +
      "General MIDI en piano, órgano, clavecín, arpa, saxo y láminas. Úsalos con " +
      "usar_instrumento(sfz = el nombre tal cual, p. ej. «Grand Piano, Steinway B»):",
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

/** Variante preferida cuando se pide sólo la base («Pipe Organ» → «… - Quiet»). */
const PREFERIDAS = ["normal", "sustain", "sus", "non-vibrato", "quiet", "pluck", "soft mallets", "hit"];

/**
 * Nombre (o ruta) que pide el modelo → el instrumento. Admite el nombre exacto, sin
 * tildes ni mayúsculas, sólo la base de un instrumento con variantes, o una parte
 * del nombre si sólo hay uno que la contenga.
 */
export function resolverInstrumento(
  pedido: string,
  instrumentos: readonly InstrumentoBiblioteca[],
): { instrumento?: InstrumentoBiblioteca; error?: string } {
  const limpio = normalizarTexto(pedido.replace(/\\/g, "/").split("/").pop()!.replace(/\.sfz$/i, ""));
  if (limpio === "") return { error: "falta el nombre del instrumento" };
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
        ? `«${pedido}» encaja con varios: ${sugerencias}. Elige uno.`
        : `No hay ningún instrumento «${pedido}» en la biblioteca. Mira la lista con listar_instrumentos.`,
  };
}
