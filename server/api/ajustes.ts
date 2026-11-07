/**
 * Settings: what the app rents, without editing a .env (Carlos, 6-Nov).
 *
 *   GET  /api/ajustes/gpu          each provider's fields, values and origin, WITHOUT secrets
 *   POST /api/ajustes/gpu          {accion: guardar | borrarClave, id, campos}
 *   POST /api/ajustes/gpu/probar   what can be checked without starting anything or spending
 *
 * A key comes in here and never goes back to the browser or into a log: only "there is one", its
 * last digits, and the names of the fields that changed.
 */

import type { IncomingMessage } from "node:http";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { guardarFicheroProveedores, leerConfigGpu } from "../config-proveedores.ts";
import { mensajeDe, rutaJson } from "../ruta.ts";
import { PROVEEDORES_GPU, ajustesEfectivos, claveOculta, limpiarAjustesGpu, proveedorGpuPorId } from "../../src/core/proveedores-gpu.ts";

/** A page from another site can POST to localhost: it must not be able to change the keys. */
function otroOrigen(req: IncomingMessage): boolean {
  const origen = req.headers.origin;
  if (!origen) return false;
  try {
    return new URL(origen).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function rutasAjustes(server: ViteDevServer, ctx: Contexto): void {
  const { gpuActual, envGpu, anotarGpu, responderJson } = ctx;

  const describir = () => {
    const config = leerConfigGpu();
    const env = envGpu();
    const { gpu, faltan } = gpuActual();
    return {
      disponible: gpu !== null,
      faltan,
      proveedores: PROVEEDORES_GPU.map((p) => {
        const { variables, origen } = ajustesEfectivos(p.id, config, env);
        return {
          id: p.id,
          nombre: p.nombre,
          ayuda: p.ayuda,
          campos: p.campos.map((c) => {
            const valor = variables[c.variableEnv] ?? "";
            return {
              clave: c.clave,
              etiqueta: c.etiqueta,
              ayuda: c.ayuda ?? "",
              avanzado: c.avanzado === true,
              secreto: c.secreto === true,
              origen: origen[c.clave],
              porDefecto: c.porDefecto ?? "",
              ...(c.secreto ? { tiene: valor !== "", oculta: claveOculta(valor) } : { valor }),
            };
          }),
        };
      }),
    };
  };

  // Answers ok:false in a 200 on purpose: a key that fails is the result of the test, not an error of the route.
  server.middlewares.use(
    "/api/ajustes/gpu/probar",
    rutaJson({ metodo: "POST" }, async ({ req, res }) => {
      if (otroOrigen(req)) {
        responderJson(res, 403, { error: "only from the app itself" });
        return;
      }
      const { gpu, faltan } = gpuActual();
      if (gpu === null) {
        responderJson(res, 200, { ok: false, comprobaciones: [{ que: "Settings", ok: false, detalle: `missing: ${faltan.join(", ")}` }] });
        return;
      }
      try {
        const comprobaciones = await gpu.comprobar();
        responderJson(res, 200, { ok: comprobaciones.every((c) => c.ok), comprobaciones });
      } catch (error) {
        responderJson(res, 200, { ok: false, comprobaciones: [{ que: gpu.nombre, ok: false, detalle: mensajeDe(error) }] });
      }
    }),
  );

  const guardar = rutaJson<{ accion?: string; id?: string; campos?: Record<string, unknown> }>({ metodo: "POST" }, ({ req, res, datos }) => {
    if (otroOrigen(req)) {
      responderJson(res, 403, { error: "only from the app itself" });
      return;
    }
    const p = proveedorGpuPorId(String(datos.id ?? ""));
    if (!p) {
      responderJson(res, 400, { error: `unknown GPU provider: ${String(datos.id)}` });
      return;
    }
    if (datos.accion !== "guardar" && datos.accion !== "borrarClave") {
      responderJson(res, 400, { error: `unknown action: ${String(datos.accion)}` });
      return;
    }
    const config = leerConfigGpu() ?? { proveedores: {} };
    const previos = config.proveedores[p.id] ?? {};
    const propios = limpiarAjustesGpu(p.id, datos.campos ?? {}, previos);
    if (datos.accion === "borrarClave") for (const c of p.campos) if (c.secreto) delete propios[c.clave];
    guardarFicheroProveedores({ gpu: { proveedores: { ...config.proveedores, [p.id]: propios } } });
    // Never the values: which fields came, for the log.
    anotarGpu({ tool: "ajustes_gpu", id: p.id, accion: datos.accion, campos: Object.keys(datos.campos ?? {}) });
    responderJson(res, 200, describir());
  });

  server.middlewares.use("/api/ajustes/gpu", (req, res) => {
    if (req.method === "GET") {
      responderJson(res, 200, describir());
      return;
    }
    guardar(req, res);
  });
}
