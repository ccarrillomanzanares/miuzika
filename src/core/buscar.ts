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
  const caracteres = Object.keys(CARACTER).filter((c) => texto.includes(c));
  const resultados: Resultado[] = [];

  for (const entrada of catalogo) {
    if (opciones.familia && entrada.familia !== opciones.familia) continue;
    let puntuacion = 0;
    let coincideEtiqueta = false;
    const motivos: string[] = [];
    const nombre = normalizar(`${entrada.clave} ${entrada.etiqueta} ${entrada.descripcion}`);

    for (const etiqueta of etiquetas) {
      const coincideId =
        entrada.taxonomia === etiqueta.id ||
        normalizar(entrada.clave) === normalizar(etiqueta.id) ||
        normalizar(entrada.etiqueta).includes(normalizar(etiqueta.es)) ||
        [etiqueta.es, etiqueta.en, ...etiqueta.alias].map(normalizar).some((n) => nombre.includes(n));
      if (coincideId) {
        puntuacion += 10;
        coincideEtiqueta = true;
        motivos.push(`es «${etiqueta.es}»`);
      } else if (normalizar(entrada.familia) === normalizar(etiqueta.familia)) {
        puntuacion += 2;
        motivos.push(`misma familia (${etiqueta.familia})`);
      }
    }

    for (const palabra of palabras) {
      if (normalizar(entrada.clave).includes(palabra) || nombre.includes(palabra)) {
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

/**
 * Parecido acústico: ordena el catálogo por distancia al perfil de una referencia.
 * Es lo que resuelve «un bombo como éste» sin palabras.
 */
export function parecidosA(
  catalogo: EntradaCatalogo[],
  referencia: Perfil,
  limite = 5,
): Resultado[] {
  const log = (v: number): number => Math.log10(Math.max(v, 1e-6));
  const distancia = (p: Perfil): number => {
    const d: number[] = [];
    if (p.centroide_hz && referencia.centroide_hz) {
      d.push(Math.abs(log(p.centroide_hz) - log(referencia.centroide_hz)) * 3);
    }
    if (p.duracion_s && referencia.duracion_s) {
      d.push(Math.abs(log(p.duracion_s) - log(referencia.duracion_s)) * 2);
    }
    if (p.crest_db !== undefined && referencia.crest_db !== undefined) {
      d.push(Math.abs(p.crest_db - referencia.crest_db) / 10);
    }
    if (d.length === 0) return 99;
    return d.reduce((a, b) => a + b, 0) / d.length;
  };
  return catalogo
    .filter((e) => e.perfil)
    .map((entrada) => {
      const d = distancia(entrada.perfil ?? {});
      return {
        entrada,
        puntuacion: Math.round((1 - Math.min(d, 1)) * 100),
        motivos: [`distancia acústica ${d.toFixed(2)}`],
        etiqueta: false,
      };
    })
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, limite);
}
