/**
 * GPU spending counter.
 *
 * It does not know which provider it is: it requests `/api/gpu/estado` and expects
 * the instance's real rate, the phase (off / starting / active / shutting down) and
 * since when it has been counting. The text is composed in `gpu-texto.ts`, which
 * does have tests.
 *
 * It shows two numbers because both matter:
 *   - what THIS instance has spent so far (at the rate the provider gives)
 *   - what has accumulated in the browser session (sum of the segments, survives
 *     reloads and is not lost when the machine is shut down)
 */

import { detalleCoste, normalizarEstadoGpu, textoCoste, type EstadoGpu } from "./gpu-texto.ts";

// v3: v2 stored a total using the rate from .env (which might not be the real one).
const CLAVE_SESION = "miuzika.gpu.sesion.v3";
const CADA_POLVO_MS = 10_000;

export interface CosteGpu {
  /** Forces a read of the state (used by the on/off button). */
  refrescar(): Promise<void>;
  /** Last read, so the activity bar knows which phase it is in. */
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
    /* no persistence */
  }

  const guardarSesion = (): void => {
    try {
      localStorage.setItem(CLAVE_SESION, JSON.stringify({ total: totalSesion }));
    } catch {
      /* no persistence */
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

      // New instance -> the provider counter goes back to zero and the previous
      // segment is already added to the session.
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
      // Without a server there is no data: the last painted value stays.
      if (estado === null) elemento.hidden = true;
    }
  };

  void refrescar();
  window.setInterval(() => void refrescar(), CADA_POLVO_MS);
  // The elapsed-time clock moves on its own, without asking again.
  window.setInterval(pintar, 1000);

  return { refrescar, estado: () => estado };
}
