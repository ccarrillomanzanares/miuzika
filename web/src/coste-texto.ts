/**
 * Text of the model-cost counter. No DOM, with tests.
 *
 * Rules (Carlos, 1-Nov): a cost is shown only with a known, dated price; otherwise it
 * says "price unknown". The price date is always visible in the tooltip, and the
 * counter warns when the list is older than HORAS_PRECIOS_VIEJOS.
 */

import { HORAS_PRECIOS_VIEJOS, type Tarifa } from "../../src/core/precios.ts";
import { locale, t } from "./i18n.ts";

/** What the counter knows about the current turn and the session. */
export interface EstadoCosteLlm {
  proveedor: string;
  modelo: string;
  /** null = the price list has no entry for this model. */
  tarifa: Tarifa | null;
  /** ISO date of the price list; null if the server has none. */
  fechaPrecios: string | null;
  turno: Acumulado;
  sesion: Acumulado;
}

export interface Acumulado {
  usd: number;
  llamadas: number;
  turnos: number;
  tokensNuevos: number;
  tokensCache: number;
  tokensSalida: number;
}

export const ACUMULADO_CERO: Acumulado = { usd: 0, llamadas: 0, turnos: 0, tokensNuevos: 0, tokensCache: 0, tokensSalida: 0 };

/** Dollars with enough digits to see a cheap call: $0.0036, $0.04, $1.21. */
export function usd(valor: number): string {
  const decimales = valor !== 0 && Math.abs(valor) < 0.01 ? 4 : 2;
  return `$${valor.toLocaleString(locale(), { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}

/** 812, 50 k, 1.3 M. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(locale(), { maximumFractionDigits: 1 })} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString(locale())} k`;
  return String(Math.round(n));
}

/** Price list age for the warning: null when fresh enough. */
export function avisoPrecios(fechaPrecios: string | null, ahora = Date.now()): string | null {
  if (!fechaPrecios) return t("coste.sinLista", "no price list");
  const horas = (ahora - Date.parse(fechaPrecios)) / 3_600_000;
  if (!Number.isFinite(horas) || horas < HORAS_PRECIOS_VIEJOS) return null;
  return `${t("coste.precios", "prices")} ${Math.floor(horas / 24)} d ${t("coste.viejos", "old")}`.trim();
}

/** The counter line: "LLM $0.04 · $0.31 session". */
export function textoCosteLlm(e: EstadoCosteLlm, ahora = Date.now()): string {
  if (e.tarifa === null) return `LLM ${t("coste.desconocido", "price unknown")} · ${e.modelo}`;
  if (e.tarifa.id === "local") return `LLM ${t("coste.local", "local, free")}`;
  const partes = [`LLM ${usd(e.turno.usd)}`];
  if (e.sesion.turnos > 1 || e.sesion.usd !== e.turno.usd) partes.push(`${usd(e.sesion.usd)} ${t("gpu.sesion", "session")}`);
  const aviso = avisoPrecios(e.fechaPrecios, ahora);
  if (aviso) partes.push(`⚠ ${aviso}`);
  return partes.join(" · ");
}

const porcentajeCache = (a: Acumulado): string => {
  const entrada = a.tokensNuevos + a.tokensCache;
  return entrada === 0 ? "" : ` (${Math.round((a.tokensCache / entrada) * 100)}% ${t("coste.cacheados", "cached")})`;
};

/** Tooltip: how the number was reached and with which price. */
export function detalleCosteLlm(e: EstadoCosteLlm, ahora = Date.now()): string {
  const lineas = [`${t("coste.modelo", "Model")}: ${e.modelo} (${e.proveedor})`];
  if (e.tarifa === null) {
    lineas.push(t("coste.desconocidoDetalle", "Not in the OpenRouter price list: no cost is estimated."));
  } else {
    const resumen = (nombre: string, a: Acumulado): string =>
      `${nombre}: ${a.llamadas} ${t("coste.llamadas", "calls")} · ${tokens(a.tokensNuevos + a.tokensCache)} ${t("coste.entrada", "in")}${porcentajeCache(a)} · ${tokens(a.tokensSalida)} ${t("coste.salida", "out")} · ${usd(a.usd)}`;
    lineas.push(resumen(t("coste.turno", "This turn"), e.turno));
    lineas.push(`${resumen(t("gpu.sesionNavegador", "This browser session"), e.sesion)} · ${e.sesion.turnos} ${t("coste.turnos", "turns")}`);
    if (e.tarifa.id === "local") {
      lineas.push(t("coste.localDetalle", "Runs on this machine: nothing to pay."));
    } else {
      const porMillon = (x: number): string => `$${(x * 1e6).toLocaleString(locale(), { maximumFractionDigits: 3 })}/M`;
      lineas.push(
        `${t("coste.tarifa", "Rate")} ${e.tarifa.id}: ${porMillon(e.tarifa.prompt)} ${t("coste.entrada", "in")} · ${porMillon(e.tarifa.cacheRead)} ${t("coste.cache", "cache")} · ${porMillon(e.tarifa.completion)} ${t("coste.salida", "out")}`,
      );
      lineas.push(t("coste.sinEscrituras", "Cache writes are not reported by the API and are not counted."));
    }
  }
  if (e.fechaPrecios) {
    const fecha = new Date(e.fechaPrecios).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    lineas.push(`${t("coste.preciosDe", "Prices from OpenRouter, downloaded")} ${fecha}`);
  } else {
    lineas.push(t("coste.sinListaDetalle", "The server has no price list yet (no network at start-up?)."));
  }
  const aviso = avisoPrecios(e.fechaPrecios, ahora);
  if (aviso && e.fechaPrecios) lineas.push(`⚠ ${aviso}`);
  return lineas.join("\n");
}
