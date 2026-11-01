/**
 * Model-cost counter (what the agent's calls cost, in the chat header next to the GPU one).
 *
 * `llm.ts` fires a `miuzika:llm-uso` event after every call with the provider, the
 * model and the `usage` block. This module asks the server for the rate of that
 * (provider, model) pair once (`/api/precios`, OpenRouter's list cached on disk and
 * refreshed daily), prices the call with the same function the server uses for
 * `tmp/llm.log` (src/core/precios.ts) and adds it to the turn and to the session.
 *
 * Two numbers, like the GPU counter: this turn (resets when a turn starts) and the
 * browser session (localStorage, survives F5). The text is in `coste-texto.ts`, with tests.
 */

import { costeDe, type Tarifa } from "../../src/core/precios.ts";
import { ACUMULADO_CERO, detalleCosteLlm, textoCosteLlm, usd, type Acumulado, type EstadoCosteLlm } from "./coste-texto.ts";
import { getModel, getProveedor, type UsoLlmEvento } from "./llm.ts";

const CLAVE_SESION = "miuzika.llm.coste.v1";

export interface CosteLlm {
  /** A turn starts: the per-turn counter goes back to zero. */
  nuevoTurno(): void;
  /** What this turn has cost so far, formatted for the end-of-turn line ("" if unknown). */
  textoTurno(): string;
  /** Re-reads the rate (the "Models" menu changed provider or model). */
  refrescar(): Promise<void>;
  /** The turn's numbers for the trajectory file; null when the rate is unknown. */
  turno(): { usd: number; tokensNuevos: number; tokensCache: number; tokensSalida: number; tarifa: string | null } | null;
}

interface RespuestaPrecios {
  ok?: boolean;
  fecha?: string | null;
  tarifa?: Tarifa | null;
}

export function initCosteLlm(elemento: HTMLElement | null): CosteLlm {
  if (!elemento) return { nuevoTurno: () => {}, textoTurno: () => "", refrescar: async () => {}, turno: () => null };

  let turno: Acumulado = { ...ACUMULADO_CERO };
  let sesion: Acumulado = { ...ACUMULADO_CERO };
  /** Rates already asked for, by "proveedor|modelo"; null = unknown to the list. */
  const tarifas = new Map<string, { tarifa: Tarifa | null; fecha: string | null }>();
  let visto = false;

  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? "{}") as Partial<Acumulado>;
    sesion = { ...ACUMULADO_CERO, ...guardado, usd: Number(guardado.usd) || 0 };
  } catch {
    /* no persistence */
  }

  const guardar = (): void => {
    try {
      localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    } catch {
      /* no persistence */
    }
  };

  const clave = (proveedor: string, modelo: string): string => `${proveedor}|${modelo}`;

  const pedirTarifa = async (proveedor: string, modelo: string): Promise<{ tarifa: Tarifa | null; fecha: string | null }> => {
    const k = clave(proveedor, modelo);
    const previa = tarifas.get(k);
    if (previa) return previa;
    try {
      const res = await fetch(`/api/precios?proveedor=${encodeURIComponent(proveedor)}&modelo=${encodeURIComponent(modelo)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const datos = (await res.json()) as RespuestaPrecios;
      const valor = { tarifa: datos.tarifa ?? null, fecha: datos.fecha ?? null };
      // A list the server has not downloaded yet is not "unknown model": ask again next time.
      if (datos.fecha || valor.tarifa) tarifas.set(k, valor);
      return valor;
    } catch {
      return { tarifa: null, fecha: null };
    }
  };

  const estado = (tarifa: Tarifa | null, fecha: string | null): EstadoCosteLlm => ({
    proveedor: getProveedor(),
    modelo: getModel(),
    tarifa,
    fechaPrecios: fecha,
    turno,
    sesion,
  });

  const pintar = async (): Promise<void> => {
    if (!visto) {
      elemento.hidden = true;
      return;
    }
    const { tarifa, fecha } = await pedirTarifa(getProveedor(), getModel());
    const e = estado(tarifa, fecha);
    elemento.hidden = false;
    elemento.textContent = textoCosteLlm(e);
    elemento.title = detalleCosteLlm(e);
    elemento.classList.toggle("desconocido", tarifa === null);
  };

  const sumar = (a: Acumulado, c: ReturnType<typeof costeDe>): Acumulado => ({
    ...a,
    usd: a.usd + c.usd,
    llamadas: a.llamadas + 1,
    tokensNuevos: a.tokensNuevos + c.tokensNuevos,
    tokensCache: a.tokensCache + c.tokensCache,
    tokensSalida: a.tokensSalida + c.tokensSalida,
  });

  window.addEventListener("miuzika:llm-uso", (evento) => {
    const d = (evento as CustomEvent<UsoLlmEvento>).detail;
    visto = true;
    void (async () => {
      const { tarifa } = await pedirTarifa(d.proveedor, d.modelo);
      if (tarifa) {
        const coste = costeDe(tarifa, d.usage, new Date(d.t));
        turno = sumar(turno, coste);
        sesion = sumar(sesion, coste);
        guardar();
      }
      await pintar();
    })();
  });

  window.addEventListener("miuzika:llm-modelo", () => void pintar());

  return {
    nuevoTurno: () => {
      turno = { ...ACUMULADO_CERO };
      sesion = { ...sesion, turnos: sesion.turnos + 1 };
      guardar();
    },
    textoTurno: () => {
      const k = tarifas.get(clave(getProveedor(), getModel()));
      if (!k?.tarifa || k.tarifa.id === "local" || turno.llamadas === 0) return "";
      return usd(turno.usd);
    },
    refrescar: async () => {
      tarifas.clear();
      await pintar();
    },
    turno: () => {
      const k = tarifas.get(clave(getProveedor(), getModel()));
      if (!k?.tarifa) return null;
      const { usd, tokensNuevos, tokensCache, tokensSalida } = turno;
      return { usd, tokensNuevos, tokensCache, tokensSalida, tarifa: k.tarifa.id };
    },
  };
}
