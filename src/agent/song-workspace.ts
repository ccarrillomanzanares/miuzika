/** Workspace de canción: ficheros, Python y métricas del render. */

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve("out/song-jobs");
const WORKER = path.resolve("song-worker");
const RENDERED = path.resolve("rendered");
const MAX_WRITE = 200_000;
const MAX_READ = 120_000;
const MAX_OUTPUT = 80_000;
const PYTHON_TIMEOUT = 900_000;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface WavMetrics {
  file: string;
  duration: number;
  sampleRate: number;
  channels: number;
  frames: number;
  peakDbfs: number;
  rmsDbfs: number;
  clipped: number;
  bytes: number;
}

export class SongWorkspace {
  readonly dir: string;
  readonly out: string;
  readonly id: string;

  private constructor(id: string) {
    this.id = id;
    this.dir = path.join(ROOT, id);
    this.out = path.join(this.dir, "out");
  }

  static async create(id: string): Promise<SongWorkspace> {
    const workspace = new SongWorkspace(id);
    await mkdir(workspace.out, { recursive: true });
    await copyFile(path.join(WORKER, "render_song.py"), path.join(workspace.dir, "render_song.py"));
    await copyFile(path.join(WORKER, "bundle.py"), path.join(workspace.dir, "bundle.py"));
    await copyFile(path.join(WORKER, "template", "song_data.py"), path.join(workspace.dir, "song_data.py"));
    await writeFile(
      path.join(workspace.dir, "README_SONG.md"),
      [
        "# Workspace de canción",
        "",
        "El renderer es `render_song.py`; no lo reescribas.",
        "La composición vive en `song_data.py`. Usa `song_data.py` como plantilla.",
        "Los artefactos se escriben en `out/`.",
        "",
        "Flujo recomendado:",
        "1. `python song_data.py` para validar.",
        "2. `python render_song.py --bars 1 8 --out out` para una prueba corta.",
        "3. `python render_song.py --out out` para la canción completa.",
        "4. `python bundle.py --out out` para crear el `.miuzika.zip`.",
        "",
        "RAM limitada: no cargues stems ni WAV completos en memoria.",
      ].join("\n"),
      "utf8",
    );
    return workspace;
  }

  private safe(relative: string): string {
    if (!relative || path.isAbsolute(relative)) throw new Error("Ruta inválida");
    const resolved = path.resolve(this.dir, relative);
    if (!resolved.startsWith(this.dir + path.sep)) throw new Error("Ruta fuera del workspace");
    return resolved;
  }

  async write(relative: string, content: string): Promise<string> {
    if (content.length > MAX_WRITE) throw new Error(`El archivo supera ${MAX_WRITE} caracteres`);
    const target = this.safe(relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return `${relative}: ${content.length} caracteres`;
  }

  async read(relative: string): Promise<string> {
    const content = await readFile(this.safe(relative), "utf8");
    return content.length > MAX_READ
      ? `${content.slice(0, MAX_READ)}\n… (recortado, ${content.length} caracteres)`
      : content;
  }

  async list(): Promise<string> {
    const walk = async (dir: string, prefix = ""): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const rows: string[] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          rows.push(`${relative}/`);
          if (relative !== "out" && rows.length < 80) rows.push(...(await walk(path.join(dir, entry.name), relative)));
        } else {
          const info = await stat(path.join(dir, entry.name));
          rows.push(`${relative} (${info.size} B)`);
        }
        if (rows.length > 120) break;
      }
      return rows;
    };
    return (await walk(this.dir)).slice(0, 120).join("\n");
  }

  async runPython(args: string[]): Promise<RunResult> {
    const allowed = new Set(["render_song.py", "bundle.py", "song_data.py"]);
    if (args.length === 0 || !allowed.has(args[0]!)) {
      throw new Error("Solo se puede ejecutar song_data.py, render_song.py o bundle.py");
    }
    if (args.some((arg) => arg.includes("..") || path.isAbsolute(arg))) {
      throw new Error("Argumento de ruta no permitido");
    }
    return new Promise((resolve, reject) => {
      const child = spawn("python", args, {
        cwd: this.dir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          MIUZIKA_RENDERED: RENDERED,
          MIUZIKA_OUT: this.out,
          PYTHONUTF8: "1",
        },
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        finish(() => resolve({ code: null, stdout, stderr, timedOut: true }));
      }, PYTHON_TIMEOUT);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) => finish(() => resolve({ code, stdout, stderr, timedOut })));
    });
  }

  async metrics(relative = "out"): Promise<WavMetrics[]> {
    const target = this.safe(relative);
    const info = await stat(target);
    const files: string[] = [];
    if (info.isDirectory()) {
      for (const name of await readdir(target)) {
        if (name.toLowerCase().endsWith(".wav") && !name.startsWith("_")) {
          files.push(path.join(target, name));
        }
      }
    } else if (target.toLowerCase().endsWith(".wav")) {
      files.push(target);
    }
    const result: WavMetrics[] = [];
    for (const file of files.slice(0, 8)) result.push(await measureWav(file));
    return result;
  }

  async artifacts(): Promise<Array<{ path: string; bytes: number }>> {
    const rows: Array<{ path: string; bytes: number }> = [];
    const walk = async (dir: string, prefix = ""): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (rows.length >= 80) return;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "_stems_tmp") continue;
          await walk(absolute, relative);
        } else {
          rows.push({ path: relative, bytes: (await stat(absolute)).size });
        }
      }
    };
    await walk(this.out);
    return rows;
  }

  async findBundle(): Promise<string | null> {
    const rows = await this.artifacts();
    return rows.find((row) => row.path.toLowerCase().endsWith(".miuzika.zip"))?.path ?? null;
  }
}

function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

export async function measureWav(file: string): Promise<WavMetrics> {
  const buffer = await readFile(file);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("No es un WAV RIFF");
  }
  let offset = 12;
  let channels = 2;
  let sampleRate = 44_100;
  let bits = 16;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = readU32(buffer, offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = readU32(buffer, body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = Math.min(size, buffer.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (bits !== 16 || dataOffset === 0) throw new Error("Solo se miden WAV PCM 16-bit");
  const frames = Math.floor(dataSize / (channels * 2));
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let index = 0; index < frames * channels; index++) {
    const value = buffer.readInt16LE(dataOffset + index * 2) / 32768;
    const absolute = Math.abs(value);
    if (absolute > peak) peak = absolute;
    if (absolute >= 0.9999) clipped++;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / Math.max(1, frames * channels));
  return {
    file,
    duration: frames / sampleRate,
    sampleRate,
    channels,
    frames,
    peakDbfs: 20 * Math.log10(Math.max(peak, 1e-12)),
    rmsDbfs: 20 * Math.log10(Math.max(rms, 1e-12)),
    clipped,
    bytes: buffer.length,
  };
}
