/** Render de una pista MIDI con el motor Python Rendered dentro del contenedor. */

import { spawn } from "node:child_process";

const IMAGE = process.env.MIUZIKA_SOUND_IMAGE ?? "miuzika-sound-sandbox";
const TIMEOUT_MS = 300_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

export interface RenderedTrackNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface RenderedTrackClip {
  start: number;
  length: number;
  notes: RenderedTrackNote[];
}

export interface RenderedTrackRequest {
  bpm: number;
  lengthBars: number;
  track: {
    name: string;
    instrument: string;
    gainDb: number;
    pan: number;
    clips: RenderedTrackClip[];
  };
}

export interface RenderedTrackResult {
  wav: Buffer;
  duration: number;
  sampleRate: number;
  channels: number;
  frames: number;
  notes: number;
  peakDbfs: number;
  rmsDbfs: number;
}

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
    "1g",
    "--cpus",
    "1",
    "--pids-limit",
    "64",
    IMAGE,
    "/app/render_track.py",
  ];
  if (process.platform === "win32") {
    return {
      command: "wsl",
      args: ["-d", process.env.MIUZIKA_WSL_DISTRO ?? "Ubuntu", "--", "docker", ...args],
    };
  }
  return { command: "docker", args };
}

export async function renderRenderedTrack(
  request: RenderedTrackRequest,
): Promise<RenderedTrackResult> {
  if (!request.track || !Array.isArray(request.track.clips)) {
    throw new Error("Pista inválida para Rendered");
  }
  if (!Number.isFinite(request.bpm) || request.bpm < 20 || request.bpm > 300) {
    throw new Error("BPM inválido");
  }
  if (!Number.isInteger(request.lengthBars) || request.lengthBars < 1) {
    throw new Error("lengthBars inválido");
  }

  const payload = JSON.stringify(request);
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
        finish(() => reject(new Error("Rendered agotó el tiempo (300 s)")));
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > MAX_OUTPUT) {
          child.kill("SIGKILL");
          finish(() => reject(new Error("La salida de Rendered es demasiado grande")));
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
              `No se pudo ejecutar Rendered (${command}). ¿Docker/WSL disponible? ${error.message}`,
            ),
          ),
        );
      });
      child.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));
      child.stdin.end(payload);
    },
  );

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Rendered no devolvió JSON (exit ${result.code}). ${result.stderr.slice(0, 300)}`,
    );
  }
  if (data.ok !== true) {
    throw new Error(`Rendered: ${String(data.error ?? (result.stderr || "error desconocido"))}`);
  }
  const wav = Buffer.from(String(data.wav ?? ""), "base64");
  if (wav.length < 44) throw new Error("Rendered devolvió un WAV vacío");
  return {
    wav,
    duration: Number(data.duration),
    sampleRate: Number(data.sampleRate),
    channels: Number(data.channels),
    frames: Number(data.frames),
    notes: Number(data.notes),
    peakDbfs: Number(data.peakDbfs),
    rmsDbfs: Number(data.rmsDbfs),
  };
}
