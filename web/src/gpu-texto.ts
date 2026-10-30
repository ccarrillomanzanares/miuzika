/**
 * GPU counter text. No DOM, with tests.
 *
 * Rule: the price shown is that of the instance in front of us (Lambda gives it
 * per type), not the one from `.env`, and it is only shown when there is something
 * to bill. A machine that is starting is not charging yet; a machine that is off
 * has no rate to show.
 */

import { locale, t } from "./i18n.ts";

export type FaseGpu = "apagada" | "arrancando" | "activa" | "apagandose";

export interface InstanciaGpu {
  id: string;
  status: string;
  tipo: string;
  ip: string | null;
  nombre?: string;
  precioHora?: number;
  desde?: string | null;
  cambio?: string | null;
  gastado?: number;
}

export interface EstadoGpu {
  configurado: boolean;
  fase?: FaseGpu;
  activo: boolean;
  tipo?: string;
  desde: string | null;
  arranque?: string | null;
  precioHora: number;
  moneda: string;
  gastado: number;
  proveedor?: string;
  instancias?: InstanciaGpu[];
}

const simbolo = (moneda: string): string => (moneda === "USD" ? "$" : moneda === "EUR" ? "€" : `${moneda} `);

/** Short name of the Lambda type: gpu_1x_a10 -> A10, gpu_8x_h100_sxm -> 8× H100 SXM. */
export function tipoCorto(tipo: string): string {
  const partes = /^gpu_(\d+)x_(.+)$/.exec(tipo);
  if (!partes) return tipo.replace(/_/g, " ").toUpperCase() || "GPU";
  const cuantas = Number(partes[1]);
  const resto = partes[2]!.replace(/_/g, " ").toUpperCase();
  // The number of GPUs matters: eight H100s cost eight times as much.
  return cuantas > 1 ? `${cuantas}× ${resto}` : resto;
}

/** Two decimals in the interface language's format: "1.29" in English, "1,29" in Spanish. */
export function dinero(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100;
  return redondeado.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** hh:mm:ss since the given instant (empty if there is no instant). */
export function transcurrido(desde: string | null | undefined, ahora = Date.now()): string {
  if (!desde) return "00:00:00";
  const ms = ahora - Date.parse(desde);
  if (!Number.isFinite(ms) || ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** "2 min 34 s" for the startup, which is counted in minutes. */
export function minutosYsegundos(desde: string | null | undefined, ahora = Date.now()): string {
  if (!desde) return "";
  const ms = ahora - Date.parse(desde);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return min > 0 ? `${min} min ${String(seg).padStart(2, "0")} s` : `${seg} s`;
}

/**
 * Counter line. `totalSesion` is what has accumulated in this browser.
 */
export function textoCoste(estado: EstadoGpu, totalSesion: number, ahora = Date.now()): string {
  const signo = simbolo(estado.moneda);
  const tipo = tipoCorto(estado.tipo ?? "");
  const fase: FaseGpu = estado.fase ?? (estado.activo ? "activa" : "apagada");

  if (fase === "activa") {
    return (
      `${tipo} · ${dinero(estado.precioHora)} ${signo}/h · ${transcurrido(estado.desde, ahora)} · ` +
      `${dinero(estado.gastado)} ${signo} (${t("gpu.sesion", "session")} ${dinero(totalSesion)} ${signo})`
    );
  }
  if (fase === "arrancando") {
    const rato = minutosYsegundos(estado.arranque, ahora);
    return `${tipo} ${t("gpu.arrancando", "starting")}${rato ? ` · ${rato}` : ""} · ${t("gpu.sinFacturar", "not billing yet")}`;
  }
  if (fase === "apagandose") {
    // What that run billed is no longer known exactly when the provider stops
    // counting it: we say it is shutting down, without inventing figures.
    return `${tipo} ${t("gpu.apagandose", "shutting down…")}`;
  }
  // Off: there is no rate to show, only what was spent in the session.
  const apagada = t("gpu.apagada", "GPU off");
  return totalSesion > 0 ? `${apagada} · ${t("gpu.sesion", "session")} ${dinero(totalSesion)} ${signo}` : apagada;
}

/** Tooltip: where each number comes from. */
export function detalleCoste(estado: EstadoGpu, totalSesion: number): string {
  const signo = simbolo(estado.moneda);
  const lineas = [
    `${t("gpu.proveedor", "Provider")}: ${estado.proveedor ?? "?"} · ${t("gpu.tarifa", "rate")} ${dinero(estado.precioHora)} ${signo}/${t(
      "gpu.hora",
      "hour",
    )} (${tipoCorto(estado.tipo ?? "")})`,
    `${t("gpu.sesionNavegador", "This browser session")}: ${dinero(totalSesion)} ${signo}`,
  ];
  for (const instancia of estado.instancias ?? []) {
    const tarifa =
      instancia.precioHora !== undefined ? `${dinero(instancia.precioHora)} ${signo}/h` : `${t("gpu.tarifa", "rate")} ?`;
    lineas.push(
      `${instancia.tipo || "?"} · ${instancia.status} · ${tarifa} · ` +
        `${dinero(instancia.gastado ?? 0)} ${signo}`,
    );
  }
  return lineas.join("\n");
}

/** Is the turn stuck? No signals for more than `umbralMs`. */
export function sinSenales(ultimoEventoMs: number, ahora = Date.now(), umbralMs = 90_000): number {
  const callado = ahora - ultimoEventoMs;
  return callado > umbralMs ? Math.floor(callado / 1000) : 0;
}

/**
 * The endpoint speaks snake_case (`precio_hora`) and sometimes camelCase: it is
 * normalized here so that a misspelled name does not end up painting "NaN $/h".
 */
export function normalizarEstadoGpu(crudo: unknown): EstadoGpu {
  const datos = (crudo ?? {}) as Record<string, unknown>;
  const precio = datos.precio_hora ?? datos.precioHora;
  const instancias = Array.isArray(datos.instancias) ? (datos.instancias as InstanciaGpu[]) : [];
  return {
    configurado: datos.configurado === true,
    fase: (datos.fase as FaseGpu | undefined) ?? undefined,
    activo: datos.activo === true,
    tipo: typeof datos.tipo === "string" ? datos.tipo : undefined,
    desde: typeof datos.desde === "string" ? datos.desde : null,
    arranque: typeof datos.arranque === "string" ? datos.arranque : null,
    precioHora: Number.isFinite(Number(precio)) ? Number(precio) : 0,
    moneda: typeof datos.moneda === "string" ? datos.moneda : "USD",
    gastado: Number.isFinite(Number(datos.gastado)) ? Number(datos.gastado) : 0,
    proveedor: typeof datos.proveedor === "string" ? datos.proveedor : undefined,
    instancias,
  };
}
