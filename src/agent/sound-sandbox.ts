/** Puente Node → contenedor Docker aislado que ejecuta scripts Python de sonido. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const IMAGE = process.env.MIUZIKA_SOUND_IMAGE ?? "miuzika-sound-sandbox";
const TIMEOUT_MS = 120_000;
const MAX_CODE = 50_000;
const MAX_OUTPUT = 16 * 1024 * 1024;
const CACHE_LIMIT = 32;

export interface SoundScriptRequest {
  code: string;
  duration: number;
  sampleRate?: number;
  params?: Record<string, unknown>;
  seed?: number;
}

export interface SoundScriptResult {
  wav: Buffer;
  duration: number;
  sampleRate: number;
  channels: number;
  frames: number;
  peakDbfs: number;
  rmsDbfs: number;
  cached: boolean;
}

const cache = new Map<string, SoundScriptResult>();

function dockerInvocation(): { command: string; args: string[] } {
  const args = [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--user",
    "65534:65534",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--pids-limit",
    "64",
    IMAGE,
  ];
  if (process.platform === "win32") {
    return {
      command: "wsl",
      args: ["-d", process.env.MIUZIKA_WSL_DISTRO ?? "Ubuntu", "--", "docker", ...args],
    };
  }
  return { command: "docker", args };
}

function cacheKey(request: SoundScriptRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        code: request.code,
        duration: request.duration,
        sampleRate: request.sampleRate ?? 48_000,
        params: request.params ?? {},
        seed: request.seed ?? 1,
      }),
    )
    .digest("hex");
}

export async function renderSoundScript(
  request: SoundScriptRequest,
): Promise<SoundScriptResult> {
  const code = request.code.trim();
  if (!code) throw new Error("El script está vacío");
  if (code.length > MAX_CODE) throw new Error(`El script supera ${MAX_CODE} caracteres`);
  if (!Number.isFinite(request.duration) || request.duration < 0.05 || request.duration > 32) {
    throw new Error("Duración fuera de rango (0.05–32 s)");
  }
  const sampleRate = request.sampleRate ?? 48_000;
  if (sampleRate !== 44_100 && sampleRate !== 48_000) {
    throw new Error("sampleRate debe ser 44100 o 48000");
  }

  const key = cacheKey({ ...request, code, sampleRate });
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const payload = JSON.stringify({
    code,
    duration: request.duration,
    sampleRate,
    params: request.params ?? {},
    seed: request.seed ?? 1,
  });
  const { command, args } = dockerInvocation();

  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let outputSize = 0;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error("El sandbox agotó el tiempo (120 s)")));
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > MAX_OUTPUT) {
          child.kill("SIGKILL");
          finish(() => reject(new Error("La salida del sandbox es demasiado grande")));
          return;
        }
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        finish(() =>
          reject(
            new Error(
              `No se pudo ejecutar el sandbox (${command}). ¿Está Docker/WSL disponible? ${error.message}`,
            ),
          ),
        );
      });
      child.on("close", (code) => {
        finish(() => resolve({ stdout, stderr, code }));
      });

      child.stdin.end(payload);
    },
  );

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(
      `El sandbox no devolvió JSON (exit ${result.code}). ${result.stderr.slice(0, 300)}`,
    );
  }
  if (data.ok !== true) {
    throw new Error(`Sandbox: ${String(data.error ?? (result.stderr || "error desconocido"))}`);
  }
  const wav = Buffer.from(String(data.wav ?? ""), "base64");
  if (wav.length < 44) throw new Error("El sandbox devolvió un WAV vacío");
  const value: SoundScriptResult = {
    wav,
    duration: Number(data.duration),
    sampleRate: Number(data.sampleRate),
    channels: Number(data.channels),
    frames: Number(data.frames),
    peakDbfs: Number(data.peakDbfs),
    rmsDbfs: Number(data.rmsDbfs),
    cached: false,
  };
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}
