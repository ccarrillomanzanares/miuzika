/** Ficheros del workspace: leer, escribir, editar y listar (las manos del agente), más el log de turnos, el manifiesto del motor y el id del código servido. */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasFicheros(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, registrarTurno, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, idDeBuild, arranqueServidor, slugProyecto, resolverEnTrabajo, MAX_LISTADO, listarTrabajo, correr, MOTOR, esDeCodigo, esDeGpu, simbolosDelMotor, nombresDefinidos, smokeOTeReverto } = ctx;

  server.middlewares.use("/api/agent-log", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    // Con tope, como todos los cuerpos: un turno con el prompt entero eran ~40 KB y
    // sin límite un cliente roto podía llenar la memoria.
    leerCuerpo(req, res, (cuerpo) => {
      registrarTurno(cuerpo.trim());
      res.statusCode = 204;
      res.end();
    });
  });

  server.middlewares.use("/api/fs/write", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
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
                "Si es funcionalidad de esta canción, escríbela en la carpeta del proyecto, no en el motor.",
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
    leerCuerpo(req, res, (cuerpo) => {
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
    // Sin `carpeta`: el proyecto activo (lo que el agente necesita ver).
    // Con `carpeta=codigo` o `carpeta=` se pide otra zona del espacio.
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
      // Sin este aviso, un listado cortado se lee como «aquí no está».
      truncado: ficheros.length >= MAX_LISTADO,
    });
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
    leerCuerpo(req, res, async (cuerpo) => {
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
}
