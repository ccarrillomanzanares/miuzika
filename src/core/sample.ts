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

const FmSchema = z.object({
  ratio: z.number().min(0.1).max(12).default(1).describe("Frecuencia del modulador / portadora"),
  index: z.number().min(0).max(20).default(2).describe("Profundidad FM (× frecuencia)"),
  decay: z.number().min(0.01).max(2).default(0.2).describe("Caída del índice FM"),
});

const FilterEnvSchema = z.object({
  amount: z.number().min(-12_000).max(12_000).default(4000).describe("Recorrido del cutoff en Hz"),
  attack: z.number().min(0).max(2).default(0.005),
  decay: z.number().min(0.01).max(2).default(0.2),
  sustain: z.number().min(0).max(1).default(0),
});

const LayerSchema = z.object({
  osc: z.enum(["sine", "saw", "square", "triangle", "noise"]),
  freq: z.number().min(20).max(20_000).optional().describe("Frecuencia inicial en Hz"),
  glideTo: z.number().min(20).max(20_000).optional(),
  glide: z.number().min(0).max(2).optional(),
  detune: z.number().min(-100).max(100).optional(),
  /** Capas/unísono del mismo oscilador (pads, supersaws). */
  voices: z.number().int().min(1).max(4).default(1),
  spread: z.number().min(0).max(100).optional().describe("Desafinación del unísono en cents"),
  pan: z.number().min(-1).max(1).optional(),
  fm: FmSchema.optional().describe("FM inarmónica para campanas, plucks metálicos, bajos growl"),
  filter: FilterSchema.optional(),
  filterEnv: FilterEnvSchema.optional().describe("Envolvente del filtro para kicks, plucks, risers"),
  env: EnvelopeSchema,
  gain: z.number().min(0).max(1).default(0.7),
});

const FxSchema = z.object({
  drive: z.number().min(0).max(1).optional(),
  bitcrush: z
    .object({ levels: z.number().min(4).max(256).default(32) })
    .optional()
    .describe("Cuantización lo-fi; levels bajos = más sucio"),
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

/**
 * One-shot industrial: stab metálico con pitch-drop, FM inarmónica, ruido,
 * saturación asimétrica, bitcrush, barrido de filtro y cola estéreo.
 */
export const IndustrialParamsSchema = z.object({
  rootHz: z.number().min(20).max(2000).default(82.41).describe("Frecuencia base en Hz (E2 = 82.41)"),
  pitchDrop: z.number().min(0).max(24).default(12).describe("Caída de tono inicial en semitonos"),
  pitchTau: z.number().min(0.005).max(1).default(0.035).describe("Rapidez de la caída de tono"),
  decay: z.number().min(0.05).max(4).default(0.9).describe("Decaimiento del cuerpo"),
  drive: z.number().min(0).max(10).default(3.4).describe("Saturación tanh"),
  crushHz: z.number().min(200).max(22_050).default(11_000).describe("Frecuencia del bitcrush"),
  crushLevels: z.number().min(4).max(1024).default(96).describe("Niveles de cuantización"),
  cutoffStart: z.number().min(200).max(20_000).default(8800).describe("Cutoff inicial del barrido"),
  cutoffEnd: z.number().min(40).max(8000).default(190).describe("Cutoff final del barrido"),
  cutoffTau: z.number().min(0.02).max(3).default(0.55).describe("Velocidad del barrido"),
  resonance: z.number().min(0.5).max(12).default(3.6).describe("Resonancia del filtro"),
  metalHz: z.number().min(20).max(2000).default(131).describe("Portadora de la capa metálica"),
  metalRatio: z.number().min(0.1).max(8).default(1.4142).describe("Ratio FM inarmónico"),
  metalIndex: z.number().min(0).max(30).default(14).describe("Índice FM inicial"),
  noise: z.number().min(0).max(1).default(0.3).describe("Nivel del transitorio de ruido"),
  width: z.number().min(0).max(1).default(1).describe("Anchura estéreo (Haas/detune)"),
  delayWet: z.number().min(0).max(1).default(0.55).describe("Nivel de la cola espacial"),
  seed: z.number().int().min(0).max(2_147_483_647).default(20_261_020).describe("Semilla del ruido"),
});

export const IndustrialSpecSchema = z.object({
  kind: z.literal("industrial"),
  name: z.string().min(1).max(60),
  duration: z.number().min(0.2).max(8).default(2.4),
  params: IndustrialParamsSchema.optional(),
  gainDb: z.number().min(-24).max(6).default(0),
});

export const SampleSpecSchema = z.discriminatedUnion("kind", [
  OneShotSchema,
  LoopSchema,
  IndustrialSpecSchema,
]);

export type SampleSpec = z.infer<typeof SampleSpecSchema>;
export type OneShotSpec = z.infer<typeof OneShotSchema>;
export type LoopSpec = z.infer<typeof LoopSchema>;
export type IndustrialSpec = z.infer<typeof IndustrialSpecSchema>;
export type IndustrialParams = z.infer<typeof IndustrialParamsSchema>;

export const SAMPLE_ROLE_DESCRIPTION =
  "drums, bass, chords, lead, arp, pad; estilos: drums (gated_80s, siniestro_punk, four_on_floor, half_time, breakbeat, driving, ambient), bass (straight8, driving8, syncopated, quarters, punk, ambient, sub), chords/pad (pad, gated, stab, offbeat, power, sustained), lead/arp (hook, up)";
