/** Fase 1: el LLM propone un plan de canción (JSON) que validamos con zod. */

import type { LlmClient } from "./client.ts";
import { PLANNER_SYSTEM, plannerMessage } from "./prompts.ts";
import type { SongPlan } from "../core/plan.ts";
import { normalizePlan, parseSongPlan, validatePlan } from "../core/plan.ts";
import type { PromptConstraints } from "../core/parse.ts";
import { checkConstraints, describeConstraints } from "../core/parse.ts";

export function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`La respuesta no contiene un objeto JSON: ${cleaned.slice(0, 200)}`);
  }
}

export interface PlanOptions {
  attempts?: number;
  temperature?: number;
  constraints?: PromptConstraints;
}

/**
 * Tres capas de control sobre el modelo:
 *  1. zod: forma del plan
 *  2. normalizePlan: sinónimos de parámetros y rangos
 *  3. validatePlan + checkConstraints: música y requisitos del usuario
 * Si algo falla, el error vuelve al modelo como feedback y se reintenta.
 */
export async function planSong(client: LlmClient, prompt: string, options: PlanOptions = {}): Promise<SongPlan> {
  const attempts = options.attempts ?? 2;
  const constraintsText = options.constraints ? describeConstraints(options.constraints) : "";
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const base = plannerMessage(prompt, constraintsText || undefined);
    const user =
      attempt === 0
        ? base
        : `${base}\n\nTu plan anterior fue rechazado por estos motivos:\n${
            lastError instanceof Error ? lastError.message : String(lastError)
          }\nCorrige exactamente esos puntos y devuelve SOLO el JSON.`;

    const response = await client.complete({
      messages: [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: user },
      ],
      jsonMode: true,
      temperature: attempt === 0 ? (options.temperature ?? 0.8) : 0.4,
      reasoningEffort: "low",
      // 68 compases + 7 pistas + secciones no caben en los 4k anteriores.
      maxTokens: 12_000,
    });

    try {
      const finish = (response.raw as { choices?: Array<{ finish_reason?: string }> })
        ?.choices?.[0]?.finish_reason;
      if (!response.content?.trim()) {
        throw new Error(
          finish === "length"
            ? "El plan se cortó por límite de tokens. Reduce el detalle o sube maxTokens."
            : "El LLM no devolvió contenido para el plan.",
        );
      }
      if (finish === "length") {
        throw new Error("El plan se cortó por límite de tokens. Reduce el detalle o sube maxTokens.");
      }
      const plan = normalizePlan(parseSongPlan(extractJson(response.content)));
      const issues = [
        ...validatePlan(plan),
        ...(options.constraints ? checkConstraints(plan, options.constraints) : []),
      ];
      if (issues.length > 0) throw new Error(issues.map((issue) => `- ${issue}`).join("\n"));
      return plan;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `No se pudo obtener un plan válido tras ${attempts} intentos: ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}
