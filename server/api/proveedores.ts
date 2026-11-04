/**
 * Model providers: configuration and agent proxy.
 *
 *   GET  /api/proveedores              list, which one is active and with which model (WITHOUT keys)
 *   POST /api/proveedores              {accion: "guardar" | "activar" | "borrarClave", id, apiKey?, base?, modelo?}
 *   GET  /api/proveedores/modelos?id=  models offered by that provider
 *   POST /api/proveedores/probar       {id, modelo}: a minimal call, to know whether it works
 *   *    /api/llm/v1/…                 the agent chat → active provider (with its key)
 *   *    /api/llm/api/…                Ollama's own services (web search, tags) → Ollama Cloud
 *
 * The keys live in `.miuzika/proveedores.json` (outside git and outside
 * workspace/, where the agent reads and writes) or in the .env. They are never returned to the
 * browser: only "there is a key" and its last digits.
 *
 * This used to be a fixed Vite proxy to Ollama Cloud (vite.config.ts).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { rutaJson } from "../ruta.ts";
import { guardarFicheroProveedores, leerConfigGpu, leerFicheroProveedores } from "../config-proveedores.ts";
import { PROVEEDORES_GPU, ajustesEfectivos, gpuActiva, limpiarAjustesGpu, proveedorGpuPorId } from "../../src/core/proveedores-gpu.ts";
import {
  PROVEEDORES,
  PROVEEDOR_POR_DEFECTO,
  adaptarCuerpo,
  baseDe,
  claveDe,
  claveOculta,
  modelosDeRespuesta,
  proveedorPorId,
  type ConfigProveedores,
  type Proveedor,
} from "../../src/core/proveedores.ts";

function leerConfig(): ConfigProveedores {
  const datos = leerFicheroProveedores();
  return {
    activo: proveedorPorId(String(datos.activo ?? "")) ? String(datos.activo) : PROVEEDOR_POR_DEFECTO,
    proveedores:
      typeof datos.proveedores === "object" && datos.proveedores ? (datos.proveedores as ConfigProveedores["proveedores"]) : {},
  };
}

/** Only the LLM part: the GPU part of the same file is kept (server/config-proveedores.ts). */
function guardarConfig(config: ConfigProveedores): void {
  guardarFicheroProveedores({ activo: config.activo, proveedores: config.proveedores });
}

/** Authentication headers for a provider (Anthropic also accepts Bearer in its compatible API). */
function cabeceras(clave: string): Record<string, string> {
  return clave ? { Authorization: `Bearer ${clave}` } : {};
}

export function rutasProveedores(server: ViteDevServer, ctx: Contexto, env: Record<string, string>): void {
  const { responderJson, leerCuerpo, leerCuerpoCrudo, anotar, ficheroHerramientas } = ctx;

  const activo = (): { p: Proveedor; base: string; clave: string; modelo: string } => {
    const config = leerConfig();
    const p = proveedorPorId(config.activo) ?? proveedorPorId(PROVEEDOR_POR_DEFECTO)!;
    const ajustes = config.proveedores[p.id];
    return { p, base: baseDe(p, ajustes), clave: claveDe(p, ajustes, env), modelo: ajustes?.modelo || p.modeloPorDefecto };
  };

  const describir = () => {
    const config = leerConfig();
    return {
      ok: true,
      activo: config.activo,
      modelo: config.proveedores[config.activo]?.modelo || proveedorPorId(config.activo)?.modeloPorDefecto || "",
      proveedores: PROVEEDORES.map((p) => {
        const ajustes = config.proveedores[p.id];
        const clave = claveDe(p, ajustes, env);
        return {
          id: p.id,
          nombre: p.nombre,
          base: baseDe(p, ajustes),
          baseEditable: p.baseEditable === true,
          necesitaClave: p.necesitaClave,
          tieneClave: clave !== "",
          clave: claveOculta(clave),
          claveDelEnv: !ajustes?.apiKey && clave !== "" ? p.variableEnv : undefined,
          modelo: ajustes?.modelo || p.modeloPorDefecto,
          ayuda: p.ayuda,
        };
      }),
    };
  };

  async function listarModelos(id: string): Promise<string[]> {
    const p = proveedorPorId(id);
    if (!p) throw new Error(`unknown provider: ${id}`);
    const ajustes = leerConfig().proveedores[id];
    const base = baseDe(p, ajustes);
    if (!base) throw new Error("missing the base URL");
    const clave = claveDe(p, ajustes, env);
    if (p.necesitaClave && !clave) throw new Error("missing the key");
    // Ollama lists at /api/tags (outside /v1); the others at /models.
    const url = p.listado === "ollama" ? `${base.replace(/\/v1$/, "")}/api/tags` : `${base}/models`;
    const res = await fetch(url, {
      headers: { ...cabeceras(clave), ...(p.id === "anthropic" ? { "x-api-key": clave, "anthropic-version": "2023-06-01" } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return modelosDeRespuesta(await res.json());
  }

  server.middlewares.use("/api/proveedores/modelos", (req, res) => {
    const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? "";
    listarModelos(id)
      .then((modelos) => responderJson(res, 200, { ok: true, modelos }))
      .catch((error: unknown) => responderJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }));
  });

  // Errors answer 200 with ok:false on purpose: the Models panel shows the text.
  // rutaJson adds the POST guard it lacked (review 3-Nov, bug 9).
  server.middlewares.use("/api/proveedores/probar", rutaJson<{ id?: string; modelo?: string }>({ metodo: "POST" }, async ({ res, datos: { id, modelo } }) => {
    try {
      const p = proveedorPorId(String(id));
      if (!p) throw new Error("unknown provider");
      const ajustes = leerConfig().proveedores[p.id];
      const base = baseDe(p, ajustes);
      const clave = claveDe(p, ajustes, env);
      if (p.necesitaClave && !clave) throw new Error("missing the key");
      const t0 = Date.now();
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceras(clave) },
        body: JSON.stringify(
          adaptarCuerpo(p, {
            model: modelo || ajustes?.modelo || p.modeloPorDefecto,
            messages: [{ role: "user", content: "Answer only: ok" }],
            max_tokens: 16,
            stream: false,
          }),
        ),
        signal: AbortSignal.timeout(60_000),
      });
      const texto = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 300)}`);
      const datos = JSON.parse(texto) as { choices?: { message?: { content?: string } }[]; model?: string };
      responderJson(res, 200, {
        ok: true,
        ms: Date.now() - t0,
        modelo: datos.model,
        respuesta: String(datos.choices?.[0]?.message?.content ?? "").slice(0, 80),
      });
    } catch (error) {
      responderJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }));

  // ---------------------------------------------------------------- GPU (4-Nov)
  // GET: the GPU providers, which one is on and each field's value and origin (settings,
  // .env, default), WITHOUT secrets: a secret only says it exists and its last digits.
  // POST {accion: guardar | activar | desactivar | borrarClave, id, campos}.
  // Mounted before the root route below, which only answers "/".
  const describirGpu = () => {
    const config = leerConfigGpu();
    const { gpu, faltan } = ctx.gpuActual();
    return {
      ok: true,
      activo: gpuActiva(config, env),
      // Where the on/off comes from: the settings, or .env's MIUZIKA_LAMBDA when there are none.
      activoDesde: config?.activo !== undefined ? "ajustes" : "env",
      disponible: gpu !== null,
      faltan,
      proveedores: PROVEEDORES_GPU.map((p) => {
        const { variables, origen } = ajustesEfectivos(p.id, config, env);
        return {
          id: p.id,
          nombre: p.nombre,
          ayuda: { es: p.ayudaEs, en: p.ayudaEn },
          campos: p.campos.map((c) => {
            const valor = variables[c.variableEnv] ?? "";
            return {
              clave: c.clave,
              es: c.es,
              en: c.en,
              variableEnv: c.variableEnv,
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

  server.middlewares.use("/api/proveedores/gpu", (req, res) => {
    if (req.method === "GET") {
      responderJson(res, 200, describirGpu());
      return;
    }
    rutaJson<{ accion?: string; id?: string; campos?: Record<string, unknown> }>({ metodo: "POST" }, async ({ res: r, datos }) => {
      const p = proveedorGpuPorId(String(datos.id ?? ""));
      if (!p) {
        responderJson(r, 400, { error: `unknown GPU provider: ${String(datos.id)}` });
        return;
      }
      const config = leerConfigGpu() ?? { proveedores: {} };
      const previos = config.proveedores[p.id] ?? {};
      let propios = limpiarAjustesGpu(p.id, datos.campos ?? {}, previos);
      if (datos.accion === "borrarClave") {
        propios = { ...previos };
        for (const c of p.campos) if (c.secreto) delete propios[c.clave];
      }
      const activo = datos.accion === "activar" ? p.id : datos.accion === "desactivar" ? "" : config.activo;
      guardarFicheroProveedores({
        gpu: { ...(activo !== undefined ? { activo } : {}), proveedores: { ...config.proveedores, [p.id]: propios } },
      });
      // Never the values: which fields changed, for the log.
      anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "ajustes_gpu", id: p.id, accion: datos.accion ?? "guardar", campos: Object.keys(datos.campos ?? {}) }));
      responderJson(r, 200, describirGpu());
    })(req, res);
  });

  server.middlewares.use("/api/proveedores", (req, res, next) => {
    // Mounted after /modelos and /probar: only the root reaches here.
    if ((req.url ?? "/").replace(/\?.*$/, "") !== "/") {
      next();
      return;
    }
    if (req.method === "GET") {
      responderJson(res, 200, describir());
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      try {
        const d = JSON.parse(cuerpo) as { accion?: string; id?: string; apiKey?: string; base?: string; modelo?: string };
        const p = proveedorPorId(String(d.id));
        if (!p) {
          responderJson(res, 400, { error: `unknown provider: ${d.id}` });
          return;
        }
        const config = leerConfig();
        const ajustes = { ...(config.proveedores[p.id] ?? {}) };
        if (d.accion === "borrarClave") {
          delete ajustes.apiKey;
        } else {
          if (typeof d.apiKey === "string" && d.apiKey.trim() !== "") ajustes.apiKey = d.apiKey.trim();
          if (typeof d.base === "string" && p.baseEditable) ajustes.base = d.base.trim();
          if (typeof d.modelo === "string") ajustes.modelo = d.modelo.trim();
          if (d.accion === "activar") config.activo = p.id;
        }
        config.proveedores[p.id] = ajustes;
        guardarConfig(config);
        responderJson(res, 200, describir());
      } catch (error) {
        responderJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  /** Forwards a request with its body and returns the response as is (streaming included). */
  async function reenviar(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    clave: string,
    adaptar: ((cuerpo: Record<string, unknown>) => Record<string, unknown>) | null,
    etiqueta: string,
  ): Promise<void> {
    const t0 = Date.now();
    const cuerpoCrudo = req.method === "GET" || req.method === "HEAD"
      ? null
      : await new Promise<string | null>((listo) => leerCuerpoCrudo(req, listo, 16 * 1024 * 1024));
    let cuerpo: string | undefined;
    if (cuerpoCrudo !== null && cuerpoCrudo !== "") {
      cuerpo = cuerpoCrudo;
      if (adaptar) {
        try {
          cuerpo = JSON.stringify(adaptar(JSON.parse(cuerpoCrudo) as Record<string, unknown>));
        } catch {
          /* not JSON: forwarded as is */
        }
      }
    }
    const control = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) control.abort();
    });
    try {
      const r = await fetch(url, {
        method: req.method,
        headers: { "Content-Type": "application/json", ...cabeceras(clave) },
        body: cuerpo,
        signal: control.signal,
      });
      res.statusCode = r.status;
      const tipo = r.headers.get("content-type");
      if (tipo) res.setHeader("Content-Type", tipo);
      res.setHeader("Cache-Control", "no-cache");
      console.log(`[llm] ${etiqueta} ${req.method} ${url.replace(/^https?:\/\/[^/]+/, "")} -> ${r.status} in ${Date.now() - t0} ms`);
      if (!r.body) {
        res.end();
        return;
      }
      // The stream must have an error listener: when the browser closes the connection
      // mid-answer (Cancel, reload, a closed tab) the abort above makes it emit AbortError, and
      // an unhandled stream error kills the whole dev server. Seen 4-Nov: a test tab closed
      // during a DeepSeek answer took down Vite ("Unhandled 'error' event ... AbortError").
      const flujo = Readable.fromWeb(r.body as never);
      flujo.on("error", (error) => {
        if (!control.signal.aborted) console.error(`[llm] ${etiqueta} stream error: ${error instanceof Error ? error.message : String(error)}`);
        res.destroy();
      });
      flujo.pipe(res);
    } catch (error) {
      if (control.signal.aborted) return;
      console.error(`[llm] ${etiqueta} ${url} -> ERROR ${error instanceof Error ? error.message : String(error)}`);
      responderJson(res, 502, { error: `could not talk to ${etiqueta}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // Ollama's own services (web search, page reading, model list):
  // always to Ollama Cloud with its key, whatever the agent's provider is.
  server.middlewares.use("/api/llm/api", (req, res) => {
    const p = proveedorPorId("ollama-cloud")!;
    const clave = claveDe(p, leerConfig().proveedores[p.id], env);
    void reenviar(req, res, `https://ollama.com/api${req.url ?? ""}`, clave, null, "ollama");
  });

  // The agent chat: to the active provider.
  server.middlewares.use("/api/llm/v1", (req, res) => {
    const { p, base, clave } = activo();
    if (!base) {
      responderJson(res, 400, { error: `provider "${p.nombre}" has no base URL: set it in Modelos` });
      return;
    }
    if (p.necesitaClave && !clave) {
      responderJson(res, 401, { error: `missing the key for "${p.nombre}": set it in Modelos` });
      return;
    }
    void reenviar(req, res, `${base}${req.url ?? ""}`, clave, (cuerpo) => adaptarCuerpo(p, cuerpo), p.nombre);
  });
}
