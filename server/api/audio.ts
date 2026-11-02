/** Project audio: upload, serve with Range, waveform peaks, MIDI to notes, measurements of a WAV and of a reference. */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasAudio(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, responderJson, leerCuerpo, leerCuerpoBinario, slugProyecto, carpetaProyecto, resolverEnTrabajo, correr, carpetaTrabajo } = ctx;

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

  // Peaks of a WAV computed on the server: the waveform is drawn without decoding.
  //
  // With a cache keyed by (path, mtime, buckets): each /api/picos launched a Python that
  // read the whole file, and opening a 21-track project with 11 WAVs
  // took 38 s (measured). The WAV only changes if its mtime changes, so the
  // second opening does not read it again.
  const cachePicos = new Map<string, unknown>();
  server.middlewares.use("/api/picos", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
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
  });

  // Measures a reference song (link or file): tempo, key, form.
  server.middlewares.use("/api/referencia/medir", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { origen?: string };
        const origen = String(datos.origen ?? "").trim();
        if (!origen) {
          responderJson(res, 400, { error: "missing the origin (link or path)" });
          return;
        }
        const r = await correr("codigo/analizar_referencia.py", [origen], 900);
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
      } catch (error) {
        responderJson(res, 500, { error: String(error) });
      }
    });
  });

  // Returns the notes of a .mid already normalized to beats (op add_notes).
  server.middlewares.use("/api/midi", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
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
  });

  // verificar_audio: objective metrics of a WAV (do not rewrite analyzers).
  server.middlewares.use("/api/verificar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const d = JSON.parse(cuerpo) as { path?: string };
        const destino = d.path ? resolverEnTrabajo(d.path, slugProyecto(req.headers["x-miuzika-proyecto"])) : null;
        if (!destino) {
          responderJson(res, 403, { error: "path outside workspace/" });
          return;
        }
        if (!existsSync(destino)) {
          responderJson(res, 404, { error: "does not exist" });
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

  // transcribir_audio: WAV → MIDI with basic-pitch (Spotify, Apache-2.0), on this CPU.
  // The model lives in its own venv (`.miuzika/bp`, outside git) because basic-pitch 0.4
  // pins an old numpy with no Python 3.12 wheel: it is installed with --no-deps and the
  // ONNX runtime (the default backend on Windows). Measured 2-Nov-2026 on the i5-1035G1:
  // 8 s per 2.5-minute stem; on miuzika's own "Stahl" stems (MIDI ground truth) F1 at
  // 50 ms: bass 0.85, guitar riff 0.89 (48 octave errors), synth 0.66. Good for "take the
  // melody from my stem", not a score. Only the user's own or CC audio (LEGAL.md §4).
  const basicPitch =
    process.env.MIUZIKA_BASIC_PITCH ||
    resolve(process.cwd(), ".miuzika", "bp", process.platform === "win32" ? "Scripts/basic-pitch.exe" : "bin/basic-pitch");
  server.middlewares.use("/api/transcribir", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const d = JSON.parse(cuerpo) as { archivo?: string; nombre?: string };
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
        const r = await new Promise<{ codigo: number | null; salida: string; errores: string }>((listo) => {
          // PYTHONUTF8: the CLI prints a unicode banner and dies on the Windows code page without it.
          const hijo = spawn(basicPitch, [carpeta, origen, "--model-serialization", "onnx"], {
            cwd: carpetaTrabajo,
            env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
            windowsHide: true,
          });
          let salida = "";
          let errores = "";
          let cerrado = false;
          const terminar = (codigo: number | null): void => {
            if (cerrado) return;
            cerrado = true;
            clearTimeout(temporizador);
            listo({ codigo, salida, errores });
          };
          const temporizador = setTimeout(() => {
            if (hijo.pid) {
              if (process.platform === "win32") spawn("taskkill", ["/PID", String(hijo.pid), "/T", "/F"]);
              else hijo.kill("SIGKILL");
            }
            errores += "\n[miuzika] basic-pitch cut off after 300 s\n";
            setTimeout(() => terminar(null), 2000);
          }, 300_000);
          hijo.stdout.on("data", (t: Buffer) => { salida += t.toString("utf8"); });
          hijo.stderr.on("data", (t: Buffer) => { errores += t.toString("utf8"); });
          hijo.on("close", (codigo) => terminar(codigo));
          hijo.on("error", (error) => { errores += error.message; terminar(null); });
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
      } catch (error) {
        responderJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}
