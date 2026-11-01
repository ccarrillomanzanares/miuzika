/**
 * Price list store: downloads OpenRouter's model list, keeps it on disk and answers
 * "what does this provider's model cost?".
 *
 * Why a download and not a table: Carlos asked on 1-Nov that the costs shown in the
 * app update by themselves. OpenRouter publishes per-token prices for 452 models
 * (1-Nov-2026) without a key, cached-input price and time windows included
 * (src/core/precios.ts does the arithmetic).
 *
 * The copy lives in `.miuzika/precios.json` (outside git and outside workspace/, next
 * to the provider keys, although it holds no secret) so a restart without network
 * still prices the calls, with the date of the copy. It is refreshed at start-up when
 * older than a day and then once a day; a failed download keeps the previous copy.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { antiguedadHoras, tarifaDesdeOpenRouter, tarifaPara, type Tarifa } from "../src/core/precios.ts";

export const URL_OPENROUTER = "https://openrouter.ai/api/v1/models";
const CADA_MS = 24 * 3_600_000;

interface Copia {
  fecha: string;
  fuente: string;
  tarifas: Tarifa[];
}

export interface EstadoPrecios {
  /** ISO date of the copy, null if there has never been one. */
  fecha: string | null;
  antiguedadHoras: number | null;
  modelos: number;
  fuente: string;
  /** Last download error, if the copy could not be refreshed. */
  error: string | null;
}

export interface AlmacenPrecios {
  tarifaPara(proveedor: string, modelo: string): Tarifa | null;
  estado(): EstadoPrecios;
  /** Downloads now (used by the route and by the start-up check). */
  refrescar(): Promise<EstadoPrecios>;
}

export function crearAlmacenPrecios(
  fichero = resolve(process.cwd(), ".miuzika", "precios.json"),
  descargar: () => Promise<unknown> = async () => {
    const r = await fetch(URL_OPENROUTER, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
): AlmacenPrecios {
  let copia: Copia | null = null;
  let error: string | null = null;
  let enCurso: Promise<EstadoPrecios> | null = null;

  try {
    if (existsSync(fichero)) {
      const datos = JSON.parse(readFileSync(fichero, "utf8")) as Partial<Copia>;
      if (typeof datos.fecha === "string" && Array.isArray(datos.tarifas)) {
        copia = { fecha: datos.fecha, fuente: String(datos.fuente ?? "openrouter"), tarifas: datos.tarifas as Tarifa[] };
      }
    }
  } catch (e) {
    error = `unreadable ${fichero}: ${e instanceof Error ? e.message : String(e)}`;
  }

  const estado = (): EstadoPrecios => ({
    fecha: copia?.fecha ?? null,
    antiguedadHoras: antiguedadHoras(copia?.fecha),
    modelos: copia?.tarifas.length ?? 0,
    fuente: copia?.fuente ?? "openrouter",
    error,
  });

  const refrescar = (): Promise<EstadoPrecios> => {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      try {
        const datos = (await descargar()) as { data?: unknown[] };
        const tarifas = (Array.isArray(datos?.data) ? datos.data : [])
          .map(tarifaDesdeOpenRouter)
          .filter((t): t is Tarifa => t !== null);
        // An empty list is a broken answer, not "no models": keep what we had.
        if (tarifas.length === 0) throw new Error("the list came back empty");
        copia = { fecha: new Date().toISOString(), fuente: "openrouter", tarifas };
        error = null;
        mkdirSync(dirname(fichero), { recursive: true });
        writeFileSync(fichero, JSON.stringify(copia), "utf8");
        console.log(`[precios] ${tarifas.length} model prices from OpenRouter`);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.warn(`[precios] could not refresh the price list: ${error}` + (copia ? ` (keeping the copy from ${copia.fecha})` : ""));
      } finally {
        enCurso = null;
      }
      return estado();
    })();
    return enCurso;
  };

  const horas = antiguedadHoras(copia?.fecha);
  if (horas === null || horas >= 24) void refrescar();
  const temporizador = setInterval(() => void refrescar(), CADA_MS);
  // The timer must not keep the process alive when Vite shuts down.
  if (typeof temporizador === "object" && "unref" in temporizador) temporizador.unref();

  return {
    tarifaPara: (proveedor, modelo) => tarifaPara(proveedor, modelo, copia?.tarifas ?? []),
    estado,
    refrescar,
  };
}
