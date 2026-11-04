/** Project audio: upload, serve with Range, waveform peaks, MIDI to notes, measurements of a WAV and of a reference. */

import { correrProceso } from "../proceso.ts";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { rutaJson } from "../ruta.ts";
import { KBPS_MP3, argumentosMedir, argumentosMp3, leerMedida, problemasMp3 } from "../mp3.ts";

/**
 * basic-pitch arguments. `--midi-tempo` is the project's tempo: basic-pitch keeps note
 * times in seconds and writes 120 BPM by default, and the import places notes by beats.
 * Measured on 2-Nov in "Stahl" (125 BPM): every onset landed 4 % early (last onset 291.3
 * vs 303.5 beats) and the agent re-scaled by hand. Out-of-range or missing bpm keeps 120.
 */
export function argumentosBasicPitch(carpeta: string, origen: string, bpm: unknown): string[] {
  const args = [carpeta, origen, "--model-serialization", "onnx"];
  const tempo = Number(bpm);
  if (Number.isFinite(tempo) && tempo >= 20 && tempo <= 400) args.push("--midi-tempo", String(tempo));
  return args;
}

export function rutasAudio(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, basicPitch, responderJson, leerCuerpoBinario, slugProyecto, carpetaProyecto, resolverEnTrabajo, correr, carpetaTrabajo } = ctx;

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
    if (!/\.(wav|mp3|ogg|flac|aif|aiff|m4a|mid|midi)$/i.test(base)) {
      responderJson(res, 400, { error: "only audio (.wav, .mp3, .ogg, .flac, .aif, .m4a) or MIDI (.mid)" });
      return;
    }
    leerCuerpoBinario(req, 512 * 1024 * 1024, (datos) => {
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
        let destino = resolve(carpeta, base);
        let copia = 2;
        while (!salida && existsSync(destino)) {
          destino = resolve(carpeta, base.replace(/(\.[^.]+)$/, `_${copia++}$1`));
        }
        writeFileSync(destino, datos);
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
      const t0 = Date.now();
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
      anotar(
        ficheroHerramientas,
        JSON.stringify({ t: new Date().toISOString(), tool: "mp3", archivo: d.archivo, ruta: rel, bytes, wav, mp3, problemas, ms: Date.now() - t0 }),
      );
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

  // Measures a reference song (link or file): tempo, key, form.
  server.middlewares.use("/api/referencia/medir", rutaJson<{ origen?: string }>({ metodo: "POST" }, async ({ res, datos }) => {
        const origen = String(datos.origen ?? "").trim();
    if (!origen) {
      responderJson(res, 400, { error: "missing the origin (link or path)" });
      return;
    }
    const r = await correr("codigo/analizar_referencia.py", [origen], 900, { procesos: true }); // yt_dlp and ffmpeg
    if (r.codigo !== 0) {
      const crudo = (r.errores || r.salida).slice(-800);
      // What is missing on the machine, phrased so the agent can ask the person for it.
      const falta = /No module named ['"]?yt_dlp/.test(crudo)
        ? "yt-dlp is missing from the machine's Python: install it with “python -m pip install yt-dlp” (and ffmpeg on the PATH). In the meantime, ask for a link to another source or an audio file."
        : /ffmpeg/i.test(crudo) && /(not found|no se reconoce|No such file)/i.test(crudo)
          ? "ffmpeg is missing from the machine's PATH to decode the audio."
          : "";
      responderJson(res, 400, { error: falta ? `${falta}\n${crudo}` : crudo });
      return;
    }
    responderJson(res, 200, JSON.parse(r.salida));
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

  // verificar_audio: objective metrics of a WAV (do not rewrite analyzers).
  server.middlewares.use("/api/verificar", rutaJson<{ path?: string; timeout_segundos?: number }>({ metodo: "POST" }, async ({ req, res, datos: d }) => {
        const destino = d.path ? resolverEnTrabajo(d.path, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
    if (!destino) {
      responderJson(res, 403, { error: "path outside workspace/" });
      return;
    }
    if (!existsSync(destino)) {
      responderJson(res, 404, { error: "does not exist" });
      return;
    }
    // The tool's limit (180 by default, 1800 at most, as its description says).
    const pedido = Number(d.timeout_segundos);
    const segundos = Number.isFinite(pedido) && pedido > 0 ? Math.min(Math.max(pedido, 10), 1800) : 180;
    const r = await correr("herramientas/verificar_audio.py", [destino], segundos);
    anotar(
      ficheroHerramientas,
      JSON.stringify({ t: new Date().toISOString(), tool: "verificar_audio", path: d.path, codigo: r.codigo }),
    );
    responderJson(res, 200, {
      ok: r.codigo === 0,
      codigo: r.codigo,
      informe: (r.salida + r.errores).slice(-4000),
    });
  }));

  // transcribir_audio: WAV → MIDI with basic-pitch (Spotify, Apache-2.0), on this CPU.
  // The model lives in its own venv (`.miuzika/bp`, outside git) because basic-pitch 0.4
  // pins an old numpy with no Python 3.12 wheel: it is installed with --no-deps and the
  // ONNX runtime (the default backend on Windows). Measured 2-Nov-2026 on the i5-1035G1:
  // 8 s per 2.5-minute stem; on miuzika's own "Stahl" stems (MIDI ground truth) F1 at
  // 50 ms: bass 0.85, guitar riff 0.89 (48 octave errors), synth 0.66. Good for "take the
  // melody from my stem", not a score. Only the user's own or CC audio (LEGAL.md §4).
  // Its path comes from the context (MIUZIKA_BASIC_PITCH in .env, or the default venv).
  server.middlewares.use("/api/transcribir", rutaJson<{ archivo?: string; nombre?: string; bpm?: number }>({ metodo: "POST" }, async ({ req, res, datos: d }) => {
        const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
    const origen = d.archivo ? resolverEnTrabajo(d.archivo, slug) : null;
    if (!origen) {
      responderJson(res, 403, { error: "path outside workspace/" });
      return;
    }
    if (!existsSync(origen)) {
      responderJson(res, 404, { error: `${d.archivo} does not exist` });
      return;
    }
    if (!existsSync(basicPitch)) {
      responderJson(res, 501, {
        error:
          `basic-pitch is not installed (${basicPitch}). Install it once: python -m venv .miuzika/bp && ` +
          ".miuzika/bp/Scripts/pip install --no-deps basic-pitch && .miuzika/bp/Scripts/pip install " +
          "numpy scipy librosa onnxruntime pretty_midi mir_eval resampy mido; or set MIUZIKA_BASIC_PITCH.",
      });
      return;
    }
    const nombre = String(d.nombre ?? basename(origen).replace(/\.[^.]+$/, ""))
      .replace(/[^a-z0-9_-]+/gi, "-")
      .toLowerCase()
      .slice(0, 40) || "transcripcion";
    const carpeta = resolve(carpetaProyecto(slug), "transcripciones");
    mkdirSync(carpeta, { recursive: true });
    const t0 = Date.now();
    // PYTHONUTF8: the CLI prints a unicode banner and dies on the Windows code page without it.
    const r = await correrProceso(basicPitch, argumentosBasicPitch(carpeta, origen, d.bpm), {
      segundos: 300,
      nombre: "basic-pitch",
      cwd: carpetaTrabajo,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    // basic-pitch names the file <stem>_basic_pitch.mid; the project wants <nombre>.mid.
    const base = basename(origen).replace(/\.[^.]+$/, "");
    const escrito = resolve(carpeta, `${base}_basic_pitch.mid`);
    const destino = resolve(carpeta, `${nombre}.mid`);
    if (r.codigo === 0 && existsSync(escrito)) renameSync(escrito, destino);
    const ok = r.codigo === 0 && existsSync(destino);
    anotar(
      ficheroHerramientas,
      JSON.stringify({ t: new Date().toISOString(), tool: "transcribir", archivo: d.archivo, nombre, codigo: r.codigo, ms: Date.now() - t0 }),
    );
    if (!ok) {
      const sobrantes = readdirSync(carpeta).filter((f) => f.endsWith("_basic_pitch.mid"));
      responderJson(res, 500, { ok: false, error: (r.errores || r.salida).slice(-800), sobrantes });
      return;
    }
    responderJson(res, 200, { ok: true, ruta: `transcripciones/${nombre}.mid`, ms: Date.now() - t0 });
  }));
}
