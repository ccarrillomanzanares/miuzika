/**
 * What every route shares: where the workspace is, how a path is confined to it, how a
 * body is read with a limit and how the two helper scripts are launched.
 *
 * miuzika's Python box (caja.py) is not here: it exists because the agent writes the
 * Python it runs. These scripts are fixed and only receive paths already confined.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { rutaEnWorkspace } from "../src/core/rutas.ts";
import { slugDe } from "../src/core/nombres.ts";
import { correrProceso } from "./proceso.ts";
import { leerCuerpoCrudo, LIMITE_CUERPO, registroApi, responderJson, rutaJson, textoTamano } from "./ruta.ts";
import { dentroDe } from "./dentro.ts";
import { proyectosEnDisco } from "./trabajo.ts";
import { configDesdeEnv } from "./lambda.ts";
import { leerConfigGpu } from "./config-proveedores.ts";
import { ajustesEfectivos, faltanLegibles } from "../src/core/proveedores-gpu.ts";
import { proveedorLambda } from "./gpu/lambda.ts";
import { proveedorSimulado } from "./gpu/simulado.ts";
import type { ProveedorGpu } from "./gpu/proveedor.ts";

export function crearContexto() {
  const carpetaTrabajo = resolve(process.cwd(), "workspace");
  const carpetaTmp = resolve(process.cwd(), "tmp");
  const interprete = process.env.MIUZIKA_PYTHON || "python";

  mkdirSync(carpetaTmp, { recursive: true });
  /** One line per API request (route, status, ms), except the poll of /api/build. */
  const registro = registroApi((linea) => appendFileSync(resolve(carpetaTmp, "api.log"), `${linea}\n`), new Set(["/api/build", "/api/gpu/estado"]));

  const leerCuerpo = (req: IncomingMessage, res: ServerResponse, alTerminar: (cuerpo: string) => void, limite?: number): void =>
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
  const leerCuerpoBinario = (req: IncomingMessage, limite: number, alTerminar: (datos: Buffer | null) => void): void => {
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
   * The GPU in use, read on each request: saving a key in Settings must not need a restart.
   * Settings first, then .env, of which only LAMBDA_* comes in. It all stays on the server.
   */
  const envGpu = (): Record<string, string> => loadEnv("development", process.cwd(), "LAMBDA_");
  const gpuActual = (): { gpu: ProveedorGpu | null; faltan: string[] } => {
    if (process.env.MIUZIKA_GPU === "simulado") return { gpu: proveedorSimulado(), faltan: [] };
    const { cfg, faltan } = configDesdeEnv(ajustesEfectivos("lambda", leerConfigGpu(), envGpu()).variables);
    return cfg ? { gpu: proveedorLambda(cfg), faltan: [] } : { gpu: null, faltan: faltanLegibles("lambda", faltan) };
  };

  /** One line per GPU step, with no keys: the arguments only name the recipe file. */
  const anotarGpu = (datos: Record<string, unknown>): void =>
    appendFileSync(resolve(carpetaTmp, "gpu.log"), `${JSON.stringify({ t: new Date().toISOString(), ...datos })}
`);

  /** Newest mtime under web/src: if it changes, the open tab is running an old bundle. */
  const idDeBuild = (): string => {
    let max = 0;
    const recorrer = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const completo = resolve(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(completo);
        else if (/\.(ts|css|html)$/.test(entrada.name)) max = Math.max(max, statSync(completo).mtimeMs);
      }
    };
    recorrer(resolve(process.cwd(), "web/src"));
    return String(Math.round(max));
  };

  /** Safe slug of the project ("" -> "sin-proyecto"); the header arrives URI-encoded. */
  const slugProyecto = (valor: unknown): string => {
    let texto = String(valor ?? "");
    try {
      texto = decodeURIComponent(texto);
    } catch {
      /* it was not encoded: use it as is */
    }
    return slugDe(texto, { defecto: "sin-proyecto" });
  };

  const carpetaProyecto = (slug: string): string => {
    const carpeta = resolve(carpetaTrabajo, "proyectos", slug);
    mkdirSync(carpeta, { recursive: true });
    return carpeta;
  };

  const resolverEnTrabajo = (relativo: string, slug = "sin-proyecto"): string | null => {
    if (relativo.includes("\\") || relativo.includes("..")) return null;
    const destino = resolve(carpetaTrabajo, rutaEnWorkspace(relativo.replace(/^\/+/, ""), slug));
    return dentroDe(carpetaTrabajo, destino, { incluirRaiz: true }) ? destino : null;
  };

  /** Runs one of the fixed scripts in workspace/herramientas/. */
  const correr = (scriptRel: string, argumentos: string[], segundos: number) =>
    correrProceso(interprete, ["-u", resolve(carpetaTrabajo, scriptRel), ...argumentos], {
      segundos,
      nombre: scriptRel,
      cwd: carpetaTrabajo,
      windowsHide: true,
    });

  return {
    carpetaTrabajo,
    /** The Python the server runs its own scripts with (the touchpad capture, 8-Nov). */
    interprete,
    gpuActual,
    envGpu,
    anotarGpu,
    registro,
    responderJson,
    rutaJson,
    leerCuerpo,
    leerCuerpoBinario,
    idDeBuild,
    slugProyecto,
    carpetaProyecto,
    resolverEnTrabajo,
    listarProyectosDisco: (): Record<string, unknown>[] => proyectosEnDisco(carpetaTrabajo),
    correr,
  };
}

export type Contexto = ReturnType<typeof crearContexto>;
