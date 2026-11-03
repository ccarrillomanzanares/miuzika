/** Run a Python script on this machine, with a time limit and cancellation, inside the sandbox. */

import { correrProceso } from "../proceso.ts";
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
  rutas: { motor: string; proyecto: string | string[]; repo: string; workspace: string; procesos?: boolean },
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
    // The first folder holds the script's temp (see caja.py).
    MIUZIKA_ESCRIBIR: (Array.isArray(rutas.proyecto) ? rutas.proyecto : [rutas.proyecto]).join(delimiter),
    MIUZIKA_REPO: rutas.repo,
    MIUZIKA_WORKSPACE: rutas.workspace,
    ...(rutas.procesos ? { MIUZIKA_PROCESOS: "1" } : {}),
  };
}

/**
 * Where the server's own scripts may write when they run in the box: projects, the
 * shared temp, downloaded references and the engine manifest. Not codigo/, gpu/ or
 * herramientas/: engine code the agent edited must not be able to rewrite the scripts
 * that run with more permissions (sfz_a_proyecto, analizar_referencia, the pad).
 * Measured 3-Nov by reading every script the server runs (smoke, manifiesto, picos,
 * midi_lector, verificar_audio, voces, gate_voz, importar_sample, sfz_a_proyecto,
 * analizar_referencia): none writes anywhere else.
 */
export function escribiblesDelServidor(carpetaTrabajo: string): string[] {
  return [
    resolve(carpetaTrabajo, "tmp"),
    resolve(carpetaTrabajo, "proyectos"),
    resolve(carpetaTrabajo, "_referencias"),
    resolve(carpetaTrabajo, "MANIFEST.json"),
    resolve(carpetaTrabajo, "MANIFEST.md"),
  ];
}

export function rutasPython(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, interprete, responderJson, leerCuerpo, slugProyecto, carpetaProyecto, resolverEnTrabajo, escritosDesde } = ctx;

  server.middlewares.use("/api/run/python", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
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
      // "Cancel" in the app aborts the fetch: the connection closes and the process has to
      // die with it. Before, it kept rendering until its own limit. 'close' also fires after
      // a normal answer; by then the run is over and aborting does nothing.
      const control = new AbortController();
      res.on("close", () => control.abort());
      const r = await correrProceso(interprete, ["-u", CAJA, script, ...argumentos], {
        segundos,
        nombre: datos.path,
        cwd: cwdProyecto,
        env: entornoDeCaja(process.env, {
          motor,
          proyecto: cwdProyecto,
          repo: process.cwd(),
          workspace: carpetaTrabajo,
        }),
        senal: control.signal,
      });
      if (r.cancelado) {
        anotar(
          ficheroHerramientas,
          JSON.stringify({ t: new Date().toISOString(), tool: "ejecutar_python", path: datos.path, cancelado: true }),
        );
        return;
      }
      if (r.errorArranque) {
        responderJson(res, 500, { error: `could not launch '${interprete}': ${r.errorArranque}` });
        return;
      }
      anotar(
        ficheroHerramientas,
        JSON.stringify({
          t: new Date().toISOString(),
          tool: "ejecutar_python",
          path: datos.path,
          argumentos,
          codigo: r.codigo,
          senal: r.senal,
          ms: r.ms,
          por_timeout: r.porTiempo,
          salida: r.salida.slice(-600),
          errores: r.errores.slice(-600),
        }),
      );
      responderJson(res, 200, {
        ok: r.codigo === 0,
        codigo: r.codigo,
        senal: r.senal,
        ms: r.ms,
        por_timeout: r.porTiempo,
        salida: r.salida.slice(-8000),
        errores: r.errores.slice(-8000),
        escritos: escritosDesde(slug, t0),
      });
    });
  });
}
