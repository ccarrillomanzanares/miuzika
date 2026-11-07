/**
 * A GPU that costs nothing, for checking the whole path without spending: only with
 * MIUZIKA_GPU=simulado, which nobody sets by accident. It runs the real generar_audio.py on the
 * laptop through scripts/simular_acestep.py, which replaces torch and ACE-Step with stand-ins.
 * It proves what reaches the model, not what the model does with it.
 */

import { correrProceso } from "../proceso.ts";
import { Cancelado, type EstadoGpu, type ProveedorGpu } from "./proveedor.ts";
import { resolve } from "node:path";

export function proveedorSimulado(): ProveedorGpu {
  const estado: EstadoGpu = {
    configurado: true,
    instancias: [],
    ssh: { ok: true, detalle: "simulated" },
    precioHora: 1.29,
    tipo: "simulated",
    fase: "apagada",
    activo: false,
    desde: null,
    arranque: null,
    gastado: 0,
    moneda: "USD",
    proveedor: "simulated",
  };
  return {
    id: "simulado",
    nombre: "Simulated GPU",
    region: "laptop",
    etiqueta: "simulado",
    estado: async () => estado,
    comprobar: async () => [{ que: "Simulated GPU", ok: true, detalle: "nothing to check" }],
    encender: async () => ({ id: "simulado", ip: "127.0.0.1", reutilizada: true }),
    apagables: async () => [],
    apagar: async () => ({ apagada: true, segundos: 0 }),
    ejecutar: async (p) => {
      p.aviso("simulated: nothing is billed");
      const t0 = Date.now();
      const r = await correrProceso(
        process.env.MIUZIKA_PYTHON || "python",
        ["-u", resolve(process.cwd(), "scripts/simular_acestep.py"), resolve(p.carpetaTrabajo, p.scriptRel), ...p.argumentos],
        {
          segundos: p.segundos,
          senal: p.senal,
          cwd: resolve(p.carpetaTrabajo, "proyectos", p.slug),
          env: { ...process.env, PYTHONIOENCODING: "utf-8", MIUZIKA_SIMULAR_RETARDO: process.env.MIUZIKA_SIMULAR_RETARDO ?? "0" },
          windowsHide: true,
        },
      );
      if (p.senal?.aborted) throw new Cancelado();
      return {
        ok: r.codigo === 0,
        id: "simulado",
        ip: "127.0.0.1",
        codigo: r.codigo,
        salida: r.salida,
        errores: r.errores,
        ms: Date.now() - t0,
        traidos: [],
        nota: "simulated",
        traidaFallo: "",
      };
    },
  };
}
