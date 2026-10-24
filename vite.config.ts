import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { createReadStream } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { buscarEnCatalogo } from "./src/core/buscar.ts";
import type { EntradaCatalogo } from "./src/core/buscar.ts";

import {
  apagar as apagarLambda,
  configDesdeEnv,
  ejecutarEnLambda,
  encender as encenderLambda,
  estado as estadoLambda,
} from "./server/lambda.js";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => {
  // El .env vive en la raiz del proyecto (el root de Vite es "web").
  const env = loadEnv(mode, process.cwd(), "");
  const base = (env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
  const apiKey = env.OLLAMA_API_KEY || "";

  // --- Lambda Cloud: la clave vive en .env y solo la usa este servidor.
  const { cfg: cfgLambda, faltan: faltanLambda } = configDesdeEnv(env as Record<string, string>);
  /** Instancia que ha usado esta sesion (para poder apagarla sin pedir el id). */
  let maquinaLambda: { id: string; ip: string } | null = null;
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

  const leerCuerpo = (req: IncomingMessage, alTerminar: (cuerpo: string) => void): void => {
    let cuerpo = "";
    req.on("data", (trozo: Buffer) => {
      cuerpo += trozo.toString("utf8");
    });
    req.on("end", () => alTerminar(cuerpo));
  };

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

  /** Carpetas compartidas por todos los proyectos: motor y utilidades. */
  const COMPARTIDO = ["codigo/", "gpu/", "herramientas/", "plantillas/", "_archivo/", "proyectos/"];

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

  /** Slug seguro del proyecto activo ("" -> "sin-proyecto"). */
  const slugProyecto = (valor: unknown): string => {
    const limpio = String(valor ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return limpio || "sin-proyecto";
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
    const limpio = relativo.replace(/^\/+/, "");
    const esCompartido = COMPARTIDO.some(
      (prefijo) => limpio === prefijo.slice(0, -1) || limpio.startsWith(prefijo),
    );
    const prefijado = esCompartido ? limpio : `proyectos/${slug}/${limpio}`;
    const destino = resolve(carpetaTrabajo, prefijado);
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

  /** Inventario de lo que hay en workspace/ (lo ve el agente y lo ve la app). */
  const listarTrabajo = (): { path: string; bytes: number }[] => {
    if (!existsSync(carpetaTrabajo)) return [];
    const salida: { path: string; bytes: number }[] = [];
    const recorrer = (dir: string): void => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const completo = resolve(dir, entrada.name);
        if (entrada.isDirectory()) {
          recorrer(completo);
        } else {
          salida.push({
            path: relative(carpetaTrabajo, completo).split(sep).join("/"),
            bytes: statSync(completo).size,
          });
        }
      }
    };
    recorrer(carpetaTrabajo);
    return salida;
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
  const MOTOR = new Set(["dsp.py", "instruments.py", "render.py", "midi.py", "cancion.py"]);

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

  if (!apiKey) {
    console.warn("[miuzika] OLLAMA_API_KEY no esta en .env: /api/llm respondera sin credenciales.");
  }

  return {
    root: "web",
    plugins: [
      {
        name: "miuzika-agent-log",
        // Cada turno del agente se guarda en tmp/llm.log para poder depurar
        // (solo en el servidor de desarrollo; no hay clave en lo que se escribe).
        configureServer(server) {
          server.middlewares.use("/api/agent-log", (req, res) => {
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end();
              return;
            }
            let cuerpo = "";
            req.on("data", (trozo) => {
              cuerpo += trozo;
            });
            req.on("end", () => {
              registrarTurno(cuerpo.trim());
              res.statusCode = 204;
              res.end();
            });
          });
        },
      },
      {
        name: "miuzika-agent-tools",
        // Manos del agente: ejecutar codigo y escribir ficheros, SIEMPRE dentro
        // de <proyecto>/workspace. Solo existe en el servidor de desarrollo.
        configureServer(server) {
          server.middlewares.use("/api/fs/write", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, async (cuerpo) => {
              try {
                const datos = JSON.parse(cuerpo) as { path?: string; contenido?: string };
                if (!datos.path || typeof datos.contenido !== "string") {
                  responderJson(res, 400, { error: "faltan 'path' o 'contenido'" });
                  return;
                }
                const destino = resolverEnTrabajo(datos.path, slugProyecto(req.headers["x-miuzika-proyecto"]));
                if (!destino) {
                  responderJson(res, 403, { error: "ruta fuera de workspace/" });
                  return;
                }
                if (datos.contenido.trim().length === 0) {
                  responderJson(res, 400, {
                    error:
                      "contenido vacio: escribe el script completo en una sola llamada (no lo dejes para despues).",
                  });
                  return;
                }
                const nombre = basename(destino);
                const nuevo = !existsSync(destino);

                // (1) prohibido parchear codigo ajeno con scripts de reemplazo
                if (/^(patch|parche)/i.test(nombre) && nombre.endsWith(".py")) {
                  anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "script de parche" }));
                  responderJson(res, 409, {
                    error:
                      "No se permiten scripts de parche (patch*/parche*). Usa editar_fichero(path, busca, reemplaza): reemplazo exacto, atomico y verificado.",
                  });
                  return;
                }

                // (2) no redefinir simbolos que el motor ya tiene
                if (nuevo && esDeCodigo(datos.path)) {
                  const existentes = simbolosDelMotor();
                  const choques = nombresDefinidos(datos.contenido)
                    .filter((s) => existentes.has(s))
                    .map((s) => ({ simbolo: s, modulo: existentes.get(s) ?? "?" }));
                  if (choques.length > 0) {
                    const detalle = [...new Map(choques.map((c) => [c.simbolo, c])).values()]
                      .slice(0, 8)
                      .map((c) => `${c.simbolo} ya existe en ${c.modulo}`)
                      .join("; ");
                    anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "duplicado" }));
                    responderJson(res, 409, {
                      error:
                        `Duplicarias ${choques.length} simbolo(s) del motor: ${detalle}. ` +
                        "Importalos (from <modulo> import <simbolo>) o usa nombres nuevos. " +
                        "Si es funcionalidad nueva, guardala en codigo/experimental/.",
                    });
                    return;
                  }
                }

                // (3) escribir; si es el motor, smoke test con rollback
                const esMotor = MOTOR.has(nombre) && esDeCodigo(datos.path);
                const previo = esMotor && !nuevo ? readFileSync(destino, "utf8") : null;
                mkdirSync(dirname(destino), { recursive: true });
                writeFileSync(destino, datos.contenido, "utf8");

                let nota = "";
                if (esDeGpu(datos.path)) {
                  // En gpu/ no hay smoke posible: el portatil no tiene torch. Lo
                  // minimo es que el fichero parsea; la validacion real se hace en
                  // la instancia con destino="lambda".
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
                      error: `El fichero de GPU no parsea; no se ha escrito.\n${(comprobacion.errores || comprobacion.salida).slice(-1200)}`,
                    });
                    return;
                  }
                  nota = "gpu: sintaxis ok (validar ejecutando con destino=lambda)";
                }
                if (esMotor) {
                  const smoke = await smokeOTeReverto(destino, previo);
                  if (!smoke.ok) {
                    anotar(ficheroHerramientas, JSON.stringify({ t: new Date().toISOString(), tool: "escribir_fichero", path: datos.path, rechazado: "smoke" }));
                    responderJson(res, 400, {
                      error: `El motor no pasa el smoke test; cambios revertidos.\n${smoke.detalle}`,
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
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, (cuerpo) => {
              try {
                const datos = JSON.parse(cuerpo) as { path?: string };
                const destino = datos.path ? resolverEnTrabajo(datos.path, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
                if (!destino) {
                  responderJson(res, 403, { error: "ruta fuera de workspace/" });
                  return;
                }
                if (!existsSync(destino)) {
                  responderJson(res, 404, { error: "no existe" });
                  return;
                }
                responderJson(res, 200, {
                  ok: true,
                  path: datos.path,
                  contenido: readFileSync(destino, "utf8").slice(0, 20000),
                });
              } catch (error) {
                responderJson(res, 500, {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            });
          });

          // Identificador del código servido: la pestaña lo compara cada 20 s y
          // avisa si está corriendo un bundle viejo (HMR desconectado).
          server.middlewares.use("/api/build", (_req, res) => {
            responderJson(res, 200, { ok: true, id: idDeBuild(), arrancado: arranqueServidor });
          });

          server.middlewares.use("/api/fs/list", (req, res) => {
            if (req.method !== "GET") {
              responderJson(res, 405, { error: "usa GET" });
              return;
            }
            responderJson(res, 200, { ok: true, raiz: "workspace/", ficheros: listarTrabajo() });
          });

          // Fichero maestro por proyecto: proyectos/<slug>/proyecto.json.
          // GET sin path -> inventario; GET con path -> contenido completo (sin el
          // recorte de 20 KB de /api/fs/read: un proyecto con miles de notas no cabe).
          // POST -> escribe el maestro (crea la carpeta del proyecto).
          server.middlewares.use("/api/proyectos", (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const rel = url.searchParams.get("path") ?? "";

            if (req.method === "GET") {
              if (!rel) {
                responderJson(res, 200, { ok: true, raiz: "workspace/proyectos/", proyectos: listarProyectosDisco() });
                return;
              }
              const destino = resolverEnTrabajo(rel);
              if (!destino || !existsSync(destino)) {
                responderJson(res, 404, { error: `no existe ${rel}` });
                return;
              }
              if (!destino.endsWith("proyecto.json")) {
                responderJson(res, 400, { error: "sólo se leen ficheros proyecto.json por aquí" });
                return;
              }
              if (statSync(destino).size > 64 * 1024 * 1024) {
                responderJson(res, 413, { error: "el proyecto pasa de 64 MB: no es un proyecto de miuzika" });
                return;
              }
              responderJson(res, 200, { ok: true, path: rel, contenido: readFileSync(destino, "utf8") });
              return;
            }

            if (req.method === "POST") {
              leerCuerpo(req, (cuerpo) => {
                try {
                  const datos = JSON.parse(cuerpo) as { path?: string; contenido?: string };
                  if (!datos.path || typeof datos.contenido !== "string" || datos.contenido.trim() === "") {
                    responderJson(res, 400, { error: "faltan 'path' o 'contenido'" });
                    return;
                  }
                  const destino = resolverEnTrabajo(datos.path);
                  if (!destino || !destino.endsWith("proyecto.json")) {
                    responderJson(res, 403, { error: "el fichero maestro tiene que ser proyectos/<slug>/proyecto.json" });
                    return;
                  }
                  // No se escribe basura: si no parsea o no es de miuzika, no se toca el disco.
                  let validado: { formato?: string; proyecto?: { schemaVersion?: number } };
                  try {
                    validado = JSON.parse(datos.contenido) as typeof validado;
                  } catch (error) {
                    responderJson(res, 400, {
                      error: `el proyecto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
                    });
                    return;
                  }
                  if (validado.formato !== "miuzika-proyecto" || validado.proyecto?.schemaVersion !== 1) {
                    responderJson(res, 400, {
                      error: 'el fichero maestro tiene que ser { formato: "miuzika-proyecto", proyecto: { schemaVersion: 1 } }',
                    });
                    return;
                  }
                  mkdirSync(dirname(destino), { recursive: true });
                  writeFileSync(destino, datos.contenido, "utf8");
                  responderJson(res, 200, {
                    ok: true,
                    path: datos.path,
                    bytes: Buffer.byteLength(datos.contenido, "utf8"),
                  });
                } catch (error) {
                  responderJson(res, 500, {
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              });
              return;
            }

            responderJson(res, 405, { error: "usa GET o POST" });
          });

          // El manifiesto del motor, regenerado al pedirlo (lo inyecta el prompt).
          server.middlewares.use("/api/manifiesto", async (req, res) => {
            if (req.method !== "GET") {
              responderJson(res, 405, { error: "usa GET" });
              return;
            }
            await correr("herramientas/manifiesto.py", [], 60);
            const rutaMd = resolve(carpetaTrabajo, "MANIFEST.md");
            const texto = existsSync(rutaMd)
              ? readFileSync(rutaMd, "utf8")
              : "(sin manifiesto: ejecuta herramientas/manifiesto.py)";
            responderJson(res, 200, { ok: true, manifiesto: texto, bytes: texto.length });
          });

          // editar_fichero: reemplazo exacto, con smoke test si toca el motor.
          server.middlewares.use("/api/fs/edit", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, async (cuerpo) => {
              try {
                const d = JSON.parse(cuerpo) as {
                  path?: string;
                  busca?: string;
                  reemplaza?: string;
                  todas?: boolean;
                };
                if (!d.path || typeof d.busca !== "string" || typeof d.reemplaza !== "string") {
                  responderJson(res, 400, { error: "faltan 'path', 'busca' o 'reemplaza'" });
                  return;
                }
                const destino = resolverEnTrabajo(d.path, slugProyecto(req.headers["x-miuzika-proyecto"]));
                if (!destino) {
                  responderJson(res, 403, { error: "ruta fuera de workspace/" });
                  return;
                }
                if (!existsSync(destino)) {
                  responderJson(res, 404, { error: "no existe" });
                  return;
                }
                const antes = readFileSync(destino, "utf8");
                const trozos = antes.split(d.busca);
                const total = trozos.length - 1;
                if (total === 0) {
                  responderJson(res, 409, {
                    error:
                      "ese texto no aparece en el fichero: copia el fragmento EXACTO (con su indentacion) o usa leer_fichero.",
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
                      error: `El motor no pasa el smoke test; cambio revertido.\n${smoke.detalle}`,
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
                responderJson(res, 200, { ok: true, reemplazos: todas ? total : 1, bytes: Buffer.byteLength(despues, "utf8") });
              } catch (error) {
                responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
              }
            });
          });

          // WAV del navegador al disco: lo que el usuario importa con «Audio» se
          // copia a proyectos/<slug>/entrada/ para que el fichero maestro lo pueda
          // referenciar (si no, sólo viviría en IndexedDB y el proyecto no viajaría).
          server.middlewares.use("/api/audio/subir", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            const url = new URL(req.url ?? "/", "http://localhost");
            const slug = slugProyecto(url.searchParams.get("slug") || req.headers["x-miuzika-proyecto"]);
            const crudo = url.searchParams.get("nombre") ?? "";
            const base = basename(crudo)
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^A-Za-z0-9._-]+/g, "_")
              .slice(-80);
            if (!/\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i.test(base)) {
              responderJson(res, 400, { error: "sólo audio (.wav, .mp3, .ogg, .flac, .aif, .m4a)" });
              return;
            }
            leerCuerpoBinario(req, 512 * 1024 * 1024, (datos) => {
              if (!datos || datos.length === 0) {
                responderJson(res, 413, { error: "audio vacío o mayor de 512 MB" });
                return;
              }
              try {
                const carpeta = resolve(carpetaProyecto(slug), "entrada");
                mkdirSync(carpeta, { recursive: true });
                let destino = resolve(carpeta, base);
                let copia = 2;
                while (existsSync(destino)) {
                  destino = resolve(carpeta, base.replace(/(\.[^.]+)$/, `_${copia++}$1`));
                }
                writeFileSync(destino, datos);
                responderJson(res, 200, {
                  ok: true,
                  path: `entrada/${basename(destino)}`,
                  bytes: datos.length,
                  slug,
                });
              } catch (error) {
                responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
              }
            });
          });

          // Sirve un WAV de workspace/ con soporte de Range: el cliente puede pedir
          // trozos y decodificarlos de uno en uno (streaming) en vez del fichero entero.
          server.middlewares.use("/api/audio", (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const rel = url.searchParams.get("path") ?? "";
            const destino = rel
              ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"]))
              : null;
            if (!destino || !existsSync(destino)) {
              responderJson(res, 404, { error: "no existe" });
              return;
            }
            const totalBytes = statSync(destino).size;
            const rango = String(req.headers.range ?? "");
            const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(rango.trim());
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Type", "audio/wav");

            if (coincidencia && (coincidencia[1] !== "" || coincidencia[2] !== "")) {
              let desde = coincidencia[1] === "" ? totalBytes - Number(coincidencia[2]) : Number(coincidencia[1]);
              let hasta = coincidencia[1] === "" || coincidencia[2] === "" ? totalBytes - 1 : Number(coincidencia[2]);
              desde = Math.max(0, Math.min(desde, totalBytes - 1));
              hasta = Math.max(desde, Math.min(hasta, totalBytes - 1));
              const largo = hasta - desde + 1;
              res.statusCode = 206;
              res.setHeader("Content-Range", `bytes ${desde}-${hasta}/${totalBytes}`);
              res.setHeader("Content-Length", String(largo));
              createReadStream(destino, { start: desde, end: hasta }).pipe(res);
              return;
            }

            res.statusCode = 200;
            res.setHeader("Content-Length", String(totalBytes));
            createReadStream(destino).pipe(res);
          });

          // Picos de un WAV calculados en el servidor: la onda se dibuja sin decodificar.
          server.middlewares.use("/api/picos", async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const rel = url.searchParams.get("path") ?? "";
            const cubos = url.searchParams.get("cubos") ?? "1024";
            const destino = rel
              ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"]))
              : null;
            if (!destino || !existsSync(destino)) {
              responderJson(res, 404, { error: "no existe" });
              return;
            }
            const r = await correr("herramientas/picos.py", [destino, cubos], 120);
            if (r.codigo !== 0) {
              responderJson(res, 400, { error: (r.errores || r.salida).slice(-800) });
              return;
            }
            try {
              const datos = JSON.parse(r.salida) as Record<string, unknown>;
              responderJson(res, 200, { ok: true, ...datos });
            } catch (error) {
              responderJson(res, 500, { error: "salida no es JSON: " + String(error) });
            }
          });

          // Devuelve las notas de un .mid ya normalizadas a beats (op add_notes).
          server.middlewares.use("/api/midi", async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const rel = url.searchParams.get("path") ?? "";
            const destino = rel ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
            if (!destino || !existsSync(destino)) {
              responderJson(res, 404, { error: "no existe" });
              return;
            }
            const r = await correr("herramientas/midi_lector.py", [destino], 60);
            if (r.codigo !== 0) {
              responderJson(res, 400, { error: (r.errores || r.salida).slice(-800) });
              return;
            }
            try {
              const datos = JSON.parse(r.salida) as Record<string, unknown>;
              responderJson(res, 200, { ok: true, ...datos });
            } catch (error) {
              responderJson(res, 500, { error: "salida no es JSON: " + String(error) });
            }
          });

          // verificar_audio: metricas objetivas de un WAV (no reescribir analizadores).
          server.middlewares.use("/api/verificar", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, async (cuerpo) => {
              try {
                const d = JSON.parse(cuerpo) as { path?: string };
                const destino = d.path ? resolverEnTrabajo(d.path, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
                if (!destino) {
                  responderJson(res, 403, { error: "ruta fuera de workspace/" });
                  return;
                }
                if (!existsSync(destino)) {
                  responderJson(res, 404, { error: "no existe" });
                  return;
                }
                const r = await correr("herramientas/verificar_audio.py", [destino], 180);
                anotar(
                  ficheroHerramientas,
                  JSON.stringify({ t: new Date().toISOString(), tool: "verificar_audio", path: d.path, codigo: r.codigo }),
                );
                responderJson(res, 200, {
                  ok: r.codigo === 0,
                  codigo: r.codigo,
                  informe: (r.salida + r.errores).slice(-4000),
                });
              } catch (error) {
                responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
              }
            });
          });


          // ---------------------------------------------------------- Catálogo de samples
          // Índice de la biblioteca CC0 (codigo/catalogo.py). Se busca en el servidor
          // para no mandar 4.231 entradas al navegador en cada consulta.
          const cacheCatalogo = {
            json: null as null | Record<string, unknown>,
            entradas: null as null | EntradaCatalogo[],
            mtime: 0,
          };
          const leerCatalogo = (): { entradas: EntradaCatalogo[]; total: number } => {
            const ruta = resolve(carpetaTrabajo, "catalogo", "catalogo-vcsl.json");
            const rutaStrudel = resolve(carpetaTrabajo, "catalogo", "strudel-vcsl.json");
            if (!existsSync(ruta)) return { entradas: [], total: 0 };
            const mtime = statSync(ruta).mtimeMs;
            if (cacheCatalogo.json === null || mtime !== cacheCatalogo.mtime) {
              cacheCatalogo.json = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>;
              cacheCatalogo.entradas = null;
              cacheCatalogo.mtime = mtime;
            }
            if (cacheCatalogo.entradas !== null) {
              return { entradas: cacheCatalogo.entradas, total: cacheCatalogo.entradas.length };
            }
            const datos = cacheCatalogo.json as { entradas?: Record<string, unknown>[] };
            // Nombres de Strudel: su mapa apunta a los mismos ficheros de VCSL, así que
            // un sample puede tener nombre corto allí (`s("bassdrum1")`).
            const strudel = new Map<string, string>();
            if (existsSync(rutaStrudel)) {
              const mapa = JSON.parse(readFileSync(rutaStrudel, "utf8")) as Record<string, unknown>;
              for (const [nombre, valor] of Object.entries(mapa)) {
                if (nombre === "_base") continue;
                // En el mapa de Strudel cada nombre lleva una lista de ficheros.
                const destinos = Array.isArray(valor) ? valor : [valor];
                for (const destino of destinos) {
                  if (typeof destino !== "string") continue;
                  try {
                    strudel.set(decodeURIComponent(destino), nombre);
                  } catch {
                    strudel.set(destino, nombre);
                  }
                }
              }
            }
            const entradas = (datos.entradas ?? [])
              .filter((x) => typeof x.archivo === "string" && (x.medido as Record<string, unknown> | null))
              .map((x) => {
                const medido = x.medido as Record<string, number>;
                const archivo = String(x.archivo);
                return {
                  clave: archivo,
                  etiqueta: String(x.instrumento ?? archivo),
                  familia: String(x.familia ?? "sin clasificar"),
                  descripcion:
                    `${String(x.instrumento ?? "")}${x.articulacion ? " · " + String(x.articulacion) : ""}` +
                    ` · ${String(x.sr)} Hz ${String(x.bits)}b${String(x.archivo).includes("") ? "" : ""}` +
                    (strudel.has(archivo) ? ` · strudel: ${strudel.get(archivo)}` : ""),
                  destino: "cpu" as const,
                  perfil: {
                    duracion_s: medido.duracion_s,
                    centroide_hz: medido.centroide_hz,
                    crest_db: medido.crest_db,
                    cola_ms: medido.cola_ms,
                    rms_dbfs: medido.rms_dbfs,
                  },
                  ruta: archivo,
                  strudel: strudel.get(archivo) ?? null,
                  // Normalizado una vez, no en cada búsqueda: con 4.231 entradas,
                  // normalizar en caliente costaba ~800 ms por consulta.
                  normTexto: `${archivo} ${String(x.instrumento ?? "")} ${String(x.articulacion ?? "")}`
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toLowerCase(),
                  normClave: archivo
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toLowerCase(),
                } as EntradaCatalogo & { strudel: string | null };
              });
            cacheCatalogo.entradas = entradas;
            return { entradas, total: entradas.length };
          };

          server.middlewares.use("/api/catalogo/buscar", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, (cuerpo) => {
              try {
                const datos = JSON.parse(cuerpo) as { consulta?: string; limite?: number; familia?: string };
                const { entradas, total } = leerCatalogo();
                const encontrados = buscarEnCatalogo(entradas, String(datos.consulta ?? ""), {
                  limite: Math.min(Math.max(Number(datos.limite ?? 8), 1), 50),
                  ...(datos.familia ? { familia: datos.familia } : {}),
                });
                responderJson(res, 200, {
                  ok: true,
                  total,
                  resultados: encontrados.map((r) => ({
                    archivo: r.entrada.ruta,
                    instrumento: r.entrada.etiqueta,
                    familia: r.entrada.familia,
                    perfil: r.entrada.perfil,
                    strudel: (r.entrada as { strudel?: string | null }).strudel ?? null,
                    puntuacion: r.puntuacion,
                    motivos: r.motivos,
                  })),
                });
              } catch (error) {
                responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
              }
            });
          });

          // Un sample del catálogo entra en el proyecto convertido y normalizado.
          server.middlewares.use("/api/catalogo/importar", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, async (cuerpo) => {
              try {
                const datos = JSON.parse(cuerpo) as { archivo?: string; nombre?: string };
                const archivo = String(datos.archivo ?? "");
                const nombre = String(datos.nombre ?? "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
                if (archivo === "" || nombre === "") {
                  responderJson(res, 400, { ok: false, error: "faltan 'archivo' o 'nombre'" });
                  return;
                }
                const completo = resolve(carpetaTrabajo, "catalogo");
                // El índice guarda la ruta relativa a la raíz de la biblioteca
                // ("Idiophones/…"), así que se prueba con y sin esa raíz.
                const indice = resolve(carpetaTrabajo, "catalogo", "catalogo-vcsl.json");
                let raiz = "";
                if (existsSync(indice)) {
                  const cabecera = JSON.parse(readFileSync(indice, "utf8")) as { raiz?: string };
                  raiz = String(cabecera.raiz ?? "");
                }
                const candidatos = [
                  resolve(carpetaTrabajo, "catalogo", archivo),
                  ...(raiz !== "" ? [resolve(carpetaTrabajo, "catalogo", raiz, archivo)] : []),
                ];
                const origen = candidatos.find((c) => c.startsWith(completo + sep) && existsSync(c));
                if (!origen) {
                  responderJson(res, 404, { ok: false, error: `no existe ${archivo}` });
                  return;
                }
                const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
                const r = await correr(
                  "codigo/importar_sample.py",
                  [origen, slug, nombre],
                  300,
                );
                const salida = (r.salida ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
                if (!salida) {
                  responderJson(res, 500, { ok: false, error: (r.errores || r.salida).slice(-800) });
                  return;
                }
                anotar(
                  ficheroHerramientas,
                  JSON.stringify({ t: new Date().toISOString(), tool: "catalogo_importar", archivo, nombre }),
                );
                responderJson(res, 200, JSON.parse(salida));
              } catch (error) {
                responderJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
              }
            });
          });

          // ---------------------------------------------------------- Voces del motor
          // El catálogo sale del propio instruments.py (ver codigo/voces.py): no hay
          // una segunda lista que mantener. `medir` renderiza y mide cada voz.
          server.middlewares.use("/api/voces", async (req, res, next) => {
            // Conexión monta por prefijo: /api/voces/nueva tiene su propio handler.
            const resto = (req.url ?? "").split("?")[0];
            if (resto !== "" && resto !== "/") {
              next();
              return;
            }
            if (req.method !== "GET") {
              responderJson(res, 405, { error: "usa GET" });
              return;
            }
            const medir = /[?&]medir=1/.test(req.url ?? "");
            try {
              const r = await correr("codigo/voces.py", medir ? ["--medir"] : [], 240);
              if (r.codigo !== 0) {
                responderJson(res, 500, { error: (r.errores || r.salida).slice(-1200) });
                return;
              }
              responderJson(res, 200, JSON.parse(r.salida.trim()));
            } catch (error) {
              responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
            }
          });

          // Una voz nueva pasa por la puerta (codigo/gate_voz.py): se renderiza, se
          // mide y, si cumple, se cuece en instruments.py para siempre. Si no, se
          // devuelven los motivos concretos y el fichero queda intacto.
          server.middlewares.use("/api/voces/nueva", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, async (cuerpo) => {
              const rutaInstruments = resolve(carpetaTrabajo, "codigo", "instruments.py");
              try {
                const datos = JSON.parse(cuerpo) as {
                  nombre?: string;
                  fuente?: string;
                  destino?: string;
                };
                const destino = datos.destino === "gpu" ? "gpu" : "cpu";
                const nombre = String(datos.nombre ?? "").trim().toLowerCase();
                const fuente = String(datos.fuente ?? "");
                if (!/^[a-z][a-z0-9_]{2,30}$/.test(nombre)) {
                  responderJson(res, 400, {
                    ok: false,
                    motivos: ["el nombre debe ser minúsculas, 3-31 caracteres, letras/números/_"],
                  });
                  return;
                }
                if (fuente.trim().length < 40 || fuente.length > 20000) {
                  responderJson(res, 400, { ok: false, motivos: ["la fuente está vacía o es enorme"] });
                  return;
                }
                const rutaGpu = resolve(carpetaTrabajo, "gpu", "voces_gpu.py");
                const textoCpu = readFileSync(rutaInstruments, "utf8");
                const textoGpu = existsSync(rutaGpu) ? readFileSync(rutaGpu, "utf8") : "";
                const existe = new RegExp(`^def ${nombre}\\(`, "m");
                if (existe.test(textoCpu) || existe.test(textoGpu)) {
                  responderJson(res, 409, { ok: false, motivos: [`ya existe la voz "${nombre}"`] });
                  return;
                }

                // 1) la candidata se renderiza donde toca. En GPU va a gpu/ (Lambda
                //    sube esa carpeta) y la mide gpu/gate_voz_gpu.py allí mismo.
                const candidata =
                  destino === "gpu" ? `gpu/_candidata_${nombre}.py` : `tmp/_candidata_${nombre}.py`;
                writeFileSync(resolve(carpetaTrabajo, candidata), fuente, "utf8");
                let prueba: { codigo: number | null; salida: string; errores: string };
                if (destino === "gpu") {
                  const host = req.headers.host ?? "localhost:5173";
                  const respuesta = await fetch(`http://${host}/api/run/lambda`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-miuzika-proyecto": slugProyecto(req.headers["x-miuzika-proyecto"]) },
                    body: JSON.stringify({
                      path: "gpu/gate_voz_gpu.py",
                      argumentos: [`_candidata_${nombre}.py`],
                      timeout_segundos: 900,
                    }),
                  });
                  const leido = (await respuesta.json()) as { codigo?: number; salida?: string; errores?: string };
                  prueba = {
                    codigo: leido.codigo ?? (respuesta.ok ? 0 : 1),
                    salida: leido.salida ?? "",
                    errores: leido.errores ?? "",
                  };
                } else {
                  prueba = await correr("codigo/gate_voz.py", [candidata], 90);
                }
                const ultima = prueba.salida.trim().split("\n").filter((l) => l.startsWith("{")).pop();
                if (!ultima) {
                  responderJson(res, 500, {
                    ok: false,
                    motivos: ["la puerta no devolvió veredicto"],
                    detalle: (prueba.errores || prueba.salida).slice(-800),
                  });
                  return;
                }
                const veredicto = JSON.parse(ultima) as {
                  ok?: boolean;
                  motivos?: string[];
                  perfil?: Record<string, unknown>;
                  traza?: string;
                };
                if (!veredicto.ok) {
                  responderJson(res, 422, {
                    ok: false,
                    motivos: veredicto.motivos ?? ["no pasa la puerta"],
                    perfil: veredicto.perfil ?? null,
                    traza: veredicto.traza ?? null,
                  });
                  return;
                }

                // 2) cocer: se añade al final de instruments.py, con su sección.
                //    Se quitan los imports de sí misma (dentro del módulo no hacen
                //    falta y provocan import circular según dónde caiga la función).
                const limpia = fuente
                  .split("\n")
                  .filter((l) => !/^(from instruments import|import instruments)/.test(l.trim()))
                  .join("\n")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim();
                const rutaDestino = destino === "gpu" ? rutaGpu : rutaInstruments;
                const original = readFileSync(rutaDestino, "utf8");
                const marca = "VOCES CREADAS POR EL AGENTE";
                const cabecera = original.includes(marca)
                  ? ""
                  : "\n\n# ── VOCES CREADAS POR EL AGENTE ──────────────────────────────────────────────\n" +
                    "# Añadidas desde la app. Docstring obligatorio: ver codigo/voces.py.\n";
                writeFileSync(
                  rutaDestino,
                  original.replace(/\s*$/, "\n") + cabecera + "\n" + limpia + "\n",
                  "utf8",
                );

                // 3) el módulo tiene que seguir importando y la voz aparecer en el catálogo.
                const revisar = await correr("codigo/voces.py", ["--medir"], 240);
                if (revisar.codigo !== 0) {
                  writeFileSync(rutaDestino, original, "utf8");
                  responderJson(res, 500, {
                    ok: false,
                    motivos: ["la voz rompe instruments.py; se ha deshecho el cambio"],
                    detalle: (revisar.errores || revisar.salida).slice(-800),
                  });
                  return;
                }
                const catalogo = JSON.parse(revisar.salida.trim()) as {
                  voces?: { clave: string; [k: string]: unknown }[];
                };
                anotar(
                  ficheroHerramientas,
                  JSON.stringify({
                    t: new Date().toISOString(),
                    tool: "voz_nueva",
                    nombre,
                    motivos: [],
                    perfil: veredicto.perfil ?? null,
                  }),
                );
                responderJson(res, 200, {
                  ok: true,
                  voz: (catalogo.voces ?? []).find((v) => v.clave === nombre) ?? null,
                  perfil: veredicto.perfil ?? null,
                  total: (catalogo.voces ?? []).length,
                });
              } catch (error) {
                responderJson(res, 500, {
                  ok: false,
                  motivos: [error instanceof Error ? error.message : String(error)],
                });
              }
            });
          });

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
            leerCuerpo(req, (cuerpo) => {
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
            leerCuerpo(req, (cuerpo) => {
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
              const usaGpu = /\b(?:from|import)\s+motor_gpu\b/.test(fuente) || /\btorch\b/.test(fuente);
              const usaNumpy = /\b(?:from|import)\s+(?:dsp|instruments|render|cancion)\b/.test(fuente);
              if (usaNumpy && !usaGpu) {
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
                    "Ese script usa el motor numpy (dsp/instruments/render) y NO importa motor_gpu: en " +
                    "Lambda pagarías GPU para renderizar en CPU. Dos salidas: (1) reescríbelo con motor_gpu " +
                    "(torch: osc, saturar(veces=4), ir_estereo, reverb, shimmer, congelar, granular, " +
                    "compresor_multibanda, limitador) y repite con destino='lambda'; (2) si quieres CPU, " +
                    "usa destino='cpu': es gratis y corre en el portátil. No hay una tercera.",
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
              if (!usaGpu) {
                avisos.push("El script no importa motor_gpu: la GPU está encendida pero no se usa.");
              }
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
                    ficheros: listarTrabajo(),
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

          server.middlewares.use("/api/run/python", (req, res) => {
            if (req.method !== "POST") {
              responderJson(res, 405, { error: "usa POST" });
              return;
            }
            leerCuerpo(req, (cuerpo) => {
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
                  PYTHONPATH: [motor, process.env.PYTHONPATH].filter(Boolean).join(sep),
                },
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
                  ficheros: listarTrabajo(),
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
        },
      },
    ],
    server: {
      port: 5173,
      host: "localhost",
      headers: isolationHeaders,
      proxy: {
        // El navegador llama a /api/llm/... y la clave la pone el servidor:
        // asi nunca entra en el bundle del cliente.
        "/api/llm": {
          target: base,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/llm/, ""),
          configure: (proxy) => {
            // Log de cada llamada al LLM en la consola del servidor de Vite:
            // es lo que permite depurar mientras se le piden cosas al agente.
            const inicio = new WeakMap<object, number>();
            proxy.on("proxyReq", (proxyReq, req) => {
              proxyReq.setHeader("Authorization", `Bearer ${apiKey}`);
              inicio.set(req, Date.now());
            });
            proxy.on("proxyRes", (proxyRes, req) => {
              const t0 = inicio.get(req) ?? Date.now();
              console.log(
                `[llm] ${req.method} ${req.url} -> ${proxyRes.statusCode} en ${Date.now() - t0} ms`,
              );
            });
            proxy.on("error", (error, req) => {
              console.error(`[llm] ${req.method} ${req.url} -> ERROR ${error.message}`);
            });
          },
        },
      },
    },
    preview: {
      port: 4173,
      headers: isolationHeaders,
    },
    build: {
      outDir: "../dist-web",
      emptyOutDir: true,
      target: "es2022",
    },
  };
});
