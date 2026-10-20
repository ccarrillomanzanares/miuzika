/** Fase LLM del Sample Lab: prompt → SampleSpec validado. */

import { z } from "zod";
import type { LlmClient } from "./client.ts";
import type { LoopSpec, SampleSpec } from "../core/sample.ts";
import { SAMPLE_ROLE_DESCRIPTION, SampleSpecSchema } from "../core/sample.ts";
import { BASS_STYLES, CHORD_RHYTHMS, DRUM_STYLES } from "../core/patterns.ts";
import { extractJson } from "./planner.ts";

const schema = z.toJSONSchema(SampleSpecSchema) as Record<string, unknown>;
delete schema.$schema;
const SAMPLE_SCHEMA = JSON.stringify(schema);

export const SAMPLE_DESIGNER_SYSTEM = `Eres diseñador de sonido. Recibes una petición y devuelves SOLO un SampleSpec JSON que cumpla exactamente este esquema:

${SAMPLE_SCHEMA}

- one_shot: 1-4 capas. Cada capa tiene osc (sine, saw, square, triangle, noise), freq, glideTo, glide, detune, filter {type, freq, q}, env {attack, decay, sustain, release} y gain. Puedes añadir fx {drive, eq, delay, reverb}. duration en segundos.
- loop: role, style, bars, bpm, key, density, octave, chords, energy. Usa el BPM del proyecto.
- Roles y estilos válidos: ${SAMPLE_ROLE_DESCRIPTION}.
- Para percusión usa capas de sine con glide (bombo/toms) o noise con filtro (caja/charles).
- No expliques nada: solo el JSON.`;

export interface SampleDesignContext {
  bpm: number;
  key: { tonic: string; mode: string };
  kind: "one_shot" | "loop";
  bars: number;
}

function validateLoopStyle(spec: LoopSpec): void {
  if (spec.role === "drums" && !DRUM_STYLES[spec.style]) {
    throw new Error(`Estilo de batería desconocido "${spec.style}". Usa: ${Object.keys(DRUM_STYLES).join(", ")}`);
  }
  if (spec.role === "bass" && !BASS_STYLES[spec.style]) {
    throw new Error(`Estilo de bajo desconocido "${spec.style}". Usa: ${Object.keys(BASS_STYLES).join(", ")}`);
  }
  if ((spec.role === "chords" || spec.role === "pad") && !CHORD_RHYTHMS[spec.style]) {
    throw new Error(`Estilo de acordes desconocido "${spec.style}". Usa: ${Object.keys(CHORD_RHYTHMS).join(", ")}`);
  }
}

export interface SampleDesignOptions {
  attempts?: number;
  temperature?: number;
}

export async function designSample(
  client: LlmClient,
  prompt: string,
  context: SampleDesignContext,
  options: SampleDesignOptions = {},
): Promise<SampleSpec> {
  const attempts = options.attempts ?? 2;
  let lastError: unknown;

  const describe = context.kind === "loop"
    ? `loop de ${context.bars} compases`
    : "one-shot";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const user = [
      `Petición: ${prompt}`,
      `Tipo: ${describe}.`,
      `Proyecto: ${context.bpm} BPM, ${context.key.tonic} ${context.key.mode}.`,
      attempt > 0
        ? `La receta anterior falló: ${lastError instanceof Error ? lastError.message : String(lastError)}. Corrige y devuelve solo el JSON.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.complete({
      messages: [
        { role: "system", content: SAMPLE_DESIGNER_SYSTEM },
        { role: "user", content: user },
      ],
      jsonMode: true,
      temperature: attempt === 0 ? (options.temperature ?? 0.8) : 0.4,
      maxTokens: 2000,
    });

    try {
      const spec = SampleSpecSchema.parse(extractJson(response.content ?? ""));
      if (spec.kind !== context.kind) {
        throw new Error(`Se pidió ${context.kind} y llegó ${spec.kind}`);
      }
      if (spec.kind === "loop") {
        spec.bpm = context.bpm;
        validateLoopStyle(spec);
      }
      return spec;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `No se pudo diseñar el sample: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
