/** Receta de sample: el LLM describe el sonido, el motor lo renderiza a WAV. */

import { z } from "zod";
import { MODE_NAMES } from "./theory.ts";

const KeySchema = z.object({
  tonic: z.string().min(1).max(4),
  mode: z.enum(MODE_NAMES),
});

const EnvelopeSchema = z.object({
  attack: z.number().min(0).max(2),
  decay: z.number().min(0).max(2),
  sustain: z.number().min(0).max(1),
  release: z.number().min(0).max(2),
});

const FilterSchema = z.object({
  type: z.enum(["lowpass", "highpass", "bandpass"]),
  freq: z.number().min(20).max(20_000),
  q: z.number().min(0.1).max(20).default(1),
});

const LayerSchema = z.object({
  osc: z.enum(["sine", "saw", "square", "triangle", "noise"]),
  freq: z.number().min(20).max(20_000).optional().describe("Frecuencia inicial en Hz"),
  glideTo: z.number().min(20).max(20_000).optional(),
  glide: z.number().min(0).max(2).optional(),
  detune: z.number().min(-100).max(100).optional(),
  filter: FilterSchema.optional(),
  env: EnvelopeSchema,
  gain: z.number().min(0).max(1).default(0.7),
});

const FxSchema = z.object({
  drive: z.number().min(0).max(1).optional(),
  eq: z
    .object({ low: z.number().min(-18).max(18), mid: z.number().min(-18).max(18), high: z.number().min(-18).max(18) })
    .optional(),
  delay: z
    .object({
      time: z.number().min(0.02).max(1.5),
      feedback: z.number().min(0).max(0.9),
      wet: z.number().min(0).max(1),
    })
    .optional(),
  reverb: z
    .object({ wet: z.number().min(0).max(1), decay: z.number().min(0).max(1) })
    .optional(),
});

export const OneShotSchema = z.object({
  kind: z.literal("one_shot"),
  name: z.string().min(1).max(60),
  duration: z.number().min(0.05).max(8),
  layers: z.array(LayerSchema).min(1).max(4),
  fx: FxSchema.optional(),
  gainDb: z.number().min(-24).max(6).default(0),
});

export const LoopSchema = z.object({
  kind: z.literal("loop"),
  name: z.string().min(1).max(60),
  bars: z.number().int().min(1).max(8),
  bpm: z.number().min(40).max(200),
  key: KeySchema,
  role: z.enum(["drums", "bass", "chords", "lead", "arp", "pad"]),
  style: z.string().min(1).max(32),
  density: z.number().min(0).max(1).optional(),
  octave: z.number().int().min(0).max(8).optional(),
  chords: z.array(z.string().min(1).max(16)).max(16).optional(),
  energy: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  fx: FxSchema.optional(),
  gainDb: z.number().min(-24).max(6).default(0),
});

export const SampleSpecSchema = z.discriminatedUnion("kind", [OneShotSchema, LoopSchema]);

export type SampleSpec = z.infer<typeof SampleSpecSchema>;
export type OneShotSpec = z.infer<typeof OneShotSchema>;
export type LoopSpec = z.infer<typeof LoopSchema>;

export const SAMPLE_ROLE_DESCRIPTION =
  "drums, bass, chords, lead, arp, pad; estilos: drums (gated_80s, siniestro_punk, four_on_floor, half_time, breakbeat, driving, ambient), bass (straight8, driving8, syncopated, quarters, punk, ambient, sub), chords/pad (pad, gated, stab, offbeat, power, sustained), lead/arp (hook, up)";
