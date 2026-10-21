/**
 * Operaciones: el único vocabulario con el que el asistente puede modificar
 * el proyecto. Todo es validable, transaccional y reversible.
 */

import { z } from "zod";
import type { Device, DeviceType, Note, Project, Track } from "./types.ts";import {
  DEVICE_DEFAULTS,
  DEVICE_PARAMS,
  DEVICE_TYPES,
  INSTRUMENT_PROGRAM,
  INSTRUMENT_TYPES,
  beatsPerBar,
  barsToBeats,
} from "./types.ts";
import type { Role } from "./patterns.ts";
import { expandPattern } from "./patterns.ts";
import { MODE_NAMES, canonicalPitchClass, pitchClass } from "./theory.ts";
import { validateProject } from "./project.ts";
import type { Issue } from "./project.ts";
import { ParamValueSchema, numericParam } from "./params.ts";

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpError";
  }
}

const IdSchema = z.string().min(1).max(64);
const BarsSchema = z.number().int().min(1).max(512);
const GainSchema = z.number().min(-60).max(12);

const NoteSchema = z.object({
  pitch: z.number().int().min(0).max(127).describe("Nota MIDI, 60 = Do central"),
  start: z.number().min(0).describe("Beats desde el inicio del clip"),
  duration: z.number().positive().describe("Duración en beats"),
  velocity: z.number().int().min(1).max(127).default(96),
});

export const InstrumentSchema = z.object({
  type: z.enum(INSTRUMENT_TYPES),
  preset: z.string().max(64).optional(),
  program: z.number().int().min(0).max(127).optional(),
});

export const PatternSchema = z.object({
  role: z.enum(["drums", "bass", "chords", "lead", "arp", "pad"]),
  style: z
    .string()
    .max(32)
    .optional()
    .describe(
      "Batería: gated_80s, siniestro_punk, four_on_floor, half_time, breakbeat, driving, ambient. " +
        "Bajo: straight8, driving8, syncopated, quarters, punk, ambient, sub. " +
        "Acordes: pad, gated, stab, offbeat, power, sustained.",
    ),
  bars: z.number().int().min(1).max(64).default(8),
  chords: z.array(z.string().min(1).max(16)).max(32).optional().describe("Un acorde por compás, se cicla"),
  octave: z.number().int().min(0).max(8).optional().describe("Octava de la fundamental (bajo: 2, pads: 4, lead: 5)"),
  density: z.number().min(0).max(1).optional(),
  energy: z.number().min(0).max(1).optional().describe("Energía de la sección; cambia fills y movimiento"),
  root: z.string().max(4).optional(),
  motif: z.array(z.number().int().min(-14).max(21)).max(32).optional().describe("Grados de escala del motivo"),
  seed: z.number().int().optional(),
  swing: z.number().min(0).max(1).optional(),
});

const KeySchema = z.object({
  tonic: z.string().min(1).max(4).describe("Tónica: C, D, F#, Bb..."),
  mode: z.enum(MODE_NAMES),
});

const SetSongOp = z.object({
  op: z.literal("set_song"),
  name: z.string().min(1).max(80).optional(),
  bpm: z.number().min(20).max(300).optional(),
  key: KeySchema.optional(),
  lengthBars: BarsSchema.optional(),
  seed: z.number().int().optional(),
});

const AddTrackOp = z.object({
  op: z.literal("add_track"),
  id: IdSchema.optional(),
  name: z.string().min(1).max(60),
  kind: z.enum(["midi", "audio"]).default("midi"),
  instrument: InstrumentSchema.optional(),
  gainDb: GainSchema.optional(),
  pan: z.number().min(-1).max(1).optional(),
});

const SetTrackOp = z.object({
  op: z.literal("set_track"),
  trackId: IdSchema.describe("Id, nombre exacto o índice 1-based de la pista"),
  name: z.string().min(1).max(60).optional(),
  gainDb: GainSchema.optional(),
  pan: z.number().min(-1).max(1).optional(),
  muted: z.boolean().optional(),
  solo: z.boolean().optional(),
});

const RemoveTrackOp = z.object({
  op: z.literal("remove_track"),
  trackId: IdSchema,
});

const GeneratePartOp = z.object({
  op: z.literal("generate_part"),
  trackId: IdSchema.optional().describe("Si falta, se crea una pista con el campo track"),
  track: z
    .object({
      name: z.string().min(1).max(60),
      kind: z.enum(["midi", "audio"]).default("midi"),
      instrument: InstrumentSchema.optional(),
    })
    .optional(),
  startBar: z.number().int().min(0).max(511).describe("Compás donde empieza el clip (0-based)"),
  section: z.string().max(32).optional().describe("Etiqueta: intro, verse, chorus..."),
  pattern: PatternSchema,
});

const AddNotesOp = z.object({
  op: z.literal("add_notes"),
  trackId: IdSchema,
  clipId: IdSchema.optional(),
  startBar: z.number().int().min(0).max(511).optional(),
  name: z.string().max(60).optional(),
  notes: z.array(NoteSchema).min(1).max(2000),
});

const ReplaceClipNotesOp = z.object({
  op: z.literal("replace_clip_notes"),
  trackId: IdSchema,
  clipId: IdSchema,
  notes: z.array(NoteSchema).max(2000),
});

const RemoveClipOp = z.object({
  op: z.literal("remove_clip"),
  trackId: IdSchema,
  clipId: IdSchema,
});

const AddDeviceOp = z.object({
  op: z.literal("add_device"),
  trackId: IdSchema,
  id: IdSchema.optional(),
  device: z.object({
    type: z.enum(DEVICE_TYPES),
    params: z.record(z.string(), ParamValueSchema).optional(),
  }),
});

const SetDeviceOp = z.object({
  op: z.literal("set_device"),
  trackId: IdSchema,
  deviceId: IdSchema.describe("Id o tipo del dispositivo (p. ej. 'reverb')"),
  params: z.record(z.string(), ParamValueSchema).describe("Solo los parámetros a cambiar"),
});

const RemoveDeviceOp = z.object({
  op: z.literal("remove_device"),
  trackId: IdSchema,
  deviceId: IdSchema,
});

const RegisterAudioAssetOp = z.object({
  op: z.literal("register_audio_asset"),
  assetId: IdSchema,
  name: z.string().min(1).max(80),
  durationBeats: z.number().positive().max(4096),
});

const AddAudioClipOp = z.object({
  op: z.literal("add_audio_clip"),
  trackId: IdSchema.optional(),
  track: z.object({ name: z.string().min(1).max(60) }).optional(),
  assetId: IdSchema,
  startBar: z.number().int().min(0).max(511),
  lengthBeats: z.number().positive().max(4096).optional(),
  offsetBeats: z.number().min(0).max(4096).optional(),
  gainDb: GainSchema.optional(),
  name: z.string().max(60).optional(),
});

const SetAudioClipOp = z.object({
  op: z.literal("set_audio_clip"),
  trackId: IdSchema,
  clipId: IdSchema,
  startBar: z.number().int().min(0).max(511).optional().describe("Mueve el clip a este compás"),
  offsetBeats: z.number().min(0).max(4096).optional(),
  lengthBeats: z.number().positive().max(4096).optional(),
  gainDb: GainSchema.optional(),
});

const SetMasterOp = z.object({
  op: z.literal("set_master"),
  gainDb: GainSchema,
});

export const OpSchema = z.discriminatedUnion("op", [
  SetSongOp,
  AddTrackOp,
  SetTrackOp,
  RemoveTrackOp,
  GeneratePartOp,
  AddNotesOp,
  ReplaceClipNotesOp,
  RemoveClipOp,
  AddDeviceOp,
  SetDeviceOp,
  RemoveDeviceOp,
  RegisterAudioAssetOp,
  AddAudioClipOp,
  SetAudioClipOp,
  SetMasterOp,
]);

export const OpsSchema = z.array(OpSchema).min(1).max(200);

export type Op = z.input<typeof OpSchema>;
export type ParsedOp = z.output<typeof OpSchema>;
export type OpName = Op["op"];

/** Valida y normaliza operaciones venidas del LLM. */
export function parseOps(value: unknown): ParsedOp[] {
  const result = OpsSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("; ");
    throw new OpError(`Operaciones inválidas: ${detail}`);
  }
  return result.data;
}

/** JSON Schema para el tool-calling del LLM. */
export function opsJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object({ ops: OpsSchema })) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

// ---------------------------------------------------------------------------
// Resolución de referencias
// ---------------------------------------------------------------------------

function resolveTrack(project: Project, ref: string): Track {
  const cleaned = ref.trim();
  const byId = project.tracks.find((track) => track.id === cleaned);
  if (byId) return byId;

  const lower = cleaned.toLowerCase();
  const byName = project.tracks.filter((track) => track.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0]!;

  const byPrefix = project.tracks.filter((track) => track.id.startsWith(cleaned));
  if (byPrefix.length === 1) return byPrefix[0]!;

  const indexMatch = /^(?:track|pista|trk)?\s*(\d+)$/i.exec(cleaned);
  if (indexMatch) {
    const index = Number(indexMatch[1]) - 1;
    if (index >= 0 && index < project.tracks.length) return project.tracks[index]!;
  }

  const available = project.tracks.map((track, index) => `${index + 1}:${track.id}(${track.name})`).join(", ");
  throw new OpError(`No encuentro la pista "${ref}". Disponibles: ${available || "ninguna"}`);
}

function resolveClip(track: Track, ref: string) {
  const cleaned = ref.trim();
  const byId = track.clips.find((clip) => clip.id === cleaned);
  if (byId) return byId;
  const lower = cleaned.toLowerCase();
  const byName = track.clips.filter((clip) => clip.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0]!;
  if (track.clips.length === 1) return track.clips[0]!;
  const available = track.clips.map((clip) => `${clip.id}(${clip.name})`).join(", ");
  throw new OpError(`No encuentro el clip "${ref}" en "${track.name}". Disponibles: ${available || "ninguno"}`);
}

function resolveDevice(track: Track, ref: string): Device {
  const cleaned = ref.trim().toLowerCase();
  const byId = track.devices.find((device) => device.id.toLowerCase() === cleaned);
  if (byId) return byId;
  const byType = track.devices.filter((device) => device.type === cleaned);
  if (byType.length === 1) return byType[0]!;
  if (byType.length > 1) throw new OpError(`Hay ${byType.length} dispositivos "${cleaned}" en "${track.name}"; usa el id`);
  const available = track.devices.map((device) => `${device.id}(${device.type})`).join(", ");
  throw new OpError(`"${track.name}" no tiene el dispositivo "${ref}". Tiene: ${available || "ninguno"}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function uniqueId(prefix: string, base: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  const clean = base || "x";
  let candidate = `${prefix}${clean}`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${prefix}${clean}_${suffix++}`;
  return candidate;
}

function nextClipId(project: Project): string {
  const used = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  let index = 1;
  while (used.has(`clp_${index}`)) index++;
  return `clp_${index}`;
}

const ROLE_DEFAULTS: Record<Role, { name: string; instrument: Track["instrument"] }> = {
  drums: { name: "Drums", instrument: { type: "drumkit" } },
  bass: { name: "Bass", instrument: { type: "bass" } },
  chords: { name: "Chords", instrument: { type: "pad" } },
  pad: { name: "Pad", instrument: { type: "pad" } },
  lead: { name: "Lead", instrument: { type: "lead" } },
  arp: { name: "Arp", instrument: { type: "arp" } },
};

function createTrack(project: Project, name: string, instrument?: Track["instrument"]): Track {
  const track: Track = {
    id: uniqueId("trk_", slugify(name), project.tracks.map((existing) => existing.id)),
    name,
    kind: "midi",
    instrument: instrument ?? { type: "synth" },
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    devices: [],
    clips: [],
  };
  project.tracks.push(track);
  return track;
}

function coerceParams(
  type: DeviceType,
  params: Record<string, number | boolean> | undefined,
  base?: Record<string, number>,
) {
  const allowed = DEVICE_PARAMS[type];
  const result: Record<string, number> = { ...(base ?? DEVICE_DEFAULTS[type]) };
  for (const [name, raw] of Object.entries(params ?? {})) {
    const value = numericParam(raw);
    const range = allowed[name];
    if (!range) {
      throw new OpError(
        `El parámetro "${name}" no existe en ${type}. Disponibles: ${Object.keys(allowed).join(", ")}`,
      );
    }
    if (!Number.isFinite(value)) throw new OpError(`El parámetro "${name}" no es un número válido`);
    result[name] = Number(Math.max(range[0], Math.min(range[1], value)).toFixed(3));
  }
  return result;
}

function defaultDeviceId(track: Track, type: DeviceType): string {
  const base = `dev_${type}`;
  let index = 1;
  while (track.devices.some((device) => device.id === `${base}_${index}`)) index++;
  return `${base}_${index}`;
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------

function applyOne(project: Project, op: ParsedOp): string {
  switch (op.op) {
    case "set_song": {
      if (op.name !== undefined) project.name = op.name;
      if (op.bpm !== undefined) project.bpm = op.bpm;
      if (op.lengthBars !== undefined) project.lengthBars = op.lengthBars;
      if (op.seed !== undefined) project.seed = op.seed;
      if (op.key) {
        try {
          pitchClass(op.key.tonic);
        } catch {
          throw new OpError(`Tónica no válida: "${op.key.tonic}"`);
        }
        project.key = { tonic: canonicalPitchClass(op.key.tonic), mode: op.key.mode };
      }
      return `Canción: ${project.name} · ${project.bpm} BPM · ${project.key.tonic} ${project.key.mode} · ${project.lengthBars} compases`;
    }

    case "add_track": {
      const track = createTrack(project, op.name, op.instrument);
      track.kind = op.kind;
      if (op.id) {
        if (project.tracks.some((existing) => existing.id === op.id && existing !== track)) {
          throw new OpError(`Ya existe una pista con id "${op.id}"`);
        }
        track.id = op.id;
      }
      if (op.gainDb !== undefined) track.gainDb = op.gainDb;
      if (op.pan !== undefined) track.pan = op.pan;
      return `Pista creada: ${track.name} (${track.id})`;
    }

    case "set_track": {
      const track = resolveTrack(project, op.trackId);
      if (op.name !== undefined) track.name = op.name;
      if (op.gainDb !== undefined) track.gainDb = op.gainDb;
      if (op.pan !== undefined) track.pan = op.pan;
      if (op.muted !== undefined) track.muted = op.muted;
      if (op.solo !== undefined) track.solo = op.solo;
      return `Pista actualizada: ${track.name} (${track.id})`;
    }

    case "remove_track": {
      const track = resolveTrack(project, op.trackId);
      project.tracks = project.tracks.filter((existing) => existing !== track);
      return `Pista eliminada: ${track.name} (${track.id})`;
    }

    case "generate_part": {
      const pattern = op.pattern;
      const bars = Math.max(1, Math.min(64, pattern.bars));
      let track = op.trackId ? resolveTrack(project, op.trackId) : undefined;
      if (!track) {
        const fallback = ROLE_DEFAULTS[pattern.role];
        const name = op.track?.name ?? fallback.name;
        track = createTrack(project, name, op.track?.instrument ?? fallback.instrument);
        if (op.track?.kind) track.kind = op.track.kind;
      }
      if (track.kind !== "midi") {
        throw new OpError(`"${track.name}" es una pista de audio; generate_part solo genera MIDI`);
      }

      const barBeats = beatsPerBar(project);
      const start = op.startBar * barBeats;
      const length = barsToBeats(project, bars);
      const notes = expandPattern(pattern, {
        key: project.key,
        beatsPerBar: barBeats,
        stepsPerBar: 16,
        seed: project.seed,
      });

      const clip = {
        id: nextClipId(project),
        name: `${op.section ?? pattern.role} ${op.startBar + 1}`,
        start,
        length,
        notes,
        origin: {
          op: "generate_part",
          ...(op.section ? { section: op.section } : {}),
          ...(pattern.seed !== undefined ? { seed: pattern.seed } : {}),
        },
      };
      track.clips.push(clip);
      project.lengthBars = Math.max(project.lengthBars, op.startBar + bars);
      return `Generado ${pattern.role}/${pattern.style ?? "por defecto"} · ${bars} compases · ${notes.length} notas en ${track.name}`;
    }

    case "add_notes": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "midi") throw new OpError(`"${track.name}" es una pista de audio`);
      const notes: Note[] = op.notes.map((note) => ({ ...note }));
      if (op.clipId) {
        const clip = resolveClip(track, op.clipId);
        clip.notes.push(...notes);
        clip.length = Math.max(clip.length, ...notes.map((note) => note.start + note.duration));
      } else {
        const barBeats = beatsPerBar(project);
        const startBar = op.startBar ?? 0;
        const end = Math.max(...notes.map((note) => note.start + note.duration));
        track.clips.push({
          id: nextClipId(project),
          name: op.name ?? `${track.name} ${startBar + 1}`,
          start: startBar * barBeats,
          length: Math.max(barBeats, Math.ceil(end / barBeats) * barBeats),
          notes,
        });
        project.lengthBars = Math.max(project.lengthBars, startBar + Math.ceil(end / barBeats));
      }
      return `Añadidas ${notes.length} notas a ${track.name}`;
    }

    case "replace_clip_notes": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      clip.notes = op.notes.map((note) => ({ ...note }));
      clip.length = Math.max(clip.length, ...clip.notes.map((note) => note.start + note.duration));
      return `Clip ${clip.id} reemplazado por ${clip.notes.length} notas`;
    }

    case "remove_clip": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      track.clips = track.clips.filter((existing) => existing !== clip);
      return `Clip eliminado: ${clip.id} de ${track.name}`;
    }

    case "register_audio_asset": {
      const assets = (project.audioAssets ??= []);
      const existing = assets.find((asset) => asset.id === op.assetId);
      if (existing) {
        existing.name = op.name;
        existing.durationBeats = op.durationBeats;
        return `Asset actualizado: ${op.name} (${op.durationBeats.toFixed(2)} beats)`;
      }
      assets.push({ id: op.assetId, name: op.name, durationBeats: op.durationBeats });
      return `Asset registrado: ${op.name} (${op.durationBeats.toFixed(2)} beats)`;
    }

    case "add_audio_clip": {
      const assets = (project.audioAssets ??= []);
      const asset = assets.find((candidate) => candidate.id === op.assetId);
      if (!asset) {
        throw new OpError(
          `No existe el asset "${op.assetId}". Registrados: ${assets.map((candidate) => candidate.id).join(", ") || "ninguno"}`,
        );
      }
      let track = op.trackId ? resolveTrack(project, op.trackId) : undefined;
      if (!track) {
        track = createTrack(project, op.track?.name ?? "Audio", { type: "sampler" });
        track.kind = "audio";
      }
      if (track.kind !== "audio") throw new OpError(`"${track.name}" no es una pista de audio`);

      const barBeats = beatsPerBar(project);
      const start = op.startBar * barBeats;
      const offset = op.offsetBeats ?? 0;
      const available = Math.max(0.25, asset.durationBeats - offset);
      const length = Math.min(op.lengthBeats ?? available, 64 * barBeats);
      track.clips.push({
        id: nextClipId(project),
        name: op.name ?? asset.name,
        start,
        length,
        notes: [],
        audio: { assetId: asset.id, offset, gainDb: op.gainDb ?? 0 },
      });
      project.lengthBars = Math.max(project.lengthBars, Math.ceil((start + length) / barBeats));
      return `Audio colocado: ${asset.name} · ${length.toFixed(2)} beats en ${track.name}`;
    }

    case "set_audio_clip": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "audio") throw new OpError(`"${track.name}" no es una pista de audio`);
      const clip = resolveClip(track, op.clipId);
      if (!clip.audio) throw new OpError(`El clip "${clip.id}" no es de audio`);
      if (op.offsetBeats !== undefined) clip.audio.offset = op.offsetBeats;
      if (op.gainDb !== undefined) clip.audio.gainDb = op.gainDb;
      if (op.lengthBeats !== undefined) clip.length = op.lengthBeats;
      if (op.startBar !== undefined) {
        clip.start = op.startBar * beatsPerBar(project);
        project.lengthBars = Math.max(
          project.lengthBars,
          Math.ceil((clip.start + clip.length) / beatsPerBar(project)),
        );
      }
      return `Clip de audio actualizado: ${clip.id}`;
    }

    case "add_device": {
      const track = resolveTrack(project, op.trackId);
      const device: Device = {
        id: op.id ?? defaultDeviceId(track, op.device.type),
        type: op.device.type,
        enabled: true,
        params: coerceParams(op.device.type, op.device.params),
      };
      if (track.devices.some((existing) => existing.id === device.id)) {
        throw new OpError(`Ya existe el dispositivo "${device.id}" en "${track.name}"`);
      }
      track.devices.push(device);
      return `Dispositivo añadido a ${track.name}: ${device.type} (${device.id})`;
    }

    case "set_device": {
      const track = resolveTrack(project, op.trackId);
      if (Object.keys(op.params).length === 0) throw new OpError("set_device necesita al menos un parámetro");
      const device = resolveDevice(track, op.deviceId);
      device.params = coerceParams(device.type, op.params, device.params);
      return `Parámetros de ${device.type} en ${track.name}: ${JSON.stringify(op.params)}`;
    }

    case "remove_device": {
      const track = resolveTrack(project, op.trackId);
      const device = resolveDevice(track, op.deviceId);
      track.devices = track.devices.filter((existing) => existing !== device);
      return `Dispositivo eliminado de ${track.name}: ${device.type}`;
    }

    case "set_master": {
      project.master.gainDb = op.gainDb;
      return `Master: ${op.gainDb} dB`;
    }

    default: {
      const exhaustive: never = op;
      throw new OpError(`Operación no soportada: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface ApplyResult {
  project: Project;
  results: string[];
  warnings: Issue[];
}

/**
 * Aplica operaciones de forma transaccional: si alguna falla o el proyecto
 * queda inválido, no se devuelve nada y el estado original queda intacto.
 */
export function applyOps(project: Project, ops: Op[]): ApplyResult {
  const normalized = parseOps(ops);
  const draft = structuredClone(project) as Project;
  const results: string[] = [];
  normalized.forEach((op, index) => {
    try {
      results.push(applyOne(draft, op));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OpError(`Operación #${index + 1} (${op.op}) falló: ${message}`);
    }
  });

  const issues = validateProject(draft);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new OpError(
      `El proyecto quedaría inválido y no se ha aplicado nada:\n${errors
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return { project: draft, results, warnings: issues.filter((issue) => issue.severity === "warning") };
}

export function instrumentProgram(track: Track): number {
  return track.instrument.program ?? INSTRUMENT_PROGRAM[track.instrument.type] ?? 0;
}
