/**
 * Shared context for the dev-server API.
 *
 * Everything that used to live loose inside `defineConfig` in `vite.config.ts`
 * (1,863 lines): where the workspace is, how an agent path is resolved, how Python
 * is launched, how a body is read with a size limit, and how a log is written.
 * The routes (`server/api/*.ts`) receive this object and share nothing else.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { relative, resolve, sep } from "node:path";
import { CARPETAS_OCULTAS, rutaEnWorkspace } from "../src/core/rutas.ts";
import { slugDe } from "../src/core/nombres.ts";
import { configDesdeEnv } from "./lambda.ts";

export function crearContexto(env: Record<string, string>) {
  const { cfg: cfgLambda, faltan: faltanLambda } = configDesdeEnv(env as Record<string, string>);
  if (cfgLambda === null) {
    console.warn(`[miuzika] Lambda not configured: missing ${faltanLambda.join(", ")}. The CPU will be used.`);
  }

  const carpetaTmp = resolve(process.cwd(), "tmp");
  const ficheroLog = resolve(carpetaTmp, "llm.log");

  /** Size limit for each log: when exceeded, a .1 copy is kept and a new one is started. */
  const TOPE_LOG = 5 * 1024 * 1024;
  const TOPE_LOG_HERRAMIENTAS = 2 * 1024 * 1024;

  /** Appends a line to a log, rotating by size (it must never break the app). */
  const anotar = (fichero: string, linea: string, tope?: number): void => {
    try {
      mkdirSync(carpetaTmp, { recursive: true });
      const limite = tope ?? (fichero === ficheroHerramientas ? TOPE_LOG_HERRAMIENTAS : TOPE_LOG);
      if (existsSync(fichero) && statSync(fichero).size > limite) {
        renameSync(fichero, `${fichero}.1`);
      }
      appendFileSync(fichero, linea + "\n", "utf8");
    } catch {
      /* no log */
    }
  };

  /**
   * Without MIUZIKA_LOG_COMPLETO=1 the log stores the turn without the full messages:
   * with the manifest inside it was ~40 KB per round and ended up containing the whole
   * project code. It stores the shape (role, size, first 200 characters) and,
   * separately, the request and the response. With the flag, the whole thing (for debugging).
   */
  const compactarTurno = (linea: string): string => {
    if (process.env.MIUZIKA_LOG_COMPLETO === "1") return linea;
    try {
      const datos = JSON.parse(linea) as Record<string, unknown>;
      const mensajes = Array.isArray(datos.mensajes)
        ? (datos.mensajes as { role?: string; content?: string; tool_calls?: unknown[] }[])
        : [];
      const sistema = mensajes.find((m) => m.role === "system")?.content ?? "";
      const resumen = {
        ...datos,
        mensajes: mensajes.map((m) => ({
          role: m.role ?? "?",
          caracteres: (m.content ?? "").length,
          inicio: (m.content ?? "").slice(0, 200),
          herramientas: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0,
        })),
        sistema: { caracteres: sistema.length, inicio: sistema.slice(0, 400) },
      };
      return JSON.stringify(resumen);
    } catch {
      return linea.slice(0, 2000);
    }
  };

  const registrarTurno = (linea: string): void => anotar(ficheroLog, compactarTurno(linea));

  const ficheroHerramientas = resolve(carpetaTmp, "herramientas.log");
  /** Everything the agent writes or runs lives here, and cannot leave it. */
  const carpetaTrabajo = resolve(process.cwd(), "workspace");
  const interprete = env.MIUZIKA_PYTHON || "python";

  const responderJson = (res: ServerResponse, codigo: number, cuerpo: unknown): void => {
    if (res.headersSent) return;
    res.statusCode = codigo;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(cuerpo));
  };

  /** Raw text body; returns null if it exceeds the limit. */
  const leerCuerpoCrudo = (
    req: IncomingMessage,
    alTerminar: (cuerpo: string | null) => void,
    limite = 8 * 1024 * 1024,
  ): void => {
    let cuerpo = "";
    let total = 0;
    let pasado = false;
    req.on("data", (trozo: Buffer) => {
      total += trozo.length;
      if (total > limite) {
        pasado = true;
        cuerpo = "";
        return;
      }
      cuerpo += trozo.toString("utf8");
    });
    req.on("end", () => alTerminar(pasado ? null : cuerpo));
    req.on("error", () => alTerminar(null));
  };

  /** Text body of an API request: answering 413 is better than running out of memory. */
  const leerCuerpo = (
    req: IncomingMessage,
    res: ServerResponse,
    alTerminar: (cuerpo: string) => void,
    limite?: number,
  ): void =>
    leerCuerpoCrudo(
      req,
      (cuerpo) => {
        if (cuerpo === null) {
          responderJson(res, 413, { error: "body too large (max. 8 MB)" });
          return;
        }
        alTerminar(cuerpo);
      },
      limite,
    );

  /** Binary body (WAV uploaded from the browser), with a size limit. */
  const leerCuerpoBinario = (
    req: IncomingMessage,
    limite: number,
    alTerminar: (datos: Buffer | null) => void,
  ): void => {
    const trozos: Buffer[] = [];
    let total = 0;
    let cortado = false;
    let terminado = false;
    const cerrar = (datos: Buffer | null): void => {
      if (terminado) return;
      terminado = true;
      alTerminar(datos);
    };
    req.on("data", (trozo: Buffer) => {
      total += trozo.length;
      if (total > limite) {
        cortado = true;
        trozos.length = 0;
        return;
      }
      trozos.push(trozo);
    });
    req.on("end", () => cerrar(cortado ? null : Buffer.concat(trozos)));
    req.on("error", () => cerrar(null));
  };

  /**
   * Identifier of the served code: the newest timestamp from web/ and from
   * this config. If it changes, the open tab is running an old bundle
   * (HMR disconnects when the server restarts) and has to reload.
   */
  const idDeBuild = (): string => {
    let max = 0;
    const recorrer = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const completo = resolve(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(completo);
        else if (/\.(ts|css|html)$/.test(entrada.name)) {
          max = Math.max(max, statSync(completo).mtimeMs);
        }
      }
    };
    recorrer(resolve(process.cwd(), "web/src"));
    const config = resolve(process.cwd(), "vite.config.ts");
    if (existsSync(config)) max = Math.max(max, statSync(config).mtimeMs);
    return String(Math.round(max));
  };
  const arranqueServidor = new Date().toISOString();

  /**
   * Safe slug of the active project ("" -> "sin-proyecto"). It is the SAME rule the
   * browser uses (src/core/nombres.ts), and it accepts any alphabet: the old copy
   * stripped everything that was not [a-z0-9_-] and a folder "夜の歌" arrived
   * here as "sin-proyecto".
   */
  const slugProyecto = (valor: unknown): string => {
    // The header arrives encoded (cabeceraDeProyecto in the browser): HTTP only
    // transports Latin-1 in headers.
    let texto = String(valor ?? "");
    try {
      texto = decodeURIComponent(texto);
    } catch {
      /* it was not encoded: use it as is */
    }
    return slugDe(texto, { defecto: "sin-proyecto" });
  };

  /** Folder of the active project (created on first use). */
  const carpetaProyecto = (slug: string): string => {
    mkdirSync(resolve(carpetaTrabajo, "proyectos", slug), { recursive: true });
    return resolve(carpetaTrabajo, "proyectos", slug);
  };

  /**
   * Real path from a relative one. What starts with a shared folder
   * is resolved in workspace/; the rest, in the project folder.
   */
  const resolverEnTrabajo = (relativo: string, slug = "sin-proyecto"): string | null => {
    if (relativo.includes("\\") || relativo.includes("..")) return null;
    // The rule for what is shared lives in src/core/rutas.ts (the browser uses it too).
    const destino = resolve(carpetaTrabajo, rutaEnWorkspace(relativo.replace(/^\/+/, ""), slug));
    const dentro = destino === carpetaTrabajo || destino.startsWith(carpetaTrabajo + sep);
    return dentro ? destino : null;
  };

  /** Inventory of the projects on disk: those that have proyecto.json. */
  const listarProyectosDisco = (): Record<string, unknown>[] => {
    const carpeta = resolve(carpetaTrabajo, "proyectos");
    if (!existsSync(carpeta)) return [];
    const salida: Record<string, unknown>[] = [];
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      const maestro = resolve(carpeta, entrada.name, "proyecto.json");
      if (!existsSync(maestro)) continue;
      const ruta = `proyectos/${entrada.name}/proyecto.json`;
      const bytes = statSync(maestro).size;
      const actualizado = statSync(maestro).mtime.toISOString();
      try {
        // Only the header is read: the file with all the notes can be large.
        const datos = JSON.parse(readFileSync(maestro, "utf8")) as {
          guardadoEn?: string;
          proyecto?: { name?: string; bpm?: number; lengthBars?: number; tracks?: unknown[] };
        };
        const proyecto = datos.proyecto ?? {};
        salida.push({
          slug: entrada.name,
          ruta,
          nombre: String(proyecto.name ?? entrada.name),
          bpm: Number(proyecto.bpm ?? 0),
          compases: Number(proyecto.lengthBars ?? 0),
          pistas: Array.isArray(proyecto.tracks) ? proyecto.tracks.length : 0,
          guardadoEn: String(datos.guardadoEn ?? ""),
          actualizado,
          bytes,
        });
      } catch (error) {
        salida.push({
          slug: entrada.name,
          ruta,
          nombre: entrada.name,
          bpm: 0,
          compases: 0,
          pistas: 0,
          guardadoEn: "",
          actualizado,
          bytes,
          error: error instanceof Error ? error.message : "unreadable proyecto.json",
        });
      }
    }
    return salida.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
  };

  /**
   * Inventory of files in the workspace.
   *
   * Optional `carpeta`: "" = the root (without hidden folders), "proyectos/<slug>",
   * "codigo"… CARPETAS_OCULTAS folders are never traversed: `catalogo/`
   * is 4,231 files and put 573 KB into the model context, which arrives
   * trimmed to head and tail (that is: the agent did not see the middle, which is where
   * its files were). It is queried with `buscar_sonido`, not by listing.
   */
  const MAX_LISTADO = 2000;
  const listarTrabajo = (
    carpeta = "",
  ): { path: string; bytes: number }[] => {
    if (!existsSync(carpetaTrabajo)) return [];
    const relativa = carpeta.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const inicio = relativa === "" ? carpetaTrabajo : resolve(carpetaTrabajo, relativa);
    const dentro = inicio === carpetaTrabajo || inicio.startsWith(carpetaTrabajo + sep);
    if (!dentro || !existsSync(inicio)) return [];
    const salida: { path: string; bytes: number }[] = [];
    const recorrer = (dir: string): void => {
      if (salida.length >= MAX_LISTADO) return;
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        if (salida.length >= MAX_LISTADO) return;
        const completo = resolve(dir, entrada.name);
        if (entrada.isDirectory()) {
          if ((CARPETAS_OCULTAS as readonly string[]).includes(entrada.name)) continue;
          recorrer(completo);
        } else {
          salida.push({
            path: relative(carpetaTrabajo, completo).split(sep).join("/"),
            bytes: statSync(completo).size,
          });
        }
      }
    };
    recorrer(inicio);
    return salida;
  };

  /** Files in the project folder that changed since `desde` (ms). */
  const escritosDesde = (slug: string, desde: number): string[] => {
    const carpeta = resolve(carpetaTrabajo, "proyectos", slug);
    if (!existsSync(carpeta)) return [];
    return listarTrabajo(`proyectos/${slug}`)
      .filter((f) => {
        try {
          return statSync(resolve(carpetaTrabajo, f.path)).mtimeMs >= desde;
        } catch {
          return false;
        }
      })
      .map((f) => f.path.slice(`proyectos/${slug}/`.length));
  };

  /** Launches a script from workspace/ and returns output, errors and exit code. */
  const correr = (
    scriptRel: string,
    argumentos: string[] = [],
    segundos = 90,
  ): Promise<{ codigo: number | null; salida: string; errores: string }> =>
    new Promise((resolvePromise) => {
      const hijo = spawn(interprete, ["-u", scriptRel, ...argumentos], {
        cwd: carpetaTrabajo,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
      });
      let salida = "";
      let errores = "";
      let listo = false;
      const terminar = (codigo: number | null): void => {
        if (listo) return;
        listo = true;
        if (temporizador) clearTimeout(temporizador);
        resolvePromise({ codigo, salida, errores });
      };
      const temporizador = setTimeout(() => {
        if (hijo.pid) {
          if (process.platform === "win32") {
            spawn("taskkill", ["/PID", String(hijo.pid), "/T", "/F"]);
          } else {
            hijo.kill("SIGKILL");
          }
        }
        setTimeout(() => terminar(null), 3000);
      }, segundos * 1000);
      hijo.stdout.on("data", (trozo: Buffer) => {
        salida += trozo.toString("utf8");
      });
      hijo.stderr.on("data", (trozo: Buffer) => {
        errores += trozo.toString("utf8");
      });
      hijo.on("exit", (codigo) => setTimeout(() => terminar(codigo), 120));
      hijo.on("close", (codigo) => terminar(codigo));
      hijo.on("error", (error) => {
        errores += error.message;
        terminar(null);
      });
    });

  /** Files that make up the engine: rewriting them requires passing the smoke test. */
  const MOTOR = new Set(["dsp.py", "instruments.py", "render.py", "midi.py"]);

  /** Is it engine code? Both count: the numpy one in codigo/ and the GPU one in gpu/. */
  const esDeCodigo = (ruta: string): boolean => {
    const limpia = ruta.replace(/\\/g, "/");
    return limpia.startsWith("codigo/") || limpia.startsWith("gpu/");
  };

  /** Is it the GPU engine? That one cannot be validated here: there is no torch on the laptop. */
  const esDeGpu = (ruta: string): boolean => ruta.replace(/\\/g, "/").startsWith("gpu/");

  /** After touching the engine: smoke test and, if it fails, revert. */
  const smokeOTeReverto = async (
    destino: string,
    previo: string | null,
  ): Promise<{ ok: boolean; detalle: string }> => {
    const smoke = await correr("herramientas/smoke.py", [], 120);
    if (smoke.codigo === 0) return { ok: true, detalle: smoke.salida.trim() };
    if (previo !== null) {
      writeFileSync(destino, previo, "utf8");
    } else if (existsSync(destino)) {
      unlinkSync(destino);
    }
    return {
      ok: false,
      detalle: (smoke.errores || smoke.salida).slice(-1500),
    };
  };

  return {
    cfgLambda,
    faltanLambda,
    carpetaTmp,
    ficheroLog,
    TOPE_LOG,
    TOPE_LOG_HERRAMIENTAS,
    anotar,
    compactarTurno,
    registrarTurno,
    ficheroHerramientas,
    carpetaTrabajo,
    interprete,
    responderJson,
    leerCuerpoCrudo,
    leerCuerpo,
    leerCuerpoBinario,
    idDeBuild,
    arranqueServidor,
    slugProyecto,
    carpetaProyecto,
    resolverEnTrabajo,
    listarProyectosDisco,
    MAX_LISTADO,
    listarTrabajo,
    escritosDesde,
    correr,
    MOTOR,
    esDeCodigo,
    esDeGpu,
    smokeOTeReverto,
  };
}

export type Contexto = ReturnType<typeof crearContexto>;
