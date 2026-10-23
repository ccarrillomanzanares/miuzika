import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { createReadStream } from "node:fs";
import { defineConfig, loadEnv } from "vite";

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

  /** Anade una linea a un log (nunca debe romper la app). */
  const anotar = (fichero: string, linea: string): void => {
    try {
      mkdirSync(carpetaTmp, { recursive: true });
      appendFileSync(fichero, linea + "\n", "utf8");
    } catch {
      /* sin log */
    }
  };

  const registrarTurno = (linea: string): void => anotar(ficheroLog, linea);

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
    req.on("data", (trozo) => {
      cuerpo += trozo;
    });
    req.on("end", () => alTerminar(cuerpo));
  };

  /** Carpetas compartidas por todos los proyectos: motor y utilidades. */
  const COMPARTIDO = ["codigo/", "herramientas/", "plantillas/", "_archivo/", "proyectos/"];

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

  const esDeCodigo = (ruta: string): boolean => ruta.replace(/\\/g, "/").startsWith("codigo/");

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

          server.middlewares.use("/api/fs/list", (req, res) => {
            if (req.method !== "GET") {
              responderJson(res, 405, { error: "usa GET" });
              return;
            }
            responderJson(res, 200, { ok: true, raiz: "workspace/", ficheros: listarTrabajo() });
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
              responderJson(res, 200, {
                configurado: e.configurado,
                instancias: e.instancias,
                ssh: e.ssh,
                precio_hora: e.precioHora,
                tipo: cfgLambda.tipo,
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
              const segundos = Math.min(Math.max(datos.timeout_segundos ?? 900, 1), 1800);
              const argumentos = Array.isArray(datos.argumentos)
                ? datos.argumentos.map((a) => String(a))
                : [];
              // La ruta remota es la misma relativa al workspace.
              const relativo = relative(carpetaTrabajo, script).split(sep).join("/");

              const avisos: string[] = [];
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
