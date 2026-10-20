/** Fase de planificación de samples: petición libre → lista de samples a renderizar. */

import { z } from "zod";
import type { LlmClient } from "./client.ts";
import { extractJson } from "./planner.ts";

export const SampleRequestSchema = z.object({
  prompt: z.string().min(1).max(300).describe("Descripción para el diseñador de sonido"),
  name: z.string().min(1).max(60).describe("Nombre corto del sample"),
  track: z.string().min(1).max(60).describe("Pista de audio donde se insertará"),
  kind: z.enum(["one_shot", "loop"]).describe("loop para partes que se repiten; one_shot para golpes"),
  bars: z.number().int().min(1).max(8).default(2).describe("Compases si es loop"),
  role: z
    .enum(["drums", "bass", "chords", "lead", "arp", "pad"])
    .optional()
    .describe("Rol musical del loop"),
});

export const SamplePlanSchema = z.object({
  samples: z.array(SampleRequestSchema).min(1).max(8),
});

export type SampleRequest = z.infer<typeof SampleRequestSchema>;

const schema = z.toJSONSchema(SamplePlanSchema) as Record<string, unknown>;
delete schema.$schema;

export const SAMPLE_PLANNER_SYSTEM = `Eres un compositor y productor de música.

Extrae de la petición los samples que hay que crear. Devuelve SOLO JSON con este esquema:

${JSON.stringify(schema)}

Reglas:
- Un sample por instrumento o sonido pedido; no inventes samples que no se mencionen.
- Si dice "lo mismo para batería y bajo", crea samples separados para batería y bajo con el mismo carácter.
- prompt describe el sonido para el diseñador (instrumento, estilo, carácter, articulación).
- name y track pueden coincidir; usa nombres cortos y claros.
- Para batería, bajo y partes de sintetizador que deban sonar durante la canción, usa kind "loop".
- Usa kind "one_shot" solo para golpes, impactos, risers o efectos puntuales.
- En loops, elige role (drums, bass, chords, lead, arp, pad) y bars entre 1 y 8.
- Respeta el BPM y la tonalidad del proyecto.
- No expliques nada: solo el JSON.`;

export interface SamplePlanContext {
  bpm: number;
  key: { tonic: string; mode: string };
  tracks?: string[];
  lengthBars?: number;
}

export async function planSamples(
  client: LlmClient,
  prompt: string,
  context: SamplePlanContext,
  attempts = 2,
): Promise<SampleRequest[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const user = [
      `Petición: ${prompt}`,
      `Proyecto: ${context.bpm} BPM, ${context.key.tonic} ${context.key.mode}, ${context.lengthBars ?? 32} compases.`,
      context.tracks && context.tracks.length > 0
        ? `Pistas actuales: ${context.tracks.join(", ")}.`
        : "El proyecto no tiene pistas.",
      attempt > 0
        ? `La respuesta anterior falló: ${lastError instanceof Error ? lastError.message : String(lastError)}. Corrige y devuelve solo el JSON.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.complete({
      messages: [
        { role: "system", content: SAMPLE_PLANNER_SYSTEM },
        { role: "user", content: user },
      ],
      jsonMode: true,
      temperature: attempt === 0 ? 0.3 : 0.1,
      maxTokens: 1500,
    });

    try {
      const plan = SamplePlanSchema.parse(extractJson(response.content ?? ""));
      return plan.samples;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `No se pudo planificar los samples: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
