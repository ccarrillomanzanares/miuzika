/**
 * Texto del contador de GPU. Sin DOM, con tests.
 *
 * Regla: el precio que se enseña es el de la instancia que hay delante (lo da
 * Lambda por tipo), no el del `.env`, y sólo se enseña cuando hay algo que
 * factura. Una máquina arrancando aún no cobra; una apagada no tiene tarifa que
 * mostrar.
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

/** Nombre corto del tipo de Lambda: gpu_1x_a10 -> A10, gpu_8x_h100_sxm -> 8× H100 SXM. */
export function tipoCorto(tipo: string): string {
  const partes = /^gpu_(\d+)x_(.+)$/.exec(tipo);
  if (!partes) return tipo.replace(/_/g, " ").toUpperCase() || "GPU";
  const cuantas = Number(partes[1]);
  const resto = partes[2]!.replace(/_/g, " ").toUpperCase();
  // El número de GPUs importa: ocho H100 cuestan ocho veces más.
  return cuantas > 1 ? `${cuantas}× ${resto}` : resto;
}

/** Dos decimales en el formato del idioma de la interfaz: "1.29" en inglés, "1,29" en español. */
export function dinero(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100;
  return redondeado.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** hh:mm:ss desde el instante dado (vacío si no hay instante). */
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

/** "2 min 34 s" para el arranque, que se cuenta en minutos. */
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
 * Línea del contador. `totalSesion` es lo acumulado en este navegador.
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
    // Lo facturado de esa tanda ya no se sabe con exactitud cuando el proveedor
    // deja de contarla: se dice que se apaga, sin inventar cifras.
    return `${tipo} ${t("gpu.apagandose", "shutting down…")}`;
  }
  // Apagada: no hay tarifa que enseñar, sólo lo que se gastó en la sesión.
  const apagada = t("gpu.apagada", "GPU off");
  return totalSesion > 0 ? `${apagada} · ${t("gpu.sesion", "session")} ${dinero(totalSesion)} ${signo}` : apagada;
}

/** Tooltip: de dónde sale cada número. */
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

/** ¿Está colgado el turno? Sin señales más de `umbralMs`. */
export function sinSenales(ultimoEventoMs: number, ahora = Date.now(), umbralMs = 90_000): number {
  const callado = ahora - ultimoEventoMs;
  return callado > umbralMs ? Math.floor(callado / 1000) : 0;
}

/**
 * El endpoint habla snake_case (`precio_hora`) y a veces camelCase: se normaliza
 * aquí para que un nombre mal escrito no acabe pintando "NaN $/h".
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
