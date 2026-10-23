/**
 * Contador de gasto de la GPU.
 *
 * No sabe de que proveedor se trata: pide `/api/gpu/estado` y espera precio/hora,
 * desde cuando cuenta y lo gastado. Lambda lo rellena hoy; otro proveedor solo
 * tiene que devolver la misma forma y el contador funciona igual.
 *
 * Muestra dos numeros porque los dos importan:
 *   - lo que lleva gastado ESTA instancia (lo dice el proveedor)
 *   - lo acumulado en la sesion del navegador (suma de los tramos, sobrevive a
 *     recargas y no se pierde al apagar la maquina)
 */

interface InstanciaGpu {
  id: string;
  status: string;
  tipo: string;
  ip: string | null;
}

interface EstadoGpu {
  configurado: boolean;
  activo: boolean;
  desde: string | null;
  precio_hora: number;
  moneda: string;
  gastado: number;
  proveedor?: string;
  instancias?: InstanciaGpu[];
}

// v2: la v1 guardo un total envenenado por una instancia colgada en terminating.
const CLAVE_SESION = "miuzika.gpu.sesion.v2";
const CADA_POLVO_MS = 10_000;

const simbolo = (moneda: string): string => (moneda === "USD" ? "$" : moneda === "EUR" ? "€" : `${moneda} `);

/** hh:mm:ss desde el instante dado. */
function duracion(desde: string | null): string {
  if (!desde) return "00:00:00";
  const ms = Math.max(0, Date.now() - Date.parse(desde));
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export interface CosteGpu {
  /** Fuerza una lectura del estado (lo usa el boton de encender/apagar). */
  refrescar(): Promise<void>;
}

export function initCosteGpu(elemento: HTMLElement | null): CosteGpu {
  if (!elemento) return { refrescar: async () => {} };

  let estado: EstadoGpu | null = null;
  let instanciaActual = "";
  let ultimoGastado = 0;
  let totalSesion = 0;
  let moneda = "USD";

  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? "{}") as {
      total?: number;
      moneda?: string;
    };
    totalSesion = Number(guardado.total) || 0;
    moneda = guardado.moneda ?? "USD";
  } catch {
    /* sin persistencia */
  }

  const guardarSesion = (): void => {
    try {
      localStorage.setItem(CLAVE_SESION, JSON.stringify({ total: totalSesion, moneda }));
    } catch {
      /* sin persistencia */
    }
  };

  const pintar = (): void => {
    if (!estado) {
      elemento.hidden = true;
      return;
    }
    if (!estado.configurado) {
      elemento.hidden = true;
      return;
    }
    elemento.hidden = false;
    const signo = simbolo(moneda);
    const precio = estado.precio_hora.toFixed(2);
    if (estado.activo && estado.gastado >= 0) {
      elemento.textContent =
        `${precio} ${signo}/h · ${duracion(estado.desde)} · ` +
        `${estado.gastado.toFixed(2)} ${signo} (sesión ${totalSesion.toFixed(2)} ${signo})`;
      elemento.classList.add("activo");
    } else {
      elemento.textContent =
        totalSesion > 0
          ? `GPU apagada · sesión ${totalSesion.toFixed(2)} ${signo}`
          : `GPU apagada · ${precio} ${signo}/h`;
      elemento.classList.remove("activo");
    }
    elemento.title =
      `Proveedor: ${estado.proveedor ?? "?"} · tarifa ${precio} ${signo}/hora\n` +
      `Esta instancia: ${estado.gastado.toFixed(2)} ${signo} en ${duracion(estado.desde)}`;
  };

  const refrescar = async (): Promise<void> => {
    try {
      const res = await fetch("/api/gpu/estado", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const datos = (await res.json()) as EstadoGpu;
      estado = datos;
      if (datos.moneda) moneda = datos.moneda;

      // Instancia nueva -> el contador del proveedor vuelve a cero y el tramo
      // anterior ya esta sumado a la sesion.
      const id = datos.instancias?.[0]?.id ?? "";
      if (id !== instanciaActual) {
        // Instancia nueva (o primera lectura): se toma su gasto como punto de
        // partida. Restarlo de cero metia de golpe todo el acumulado del proveedor.
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
      // Sin servidor no hay dato: se queda lo ultimo pintado.
      if (estado === null) elemento.hidden = true;
    }
  };

  void refrescar();
  window.setInterval(() => void refrescar(), CADA_POLVO_MS);
  // El reloj del tiempo transcurrido se mueve solo, sin volver a preguntar.
  window.setInterval(pintar, 1000);

  return { refrescar };
}
