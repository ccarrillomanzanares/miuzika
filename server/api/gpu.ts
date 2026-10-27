/** GPU en Lambda Cloud: estado y gasto, encender, apagar y ejecutar un script. */

import { existsSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { apagar as apagarLambda, ejecutarEnLambda, encender as encenderLambda, estado as estadoLambda } from "../lambda.ts";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasGpu(server: ViteDevServer, ctx: Contexto): void {
  const { cfgLambda, faltanLambda, anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, resolverEnTrabajo, escritosDesde } = ctx;

  /** Instancia que ha usado esta sesion (para poder apagarla sin pedir el id). */
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
      // Forma generica de proveedor: la app solo necesita precio/hora y
      // desde cuando cuenta para pintar el contador de gasto.
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
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `falta ${faltanLambda.join(", ")} en .env` });
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
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `falta ${faltanLambda.join(", ")} en .env` });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      let id = maquinaLambda?.id ?? "";
      try {
        const datos = JSON.parse(cuerpo === "" ? "{}" : cuerpo) as { id?: string };
        if (typeof datos.id === "string" && datos.id !== "") id = datos.id;
      } catch {
        /* sin cuerpo: se apaga la de esta sesion */
      }
      if (id === "") {
        responderJson(res, 400, {
          error: "no se que instancia apagar: no hay ninguna encendida por esta sesion",
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

  // El mismo contrato que /api/run/python, pero el proceso corre en la GPU.
  server.middlewares.use("/api/run/lambda", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    if (cfgLambda === null) {
      responderJson(res, 400, { error: `falta ${faltanLambda.join(", ")} en .env` });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      let datos: { path?: string; argumentos?: string[]; timeout_segundos?: number };
      try {
        datos = JSON.parse(cuerpo) as typeof datos;
      } catch (error) {
        responderJson(res, 400, {
          error: `JSON invalido: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      if (!datos.path) {
        responderJson(res, 400, { error: "falta 'path'" });
        return;
      }
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const script = resolverEnTrabajo(datos.path, slug);
      if (!script) {
        responderJson(res, 403, { error: "ruta fuera de workspace/" });
        return;
      }
      if (!existsSync(script)) {
        responderJson(res, 404, { error: `no existe ${datos.path}` });
        return;
      }

      // En Lambda se paga GPU por hora: un script del motor numpy (dsp,
      // instruments, render) allí es CPU a precio de GPU. Se corta antes
      // de arrancar la máquina, que es lo caro.
      const fuente = readFileSync(script, "utf8");
      // Sólo se enciende la GPU para un script que la USA (importa torch o el motor de
      // GPU). Antes sólo se rechazaban los que importaban el motor numpy, y el 27-oct
      // un script que listaba ficheros encendió una A10 de pago.
      const usaGpu = /^\s*(?:from|import)\s+(?:motor_gpu|voces_gpu|torch)\b/m.test(fuente);
      if (!usaGpu) {
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "ejecutar_python_lambda",
            path: datos.path,
            rechazado: "script de CPU en Lambda",
          }),
        );
        responderJson(res, 409, {
          error:
            "Ese script no usa la GPU (no importa motor_gpu, voces_gpu ni torch): en Lambda pagarías " +
            "GPU para nada. Ejecútalo con destino='cpu', que es gratis. Si de verdad necesitas la GPU, " +
            "escríbelo con motor_gpu (osc, saturar, reverb, shimmer, granular, compresor_multibanda…).",
        });
        return;
      }
      const segundos = Math.min(Math.max(datos.timeout_segundos ?? 900, 1), 1800);
      const argumentos = Array.isArray(datos.argumentos)
        ? datos.argumentos.map((a) => String(a))
        : [];
      // La ruta remota es la misma relativa al workspace.
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
            por_timeout: r.errores.includes("cortado a los"),
            salida: r.salida.slice(-8000),
            errores: r.errores.slice(-8000),
            // Sólo lo que ha cambiado en la carpeta del proyecto: el árbol
            // entero son 573 KB de JSON que nadie lee (y el catálogo, 4.231
            // ficheros, cuesta segundos recorrerlo en cada llamada).
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
