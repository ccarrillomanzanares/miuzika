/**
 * Shared context for the dev-server API.
 *
 * Everything that used to live loose inside `defineConfig` in `vite.config.ts`
 * (1,863 lines): where the workspace is, how an agent path is resolved, how Python
 * is launched, how a body is read with a size limit, and how a log is written.
 * The routes (`server/api/*.ts`) receive this object and share nothing else.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { relative, resolve, sep } from "node:path";
import { CARPETAS_OCULTAS, rutaEnWorkspace } from "../src/core/rutas.ts";
import { slugDe } from "../src/core/nombres.ts";
import { configDesdeEnv } from "./lambda.ts";
import { crearRegistros } from "./registro.ts";
import { correrProceso } from "./proceso.ts";
import { leerCuerpoCrudo, LIMITE_CUERPO, registroApi, responderJson, rutaJson, textoTamano } from "./ruta.ts";
import type { Comprobacion } from "./escritura-verificada.ts";
import { CAJA, entornoDeCaja, escribiblesDelServidor } from "./api/python.ts";
import { MOTOR } from "./solo-lectura.ts";
import { dentroDe } from "./dentro.ts";

export function crearContexto(env: Record<string, string>) {
  // Lambda is OFF unless MIUZIKA_LAMBDA=on: Carlos asked on 31-Oct to stop using the
  // paid GPU for now without deleting the code or the LAMBDA_* keys in .env. With the
  // switch off every route behaves as "not configured" (no instance can be started).
  const lambdaActivo = (env.MIUZIKA_LAMBDA ?? "").trim().toLowerCase() === "on";
  const leido = lambdaActivo
    ? configDesdeEnv(env as Record<string, string>)
    : { cfg: null, faltan: ["MIUZIKA_LAMBDA=on (Lambda is disabled for now)"] };
  const { cfg: cfgLambda, faltan: faltanLambda } = leido;
  if (!lambdaActivo) {
    console.warn("[miuzika] Lambda disabled (set MIUZIKA_LAMBDA=on in .env to enable it). The CPU will be used.");
  } else if (cfgLambda === null) {
    console.warn(`[miuzika] Lambda not configured: missing ${faltanLambda.join(", ")}. The CPU will be used.`);
  }

  const {
    carpetaTmp,
    ficheroLog,
    ficheroHerramientas,
    ficheroApi,
    TOPE_LOG,
    TOPE_LOG_HERRAMIENTAS,
    anotar,
    compactarTurno,
    registrarTurno,
    precios,
  } = crearRegistros(resolve(process.cwd(), "tmp"));
  /** Everything the agent writes or runs lives here, and cannot leave it. */
  const carpetaTrabajo = resolve(process.cwd(), "workspace");
  const interprete = env.MIUZIKA_PYTHON || "python";

  /** One line per API request (route, status, ms): `registroApi` in ruta.ts. Not the two
   *  routes the tab polls (/api/build every 20 s and the GPU counter). */
  const registro = registroApi(
    (linea) => anotar(ficheroApi, linea, TOPE_LOG_HERRAMIENTAS),
    new Set(["/api/build", "/api/gpu/estado"]),
  );

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
          responderJson(res, 413, { error: `body too large (max. ${textoTamano(limite ?? LIMITE_CUERPO)})` });
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
    const dentro = dentroDe(carpetaTrabajo, destino, { incluirRaiz: true });
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
    const dentro = dentroDe(carpetaTrabajo, inicio, { incluirRaiz: true });
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

  /**
   * Launches a script from workspace/ and returns output, errors and exit code.
   * Inside the box (caja.py) since 3-Nov: these scripts import engine code the agent can
   * edit (smoke, voces, gate_voz with the agent's candidate voice), and they ran with the
   * whole server environment, network and processes (review 3-Nov, bug 2). `procesos`
   * is only for the two scripts that call ffmpeg, yt_dlp or sfz2sf2. "-c" (the gpu/
   * parse check) only parses text, so it runs outside the box with the minimal env.
   */
  const correr = (
    scriptRel: string,
    argumentos: string[] = [],
    segundos = 90,
    opciones: { procesos?: boolean } = {},
  ): Promise<{ codigo: number | null; salida: string; errores: string }> => {
    const enCaja = scriptRel !== "-c";
    return correrProceso(
      interprete,
      enCaja ? ["-u", CAJA, resolve(carpetaTrabajo, scriptRel), ...argumentos] : ["-u", scriptRel, ...argumentos],
      {
        segundos,
        nombre: scriptRel,
        cwd: carpetaTrabajo,
        env: entornoDeCaja(process.env, {
          motor: resolve(carpetaTrabajo, "codigo"),
          proyecto: escribiblesDelServidor(carpetaTrabajo),
          repo: process.cwd(),
          workspace: carpetaTrabajo,
          procesos: opciones.procesos === true,
        }),
      },
    );
  };

  /** Is it engine code? Both count: the numpy one in codigo/ and the GPU one in gpu/. */
  const esDeCodigo = (ruta: string): boolean => {
    const limpia = ruta.replace(/\\/g, "/");
    return limpia.startsWith("codigo/") || limpia.startsWith("gpu/");
  };

  /** Is it the GPU engine? That one cannot be validated here: there is no torch on the laptop. */
  const esDeGpu = (ruta: string): boolean => ruta.replace(/\\/g, "/").startsWith("gpu/");

  /** The engine still imports and renders (rollback is done by escribirComprobando). */
  const smokeDelMotor = async (): Promise<Comprobacion> => {
    const smoke = await correr("herramientas/smoke.py", [], 120);
    if (smoke.codigo === 0) return { ok: true, detalle: smoke.salida.trim() };
    return { ok: false, detalle: (smoke.errores || smoke.salida).slice(-1500) };
  };

  /** A gpu/ file at least parses: the laptop has no torch, so nothing more can run here. */
  const parseaPython = async (destino: string): Promise<Comprobacion> => {
    const r = await correr(
      "-c",
      [`import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())`, destino],
      60,
    );
    return r.codigo === 0 ? { ok: true, detalle: "" } : { ok: false, detalle: (r.errores || r.salida).slice(-1200) };
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
    precios,
    ficheroHerramientas,
    carpetaTrabajo,
    interprete,
    responderJson,
    rutaJson,
    ficheroApi,
    registro,
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
    smokeDelMotor,
    parseaPython,
  };
}

export type Contexto = ReturnType<typeof crearContexto>;
