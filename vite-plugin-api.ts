/** API local del spike: mantiene la clave del LLM en el servidor. */

import type { IncomingMessage, ServerResponse } from "node:http";
import process from "node:process";
import type { Plugin } from "vite";

import { clientFromEnv, plannerClientFromEnv } from "./src/agent/client.ts";
import { composeFromPrompt, runAgent } from "./src/agent/agent.ts";
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
    if (!prompt) return sendJson(res, 400, { error: "La petición está vacía" });

    if (url === "/api/generate") {
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

    if (url === "/api/chat") {
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
