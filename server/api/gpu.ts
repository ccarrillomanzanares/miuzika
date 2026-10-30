/** GPU on Lambda Cloud: status and spend, power on, power off and run a script. */

import { existsSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { apagar as apagarLambda, ejecutarEnLambda, encender as encenderLambda, estado as estadoLambda } from "../lambda.ts";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasGpu(server: ViteDevServer, ctx: Contexto): void {
  const { cfgLambda, faltanLambda, anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, resolverEnTrabajo, escritosDesde } = ctx;

  /** Instance used by this session (so it can be shut down without asking for the id). */
  let maquinaLambda: { id: string; ip: string } | null = null;

  // ---------------------------------------------------------- Lambda (GPU)
  server.middlewares.use("/api/gpu/estado", async (_req, res) => {
    if (cfgLambda === null) {
      responderJson(res, 200, {
        configurado: false,
        faltan: faltanLambda,
        instancias: [],
        precio_hora: 0,
      });
      return;
    }
    try {
      const e = await estadoLambda(cfgLambda);
      // Generic provider shape: the app only needs price/hour and
      // since when it counts to render the spend counter.
      responderJson(res, 200, {
        configurado: e.configurado,
        instancias: e.instancias,
        ssh: e.ssh,
        precio_hora: e.precioHora,
        moneda: e.moneda,
        proveedor: e.proveedor,
        activo: e.activo,
        desde: e.desde,
        arranque: e.arranque,
        fase: e.fase,
        gastado: e.gastado,
        tipo: e.tipo,
        region: cfgLambda.region,
        nombre: cfgLambda.nombre,
      });
    } catch (error) {
      responderJson(res, 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.middlewares.use("/api/gpu/encender", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `missing ${faltanLambda.join(", ")} in .env` });
      return;
    }
    const avisos: string[] = [];
    encenderLambda(cfgLambda, (t) => avisos.push(t))
      .then((r) => {
        maquinaLambda = { id: r.id, ip: r.ip };
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "lambda_encender",
            id: r.id,
            ip: r.ip,
            reutilizada: r.reutilizada,
            avisos,
          }),
        );
        responderJson(res, 200, { ok: true, id: r.id, ip: r.ip, reutilizada: r.reutilizada, avisos });
      })
      .catch((error) => {
        responderJson(res, 502, {
          error: error instanceof Error ? error.message : String(error),
          avisos,
        });
      });
  });

  server.middlewares.use("/api/gpu/apagar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `missing ${faltanLambda.join(", ")} in .env` });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      let id = maquinaLambda?.id ?? "";
      try {
        const datos = JSON.parse(cuerpo === "" ? "{}" : cuerpo) as { id?: string };
        if (typeof datos.id === "string" && datos.id !== "") id = datos.id;
      } catch {
        /* no body: the session's instance is shut down */
      }
      if (id === "") {
        responderJson(res, 400, {
          error: "I do not know which instance to shut down: this session has not started any",
        });
        return;
      }
      apagarLambda(cfgLambda, id)
        .then((r) => {
          maquinaLambda = null;
          anotar(
            ficheroHerramientas,
            JSON.stringify({
              t: new Date().toISOString(),
              tool: "lambda_apagar",
              id,
              apagada: r.apagada,
              segundos: r.segundos,
            }),
          );
          responderJson(res, 200, { ok: r.apagada, id, segundos: r.segundos });
        })
        .catch((error) =>
          responderJson(res, 502, {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    });
  });

  // The same contract as /api/run/python, but the process runs on the GPU.
  server.middlewares.use("/api/run/lambda", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `missing ${faltanLambda.join(", ")} in .env` });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      let datos: { path?: string; argumentos?: string[]; timeout_segundos?: number };
      try {
        datos = JSON.parse(cuerpo) as typeof datos;
      } catch (error) {
        responderJson(res, 400, {
          error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      if (!datos.path) {
        responderJson(res, 400, { error: "missing 'path'" });
        return;
      }
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const script = resolverEnTrabajo(datos.path, slug);
      if (!script) {
        responderJson(res, 403, { error: "path outside workspace/" });
        return;
      }
      if (!existsSync(script)) {
        responderJson(res, 404, { error: `${datos.path} does not exist` });
        return;
      }

      // On Lambda the GPU is paid by the hour: a numpy engine script (dsp,
      // instruments, render) there is CPU at GPU price. It is cut before
      // starting the machine, which is the expensive part.
      const fuente = readFileSync(script, "utf8");
      // The GPU is only powered on for a script that USES it (imports torch or the GPU
      // engine). Before, only those importing the numpy engine were rejected, and on Oct 27
      // a script that listed files powered on a paid A10.
      const usaGpu = /^\s*(?:from|import)\s+(?:motor_gpu|voces_gpu|torch)\b/m.test(fuente);
      if (!usaGpu) {
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "ejecutar_python_lambda",
            path: datos.path,
            rechazado: "CPU script on Lambda",
          }),
        );
        responderJson(res, 409, {
          error:
            "That script does not use the GPU (it does not import motor_gpu, voces_gpu or torch): on Lambda you would pay for " +
            "GPU for nothing. Run it with destino='cpu', which is free. If you really need the GPU, " +
            "write it with motor_gpu (osc, saturar, reverb, shimmer, granular, compresor_multibanda…).",
        });
        return;
      }
      const segundos = Math.min(Math.max(datos.timeout_segundos ?? 900, 1), 1800);
      const argumentos = Array.isArray(datos.argumentos)
        ? datos.argumentos.map((a) => String(a))
        : [];
      // The remote path is the same one relative to the workspace.
      const relativo = relative(carpetaTrabajo, script).split(sep).join("/");

      const avisos: string[] = [];
      const t0Lambda = Date.now();
      ejecutarEnLambda(cfgLambda, {
        scriptRel: relativo,
        argumentos,
        segundos,
        carpetaTrabajo,
        slug,
        aviso: (t) => {
          avisos.push(t);
          anotar(
            ficheroHerramientas,
            JSON.stringify({ t: new Date().toISOString(), tool: "lambda_aviso", texto: t }),
          );
        },
      })
        .then((r) => {
          maquinaLambda = { id: r.id, ip: r.ip };
          anotar(
            ficheroHerramientas,
            JSON.stringify({
              t: new Date().toISOString(),
              tool: "ejecutar_python_lambda",
              path: datos.path,
              argumentos,
              codigo: r.codigo,
              ms: r.ms,
              ip: r.ip,
              traidos: r.traidos,
              salida: r.salida.slice(-600),
              errores: r.errores.slice(-600),
            }),
          );
          responderJson(res, 200, {
            ok: r.ok,
            codigo: r.codigo,
            senal: null,
            ms: r.ms,
            por_timeout: r.errores.includes("cut off after"),
            salida: r.salida.slice(-8000),
            errores: r.errores.slice(-8000),
            // Only what has changed in the project folder: the whole tree
            // is 573 KB of JSON that nobody reads (and the catalog, 4,231
            // files, takes seconds to walk on every call).
            escritos: escritosDesde(slug, t0Lambda),
            lambda: { ip: r.ip, id: r.id, nota: r.nota, traidos: r.traidos, avisos },
          });
        })
        .catch((error) => {
          responderJson(res, 502, {
            error: error instanceof Error ? error.message : String(error),
            avisos,
          });
        });
    });
  });
}
