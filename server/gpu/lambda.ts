/** Lambda Cloud as a ProveedorGpu: a thin wrapper over server/lambda.ts, no behaviour of its own. */

import { apagablesDe, apagar, comprobarConfig, ejecutarEnLambda, encender, estado, instancias, type ConfigLambda } from "../lambda.ts";
import type { ProveedorGpu } from "./proveedor.ts";

export function proveedorLambda(cfg: ConfigLambda): ProveedorGpu {
  return {
    id: "lambda",
    nombre: "Lambda Cloud",
    region: cfg.region,
    etiqueta: cfg.nombre,
    estado: () => estado(cfg),
    comprobar: () => comprobarConfig(cfg),
    encender: (aviso, senal) => encender(cfg, aviso, senal),
    apagables: async () => apagablesDe(await instancias(cfg), cfg.nombre),
    apagar: (id) => apagar(cfg, id),
    ejecutar: (p) => ejecutarEnLambda(cfg, p),
  };
}
