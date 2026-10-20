/** API local del spike: mantiene la clave del LLM en el servidor. */

import type { IncomingMessage, ServerResponse } from "node:http";
import process from "node:process";
import type { Plugin } from "vite";

import { clientFromEnv, plannerClientFromEnv } from "./src/agent/client.ts";
import { composeFromPrompt, runAgent } from "./src/agent/agent.ts";
import { designSample } from "./src/agent/sample-designer.ts";
import { planSamples } from "./src/agent/sample-plan.ts";
import { renderSoundScript } from "./src/agent/sound-sandbox.ts";
import { designSoundScript } from "./src/agent/sound-script.ts";
import { renderRenderedTrack } from "./src/agent/rendered-track.ts";
import { MIDI_ENABLED } from "./src/config.ts";
import { createProject } from "./src/core/project.ts";
import type { Project } from "./src/core/types.ts";

const MAX_BODY = 8 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  let payload: string;
  try {
    payload = JSON.stringify(body);
  } catch {
    payload = JSON.stringify({ error: "No se pudo serializar la respuesta" });
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("La petición es demasiado grande"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", () => reject(new Error("Error leyendo la petición")));
  });
}

async function handler(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
): Promise<void> {
  const started = Date.now();
  const url = (req.url ?? "").split("?")[0] ?? "";
  if (!url.startsWith("/api/")) return next();

  res.on("finish", () => {
    if (url !== "/api/health") {
      console.log(`[miuzika api] ${url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  if (url === "/api/health") {
    const client = clientFromEnv();
    return sendJson(res, 200, { ok: true, llm: Boolean(client), model: client?.model ?? null });
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Método no permitido" });

  try {
    const body = await readJson(req);
    const prompt = String(body.prompt ?? "").trim();

    if (url === "/api/generate") {
      if (!MIDI_ENABLED) {
        return sendJson(res, 409, { error: "El modo MIDI está aparcado. Pide samples." });
      }
      if (!prompt) return sendJson(res, 400, { error: "La petición está vacía" });
      const planner = plannerClientFromEnv();
      if (!planner) {
        return sendJson(res, 503, {
          error: "Falta OLLAMA_API_KEY. Copia .env.example a .env y pon tu clave de Ollama Cloud.",
        });
      }
      const seed = Number(body.seed) || Math.floor(Math.random() * 1_000_000_000);
      const composed = await composeFromPrompt({
        planner,
        prompt,
        project: createProject({ prompt, seed }),
      });
      return sendJson(res, 200, {
        project: composed.project,
        plan: composed.plan,
        warnings: composed.warnings,
        model: planner.model,
        seed,
      });
    }

    if (url === "/api/rendered/track") {
      const project = body.project as Project | undefined;
      const trackId = String(body.trackId ?? "");
      const track = project?.tracks.find((candidate) => candidate.id === trackId);
      if (!project || !track || track.kind !== "midi") {
        return sendJson(res, 400, { error: "Pista MIDI no encontrada" });
      }
      const result = await renderRenderedTrack({
        bpm: project.bpm,
        lengthBars: project.lengthBars,
        track: {
          name: track.name,
          instrument: track.instrument.type,
          gainDb: track.gainDb,
          pan: track.pan,
          clips: track.clips.map((clip) => ({
            start: clip.start,
            length: clip.length,
            notes: clip.notes.map((note) => ({
              pitch: note.pitch,
              start: note.start,
              duration: note.duration,
              velocity: note.velocity,
            })),
          })),
        },
      });
      return sendJson(res, 200, { ...result, wav: result.wav.toString("base64") });
    }

    if (url === "/api/sound/create") {
      if (!prompt) return sendJson(res, 400, { error: "Describe el sonido que quieres" });
      const client = clientFromEnv(undefined, { timeoutMs: 300_000 });
      if (!client) return sendJson(res, 503, { error: "Falta OLLAMA_API_KEY en .env" });
      const duration = Math.min(32, Math.max(0.1, Number(body.duration) || 2.4));
      const sampleRate = Number(body.sampleRate) === 44_100 ? 44_100 : 48_000;
      const seed = Number(body.seed) || 1;
      const params =
        body.params && typeof body.params === "object"
          ? (body.params as Record<string, unknown>)
          : {};
      let previousError: string | undefined;
      let lastCode = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const designed = await designSoundScript(client, prompt, {
            duration,
            sampleRate,
            seed,
            previousError,
            ...(body.bpm ? { bpm: Number(body.bpm) } : {}),
            ...(body.key ? { key: body.key as { tonic: string; mode: string } } : {}),
          });
          lastCode = designed.code;
          const rendered = await renderSoundScript({
            code: designed.code,
            duration,
            sampleRate,
            params,
            seed,
          });
          return sendJson(res, 200, {
            ...rendered,
            wav: rendered.wav.toString("base64"),
            code: designed.code,
            model: designed.model,
            attempts: attempt + 1,
          });
        } catch (error) {
          previousError = error instanceof Error ? error.message : String(error);
        }
      }
      return sendJson(res, 422, {
        error: `No se pudo generar el sonido: ${previousError ?? "error desconocido"}`,
        code: lastCode,
      });
    }

    if (url === "/api/sound/render") {
      const code = String(body.code ?? "");
      if (!code) return sendJson(res, 400, { error: "Falta el script Python" });
      const result = await renderSoundScript({
        code,
        duration: Number(body.duration) || 2,
        ...(body.sampleRate ? { sampleRate: Number(body.sampleRate) } : {}),
        ...(body.params && typeof body.params === "object"
          ? { params: body.params as Record<string, unknown> }
          : {}),
        ...(body.seed !== undefined ? { seed: Number(body.seed) } : {}),
      });
      return sendJson(res, 200, { ...result, wav: result.wav.toString("base64") });
    }

    if (url === "/api/sample/plan") {
      if (!prompt) return sendJson(res, 400, { error: "La petición está vacía" });
      const client = clientFromEnv();
      if (!client) return sendJson(res, 503, { error: "Falta OLLAMA_API_KEY en .env" });
      const project = body.project as Project | undefined;
      const key =
        project && typeof project.key?.tonic === "string" && typeof project.key?.mode === "string"
          ? project.key
          : { tonic: "D", mode: "minor" as const };
      const samples = await planSamples(client, prompt, {
        bpm: project?.bpm ?? 100,
        key,
        tracks: project?.tracks.filter((track) => track.kind === "audio").map((track) => track.name),
        lengthBars: project?.lengthBars,
      });
      return sendJson(res, 200, { samples, model: client.model });
    }

    if (url === "/api/sample/design") {
      const client = clientFromEnv();
      if (!client) return sendJson(res, 503, { error: "Falta OLLAMA_API_KEY en .env" });
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) return sendJson(res, 400, { error: "Describe el sample que quieres" });

      const kind = body.kind === "loop" ? "loop" : "one_shot";
      const rawKey = body.key as { tonic?: unknown; mode?: unknown } | undefined;
      const key =
        rawKey && typeof rawKey.tonic === "string" && typeof rawKey.mode === "string"
          ? { tonic: rawKey.tonic, mode: rawKey.mode }
          : { tonic: "D", mode: "minor" };
      const bpm = Number(body.bpm) || 120;
      const bars = Math.min(8, Math.max(1, Number(body.bars) || 2));

      const spec = await designSample(client, prompt, { bpm, key, kind, bars });
      return sendJson(res, 200, { spec, model: client.model });
    }

    if (url === "/api/chat") {
      if (!MIDI_ENABLED) {
        return sendJson(res, 409, { error: "El modo MIDI está aparcado. Pide samples." });
      }
      if (!prompt) return sendJson(res, 400, { error: "La petición está vacía" });
      const client = clientFromEnv();
      if (!client) return sendJson(res, 503, { error: "Falta OLLAMA_API_KEY en .env" });
      const project = body.project as Project | undefined;
      if (!project || project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
        return sendJson(res, 400, { error: "Proyecto inválido" });
      }
      const result = await runAgent({ client, project, prompt });
      return sendJson(res, 200, {
        project: result.project,
        text: result.finalText,
        toolLog: result.toolLog.map((entry) => ({ name: entry.name, ok: entry.ok })),
        usage: result.usage,
        steps: result.steps,
        model: client.model,
      });
    }

    return sendJson(res, 404, { error: "Ruta no encontrada" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[miuzika api]", message);
    return sendJson(res, 500, { error: message });
  }
}

export function miuzikaApi(): Plugin {
  return {
    name: "miuzika-api",
    config() {
      try {
        process.loadEnvFile(".env");
      } catch {
        // .env opcional
      }
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
