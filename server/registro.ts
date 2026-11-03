/**
 * The server's logs in tmp/: llm.log (every model call, compacted and priced),
 * herramientas.log (what the tools did) and api.log (one line per /api request).
 * Moved out of contexto.ts on 3-Nov (review step 4) without changes.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { crearAlmacenPrecios } from "./precios.ts";
import { costeDe } from "../src/core/precios.ts";

export function crearRegistros(carpetaTmp: string, opciones: { logCompleto?: boolean } = {}) {
  const ficheroHerramientas = resolve(carpetaTmp, "herramientas.log");
  const ficheroApi = resolve(carpetaTmp, "api.log");
  const ficheroLog = resolve(carpetaTmp, "llm.log");

  /** Size limit for each log: when exceeded, a .1 copy is kept and a new one is started. */
  const TOPE_LOG = 5 * 1024 * 1024;
  const TOPE_LOG_HERRAMIENTAS = 2 * 1024 * 1024;

  /** Appends a line to a log, rotating by size (it must never break the app). */
  const anotar = (fichero: string, linea: string, tope?: number): void => {
    try {
      mkdirSync(carpetaTmp, { recursive: true });
      const limite = tope ?? (fichero === ficheroHerramientas ? TOPE_LOG_HERRAMIENTAS : TOPE_LOG);
      if (existsSync(fichero) && statSync(fichero).size > limite) {
        renameSync(fichero, `${fichero}.1`);
      }
      appendFileSync(fichero, linea + "\n", "utf8");
    } catch {
      /* no log */
    }
  };

  /**
   * Without MIUZIKA_LOG_COMPLETO=1 the log stores the turn without the full messages:
   * with the manifest inside it was ~40 KB per round and ended up containing the whole
   * project code. It stores the shape (role, size, first 200 characters) and,
   * separately, the request and the response. With the flag, the whole thing (for debugging).
   */
  const compactarTurno = (linea: string): string => {
    if (opciones.logCompleto === true) return linea;
    try {
      const datos = JSON.parse(linea) as Record<string, unknown>;
      const mensajes = Array.isArray(datos.mensajes)
        ? (datos.mensajes as { role?: string; content?: string; tool_calls?: unknown[] }[])
        : [];
      const sistema = mensajes.find((m) => m.role === "system")?.content ?? "";
      const resumen = {
        ...datos,
        mensajes: mensajes.map((m) => ({
          role: m.role ?? "?",
          caracteres: (m.content ?? "").length,
          inicio: (m.content ?? "").slice(0, 200),
          herramientas: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0,
        })),
        sistema: { caracteres: sistema.length, inicio: sistema.slice(0, 400) },
      };
      return JSON.stringify(resumen);
    } catch {
      return linea.slice(0, 2000);
    }
  };

  /** Model prices (OpenRouter list, cached in .miuzika/precios.json, refreshed daily). */
  const precios = crearAlmacenPrecios();

  /**
   * Adds the cost of the call to a log line: `coste_usd` from its `usage` and the
   * price in force at that moment, plus which OpenRouter rate was used. Without a
   * known rate nothing is added (the browser says "price unknown" for the same reason:
   * a wrong number is worse than none). The log is the audit trail of what a turn
   * cost: the browser's counter is derived from the same function.
   */
  const tarifarLinea = (linea: string): string => {
    try {
      const datos = JSON.parse(linea) as { t?: string; proveedor?: string; modelo?: string; usage?: unknown };
      if (!datos.usage || typeof datos.modelo !== "string") return linea;
      const tarifa = precios.tarifaPara(String(datos.proveedor ?? "ollama-cloud"), datos.modelo);
      if (!tarifa) return linea;
      const fecha = datos.t && Number.isFinite(Date.parse(datos.t)) ? new Date(datos.t) : new Date();
      const coste = costeDe(tarifa, datos.usage as Parameters<typeof costeDe>[1], fecha);
      return JSON.stringify({ ...datos, coste_usd: Math.round(coste.usd * 1e6) / 1e6, tarifa: tarifa.id });
    } catch {
      return linea;
    }
  };

  const registrarTurno = (linea: string): void => anotar(ficheroLog, compactarTurno(tarifarLinea(linea)));


  return {
    carpetaTmp,
    ficheroLog,
    ficheroHerramientas,
    ficheroApi,
    TOPE_LOG,
    TOPE_LOG_HERRAMIENTAS,
    anotar,
    compactarTurno,
    registrarTurno,
    precios,
  };
}
