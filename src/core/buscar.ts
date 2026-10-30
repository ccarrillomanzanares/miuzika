/**
 * Catalog search from natural language.
 *
 * The model does not have to memorize the catalog: it turns the request into
 * **tags** (taxonomia.ts) and this search resolves it against what exists. Besides
 * text, it filters by measured character (short, bright, low…), which is what
 * distinguishes two kicks with the same name.
 */

import { etiquetasEnFrase, normalizar } from "./taxonomia.ts";

export interface Perfil {
  duracion_s?: number;
  centroide_hz?: number;
  crest_db?: number;
  cola_ms?: number;
  rms_dbfs?: number;
}

export interface EntradaCatalogo {
  clave: string;
  etiqueta: string;
  familia: string;
  descripcion: string;
  destino?: "cpu" | "gpu";
  params?: { clave: string; min?: number; max?: number; defecto?: unknown }[];
  /** Taxonomy tag id, if the catalog declares one. */
  taxonomia?: string;
  perfil?: Perfil;
  /** WAV path if it is an already-rendered sample. */
  ruta?: string;
  /** Already-normalized text (filled in by the indexer: 4,231 entries × N queries
   *  is too much work to normalize on every search). */
  normTexto?: string;
  normClave?: string;
}

export interface OpcionesBusqueda {
  familia?: string;
  /** Only voices that can be rendered (with no input material). */
  usables?: boolean;
  limite?: number;
}

export interface Resultado {
  entrada: EntradaCatalogo;
  puntuacion: number;
  motivos: string[];
  /** Whether it matched a taxonomy tag (not just the family). */
  etiqueta: boolean;
}

/** Character thresholds: the same for voices and for samples. */
const CARACTER: Record<string, (p: Perfil) => boolean> = {
  corto: (p) => (p.duracion_s ?? 99) <= 0.8,
  largo: (p) => (p.duracion_s ?? 0) >= 1.5,
  brillante: (p) => (p.centroide_hz ?? 0) >= 4000,
  oscuro: (p) => (p.centroide_hz ?? 9999) <= 1200,
  agudo: (p) => (p.centroide_hz ?? 0) >= 3000,
  grave: (p) => (p.centroide_hz ?? 9999) <= 500,
  seco: (p) => (p.cola_ms ?? 9999) <= 250,
  sucio: (p) => (p.crest_db ?? 99) <= 8,
  limpio: (p) => (p.crest_db ?? 0) >= 14,
};

/** The same character words in English: the query arrives in Spanish or English. */
const CARACTER_EN: Record<string, string> = {
  short: "corto",
  long: "largo",
  bright: "brillante",
  dark: "oscuro",
  high: "agudo",
  low: "grave",
  deep: "grave",
  dry: "seco",
  dirty: "sucio",
  clean: "limpio",
};

/** Character words from an already-normalized query, without duplicates. */
function caracteresDe(texto: string): string[] {
  const palabras = new Set(texto.split(" "));
  const encontrados = Object.keys(CARACTER).filter((c) => texto.includes(c));
  for (const [ingles, clave] of Object.entries(CARACTER_EN)) {
    if (palabras.has(ingles) && !encontrados.includes(clave)) encontrados.push(clave);
  }
  return encontrados;
}

/**
 * Resolves a natural-language query against a catalog.
 *
 * Scoring: matching the taxonomy tag is worth more than matching the name, and the
 * measured character adds points. It also returns **why** it scored, so the agent
 * can explain its choice instead of making it up.
 */
export function buscarEnCatalogo(
  catalogo: EntradaCatalogo[],
  consulta: string,
  opciones: OpcionesBusqueda = {},
): Resultado[] {
  const texto = normalizar(consulta);
  const etiquetas = etiquetasEnFrase(consulta);
  const palabras = texto.split(" ").filter((p) => p.length >= 3);
  const caracteres = caracteresDe(texto);
  const resultados: Resultado[] = [];

  // The large catalog (4,231 entries) is queried with `includes` on already
  // normalized text with spaces at the edges: comparing by word without building a
  // regular expression per alias and per entry (that took seconds).
  const espacios = (texto: string): string => ` ${normalizar(texto)} `;
  // What does not change per entry is computed once, not 4,231 times.
  const objetivos = etiquetas.map((etiqueta) => ({
    etiqueta,
    nombres: [etiqueta.es, etiqueta.en, ...etiqueta.alias].map(espacios),
    idNormalizado: normalizar(etiqueta.id),
  }));
  const familiaBuscada = new Map(objetivos.map((o) => [o.etiqueta.id, normalizar(o.etiqueta.familia)]));
  const palabrasConEspacio = palabras.map((p) => ` ${p}`);

  for (const entrada of catalogo) {
    if (opciones.familia && entrada.familia !== opciones.familia) continue;
    let puntuacion = 0;
    let coincideEtiqueta = false;
    const motivos: string[] = [];
    const nombre =
      entrada.normTexto !== undefined
        ? ` ${entrada.normTexto} `
        : espacios(`${entrada.clave} ${entrada.etiqueta} ${entrada.descripcion}`);
    const claveNormalizada = entrada.normClave ?? normalizar(entrada.clave);

    const familiaEntrada = normalizar(entrada.familia);
    const etiquetaNormalizada = espacios(entrada.etiqueta);
    for (const objetivo of objetivos) {
      const { etiqueta } = objetivo;
      const coincideId =
        entrada.taxonomia === etiqueta.id ||
        normalizar(entrada.clave) === objetivo.idNormalizado ||
        etiquetaNormalizada.includes(espacios(etiqueta.es)) ||
        objetivo.nombres.some((n) => nombre.includes(n));
      if (coincideId) {
        puntuacion += 10;
        coincideEtiqueta = true;
        motivos.push(`is "${etiqueta.es}"`);
      } else if (familiaEntrada === familiaBuscada.get(etiqueta.id)) {
        puntuacion += 2;
        motivos.push(`same family (${etiqueta.familia})`);
      }
    }

    for (let i = 0; i < palabras.length; i += 1) {
      const palabra = palabras[i] as string;
      if (claveNormalizada.includes(palabra) || nombre.includes(palabrasConEspacio[i] as string)) {
        puntuacion += 4;
        if (!motivos.includes(`says "${palabra}"`)) motivos.push(`says "${palabra}"`);
      }
    }

    if (caracteres.length > 0 && entrada.perfil) {
      for (const caracter of caracteres) {
        if (CARACTER[caracter](entrada.perfil)) {
          puntuacion += 6;
          motivos.push(`sounds ${caracter}`);
        }
      }
    }

    if (puntuacion > 0) resultados.push({ entrada, puntuacion, motivos, etiqueta: coincideEtiqueta });
  }

  resultados.sort((a, b) => b.puntuacion - a.puntuacion || a.entrada.clave.localeCompare(b.entrada.clave));
  // If the user named something specific ("china"), we do not want back everything
  // that sounds dirty: only what is that instrument.
  const conEtiqueta = resultados.filter((r) => r.etiqueta);
  const utiles = conEtiqueta.length > 0 ? conEtiqueta : resultados;
  return utiles.slice(0, opciones.limite ?? 8);
}

