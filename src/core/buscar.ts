/**
 * Búsqueda en el catálogo a partir de lenguaje natural.
 *
 * El modelo no tiene que saberse el catálogo de memoria: convierte la petición en
 * **etiquetas** (taxonomia.ts) y esta búsqueda la resuelve contra lo que hay. Además
 * de por texto, filtra por carácter medido (corto, brillante, grave…), que es lo que
 * distingue dos bombos del mismo nombre.
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
  /** Id de la etiqueta de la taxonomía, si el catálogo la declara. */
  taxonomia?: string;
  perfil?: Perfil;
  /** Ruta del WAV si es un sample ya renderizado. */
  ruta?: string;
  /** Texto ya normalizado (lo rellena quien indexa: 4.231 entradas × N consultas
   *  es demasiado trabajo para normalizar en cada búsqueda). */
  normTexto?: string;
  normClave?: string;
}

export interface OpcionesBusqueda {
  familia?: string;
  /** Solo voces que se puedan renderizar (sin material de entrada). */
  usables?: boolean;
  limite?: number;
}

export interface Resultado {
  entrada: EntradaCatalogo;
  puntuacion: number;
  motivos: string[];
  /** Si ha coincidido con una etiqueta de la taxonomía (no sólo con la familia). */
  etiqueta: boolean;
}

/** Umbrales de carácter: son los mismos para voces y para samples. */
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

/** Las mismas palabras de carácter en inglés: la consulta llega en español o en inglés. */
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

/** Palabras de carácter de una consulta ya normalizada, sin repetir. */
function caracteresDe(texto: string): string[] {
  const palabras = new Set(texto.split(" "));
  const encontrados = Object.keys(CARACTER).filter((c) => texto.includes(c));
  for (const [ingles, clave] of Object.entries(CARACTER_EN)) {
    if (palabras.has(ingles) && !encontrados.includes(clave)) encontrados.push(clave);
  }
  return encontrados;
}

/**
 * Resuelve una consulta en lenguaje natural contra un catálogo.
 *
 * Puntuación: coincidir con la etiqueta de taxonomía vale más que coincidir con el
 * nombre, y el carácter medido suma. Devuelve también **por qué** puntúa, para que
 * el agente pueda explicar su elección en vez de inventarla.
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

  // El catálogo grande (4.231 entradas) se consulta con `includes` sobre un texto ya
  // normalizado con espacios en los bordes: comparar por palabra sin construir una
  // expresión regular por alias y por entrada (eso tardaba segundos).
  const espacios = (texto: string): string => ` ${normalizar(texto)} `;
  // Lo que no cambia por entrada se calcula una vez, no 4.231 veces.
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
        motivos.push(`es «${etiqueta.es}»`);
      } else if (familiaEntrada === familiaBuscada.get(etiqueta.id)) {
        puntuacion += 2;
        motivos.push(`misma familia (${etiqueta.familia})`);
      }
    }

    for (let i = 0; i < palabras.length; i += 1) {
      const palabra = palabras[i] as string;
      if (claveNormalizada.includes(palabra) || nombre.includes(palabrasConEspacio[i] as string)) {
        puntuacion += 4;
        if (!motivos.includes(`dice «${palabra}»`)) motivos.push(`dice «${palabra}»`);
      }
    }

    if (caracteres.length > 0 && entrada.perfil) {
      for (const caracter of caracteres) {
        if (CARACTER[caracter](entrada.perfil)) {
          puntuacion += 6;
          motivos.push(`suena ${caracter}`);
        }
      }
    }

    if (puntuacion > 0) resultados.push({ entrada, puntuacion, motivos, etiqueta: coincideEtiqueta });
  }

  resultados.sort((a, b) => b.puntuacion - a.puntuacion || a.entrada.clave.localeCompare(b.entrada.clave));
  // Si el usuario nombró algo concreto («china»), no queremos de vuelta todo lo que
  // suena sucio: sólo lo que es ese instrumento.
  const conEtiqueta = resultados.filter((r) => r.etiqueta);
  const utiles = conEtiqueta.length > 0 ? conEtiqueta : resultados;
  return utiles.slice(0, opciones.limite ?? 8);
}

