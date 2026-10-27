/** Ejecutar un script de Python en este equipo, con tope de tiempo y cancelación. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasPython(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, interprete, responderJson, leerCuerpo, slugProyecto, carpetaProyecto, resolverEnTrabajo, escritosDesde } = ctx;

  server.middlewares.use("/api/run/python", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
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

      const segundos = Math.min(Math.max(datos.timeout_segundos ?? 300, 1), 1800);
      const argumentos = Array.isArray(datos.argumentos)
        ? datos.argumentos.map((a) => String(a))
        : [];
      // cwd = carpeta del proyecto: los scripts escriben 'salida/...' ahi.
      const cwdProyecto = carpetaProyecto(slug);
      const motor = resolve(carpetaTrabajo, "codigo");

      const t0 = Date.now();
      const hijo = spawn(interprete, ["-u", script, ...argumentos], {
        cwd: cwdProyecto,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1",
          // `delimiter` (";" en Windows, ":" en el resto), no `sep`: con un PYTHONPATH
          // previo, unirlo con "\\" o "/" dejaba una sola ruta rota.
          PYTHONPATH: [motor, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
        },
        // Grupo propio fuera de Windows: así `kill(-pid)` mata también a los nietos.
        detached: process.platform !== "win32",
      });
      let salida = "";
      let errores = "";
      hijo.stdout.on("data", (trozo: Buffer) => {
        salida += trozo.toString("utf8");
      });
      hijo.stderr.on("data", (trozo: Buffer) => {
        errores += trozo.toString("utf8");
      });

      let avisado = false;
      let porTiempo = false;
      let temporizador: NodeJS.Timeout | null = null;

      /** Responde UNA sola vez (exit y close pueden llegar los dos). */
      const terminar = (codigo: number | null, senal: string | null): void => {
        if (avisado) return;
        avisado = true;
        if (temporizador) clearTimeout(temporizador);
        const ms = Date.now() - t0;
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "ejecutar_python",
            path: datos.path,
            argumentos,
            codigo,
            senal,
            ms,
            por_timeout: porTiempo,
            salida: salida.slice(-600),
            errores: errores.slice(-600),
          }),
        );
        responderJson(res, 200, {
          ok: codigo === 0,
          codigo,
          senal,
          ms,
          por_timeout: porTiempo,
          salida: salida.slice(-8000),
          errores: errores.slice(-8000),
          escritos: escritosDesde(slug, t0),
        });
      };

      /** Mata el proceso Y su descendencia: en Windows 'python' es un lanzador
       *  que deja un nieto con los pipes abiertos (si no, quedan huerfanos). */
      const matarArbol = (): void => {
        const pid = hijo.pid;
        if (!pid) return;
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(pid), "/T", "/F"]);
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            hijo.kill("SIGKILL");
          }
        }
      };

      // «Cancelar» en la app aborta el fetch: la conexión se cierra y el proceso
      // tiene que morir con ella. Antes seguía renderizando hasta su propio tope.
      res.on("close", () => {
        if (!avisado) {
          avisado = true;
          if (temporizador) clearTimeout(temporizador);
          anotar(
            ficheroHerramientas,
            JSON.stringify({ t: new Date().toISOString(), tool: "ejecutar_python", path: datos.path, cancelado: true }),
          );
          matarArbol();
        }
      });

      temporizador = setTimeout(() => {
        porTiempo = true;
        matarArbol();
        // Red de seguridad: si el arbol no muere, la peticion no queda colgada.
        setTimeout(() => terminar(null, "timeout"), 5000);
      }, segundos * 1000);

      // 'exit' llega aunque un nieto mantenga los pipes; 'close' solo si se cierran.
      hijo.on("exit", (codigo, senal) => {
        setTimeout(() => terminar(codigo, senal), 150);
      });
      hijo.on("close", (codigo, senal) => terminar(codigo, senal));
      hijo.on("error", (error) => {
        if (avisado) return;
        avisado = true;
        if (temporizador) clearTimeout(temporizador);
        responderJson(res, 500, {
          error: `no se pudo lanzar '${interprete}': ${error.message}`,
        });
      });
    });
  });
}
