/** Audio del proyecto: subir, servir con Range, picos para la onda, MIDI a notas, medidas de un WAV y de una referencia. */

import { existsSync, mkdirSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasAudio(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, responderJson, leerCuerpo, leerCuerpoBinario, slugProyecto, carpetaProyecto, resolverEnTrabajo, correr } = ctx;

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
    // .mid entra por aquí porque es el único endpoint binario: no es audio, pero
    // es un fichero que el navegador tiene que dejar en la carpeta del proyecto.
    if (!/\.(wav|mp3|ogg|flac|aif|aiff|m4a|mid|midi)$/i.test(base)) {
      responderJson(res, 400, { error: "sólo audio (.wav, .mp3, .ogg, .flac, .aif, .m4a) o MIDI (.mid)" });
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
  //
  // Con caché por (ruta, mtime, cubos): cada /api/picos lanzaba un Python que
  // leía el fichero entero, y abrir un proyecto de 21 pistas con 11 WAV
  // tardaba 38 s (medido). El WAV sólo cambia si cambia su mtime, así que la
  // segunda apertura no vuelve a leerlo.
  const cachePicos = new Map<string, unknown>();
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
    const clave = `${destino}|${statSync(destino).mtimeMs}|${cubos}`;
    const guardado = cachePicos.get(clave);
    if (guardado !== undefined) {
      responderJson(res, 200, { ok: true, ...(guardado as Record<string, unknown>) });
      return;
    }
    const r = await correr("herramientas/picos.py", [destino, cubos], 120);
    if (r.codigo !== 0) {
      responderJson(res, 400, { error: (r.errores || r.salida).slice(-800) });
      return;
    }
    try {
      const datos = JSON.parse(r.salida) as Record<string, unknown>;
      if (cachePicos.size > 200) cachePicos.clear();
      cachePicos.set(clave, datos);
      responderJson(res, 200, { ok: true, ...datos });
    } catch (error) {
      responderJson(res, 500, { error: "salida no es JSON: " + String(error) });
    }
  });

  // Mide una canción de referencia (enlace o fichero): tempo, tono, forma.
  server.middlewares.use("/api/referencia/medir", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { origen?: string };
        const origen = String(datos.origen ?? "").trim();
        if (!origen) {
          responderJson(res, 400, { error: "falta el origen (enlace o ruta)" });
          return;
        }
        const r = await correr("codigo/analizar_referencia.py", [origen], 900);
        if (r.codigo !== 0) {
          const crudo = (r.errores || r.salida).slice(-800);
          // Lo que falta en el equipo, dicho de forma que el agente se lo pueda pedir a la persona.
          const falta = /No module named ['"]?yt_dlp/.test(crudo)
            ? "Falta yt-dlp en el Python del equipo: instálalo con «python -m pip install yt-dlp» (y ffmpeg en el PATH). Mientras, pide un enlace a otra fuente o un audio."
            : /ffmpeg/i.test(crudo) && /(not found|no se reconoce|No such file)/i.test(crudo)
              ? "Falta ffmpeg en el PATH del equipo para decodificar el audio."
              : "";
          responderJson(res, 400, { error: falta ? `${falta}\n${crudo}` : crudo });
          return;
        }
        responderJson(res, 200, JSON.parse(r.salida));
      } catch (error) {
        responderJson(res, 500, { error: String(error) });
      }
    });
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
    leerCuerpo(req, res, async (cuerpo) => {
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
}
