/**
 * Contexto compartido de la API del servidor de desarrollo.
 *
 * Todo lo que antes vivía suelto dentro de `defineConfig` en `vite.config.ts`
 * (1.863 líneas): dónde está el workspace, cómo se resuelve una ruta del agente,
 * cómo se lanza Python, cómo se lee un cuerpo con tope y cómo se escribe un log.
 * Las rutas (`server/api/*.ts`) reciben este objeto y no comparten nada más.
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
    console.warn(`[miuzika] Lambda sin configurar: falta ${faltanLambda.join(", ")}. Se usara la CPU.`);
  }

  const carpetaTmp = resolve(process.cwd(), "tmp");
  const ficheroLog = resolve(carpetaTmp, "llm.log");

  /** Tope de cada log: al pasarse se guarda una copia .1 y se empieza otro. */
  const TOPE_LOG = 5 * 1024 * 1024;
  const TOPE_LOG_HERRAMIENTAS = 2 * 1024 * 1024;

  /** Anade una linea a un log, rotando por tamano (nunca debe romper la app). */
  const anotar = (fichero: string, linea: string, tope?: number): void => {
    try {
      mkdirSync(carpetaTmp, { recursive: true });
      const limite = tope ?? (fichero === ficheroHerramientas ? TOPE_LOG_HERRAMIENTAS : TOPE_LOG);
      if (existsSync(fichero) && statSync(fichero).size > limite) {
        renameSync(fichero, `${fichero}.1`);
      }
      appendFileSync(fichero, linea + "\n", "utf8");
    } catch {
      /* sin log */
    }
  };

  /**
   * Sin MIUZIKA_LOG_COMPLETO=1 el log guarda el turno sin los mensajes enteros:
   * con el manifiesto dentro eran ~40 KB por vuelta y acababa conteniendo todo el
   * codigo del proyecto. Se guarda la forma (rol, tamano, primeras 200 letras) y,
   * aparte, la peticion y la respuesta. Con el flag, entero (para depurar).
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
  /** Todo lo que escribe o ejecuta el agente vive aqui, y no puede salir de aqui. */
  const carpetaTrabajo = resolve(process.cwd(), "workspace");
  const interprete = env.MIUZIKA_PYTHON || "python";

  const responderJson = (res: ServerResponse, codigo: number, cuerpo: unknown): void => {
    if (res.headersSent) return;
    res.statusCode = codigo;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(cuerpo));
  };

  /** Cuerpo de texto en crudo; devuelve null si pasa del tope. */
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

  /** Cuerpo de texto de una API: contestar 413 es mejor que quedarse sin memoria. */
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
          responderJson(res, 413, { error: "cuerpo demasiado grande (máx. 8 MB)" });
          return;
        }
        alTerminar(cuerpo);
      },
      limite,
    );

  /** Cuerpo binario (WAV subido desde el navegador), con tope de tamaño. */
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
   * Identificador del código servido: la marca de tiempo más nueva de web/ y de
   * esta config. Si cambia, la pestaña abierta está corriendo un bundle viejo
   * (el HMR se desconecta cuando el servidor se reinicia) y hay que recargar.
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
   * Slug seguro del proyecto activo ("" -> "sin-proyecto"). Es la MISMA regla que
   * usa el navegador (src/core/nombres.ts), y admite cualquier alfabeto: la copia
   * vieja quitaba todo lo que no fuera [a-z0-9_-] y una carpeta «夜の歌» llegaba
   * aquí como «sin-proyecto».
   */
  const slugProyecto = (valor: unknown): string => {
    // La cabecera llega codificada (cabeceraDeProyecto en el navegador): HTTP sólo
    // transporta Latin-1 en las cabeceras.
    let texto = String(valor ?? "");
    try {
      texto = decodeURIComponent(texto);
    } catch {
      /* no estaba codificada: se usa tal cual */
    }
    return slugDe(texto, { defecto: "sin-proyecto" });
  };

  /** Carpeta del proyecto activo (se crea al usarla). */
  const carpetaProyecto = (slug: string): string => {
    mkdirSync(resolve(carpetaTrabajo, "proyectos", slug), { recursive: true });
    return resolve(carpetaTrabajo, "proyectos", slug);
  };

  /**
   * Ruta real a partir de una relativa. Lo que empieza por una carpeta
   * compartida se resuelve en workspace/; el resto, en la carpeta del proyecto.
   */
  const resolverEnTrabajo = (relativo: string, slug = "sin-proyecto"): string | null => {
    if (relativo.includes("\\") || relativo.includes("..")) return null;
    // La regla de qué es compartido vive en src/core/rutas.ts (la usa también el navegador).
    const destino = resolve(carpetaTrabajo, rutaEnWorkspace(relativo.replace(/^\/+/, ""), slug));
    const dentro = destino === carpetaTrabajo || destino.startsWith(carpetaTrabajo + sep);
    return dentro ? destino : null;
  };

  /** Inventario de los proyectos del disco: los que tienen proyecto.json. */
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
        // Sólo se lee la cabecera: el fichero con todas las notas puede ser grande.
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
          error: error instanceof Error ? error.message : "proyecto.json ilegible",
        });
      }
    }
    return salida.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
  };

  /**
   * Inventario de ficheros del espacio de trabajo.
   *
   * `carpeta` opcional: "" = la raíz (sin las carpetas ocultas), "proyectos/<slug>",
   * "codigo"… Las carpetas de CARPETAS_OCULTAS no se recorren nunca: `catalogo/`
   * son 4.231 ficheros y metía 573 KB en el contexto del modelo, que llega
   * recortado a cabeza y cola (o sea: el agente no veía el medio, que es donde
   * estaban sus ficheros). Se consulta con `buscar_sonido`, no listando.
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

  /** Ficheros de la carpeta del proyecto que cambiaron desde `desde` (ms). */
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

  /** Lanza un script de workspace/ y devuelve salida, errores y codigo. */
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

  /** Ficheros que forman el motor: reescribirlos exige pasar el smoke test. */
  const MOTOR = new Set(["dsp.py", "instruments.py", "render.py", "midi.py"]);

  /** ¿Es codigo del motor? Valen los dos: el numpy de codigo/ y el de GPU en gpu/. */
  const esDeCodigo = (ruta: string): boolean => {
    const limpia = ruta.replace(/\\/g, "/");
    return limpia.startsWith("codigo/") || limpia.startsWith("gpu/");
  };

  /** ¿Es el motor de GPU? Ese no se puede validar aqui: no hay torch en el portatil. */
  const esDeGpu = (ruta: string): boolean => ruta.replace(/\\/g, "/").startsWith("gpu/");

  /** simbolo -> modulo donde ya existe (del MANIFEST.json). */
  const simbolosDelMotor = (): Map<string, string> => {
    const mapa = new Map<string, string>();
    try {
      const crudo = JSON.parse(
        readFileSync(resolve(carpetaTrabajo, "MANIFEST.json"), "utf8"),
      ) as { modulos?: Record<string, { simbolos?: Record<string, unknown> }> };
      for (const [modulo, info] of Object.entries(crudo.modulos ?? {})) {
        for (const simbolo of Object.keys(info.simbolos ?? {})) {
          if (!mapa.has(simbolo)) mapa.set(simbolo, modulo);
        }
      }
    } catch {
      /* sin manifiesto: no se bloquea nada */
    }
    return mapa;
  };

  /** Nombres de nivel superior definidos en un fuente Python (regex, sin ejecutarlo). */
  const nombresDefinidos = (codigo: string): string[] => {
    const nombres: string[] = [];
    for (const linea of codigo.split("\n")) {
      const m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/.exec(linea);
      if (m) nombres.push(m[1] ?? m[2]);
    }
    return nombres;
  };

  /** Tras tocar el motor: smoke test y, si falla, se revierte. */
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
    simbolosDelMotor,
    nombresDefinidos,
    smokeOTeReverto,
  };
}

export type Contexto = ReturnType<typeof crearContexto>;
