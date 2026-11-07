/**
 * The rented GPU, for any module: status and spend, shut down, run a script of workspace/gpu/.
 * It carries the request and decides nothing: the recipe is written to a file as it arrived.
 * Keys stay here; the browser never sees them.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { esTimeoutDelModelo, planDeEntradas } from "../lambda.ts";
import { Cancelado } from "../gpu/proveedor.ts";
import { mensajeDe, rutaJson } from "../ruta.ts";

interface PeticionEjecutar {
  script?: string;
  nombre?: string;
  receta?: { parametros?: unknown };
  entradas?: unknown;
  timeout_segundos?: number;
}

/** A file name, nothing that could leave the project folder. */
const NOMBRE_VALIDO = /^[A-Za-z0-9._-]+$/;

export function rutasGpu(server: ViteDevServer, ctx: Contexto): void {
  const { gpuActual, anotarGpu, carpetaTrabajo, responderJson, slugProyecto, carpetaProyecto, resolverEnTrabajo } = ctx;

  server.middlewares.use(
    "/api/gpu/estado",
    rutaJson({ metodo: "GET" }, async ({ res }) => {
      const { gpu, faltan } = gpuActual();
      if (gpu === null) {
        responderJson(res, 200, { configurado: false, faltan });
        return;
      }
      const e = await gpu.estado();
      responderJson(res, 200, {
        configurado: true,
        ssh: e.ssh,
        precio_hora: e.precioHora,
        moneda: e.moneda,
        proveedor: gpu.nombre,
        activo: e.activo,
        desde: e.desde,
        fase: e.fase,
        gastado: e.gastado,
        tipo: e.tipo,
      });
    }),
  );

  // It answers when the provider confirms (81 s and 87 s measured on Lambda). Only instances
  // of this app: the account is shared with other projects.
  server.middlewares.use(
    "/api/gpu/apagar",
    rutaJson({ metodo: "POST" }, async ({ res }) => {
      const { gpu, faltan } = gpuActual();
      if (gpu === null) {
        responderJson(res, 400, { error: `GPU not available: ${faltan.join(", ")}` });
        return;
      }
      const nuestras = await gpu.apagables();
      if (nuestras.length === 0) {
        responderJson(res, 409, { error: `there is no instance named ${gpu.etiqueta} on or starting` });
        return;
      }
      const hechas = await Promise.all(nuestras.map(async (i) => ({ id: i.id, ...(await gpu.apagar(i.id)) })));
      for (const h of hechas) anotarGpu({ tool: "gpu_apagar", id: h.id, apagada: h.apagada, segundos: h.segundos });
      responderJson(res, 200, { ok: hechas.every((h) => h.apagada), apagadas: hechas });
    }),
  );

  // The takes of a project with their recipes, so one can be repeated. Reads what the script wrote.
  server.middlewares.use(
    "/api/gpu/tomas",
    rutaJson({ metodo: "GET" }, ({ req, res }) => {
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const carpeta = resolve(carpetaTrabajo, "proyectos", slug, "generado");
      const tomas: { nombre: string; receta: unknown; semillas: unknown[]; ficheros: string[]; creada: unknown }[] = [];
      if (existsSync(carpeta)) {
        for (const fichero of readdirSync(carpeta).filter((n) => n.endsWith(".lineage.json"))) {
          try {
            const linaje = JSON.parse(readFileSync(resolve(carpeta, fichero), "utf8")) as {
              recipe?: unknown;
              created_at?: unknown;
              outputs?: { seed?: unknown; file?: unknown }[];
            };
            if (linaje.recipe) {
              tomas.push({
                nombre: fichero.replace(/\.lineage\.json$/, ""),
                receta: linaje.recipe,
                semillas: (linaje.outputs ?? []).map((o) => o.seed),
                // Bug 22: a take of 3 writes name-1..3.wav, so those names are taken too.
                ficheros: (linaje.outputs ?? []).map((o) => o.file).filter((f): f is string => typeof f === "string"),
                creada: linaje.created_at,
              });
            }
          } catch {
            /* a broken lineage file does not hide the others */
          }
        }
      }
      responderJson(res, 200, { tomas });
    }),
  );

  /**
   * Runs one script of workspace/gpu/ and streams one JSON line per step, the result last:
   * a boot takes 4-5 minutes and the person has to see where it is. Closing the request is
   * Cancel: from then on no step starts, the ssh is cut and the remote process killed.
   */
  server.middlewares.use(
    "/api/gpu/ejecutar",
    rutaJson<PeticionEjecutar>({ metodo: "POST", limite: 1024 * 1024 }, ({ req, res, datos }) => {
      const { gpu, faltan } = gpuActual();
      if (gpu === null) {
        responderJson(res, 400, { error: `GPU not available: ${faltan.join(", ")}` });
        return;
      }
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const script = datos.script ?? "";
      const nombre = datos.nombre ?? "";
      if (!NOMBRE_VALIDO.test(script) || !script.endsWith(".py") || !existsSync(resolve(carpetaTrabajo, "gpu", script))) {
        responderJson(res, 404, { error: `gpu/${script} does not exist` });
        return;
      }
      if (!NOMBRE_VALIDO.test(nombre)) {
        responderJson(res, 400, { error: "'nombre' has to be a file name" });
        return;
      }
      if (!datos.receta || typeof datos.receta.parametros !== "object") {
        responderJson(res, 400, { error: "'receta.parametros' is missing" });
        return;
      }
      const carpeta = carpetaProyecto(slug);
      // A take with this name would be overwritten: refused before the machine boots.
      const generado = resolve(carpeta, "generado");
      if (existsSync(generado) && readdirSync(generado).some((n) => n === `${nombre}.lineage.json` || n === `${nombre}.wav`)) {
        responderJson(res, 409, { error: `there is already a take named “${nombre}” in this project` });
        return;
      }
      const entradas: string[] = [];
      for (const ruta of Array.isArray(datos.entradas) ? datos.entradas : []) {
        const local = typeof ruta === "string" ? resolverEnTrabajo(ruta, slug) : null;
        if (!local || !existsSync(local)) {
          responderJson(res, 400, { error: `input ${String(ruta)} does not exist in the project` });
          return;
        }
        entradas.push(local);
      }
      // A file and not the command line: the text must not depend on three layers of quoting.
      const carpetaEntrada = resolve(carpeta, "entrada");
      mkdirSync(carpetaEntrada, { recursive: true });
      const ficheroReceta = resolve(carpetaEntrada, `${nombre}.receta.json`);
      writeFileSync(ficheroReceta, JSON.stringify(datos.receta, null, 2), "utf8");
      entradas.push(ficheroReceta);
      const plan = planDeEntradas(carpeta, entradas);
      if ("error" in plan) {
        responderJson(res, 400, { error: plan.error });
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      const linea = (objeto: unknown): void => {
        if (!res.writableEnded) res.write(`${JSON.stringify(objeto)}\n`);
      };
      const t0 = Date.now();
      const corte = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) corte.abort();
      });
      gpu
        .ejecutar({
          senal: corte.signal,
          scriptRel: `gpu/${script}`,
          argumentos: ["--parametros", relative(carpeta, ficheroReceta).split(sep).join("/")],
          segundos: Math.min(Math.max(datos.timeout_segundos ?? 1800, 1), 1800),
          carpetaTrabajo,
          slug,
          entradas,
          aviso: (texto) => {
            anotarGpu({ tool: "gpu_aviso", texto });
            linea({ aviso: texto });
          },
        })
        .then((r) => {
          anotarGpu({ tool: "gpu_ejecutar", script, nombre, codigo: r.codigo, ms: r.ms, traidos: r.traidos, salida: r.salida.slice(-600), errores: r.errores.slice(-600) });
          linea({
            resultado: {
              ok: r.ok,
              codigo: r.codigo,
              ms: r.ms,
              por_timeout: esTimeoutDelModelo(r),
              salida: r.salida.slice(-8000),
              errores: r.errores.slice(-8000),
              nota: r.nota,
              traidos: r.traidos,
              traida_fallo: r.traidaFallo,
            },
          });
          res.end();
        })
        .catch((error: unknown) => {
          if (error instanceof Cancelado) {
            anotarGpu({ tool: "gpu_ejecutar", script, nombre, cancelado: true, ms: Date.now() - t0 });
            res.end();
            return;
          }
          linea({ error: mensajeDe(error) });
          res.end();
        });
    }),
  );
}
