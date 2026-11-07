/** Project audio: upload, serve with Range, waveform peaks, WAV to MP3 and MIDI to notes. */

import { correrProceso } from "../proceso.ts";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { rutaJson } from "../ruta.ts";
import { argumentosAWav, debeConvertirse } from "../convertir-audio.ts";
import { KBPS_MP3, argumentosMedir, argumentosMp3, leerMedida, problemasMp3 } from "../mp3.ts";

export function rutasAudio(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, leerCuerpoBinario, slugProyecto, carpetaProyecto, resolverEnTrabajo, carpetaTrabajo, correr } = ctx;


  // WAV from the browser to disk: what the user imports with "Audio" is
  // copied to proyectos/<slug>/entrada/ so the master file can reference it
  // (otherwise it would only live in IndexedDB and the project would not travel).
  server.middlewares.use("/api/audio/subir", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
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
    // .mid comes in through here because it is the only binary endpoint: it is not audio, but
    // it is a file the browser has to leave in the project folder.
    if (!/\.(wav|mp3|ogg|oga|flac|aif|aiff|m4a|mid|midi)$/i.test(base)) {
      responderJson(res, 400, { error: "only audio (.wav, .mp3, .ogg, .flac, .aif, .m4a) or MIDI (.mid)" });
      return;
    }
    leerCuerpoBinario(req, 512 * 1024 * 1024, async (datos) => {
      if (!datos || datos.length === 0) {
        responderJson(res, 413, { error: "empty audio or larger than 512 MB" });
        return;
      }
      try {
        // `carpeta=salida`: a project export (MIDI or WAV of the commission),
        // which is overwritten; everything else is incoming material and never overwrites anything.
        const salida = url.searchParams.get("carpeta") === "salida";
        const carpeta = resolve(carpetaProyecto(slug), salida ? "salida" : "entrada");
        mkdirSync(carpeta, { recursive: true });
        // Exports are ours and already right; only what comes in from outside is converted.
        const convertir = !salida && debeConvertirse(base, datos);
        const nombreFinal = convertir ? base.replace(/\.[^.]+$/, ".wav") : base;
        let destino = resolve(carpeta, nombreFinal);
        let copia = 2;
        while (!salida && existsSync(destino)) {
          destino = resolve(carpeta, nombreFinal.replace(/(\.[^.]+)$/, `_${copia++}$1`));
        }
        if (convertir) {
          const temporal = `${destino}.origen`;
          writeFileSync(temporal, datos);
          const r = await correrProceso("ffmpeg", argumentosAWav(temporal, destino), { segundos: 300, nombre: "ffmpeg", cwd: carpetaTrabajo, windowsHide: true });
          rmSync(temporal, { force: true });
          if (r.errorArranque) {
            responderJson(res, 501, { error: `to import ${base} ffmpeg has to be on the server's PATH (${r.errorArranque}).` });
            return;
          }
          if (r.codigo !== 0 || !existsSync(destino)) {
            rmSync(destino, { force: true });
            responderJson(res, 400, { error: `${base} cannot be read as audio: ${r.errores.slice(-300)}` });
            return;
          }
        } else {
          writeFileSync(destino, datos);
        }
        responderJson(res, 200, {
          ok: true,
          path: `${salida ? "salida" : "entrada"}/${basename(destino)}`,
          bytes: datos.length,
          slug,
        });
      } catch (error) {
        responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  // WAV → MP3 (320 kbps CBR, project title as ID3), measured back against the WAV.
  // Mounted before /api/audio, which matches by prefix. The MP3 goes next to its WAV. See server/mp3.ts for the decision and the tolerances.
  server.middlewares.use(
    "/api/audio/mp3",
    rutaJson<{ archivo?: string; titulo?: string }>({ metodo: "POST" }, async ({ req, res, datos: d }) => {
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const origen = d.archivo ? resolverEnTrabajo(d.archivo, slug) : null;
      if (!origen || !/\.wav$/i.test(origen)) {
        responderJson(res, 400, { ok: false, error: "'archivo' must be a .wav inside workspace/" });
        return;
      }
      if (!existsSync(origen)) {
        responderJson(res, 404, { ok: false, error: `${d.archivo} does not exist` });
        return;
      }
      const destino = origen.replace(/\.wav$/i, ".mp3");
      const control = new AbortController();
      res.on("close", () => control.abort());
      const ffmpeg = (args: string[], segundos: number) =>
        correrProceso("ffmpeg", args, { segundos, nombre: "ffmpeg", cwd: carpetaTrabajo, windowsHide: true, senal: control.signal });
      const antes = await ffmpeg(argumentosMedir(origen), 300);
      if (antes.errorArranque) {
        responderJson(res, 501, { ok: false, error: `ffmpeg is not on the server's PATH (${antes.errorArranque}).` });
        return;
      }
      const conv = await ffmpeg(argumentosMp3(origen, destino, { titulo: d.titulo }), 600);
      if (conv.cancelado) return;
      if (conv.codigo !== 0 || !existsSync(destino)) {
        responderJson(res, 500, { ok: false, error: `ffmpeg could not convert it: ${conv.errores.slice(-600)}` });
        return;
      }
      const despues = await ffmpeg(argumentosMedir(destino), 300);
      if (despues.cancelado) return;
      const wav = leerMedida(antes.errores);
      const mp3 = leerMedida(despues.errores);
      const problemas = problemasMp3(wav, mp3);
      const rel = relative(carpetaTrabajo, destino).split(sep).join("/");
      const bytes = statSync(destino).size;
      responderJson(res, 200, { ok: problemas.length === 0, ruta: rel, bytes, kbps: KBPS_MP3, wav, mp3, problemas });
    }),
  );

  // Serves a WAV from workspace/ with Range support: the client can request
  // chunks and decode them one by one (streaming) instead of the whole file.
  server.middlewares.use("/api/audio", (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.searchParams.get("path") ?? "";
    const destino = rel
      ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"]))
      : null;
    if (!destino || !existsSync(destino)) {
      responderJson(res, 404, { error: "does not exist" });
      return;
    }
    const totalBytes = statSync(destino).size;
    const rango = String(req.headers.range ?? "");
    const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(rango.trim());
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", /\.mp3$/i.test(destino) ? "audio/mpeg" : "audio/wav");


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

  // Peaks of a WAV computed on the server: the waveform is drawn without decoding.
  //
  // With a cache keyed by (path, mtime, buckets): each /api/picos launched a Python that
  // read the whole file, and opening a 21-track project with 11 WAVs
  // took 38 s (measured). The WAV only changes if its mtime changes, so the
  // second opening does not read it again.
  const cachePicos = new Map<string, unknown>();
  server.middlewares.use("/api/picos", rutaJson({ metodo: "GET" }, async ({ req, res, url }) => {
    const rel = url.searchParams.get("path") ?? "";
    const cubos = url.searchParams.get("cubos") ?? "1024";
    const destino = rel
      ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"]))
      : null;
    if (!destino || !existsSync(destino)) {
      responderJson(res, 404, { error: "does not exist" });
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
      responderJson(res, 500, { error: "output is not JSON: " + String(error) });
    }
  }));

  // Returns the notes of a .mid already normalized to beats (op add_notes).
  server.middlewares.use("/api/midi", rutaJson({ metodo: "GET" }, async ({ req, res, url }) => {
    const rel = url.searchParams.get("path") ?? "";
    const destino = rel ? resolverEnTrabajo(rel, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
    if (!destino || !existsSync(destino)) {
      responderJson(res, 404, { error: "does not exist" });
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
      responderJson(res, 500, { error: "output is not JSON: " + String(error) });
    }
  }));
}
