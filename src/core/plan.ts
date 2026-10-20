/**
 * Plan de canción: la capa intermedia entre "synth pop 80s oscuro" y las ops.
 *
 * El plan es barato de generar (y de revisar por un humano). La expansión a
 * notas la hace `composePlan` de forma determinista.
 */

import { z } from "zod";
import type { DeviceType, InstrumentType, KeySignature } from "./types.ts";
import { DEVICE_PARAMS, DEVICE_TYPES } from "./types.ts";
import type { Role } from "./patterns.ts";
import { BASS_STYLES, CHORD_RHYTHMS, DRUM_STYLES, isValidChord } from "./patterns.ts";
import type { Op } from "./ops.ts";
import { MODE_NAMES, isMajorFamily, normalizeKey, progressionFromDegrees } from "./theory.ts";

export const GENRES = ["synthpop80s", "siniestroPunk", "techno", "ambient", "rock", "hiphop"] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABELS: Record<Genre, string> = {
  synthpop80s: "Synth Pop 80s",
  siniestroPunk: "Siniestro Punk",
  techno: "Techno",
  ambient: "Ambient",
  rock: "Rock",
  hiphop: "Hip Hop",
};

export interface DevicePlan {
  type: DeviceType;
  params?: Record<string, number>;
}

export interface TrackPlan {
  name: string;
  role: Role;
  style: string;
  octave?: number;
  gainDb: number;
  pan: number;
  /** Multiplicador de densidad (1 = normal). */
  density?: number;
  devices: DevicePlan[];
  chords?: string[];
  motif?: number[];
}

export interface SongSection {
  name: string;
  bars: number;
  /** 0..1: controla densidad y qué pistas entran. */
  energy: number;
  roles: Role[];
}

export interface SongPlan {
  title: string;
  genre: string;
  bpm: number;
  key: KeySignature;
  sections: SongSection[];
  tracks: TrackPlan[];
  chords?: string[];
  mixNotes?: string;
  swing?: number;
}

const RoleSchema = z.enum(["drums", "bass", "chords", "lead", "arp", "pad"]);

export const SongPlanSchema = z.object({
  title: z.string().min(1).max(80),
  genre: z.string().max(40).default("custom"),
  bpm: z.number().min(20).max(300),
  key: z.object({ tonic: z.string().min(1).max(4), mode: z.enum(MODE_NAMES) }),
  sections: z
    .array(
      z.object({
        name: z.string().min(1).max(32),
        bars: z.number().int().min(1).max(64),
        energy: z.number().min(0).max(1),
        roles: z.array(RoleSchema).min(1),
      }),
    )
    .min(1)
    .max(16),
  tracks: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        role: RoleSchema,
        style: z.string().min(1).max(32),
        octave: z.number().int().min(0).max(8).optional(),
        gainDb: z.number().min(-60).max(12).default(0),
        pan: z.number().min(-1).max(1).default(0),
        density: z.number().min(0.1).max(1.5).optional(),
        devices: z
          .array(
            z.object({
              type: z.enum(DEVICE_TYPES),
              params: z.record(z.string(), z.number()).optional(),
            }),
          )
          .default([]),
        chords: z.array(z.string().min(1).max(16)).max(16).optional(),
        motif: z.array(z.number().int().min(-14).max(21)).max(32).optional(),
      }),
    )
    .min(1)
    .max(16),
  chords: z.array(z.string().min(1).max(16)).max(16).optional(),
  mixNotes: z.string().max(500).optional(),
  swing: z.number().min(0).max(1).optional(),
});

export function parseSongPlan(value: unknown): SongPlan {
  const result = SongPlanSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Plan inválido: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data as SongPlan;
}

/**
 * Sinónimos habituales en DAWs. El modelo no tiene por qué conocer nuestro
 * vocabulario exacto; aceptamos su término y lo mapeamos al canónico.
 */
const PARAM_ALIASES: Partial<Record<DeviceType, Record<string, string>>> = {
  reverb: { size: "decay", room: "decay", roomSize: "decay", mix: "wet", amount: "wet" },
  delay: { mix: "wet", amount: "wet", delayTime: "time", repeat: "feedback", repeats: "feedback" },
  chorus: { mix: "wet", amount: "depth", speed: "rate" },
  distortion: { amount: "drive", gain: "drive" },
  filter: { frequency: "cutoff", freq: "cutoff", q: "resonance" },
  eq: { bass: "low", treble: "high", midrange: "mid" },
  compressor: { amount: "threshold", compression: "ratio" },
  bitcrusher: { amount: "mix" },
  gate: { amount: "threshold" },
  width: { amount: "width", stereo: "width", mix: "width" },
};

/** Normaliza alias y recorta valores al rango antes de validar. */
export function normalizePlan(plan: SongPlan): SongPlan {
  const clone = structuredClone(plan) as SongPlan;
  for (const track of clone.tracks) {
    for (const device of track.devices) {
      const allowed = DEVICE_PARAMS[device.type];
      if (!allowed) continue;
      const aliases = PARAM_ALIASES[device.type] ?? {};
      const params: Record<string, number> = {};
      for (const [name, value] of Object.entries(device.params ?? {})) {
        const target = aliases[name] ?? name;
        const range = allowed[target];
        if (!range) {
          // Se conserva para que validatePlan dé un error con alternativas.
          params[name] = value;
          continue;
        }
        if (!Number.isFinite(value)) continue;
        params[target] = Math.max(range[0], Math.min(range[1], value));
      }
      device.params = params;
    }
  }
  return clone;
}

/** Comprobaciones que zod no puede hacer: estilos, parámetros, roles, armonía. */
export function validatePlan(plan: SongPlan): string[] {
  const issues: string[] = [];
  const totalBars = plan.sections.reduce((sum, section) => sum + section.bars, 0);
  if (totalBars < 1 || totalBars > 512) issues.push(`La duración total debe estar entre 1 y 512 compases (${totalBars})`);

  const trackRoles = new Set(plan.tracks.map((track) => track.role));
  plan.sections.forEach((section, index) => {
    for (const role of section.roles) {
      if (!trackRoles.has(role)) {
        issues.push(
          `sections[${index}] "${section.name}": el rol "${role}" no tiene pista. Roles con pista: ${[...trackRoles].join(", ")}`,
        );
      }
    }
  });

  const harmonic = [
    ...(plan.chords ?? []).map((chord) => ({ chord, path: "chords" })),
    ...plan.tracks.flatMap((track, index) =>
      (track.chords ?? []).map((chord) => ({ chord, path: `tracks[${index}] "${track.name}".chords` })),
    ),
  ];
  for (const { chord, path } of harmonic) {
    if (!isValidChord(chord)) issues.push(`${path}: acorde no reconocido "${chord}"`);
  }

  plan.tracks.forEach((track, index) => {
    const path = `tracks[${index}] "${track.name}"`;
    if (track.role === "drums" && !DRUM_STYLES[track.style]) {
      issues.push(`${path}: estilo de batería "${track.style}" no válido. Usa: ${Object.keys(DRUM_STYLES).join(", ")}`);
    }
    if (track.role === "bass" && !BASS_STYLES[track.style]) {
      issues.push(`${path}: estilo de bajo "${track.style}" no válido. Usa: ${Object.keys(BASS_STYLES).join(", ")}`);
    }
    if ((track.role === "chords" || track.role === "pad") && !CHORD_RHYTHMS[track.style]) {
      issues.push(`${path}: estilo de acordes "${track.style}" no válido. Usa: ${Object.keys(CHORD_RHYTHMS).join(", ")}`);
    }

    if (track.octave !== undefined) {
      const range: [number, number] =
        track.role === "bass" ? [0, 3] : track.role === "lead" || track.role === "arp" ? [3, 7] : [2, 6];
      if (track.octave < range[0] || track.octave > range[1]) {
        issues.push(`${path}: octava ${track.octave} fuera de rango para ${track.role} (${range[0]}..${range[1]})`);
      }
    }

    track.devices.forEach((device, deviceIndex) => {
      const allowed = DEVICE_PARAMS[device.type];
      for (const [name, value] of Object.entries(device.params ?? {})) {
        const devicePath = `${path}.devices[${deviceIndex}] (${device.type})`;
        const range = allowed[name];
        if (!range) {
          issues.push(
            `${devicePath}: parámetro "${name}" desconocido. Usa: ${Object.keys(allowed).join(", ")}`,
          );
          continue;
        }
        if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
          issues.push(`${devicePath}.${name}: ${value} fuera de rango [${range[0]}, ${range[1]}]`);
        }
      }
    });
  });

  return issues;
}

const ROLE_INSTRUMENT: Record<Role, InstrumentType> = {
  drums: "drumkit",
  bass: "bass",
  chords: "pad",
  pad: "pad",
  lead: "lead",
  arp: "arp",
};

/** Pistas mínimas para loops que piden un rol ausente en el preset. */
const LOOP_TRACKS: Record<Role, TrackPlan> = {
  drums: { name: "Drums", role: "drums", style: "four_on_floor", gainDb: -3, pan: 0, devices: [] },
  bass: { name: "Bass", role: "bass", style: "driving8", octave: 2, gainDb: -4, pan: 0, devices: [] },
  chords: { name: "Chords", role: "chords", style: "stab", octave: 4, gainDb: -8, pan: 0, devices: [] },
  pad: { name: "Pad", role: "pad", style: "pad", octave: 4, gainDb: -8, pan: 0, devices: [] },
  lead: { name: "Lead", role: "lead", style: "hook", octave: 5, gainDb: -6, pan: 0, devices: [] },
  arp: { name: "Arp", role: "arp", style: "up", octave: 5, gainDb: -12, pan: 0, devices: [] },
};

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

/** Convierte el plan en operaciones aplicables. */
export function composePlan(plan: SongPlan): Op[] {
  const key = normalizeKey(plan.key);
  const totalBars = plan.sections.reduce((sum, section) => sum + section.bars, 0);
  if (totalBars < 1 || totalBars > 512) throw new Error(`El plan dura ${totalBars} compases; máximo 512`);

  const chords = plan.chords?.length ? plan.chords : undefined;
  const ops: Op[] = [
    { op: "set_song", name: plan.title, bpm: plan.bpm, key, lengthBars: totalBars },
  ];

  const used = new Set<string>();
  const tracks = plan.tracks.map((track) => {
    const base = `trk_${slugify(track.name) || "track"}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}_${suffix++}`;
    used.add(id);
    return { plan: track, id };
  });

  for (const { plan: track, id } of tracks) {
    const instrumentType: InstrumentType =
      track.role === "chords" && track.style === "power" ? "synth" : ROLE_INSTRUMENT[track.role];
    ops.push({
      op: "add_track",
      id,
      name: track.name,
      kind: "midi",
      instrument: { type: instrumentType },
      gainDb: track.gainDb,
      pan: track.pan,
    });
    for (const device of track.devices) {
      ops.push({
        op: "add_device",
        trackId: id,
        device: { type: device.type, ...(device.params ? { params: device.params } : {}) },
      });
    }
  }

  let startBar = 0;
  for (const section of plan.sections) {
    for (const { plan: track, id } of tracks) {
      if (!section.roles.includes(track.role)) continue;
      const density = Math.max(0.12, Math.min(1, 0.18 + section.energy * (track.density ?? 1)));
      ops.push({
        op: "generate_part",
        trackId: id,
        startBar,
        section: section.name,
        pattern: {
          role: track.role,
          style: track.style,
          bars: section.bars,
          density,
          ...(track.chords ?? chords ? { chords: track.chords ?? chords } : {}),
          ...(track.octave !== undefined ? { octave: track.octave } : {}),
          ...(track.motif ? { motif: track.motif } : {}),
          ...(plan.swing !== undefined && track.role !== "drums" ? { swing: plan.swing } : {}),
        },
      });
    }
    startBar += section.bars;
  }

  return ops;
}

export function planBars(plan: SongPlan): number {
  return plan.sections.reduce((sum, section) => sum + section.bars, 0);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  bpm: number;
  key: KeySignature;
  /** Grados de la progresión según la familia modal. */
  degrees: { minor: number[]; major: number[] };
  sections: SongSection[];
  tracks: TrackPlan[];
  swing?: number;
  mixNotes: string;
}

const DRUMS_80S: TrackPlan = {
  name: "Drums",
  role: "drums",
  style: "gated_80s",
  gainDb: -3,
  pan: 0,
  devices: [
    { type: "compressor", params: { threshold: 0.55, ratio: 4, attack: 0.25, release: 0.35 } },
    { type: "reverb", params: { wet: 0.16, decay: 0.35, preDelay: 0.1 } },
  ],
};

const BASS_80S: TrackPlan = {
  name: "Bass",
  role: "bass",
  style: "driving8",
  octave: 2,
  gainDb: -2,
  pan: 0,
  devices: [
    { type: "distortion", params: { drive: 0.22, mix: 0.3, tone: 0.45 } },
    { type: "eq", params: { low: 3, mid: -1, high: -3 } },
  ],
};

const PAD_80S: TrackPlan = {
  name: "Pad",
  role: "pad",
  style: "pad",
  octave: 4,
  gainDb: -7,
  pan: -0.18,
  devices: [
    { type: "chorus", params: { wet: 0.38, depth: 0.6, rate: 0.22 } },
    { type: "reverb", params: { wet: 0.45, decay: 0.72, damping: 0.45 } },
  ],
};

const CHORDS_80S: TrackPlan = {
  name: "Chords",
  role: "chords",
  style: "gated",
  octave: 4,
  gainDb: -9,
  pan: 0.2,
  devices: [
    { type: "chorus", params: { wet: 0.3 } },
    { type: "reverb", params: { wet: 0.3, decay: 0.5 } },
  ],
};

const LEAD_80S: TrackPlan = {
  name: "Lead",
  role: "lead",
  style: "hook",
  octave: 5,
  gainDb: -5,
  pan: 0.1,
  motif: [0, 2, 4, 2, 4, 6, 4, 2],
  devices: [
    { type: "delay", params: { wet: 0.24, time: 0.35, feedback: 0.38 } },
    { type: "reverb", params: { wet: 0.28, decay: 0.55 } },
  ],
};

const PRESETS: Record<Genre, Preset> = {
  synthpop80s: {
    bpm: 96,
    key: { tonic: "D", mode: "minor" },
    degrees: { minor: [0, 5, 2, 6], major: [0, 5, 3, 4] },
    sections: [
      { name: "intro", bars: 4, energy: 0.25, roles: ["pad"] },
      { name: "verse", bars: 8, energy: 0.55, roles: ["drums", "bass", "pad"] },
      { name: "chorus", bars: 8, energy: 0.92, roles: ["drums", "bass", "pad", "chords", "lead"] },
      { name: "verse2", bars: 8, energy: 0.6, roles: ["drums", "bass", "pad"] },
      { name: "chorus2", bars: 8, energy: 0.98, roles: ["drums", "bass", "pad", "chords", "lead"] },
      { name: "outro", bars: 4, energy: 0.3, roles: ["pad"] },
    ],
    tracks: [DRUMS_80S, BASS_80S, PAD_80S, CHORDS_80S, LEAD_80S],
    mixNotes: "Pad ancho y oscuro, batería con puerta, bajo con saturación suave y lead con delay.",
  },

  siniestroPunk: {
    bpm: 148,
    key: { tonic: "E", mode: "minor" },
    degrees: { minor: [0, 5, 2, 6], major: [0, 5, 3, 4] },
    sections: [
      { name: "intro", bars: 4, energy: 0.45, roles: ["bass", "chords"] },
      { name: "verse", bars: 8, energy: 0.8, roles: ["drums", "bass", "chords"] },
      { name: "chorus", bars: 8, energy: 1, roles: ["drums", "bass", "chords", "lead"] },
      { name: "verse2", bars: 8, energy: 0.85, roles: ["drums", "bass", "chords"] },
      { name: "chorus2", bars: 8, energy: 1, roles: ["drums", "bass", "chords", "lead"] },
      { name: "outro", bars: 4, energy: 0.5, roles: ["drums", "bass", "chords"] },
    ],
    tracks: [
      {
        name: "Batería",
        role: "drums",
        style: "siniestro_punk",
        gainDb: -2,
        pan: 0,
        devices: [
          { type: "compressor", params: { threshold: 0.5, ratio: 6, attack: 0.15, release: 0.3 } },
          { type: "reverb", params: { wet: 0.12, decay: 0.25 } },
        ],
      },
      {
        name: "Bajo",
        role: "bass",
        style: "punk",
        octave: 2,
        gainDb: -1,
        pan: 0,
        devices: [
          { type: "distortion", params: { drive: 0.62, mix: 0.55, tone: 0.55 } },
          { type: "eq", params: { low: 2, mid: 3, high: -1 } },
        ],
      },
      {
        name: "Guitarra",
        role: "chords",
        style: "power",
        octave: 3,
        gainDb: -4,
        pan: -0.25,
        devices: [
          { type: "distortion", params: { drive: 0.7, mix: 0.7, tone: 0.6 } },
          { type: "reverb", params: { wet: 0.18, decay: 0.3 } },
        ],
      },
      {
        name: "Lead",
        role: "lead",
        style: "hook",
        octave: 5,
        gainDb: -8,
        pan: 0.15,
        motif: [0, 1, 0, -2, 0, 3, 2, 0],
        devices: [{ type: "delay", params: { wet: 0.18, time: 0.3, feedback: 0.3 } }],
      },
    ],
    mixNotes: "Sucio pero legible: guitarras al frente, bajo distorsionado y batería seca.",
  },

  techno: {
    bpm: 132,
    key: { tonic: "A", mode: "minor" },
    degrees: { minor: [0, 0, 5, 6], major: [0, 0, 5, 4] },
    sections: [
      { name: "intro", bars: 8, energy: 0.5, roles: ["drums", "arp"] },
      { name: "build", bars: 8, energy: 0.7, roles: ["drums", "bass", "arp"] },
      { name: "main", bars: 16, energy: 0.95, roles: ["drums", "bass", "chords", "arp"] },
      { name: "break", bars: 8, energy: 0.35, roles: ["pad", "arp"] },
      { name: "main2", bars: 16, energy: 1, roles: ["drums", "bass", "chords", "arp"] },
      { name: "outro", bars: 8, energy: 0.5, roles: ["drums", "arp"] },
    ],
    tracks: [
      {
        name: "Kick",
        role: "drums",
        style: "four_on_floor",
        gainDb: -1,
        pan: 0,
        devices: [{ type: "compressor", params: { threshold: 0.4, ratio: 5 } }],
      },
      {
        name: "Bass",
        role: "bass",
        style: "sub",
        octave: 1,
        gainDb: -2,
        pan: 0,
        devices: [{ type: "distortion", params: { drive: 0.15, mix: 0.2 } }],
      },
      {
        name: "Stabs",
        role: "chords",
        style: "offbeat",
        octave: 4,
        gainDb: -8,
        pan: 0.1,
        devices: [
          { type: "delay", params: { wet: 0.3, time: 0.4, feedback: 0.4 } },
          { type: "reverb", params: { wet: 0.3, decay: 0.5 } },
        ],
      },
      {
        name: "Arp",
        role: "arp",
        style: "up",
        octave: 5,
        gainDb: -12,
        pan: -0.2,
        devices: [{ type: "delay", params: { wet: 0.35, time: 0.25, feedback: 0.45 } }],
      },
      {
        name: "Pad",
        role: "pad",
        style: "pad",
        octave: 4,
        gainDb: -14,
        pan: 0,
        devices: [{ type: "reverb", params: { wet: 0.6, decay: 0.8 } }],
      },
    ],
    mixNotes: "Kick contundente, sub limpio y stabs con delay ping-pong.",
  },

  ambient: {
    bpm: 70,
    key: { tonic: "C", mode: "lydian" },
    degrees: { minor: [0, 5, 2, 6], major: [0, 5, 3, 4] },
    sections: [
      { name: "intro", bars: 8, energy: 0.2, roles: ["pad"] },
      { name: "a", bars: 16, energy: 0.45, roles: ["pad", "arp", "lead"] },
      { name: "b", bars: 16, energy: 0.65, roles: ["pad", "arp", "lead", "drums"] },
      { name: "a2", bars: 16, energy: 0.5, roles: ["pad", "arp", "lead"] },
      { name: "outro", bars: 8, energy: 0.2, roles: ["pad"] },
    ],
    tracks: [
      {
        name: "Pad",
        role: "pad",
        style: "pad",
        octave: 4,
        gainDb: -6,
        pan: 0,
        devices: [
          { type: "chorus", params: { wet: 0.4, depth: 0.7 } },
          { type: "reverb", params: { wet: 0.7, decay: 0.9, damping: 0.3 } },
        ],
      },
      {
        name: "Arp",
        role: "arp",
        style: "up",
        octave: 5,
        gainDb: -14,
        pan: 0.3,
        devices: [{ type: "delay", params: { wet: 0.45, time: 0.5, feedback: 0.55 } }],
      },
      {
        name: "Voz",
        role: "lead",
        style: "hook",
        octave: 5,
        gainDb: -12,
        pan: -0.15,
        density: 0.5,
        motif: [0, 2, 1, 4, 2, 0, -1, 0],
        devices: [{ type: "reverb", params: { wet: 0.55, decay: 0.85 } }],
      },
      {
        name: "Percusión",
        role: "drums",
        style: "ambient",
        gainDb: -10,
        pan: 0,
        devices: [{ type: "reverb", params: { wet: 0.5, decay: 0.7 } }],
      },
    ],
    mixNotes: "Todo muy reverberado, dinámica lenta, sin transientes agresivos.",
  },

  rock: {
    bpm: 124,
    key: { tonic: "E", mode: "minor" },
    degrees: { minor: [0, 5, 2, 6], major: [0, 5, 3, 4] },
    sections: [
      { name: "intro", bars: 4, energy: 0.4, roles: ["chords"] },
      { name: "verse", bars: 8, energy: 0.7, roles: ["drums", "bass", "chords"] },
      { name: "chorus", bars: 8, energy: 0.95, roles: ["drums", "bass", "chords", "lead"] },
      { name: "verse2", bars: 8, energy: 0.75, roles: ["drums", "bass", "chords"] },
      { name: "chorus2", bars: 8, energy: 1, roles: ["drums", "bass", "chords", "lead"] },
      { name: "outro", bars: 4, energy: 0.5, roles: ["drums", "bass", "chords"] },
    ],
    tracks: [
      {
        name: "Batería",
        role: "drums",
        style: "driving",
        gainDb: -2,
        pan: 0,
        devices: [{ type: "compressor", params: { threshold: 0.45, ratio: 4 } }],
      },
      { name: "Bajo", role: "bass", style: "straight8", octave: 2, gainDb: -3, pan: 0, devices: [] },
      {
        name: "Guitarra",
        role: "chords",
        style: "power",
        octave: 3,
        gainDb: -5,
        pan: -0.2,
        devices: [{ type: "distortion", params: { drive: 0.5, mix: 0.6 } }],
      },
      {
        name: "Lead",
        role: "lead",
        style: "hook",
        octave: 5,
        gainDb: -7,
        pan: 0.2,
        devices: [{ type: "delay", params: { wet: 0.2, time: 0.3, feedback: 0.3 } }],
      },
    ],
    mixNotes: "Guitarras dobladas, batería natural y bajo que sostiene.",
  },

  hiphop: {
    bpm: 88,
    key: { tonic: "F", mode: "minor" },
    degrees: { minor: [0, 5, 2, 6], major: [0, 5, 3, 4] },
    swing: 0.45,
    sections: [
      { name: "intro", bars: 4, energy: 0.35, roles: ["chords"] },
      { name: "verse", bars: 8, energy: 0.7, roles: ["drums", "bass", "chords"] },
      { name: "hook", bars: 8, energy: 0.9, roles: ["drums", "bass", "chords", "lead"] },
      { name: "verse2", bars: 8, energy: 0.75, roles: ["drums", "bass", "chords"] },
      { name: "hook2", bars: 8, energy: 0.95, roles: ["drums", "bass", "chords", "lead"] },
      { name: "outro", bars: 4, energy: 0.4, roles: ["drums", "bass", "chords"] },
    ],
    tracks: [
      {
        name: "Batería",
        role: "drums",
        style: "breakbeat",
        gainDb: -1,
        pan: 0,
        devices: [{ type: "compressor", params: { threshold: 0.4, ratio: 5 } }],
      },
      {
        name: "Bajo",
        role: "bass",
        style: "syncopated",
        octave: 1,
        gainDb: -2,
        pan: 0,
        devices: [{ type: "distortion", params: { drive: 0.2, mix: 0.25 } }],
      },
      {
        name: "Rhodes",
        role: "chords",
        style: "stab",
        octave: 4,
        gainDb: -7,
        pan: 0.1,
        devices: [
          { type: "chorus", params: { wet: 0.25 } },
          { type: "reverb", params: { wet: 0.28, decay: 0.45 } },
        ],
      },
      {
        name: "Lead",
        role: "lead",
        style: "hook",
        octave: 5,
        gainDb: -10,
        pan: -0.1,
        density: 0.6,
        devices: [{ type: "delay", params: { wet: 0.2, time: 0.3, feedback: 0.3 } }],
      },
    ],
    mixNotes: "Batería con swing, Rhodes cálido y bajo redondo.",
  },
};

export interface PresetOptions {
  key?: KeySignature;
  bpm?: number;
  bars?: number;
  title?: string;
  chords?: string[];
}

function scaleSections(sections: SongSection[], totalBars: number): SongSection[] {
  const current = sections.reduce((sum, section) => sum + section.bars, 0);
  if (current === totalBars) return sections;
  if (totalBars <= 0) throw new Error("bars debe ser > 0");
  // Menos compases que secciones: se recortan secciones (una por compás).
  if (totalBars < sections.length) {
    return sections.slice(0, totalBars).map((section) => ({ ...section, bars: 1 }));
  }

  const scaled: SongSection[] = [];
  let accumulated = 0;
  sections.forEach((section, index) => {
    const remainingSections = sections.length - index - 1;
    let bars =
      index === sections.length - 1
        ? totalBars - accumulated
        : Math.max(1, Math.round((section.bars / current) * totalBars));
    if (index !== sections.length - 1) {
      bars = Math.min(bars, totalBars - accumulated - remainingSections);
    }
    bars = Math.max(1, bars);
    scaled.push({ ...section, bars });
    accumulated += bars;
  });

  // Ajuste fino del último compás si el redondeo no cuadra.
  const diff = totalBars - scaled.reduce((sum, section) => sum + section.bars, 0);
  const last = scaled[scaled.length - 1]!;
  last.bars = Math.max(1, last.bars + diff);
  return scaled;
}

export function presetPlan(genre: Genre, options: PresetOptions = {}): SongPlan {
  const preset = PRESETS[genre];
  const key = normalizeKey(options.key ?? preset.key);
  const degrees = isMajorFamily(key.mode) ? preset.degrees.major : preset.degrees.minor;
  const chords = options.chords?.length ? options.chords : progressionFromDegrees(key, degrees);
  const bars = options.bars ?? preset.sections.reduce((sum, section) => sum + section.bars, 0);
  return {
    title: options.title ?? GENRE_LABELS[genre],
    genre,
    bpm: options.bpm ?? preset.bpm,
    key,
    sections: scaleSections(preset.sections, bars),
    tracks: preset.tracks.map((track) => ({ ...track, devices: track.devices.map((device) => ({ ...device })) })),
    chords,
    mixNotes: preset.mixNotes,
    ...(preset.swing !== undefined ? { swing: preset.swing } : {}),
  };
}

/** Plan corto tipo loop, limitado a los roles pedidos. */
export function loopPlan(genre: Genre, roles: Role[], bars = 4, options: PresetOptions = {}): SongPlan {
  const base = presetPlan(genre, { ...options, bars });
  const selected = base.tracks.filter((track) => roles.includes(track.role));
  for (const role of roles) {
    if (!selected.some((track) => track.role === role)) {
      selected.push({ ...LOOP_TRACKS[role], devices: [] });
    }
  }
  const tracks = selected.length > 0 ? selected : base.tracks;
  return {
    ...base,
    title: options.title ?? `Loop ${roles.join(" + ")}`,
    sections: [{ name: "loop", bars, energy: 0.85, roles: tracks.map((track) => track.role) }],
    tracks,
  };
}

export function presetFor(genre: string): Genre | null {
  return (GENRES as readonly string[]).includes(genre) ? (genre as Genre) : null;
}
