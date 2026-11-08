/**
 * Settings: what the app rents, without editing a .env (the user, 6-Nov).
 *
 *   GET  /api/ajustes/gpu          each provider's fields, values and origin, WITHOUT secrets
 *   POST /api/ajustes/gpu          {accion: guardar | borrarClave, id, campos}
 *   POST /api/ajustes/gpu/probar   what can be checked without starting anything or spending
 *
 * A key comes in here and never goes back to the browser or into a log: only "there is one", its
 * last digits, and the names of the fields that changed.
 */

import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { guardarFicheroProveedores, leerConfigGpu, leerTokenHf, origenTokenHf } from "../config-proveedores.ts";
import { MODELOS_HF_CON_PUERTA } from "../../src/modulos/stableaudio/receta.ts";
// A page from another site can POST to localhost: it must not be able to change the keys.
import { mensajeDe, otroOrigen, rutaJson } from "../ruta.ts";
import { PROVEEDORES_GPU, ajustesEfectivos, claveOculta, limpiarAjustesGpu, proveedorGpuPorId } from "../../src/core/proveedores-gpu.ts";

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

  // ---------------------------------------------------------------- Hugging Face (8-Nov: gated Stable Audio 3)
  //   GET  /api/ajustes/hf          {tiene, oculta, origen}: never the token
  //   POST /api/ajustes/hf          {accion: guardar | borrar, token}
  //   POST /api/ajustes/hf/probar   who the token is and whether it reaches the gated models; starts nothing
  const describirHf = () => {
    const token = leerTokenHf();
    return { tiene: token !== "", oculta: claveOculta(token), origen: origenTokenHf() };
  };

  server.middlewares.use(
    "/api/ajustes/hf/probar",
    rutaJson({ metodo: "POST" }, async ({ req, res }) => {
      if (otroOrigen(req)) {
        responderJson(res, 403, { error: "only from the app itself" });
        return;
      }
      const token = leerTokenHf();
      if (!token) {
        responderJson(res, 200, { ok: false, comprobaciones: [{ que: "Hugging Face", ok: false, detalle: "no token saved" }] });
        return;
      }
      const cabecera = { Authorization: `Bearer ${token}` };
      const comprobaciones: { que: string; ok: boolean; detalle: string }[] = [];
      try {
        const yo = await fetch("https://huggingface.co/api/whoami-v2", { headers: cabecera });
        const datos = (await yo.json().catch(() => ({}))) as { name?: string };
        comprobaciones.push({ que: "Token", ok: yo.ok, detalle: yo.ok ? `account ${datos.name ?? "?"}` : `HTTP ${yo.status}` });
        for (const repo of MODELOS_HF_CON_PUERTA) {
          const r = await fetch(`https://huggingface.co/${repo}/resolve/main/model_config.json`, { headers: cabecera, method: "HEAD" });
          comprobaciones.push({
            que: repo,
            ok: r.ok,
            detalle: r.ok ? "access granted" : r.status === 403 ? "no access: accept the terms on its page, and give the token read access to gated repos" : `HTTP ${r.status}`,
          });
        }
      } catch (error) {
        comprobaciones.push({ que: "Hugging Face", ok: false, detalle: mensajeDe(error) });
      }
      responderJson(res, 200, { ok: comprobaciones.every((c) => c.ok), comprobaciones });
    }),
  );

  const guardarHf = rutaJson<{ accion?: string; token?: unknown }>({ metodo: "POST" }, ({ req, res, datos }) => {
    if (otroOrigen(req)) {
      responderJson(res, 403, { error: "only from the app itself" });
      return;
    }
    if (datos.accion === "borrar") {
      guardarFicheroProveedores({ huggingface: {} });
    } else if (datos.accion === "guardar") {
      const token = typeof datos.token === "string" ? datos.token.trim() : "";
      if (!/^hf_[A-Za-z0-9]{20,}$/.test(token)) {
        responderJson(res, 400, { error: "That does not look like a Hugging Face token (it starts with hf_)." });
        return;
      }
      guardarFicheroProveedores({ huggingface: { token } });
    } else {
      responderJson(res, 400, { error: `unknown action: ${String(datos.accion)}` });
      return;
    }
    anotarGpu({ tool: "ajustes_hf", accion: datos.accion });
    responderJson(res, 200, describirHf());
  });

  server.middlewares.use("/api/ajustes/hf", (req, res) => {
    if (req.method === "GET") {
      responderJson(res, 200, describirHf());
      return;
    }
    guardarHf(req, res);
  });

  server.middlewares.use("/api/ajustes/gpu", (req, res) => {
    if (req.method === "GET") {
      responderJson(res, 200, describir());
      return;
    }
    guardar(req, res);
  });
}
