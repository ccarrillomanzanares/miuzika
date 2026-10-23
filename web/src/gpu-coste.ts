/**
 * Contador de gasto de la GPU.
 *
 * No sabe de qué proveedor se trata: pide `/api/gpu/estado` y espera la tarifa
 * real de la instancia, la fase (apagada / arrancando / activa / apagándose) y
 * desde cuándo cuenta. El texto se compone en `gpu-texto.ts`, que sí tiene tests.
 *
 * Muestra dos números porque los dos importan:
 *   - lo que lleva gastado ESTA instancia (a la tarifa que da el proveedor)
 *   - lo acumulado en la sesión del navegador (suma de los tramos, sobrevive a
 *     recargas y no se pierde al apagar la máquina)
 */

import { detalleCoste, normalizarEstadoGpu, textoCoste, type EstadoGpu } from "./gpu-texto.ts";

// v3: la v2 guardaba un total con la tarifa del .env (podía no ser la real).
const CLAVE_SESION = "miuzika.gpu.sesion.v3";
const CADA_POLVO_MS = 10_000;

export interface CosteGpu {
  /** Fuerza una lectura del estado (lo usa el botón de encender/apagar). */
  refrescar(): Promise<void>;
  /** Última lectura, para que la barra de actividad sepa en qué fase está. */
  estado(): EstadoGpu | null;
}

export function initCosteGpu(elemento: HTMLElement | null): CosteGpu {
  if (!elemento) return { refrescar: async () => {}, estado: () => null };

  let estado: EstadoGpu | null = null;
  let instanciaActual = "";
  let ultimoGastado = 0;
  let totalSesion = 0;

  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? "{}") as { total?: number };
    totalSesion = Number(guardado.total) || 0;
  } catch {
    /* sin persistencia */
  }

  const guardarSesion = (): void => {
    try {
      localStorage.setItem(CLAVE_SESION, JSON.stringify({ total: totalSesion }));
    } catch {
      /* sin persistencia */
    }
  };

  const pintar = (): void => {
    if (!estado || !estado.configurado) {
      elemento.hidden = true;
      return;
    }
    elemento.hidden = false;
    elemento.textContent = textoCoste(estado, totalSesion);
    const fase = estado.fase ?? (estado.activo ? "activa" : "apagada");
    elemento.classList.toggle("activo", fase === "activa");
    elemento.classList.toggle("arrancando", fase === "arrancando" || fase === "apagandose");
    elemento.title = detalleCoste(estado, totalSesion);
  };

  const refrescar = async (): Promise<void> => {
    try {
      const res = await fetch("/api/gpu/estado", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const datos = normalizarEstadoGpu(await res.json());
      estado = datos;

      // Instancia nueva -> el contador del proveedor vuelve a cero y el tramo
      // anterior ya está sumado a la sesión.
      const viva = datos.instancias?.find((i) => i.status === "active") ?? datos.instancias?.[0];
      const id = viva?.id ?? "";
      if (id !== instanciaActual) {
        instanciaActual = id;
        ultimoGastado = datos.gastado ?? 0;
      }
      const delta = Math.max(0, (datos.gastado ?? 0) - ultimoGastado);
      if (delta > 0) {
        ultimoGastado = datos.gastado ?? 0;
        totalSesion += delta;
        guardarSesion();
      }
      pintar();
    } catch {
      // Sin servidor no hay dato: se queda lo último pintado.
      if (estado === null) elemento.hidden = true;
    }
  };

  void refrescar();
  window.setInterval(() => void refrescar(), CADA_POLVO_MS);
  // El reloj del tiempo transcurrido se mueve solo, sin volver a preguntar.
  window.setInterval(pintar, 1000);

  return { refrescar, estado: () => estado };
}
