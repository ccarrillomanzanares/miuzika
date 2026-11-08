/**
 * "To MIDI": an audio clip to MIDI notes with Basic Pitch, on this machine (8-Nov-2026).
 *
 * Basic Pitch lives in its own venv in `.miuzika/basic-pitch/` (outside git and outside workspace/, like the keys), made the
 * first time it is asked for. Its PyPI metadata asks for tensorflow<2.15.1 on Python >= 3.11, which has no wheel for 3.12
 * (measured 8-Nov on this laptop): it is installed --no-deps with the bundled ONNX model's runtime and the versions that
 * ran here that day.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { correrProceso } from "../proceso.ts";

const VERSION = "basic-pitch==0.4.0";
/** What ran on 8-Nov (pip freeze of the trial venv). setuptools<81: resampy imports pkg_resources. */
const DEPENDENCIAS = [
  "onnxruntime==1.31.1", "librosa==1.0.0", "pretty_midi==0.2.11.post0", "resampy==0.4.2", "scikit-learn==1.9.1",
  "scipy==1.18.1", "numpy==2.5.4", "mir_eval==0.8.2", "soundfile==0.14.0", "mido==1.3.3", "numba==0.68.1",
  "llvmlite==0.50.0", "typing_extensions==4.16.0", "setuptools<81",
];

const TIPOS = new Set(["bajo", "melodia", "acordes", "otro"]);
const SENSIBILIDADES = new Set(["baja", "media", "alta"]);

interface Peticion {
  ruta?: string;
  desde?: number;
  duracion?: number | null;
  bpm?: number;
  tipo?: string;
  sensibilidad?: string;
  minimoMs?: number;
  rejilla?: number;
  programa?: number;
  nombre?: string;
}

export function rutasTranscribir(server: ViteDevServer, ctx: Contexto): void {
  const { rutaJson, responderJson, slugProyecto, carpetaProyecto, resolverEnTrabajo, carpetaTrabajo } = ctx;
  const interprete = process.env.MIUZIKA_PYTHON || "python";
  const carpetaVenv = resolve(process.cwd(), ".miuzika", "basic-pitch");
  const python = process.platform === "win32" ? join(carpetaVenv, "Scripts", "python.exe") : join(carpetaVenv, "bin", "python");
  const marca = join(carpetaVenv, `.ok-${VERSION}`);
  let instalando: Promise<string | null> | null = null;

  /** Makes the venv once; resolves with an error text, or null when ready. */
  function preparar(): Promise<string | null> {
    if (existsSync(marca)) return Promise.resolve(null);
    instalando ??= (async () => {
      mkdirSync(carpetaVenv, { recursive: true });
      const pasos: string[][] = [
        [interprete, "-m", "venv", carpetaVenv],
        [python, "-m", "pip", "install", "--disable-pip-version-check", "-q", "--no-deps", VERSION],
        [python, "-m", "pip", "install", "--disable-pip-version-check", "-q", ...DEPENDENCIAS],
      ];
      for (const [comando, ...args] of pasos) {
        const r = await correrProceso(comando!, args, { segundos: 900, nombre: "basic-pitch install", windowsHide: true });
        if (r.errorArranque) return `Python is not on the server's PATH (${r.errorArranque}).`;
        if (r.codigo !== 0) return `Installing Basic Pitch failed: ${r.errores.slice(-600)}`;
      }
      writeFileSync(marca, new Date().toISOString());
      return null;
    })().finally(() => {
      instalando = null;
    });
    return instalando;
  }

  server.middlewares.use("/api/transcribir/estado", rutaJson({ metodo: "GET" }, async ({ res }) => {
    responderJson(res, 200, { ok: true, instalado: existsSync(marca) });
  }));

  server.middlewares.use(
    "/api/transcribir",
    rutaJson<Peticion>({ metodo: "POST" }, async ({ req, res, datos: d }) => {
      const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
      const audio = d.ruta ? resolverEnTrabajo(d.ruta, slug) : null;
      if (!audio || !existsSync(audio)) {
        responderJson(res, 400, { ok: false, error: `${d.ruta ?? "the audio"} is not in the project folder` });
        return;
      }
      if (!d.tipo || !TIPOS.has(d.tipo)) {
        responderJson(res, 400, { ok: false, error: "kind: bajo, melodia, acordes or otro" });
        return;
      }
      if (!(typeof d.bpm === "number" && d.bpm >= 20 && d.bpm <= 300)) {
        responderJson(res, 400, { ok: false, error: "bpm from 20 to 300" });
        return;
      }
      const nombre = String(d.nombre ?? "transcripcion").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "transcripcion";
      const fallo = await preparar();
      if (fallo) {
        responderJson(res, 500, { ok: false, error: fallo });
        return;
      }
      const salidaMid = resolve(carpetaProyecto(slug), "generado", `${nombre}.mid`);
      const temporal = mkdtempSync(join(tmpdir(), "miuzika-bp-"));
      const parametros = join(temporal, "p.json");
      writeFileSync(parametros, JSON.stringify({
        audio, desde: d.desde ?? 0, duracion: d.duracion ?? null, bpm: d.bpm, tipo: d.tipo,
        sensibilidad: SENSIBILIDADES.has(d.sensibilidad ?? "") ? d.sensibilidad : "media", minimo_ms: d.minimoMs ?? 127.7,
        rejilla: d.rejilla ?? 0, programa: d.programa ?? 0, nombre, salida_mid: salidaMid,
      }));
      const control = new AbortController();
      res.on("close", () => control.abort());
      const r = await correrProceso(python, ["-I", resolve(carpetaTrabajo, "herramientas", "transcribir.py"), parametros], {
        segundos: 600, nombre: "transcribir.py", windowsHide: true, senal: control.signal,
      });
      rmSync(temporal, { recursive: true, force: true });
      if (r.cancelado) return;
      const linea = r.salida.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      if (r.codigo !== 0 || !linea) {
        responderJson(res, 500, { ok: false, error: `Basic Pitch failed: ${r.errores.slice(-800)}` });
        return;
      }
      const datos = JSON.parse(linea) as { error?: string };
      if (datos.error) {
        responderJson(res, 400, { ok: false, error: datos.error });
        return;
      }
      responderJson(res, 200, { ok: true, mid: `generado/${nombre}.mid`, ...datos });
    }),
  );
}
