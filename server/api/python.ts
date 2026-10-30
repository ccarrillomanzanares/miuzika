/** Run a Python script on this machine, with a time limit and cancellation, inside the sandbox. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

/** The launcher that watches the agent's scripts (see its header). Outside workspace/: the agent cannot edit it. */
export const CAJA = resolve(process.cwd(), "server", "python", "caja.py");

/**
 * Variables that Python needs to start on Windows and elsewhere; nothing more.
 * Before, the script inherited all of the server's `process.env`, with whatever was in
 * it (tokens, provider keys…).
 */
const VARIABLES_DE_SISTEMA = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "LANG",
  "LC_ALL",
];

export function entornoDeCaja(
  base: NodeJS.ProcessEnv,
  rutas: { motor: string; proyecto: string; repo: string; workspace: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const clave of Object.keys(base)) {
    // On Windows variables are case-insensitive ("Path", "SystemRoot").
    if (VARIABLES_DE_SISTEMA.includes(clave.toUpperCase())) env[clave] = base[clave];
  }
  return {
    ...env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    // `delimiter` (";" on Windows, ":" elsewhere), not `sep`: with a previous
    // PYTHONPATH, joining it with "\\" or "/" left a single broken path.
    PYTHONPATH: [rutas.motor, base.PYTHONPATH].filter(Boolean).join(delimiter),
    MIUZIKA_ESCRIBIR: rutas.proyecto,
    MIUZIKA_REPO: rutas.repo,
    MIUZIKA_WORKSPACE: rutas.workspace,
  };
}

export function rutasPython(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, interprete, responderJson, leerCuerpo, slugProyecto, carpetaProyecto, resolverEnTrabajo, escritosDesde } = ctx;

  server.middlewares.use("/api/run/python", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
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

      const segundos = Math.min(Math.max(datos.timeout_segundos ?? 300, 1), 1800);
      const argumentos = Array.isArray(datos.argumentos)
        ? datos.argumentos.map((a) => String(a))
        : [];
      // cwd = project folder: the scripts write 'salida/...' there.
      const cwdProyecto = carpetaProyecto(slug);
      const motor = resolve(carpetaTrabajo, "codigo");

      const t0 = Date.now();
      const hijo = spawn(interprete, ["-u", CAJA, script, ...argumentos], {
        cwd: cwdProyecto,
        env: entornoDeCaja(process.env, {
          motor,
          proyecto: cwdProyecto,
          repo: process.cwd(),
          workspace: carpetaTrabajo,
        }),
        // Own group outside Windows: this way `kill(-pid)` also kills the grandchildren.
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

      /** Answers ONCE only (exit and close may both arrive). */
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

      /** Kills the process AND its descendants: on Windows 'python' is a launcher
       *  that leaves a grandchild with the pipes open (otherwise they are orphaned). */
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

      // "Cancel" in the app aborts the fetch: the connection closes and the process
      // has to die with it. Before, it kept rendering until its own limit.
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
        // Safety net: if the tree does not die, the request does not hang.
        setTimeout(() => terminar(null, "timeout"), 5000);
      }, segundos * 1000);

      // 'exit' arrives even if a grandchild keeps the pipes; 'close' only if they close.
      hijo.on("exit", (codigo, senal) => {
        setTimeout(() => terminar(codigo, senal), 150);
      });
      hijo.on("close", (codigo, senal) => terminar(codigo, senal));
      hijo.on("error", (error) => {
        if (avisado) return;
        avisado = true;
        if (temporizador) clearTimeout(temporizador);
        responderJson(res, 500, {
          error: `could not launch '${interprete}': ${error.message}`,
        });
      });
    });
  });
}
