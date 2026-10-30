/** Workspace files: read, write, edit and list (the agent's hands), plus the turn log, the engine manifest and the served-code id. */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { CARPETA_VERSIONES, versionesSobrantes } from "../../src/core/versiones.ts";

/** Modules that a project script cannot shadow: the standard-library ones
 * actually used, numpy/scipy and the engine's own. */
const MODULOS_PROTEGIDOS = new Set(
  (
    "abc argparse array ast asyncio base64 bisect builtins bz2 calendar cmath code codecs collections colorsys " +
    "concurrent contextlib copy csv ctypes dataclasses datetime decimal difflib dis email enum fractions functools " +
    "gc glob gzip hashlib heapq hmac html http importlib inspect io itertools json locale logging lzma math " +
    "multiprocessing numbers operator os pathlib pickle platform pprint queue random re secrets select shutil " +
    "signal socket sqlite3 ssl statistics string struct subprocess sys tempfile textwrap threading time timeit " +
    "token tokenize traceback types typing unittest urllib uuid warnings wave weakref xml zipfile zlib " +
    "numpy scipy " +
    "dsp instruments render midi voces motor_gpu voces_gpu"
  ).split(" "),
);

export function rutasFicheros(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, registrarTurno, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, idDeBuild, arranqueServidor, slugProyecto, resolverEnTrabajo, MAX_LISTADO, listarTrabajo, correr, MOTOR, esDeCodigo, esDeGpu, smokeOTeReverto } = ctx;

  server.middlewares.use("/api/agent-log", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    // With a limit, like all bodies: a turn with the whole prompt was ~40 KB and
    // without a limit a broken client could fill memory.
    leerCuerpo(req, res, (cuerpo) => {
      registrarTurno(cuerpo.trim());
      res.statusCode = 204;
      res.end();
    });
  });

  server.middlewares.use("/api/fs/write", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { path?: string; contenido?: string };
        if (!datos.path || typeof datos.contenido !== "string") {
          responderJson(res, 400, { error: "missing 'path' or 'contenido'" });
          return;
        }
        const destino = resolverEnTrabajo(datos.path, slugProyecto(req.headers["x-miuzika-proyecto"]));
        if (!destino) {
          responderJson(res, 403, { error: "path outside workspace/" });
          return;
        }
        if (datos.contenido.trim().length === 0) {
          responderJson(res, 400, {
            error:
              "empty content: write the whole script in a single call (do not leave it for later).",
          });
          return;
        }
        const nombre = basename(destino);
        const nuevo = !existsSync(destino);

        // (1) forbidden to patch someone else's code with replacement scripts
        if (/^(patch|parche)/i.test(nombre) && nombre.endsWith(".py")) {
          anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "patch script" }));
          responderJson(res, 409, {
            error:
              "Patch scripts are not allowed (patch*/parche*). Use editar_fichero(path, busca, reemplaza): exact, atomic and verified replacement.",
          });
          return;
        }

        // (1c) a script named like a module shadows that module for everything that
        // runs in its folder (Python puts the script's folder first in
        // sys.path). Measured on Oct 28: a diagnostic inspect.py broke numpy.
        if (nuevo && nombre.endsWith(".py") && !esDeCodigo(datos.path) && MODULOS_PROTEGIDOS.has(nombre.slice(0, -3).toLowerCase())) {
          anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "module name" }));
          responderJson(res, 409, {
            error:
              `"${nombre}" is named like a Python or engine module and would shadow it (numpy, the engine and your ` +
              `scripts would stop importing it). Give it another name: e.g. "my_${nombre}".`,
          });
          return;
        }

        // (1b) the engines do not grow with loose scripts: a NEW file in codigo/ or gpu/
        // is rejected. Previously the agent left its tests there (buscar_sfz.py, info_saxo*.py…)
        // and they started to look like library code. Editing what already exists still goes through smoke.
        if (nuevo && esDeCodigo(datos.path)) {
          anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "new file in the engine" }));
          responderJson(res, 409, {
            error:
              "codigo/ and gpu/ are the shared engines: files are not added from the chat. Write the " +
              "script in the project folder (e.g. 'scripts/my_script.py'); from there it can import the " +
              "engine just the same. For a new timbre use crear_voz.",
          });
          return;
        }

        // (3) write; if it is the engine, smoke test with rollback
        const esMotor = MOTOR.has(nombre) && esDeCodigo(datos.path);
        const previo = esMotor && !nuevo ? readFileSync(destino, "utf8") : null;
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, datos.contenido, "utf8");
        // Version snapshots (one per agent turn): the last ones are kept.
        if (basename(dirname(destino)) === CARPETA_VERSIONES && nombre.endsWith(".json")) {
          for (const viejo of versionesSobrantes(readdirSync(dirname(destino)))) {
            try {
              unlinkSync(resolve(dirname(destino), viejo));
            } catch {
              /* another write deleted it first */
            }
          }
        }

        let nota = "";
        if (esDeGpu(datos.path)) {
          // In gpu/ there is no possible smoke test: the laptop has no torch. The
          // minimum is that the file parses; real validation is done on the
          // instance with destino="lambda".
          const comprobacion = await correr(
            "-c",
            [
              `import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())`,
              destino,
            ],
            60,
          );
          if (comprobacion.codigo !== 0) {
            writeFileSync(destino, previo ?? "", "utf8");
            if (previo === null && existsSync(destino)) unlinkSync(destino);
            responderJson(res, 400, {
              error: `The GPU file does not parse; it has not been written.\n${(comprobacion.errores || comprobacion.salida).slice(-1200)}`,
            });
            return;
          }
          nota = "gpu: syntax ok (validate by running with destino=lambda)";
        }
        if (esMotor) {
          const smoke = await smokeOTeReverto(destino, previo);
          if (!smoke.ok) {
            anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "smoke" }));
            responderJson(res, 400, {
              error: `The engine does not pass the smoke test; changes reverted.\n${smoke.detalle}`,
            });
            return;
          }
          nota = `smoke: ${smoke.detalle}`;
        }
        if (esDeCodigo(datos.path)) {
          await correr("herramientas/manifiesto.py", [], 60);
        }

        const bytes = Buffer.byteLength(datos.contenido, "utf8");
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "escribir_fichero",
            path: datos.path,
            bytes,
          }),
        );
        responderJson(res, 200, { ok: true, path: datos.path, bytes, nota });
      } catch (error) {
        responderJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  server.middlewares.use("/api/fs/read", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { path?: string; desde?: number };
        const destino = datos.path ? resolverEnTrabajo(datos.path, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
        if (!destino) {
          responderJson(res, 403, { error: "path outside workspace/" });
          return;
        }
        if (!existsSync(destino)) {
          responderJson(res, 404, { error: "does not exist" });
          return;
        }
        responderJson(res, 200, {
          ok: true,
          path: datos.path,
          // By pages: the agent asks for `desde` to keep reading. Before, it was cut at
          // 20,000 characters and the long output was saved to another file, which on
          // re-reading was cut and saved again: the agent read in circles.
          // Without `desde` (the app reading agente.json, for example) the whole thing is returned.
          ...(datos.desde === undefined
            ? { contenido: readFileSync(destino, "utf8") }
            : pagina(readFileSync(destino, "utf8"), Number(datos.desde) || 0)),
        });
      } catch (error) {
        responderJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  // Identifier of the served code: the tab compares it every 20 s and
  // warns if it is running an old bundle (HMR disconnected).
  server.middlewares.use("/api/build", (_req, res) => {
    responderJson(res, 200, { ok: true, id: idDeBuild(), arrancado: arranqueServidor });
  });

  server.middlewares.use("/api/fs/list", (req, res) => {
    if (req.method !== "GET") {
      responderJson(res, 405, { error: "use GET" });
      return;
    }
    // Without `carpeta`: the active project (what the agent needs to see).
    // With `carpeta=codigo` or `carpeta=` another zone of the space is requested.
    const url = new URL(req.url ?? "/", "http://localhost");
    const pedida = url.searchParams.get("carpeta");
    const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
    const carpeta =
      pedida !== null ? pedida.replace(/^\/+|\/+$/g, "") : `proyectos/${slug}`;
    const ficheros = listarTrabajo(carpeta);
    responderJson(res, 200, {
      ok: true,
      raiz: "workspace/",
      carpeta: carpeta === "" ? "." : carpeta,
      ficheros,
      // Without this warning, a truncated listing reads as "it is not here".
      truncado: ficheros.length >= MAX_LISTADO,
    });
  });

  // The engine manifest, regenerated when requested (injected into the prompt).
  server.middlewares.use("/api/manifiesto", async (req, res) => {
    if (req.method !== "GET") {
      responderJson(res, 405, { error: "use GET" });
      return;
    }
    await correr("herramientas/manifiesto.py", [], 60);
    const rutaMd = resolve(carpetaTrabajo, "MANIFEST.md");
    const texto = existsSync(rutaMd)
      ? readFileSync(rutaMd, "utf8")
      : "(no manifest: run herramientas/manifiesto.py)";
    responderJson(res, 200, { ok: true, manifiesto: texto, bytes: texto.length });
  });

  // editar_fichero: exact replacement, with a smoke test if it touches the engine.
  server.middlewares.use("/api/fs/edit", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const d = JSON.parse(cuerpo) as {
          path?: string;
          busca?: string;
          reemplaza?: string;
          todas?: boolean;
        };
        if (!d.path || typeof d.busca !== "string" || typeof d.reemplaza !== "string") {
          responderJson(res, 400, { error: "missing 'path', 'busca' or 'reemplaza'" });
          return;
        }
        const destino = resolverEnTrabajo(d.path, slugProyecto(req.headers["x-miuzika-proyecto"]));
        if (!destino) {
          responderJson(res, 403, { error: "path outside workspace/" });
          return;
        }
        if (!existsSync(destino)) {
          responderJson(res, 404, { error: "does not exist" });
          return;
        }
        const antes = readFileSync(destino, "utf8");
        const trozos = antes.split(d.busca);
        const total = trozos.length - 1;
        if (total === 0) {
          responderJson(res, 409, {
            error:
              "that text does not appear in the file: copy the EXACT fragment (with its indentation) or use leer_fichero.",
          });
          return;
        }
        const todas = d.todas !== false;
        const despues = todas ? trozos.join(d.reemplaza) : antes.replace(d.busca, d.reemplaza);
        const esMotor = MOTOR.has(basename(destino)) && esDeCodigo(d.path);
        writeFileSync(destino, despues, "utf8");
        if (esMotor) {
          const smoke = await smokeOTeReverto(destino, antes);
          if (!smoke.ok) {
            responderJson(res, 400, {
              error: `The engine does not pass the smoke test; change reverted.\n${smoke.detalle}`,
            });
            return;
          }
        }
        if (esDeCodigo(d.path)) await correr("herramientas/manifiesto.py", [], 60);
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "editar_fichero",
            path: d.path,
            reemplazos: todas ? total : 1,
          }),
        );
        responderJson(res, 200, { ok: true, path: d.path, reemplazos: todas ? total : 1, bytes: Buffer.byteLength(despues, "utf8") });
      } catch (error) {
        responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}

/** One page of a long text: content, where it continues and how long it is. */
const PAGINA = 6000;
function pagina(texto: string, desde: number): { contenido: string; desde: number; siguiente: number | null; total: number } {
  const inicio = Math.max(0, Math.min(Math.trunc(desde), texto.length));
  const fin = Math.min(texto.length, inicio + PAGINA);
  return { contenido: texto.slice(inicio, fin), desde: inicio, siguiente: fin < texto.length ? fin : null, total: texto.length };

}
