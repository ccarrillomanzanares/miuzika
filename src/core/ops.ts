/**
 * Operations: the vocabulary with which the GUI modifies
 * the project. Everything is validatable, transactional, and reversible.
 */

import { z } from "zod";
import type { Bus, Clip, Device, DeviceType, Note, Project, Track } from "./types.ts";
import {
  DEVICE_DEFAULTS,
  DEVICE_PARAMS,
  migrarParametros,
  DEVICE_TYPES,
  INSTRUMENT_TYPES,
  beatsPerBar,
} from "./types.ts";
import { MODE_NAMES, canonicalPitchClass, pitchClass } from "./theory.ts";
import { validateProject } from "./project.ts";
import type { Issue } from "./project.ts";
import { ParamValueSchema, numericParam } from "./params.ts";
import { slugDe } from "./nombres.ts";

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
  pitch: z.number().int().min(0).max(127).describe("MIDI note, 60 = middle C"),
  start: z.number().min(0).describe("Beats from the start of the clip"),
  duration: z.number().positive().describe("Duration in beats"),
  velocity: z.number().int().min(1).max(127).default(96),
});

const InstrumentSchema = z.object({
  type: z.enum(INSTRUMENT_TYPES),
  preset: z.string().max(64).optional(),
  program: z.number().int().min(0).max(127).optional(),
  /** Instrument .sf2, relative to the project (only for `soundfont`). */
  archivo: z.string().max(200).optional(),
});

/**
 * The instrument is also accepted as text: the model often writes
 * `"instrument": "bass"` instead of `{ "type": "bass" }` (it happened on Oct 27, and
 * cost a step). Both forms mean the same thing.
 */
const InstrumentInput = z.preprocess(
  (valor) => (typeof valor === "string" ? { type: valor.trim().toLowerCase() } : valor),
  InstrumentSchema,
);

const KeySchema = z.object({
  tonic: z.string().min(1).max(4).describe("Tonic: C, D, F#, Bb..."),
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
  instrument: InstrumentInput.optional(),
  gainDb: GainSchema.optional(),
  pan: z.number().min(-1).max(1).optional(),
});

const SetTrackOp = z.object({
  op: z.literal("set_track"),
  trackId: IdSchema.describe("Track id, exact name, or 1-based index"),
  name: z.string().min(1).max(60).optional(),
  gainDb: GainSchema.optional(),
  pan: z.number().min(-1).max(1).optional(),
  muted: z.boolean().optional(),
  solo: z.boolean().optional(),
});

/** Changes the instrument of a MIDI track (e.g. from synth to General MIDI guitar). */
const SetInstrumentOp = z.object({
  op: z.literal("set_instrument"),
  trackId: IdSchema,
  instrument: InstrumentInput,
});

const RemoveTrackOp = z.object({
  op: z.literal("remove_track"),
  trackId: IdSchema,
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

/**
 * A device: `"reverb"`, `{type, params}`, or with loose parameters
 * (`{type:"compressor", thresholdDb:-20}`).
 * - `"reverb"` is equivalent to `{type:"reverb"}`: the model often writes it that way
 *   (measured on Oct 27: three add_device calls in a row rejected because of that).
 * - Loose parameters are moved into `params`: before, zod dropped them without notice
 *   and the device kept the default values (measured on Oct 28 in "Hard": two
 *   compressors, an EQ, and a bus reverb, all without what the model asked for).
 *   A name that does not exist gives an error in `coerceParams`; it is not lost.
 */
const DeviceInput = z.preprocess(
  (valor) => {
    if (typeof valor === "string") return { type: valor.trim().toLowerCase() };
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return valor;
    // id and name are labels, not parameters: if the model puts them here, they are ignored.
    const { type, params, id: _id, name: _name, ...sueltos } = valor as Record<string, unknown>;
    if (Object.keys(sueltos).length === 0) return valor;
    const juntos = params && typeof params === "object" && !Array.isArray(params) ? { ...sueltos, ...params } : sueltos;
    return { type, params: juntos };
  },
  z.object({
    type: z.enum(DEVICE_TYPES),
    params: z.record(z.string(), ParamValueSchema).optional(),
  }),
);

const AddDeviceOp = z.object({
  op: z.literal("add_device"),
  trackId: IdSchema.describe("Track or bus (id or name)"),
  id: IdSchema.optional(),
  device: DeviceInput,
});

const SetDeviceOp = z.object({
  op: z.literal("set_device"),
  trackId: IdSchema.describe("Track or bus (id or name)"),
  deviceId: IdSchema.describe("Device id or type (e.g. 'reverb')"),
  params: z.record(z.string(), ParamValueSchema).describe("Only the parameters to change"),
});

const RemoveDeviceOp = z.object({
  op: z.literal("remove_device"),
  trackId: IdSchema.describe("Track or bus (id or name)"),
  deviceId: IdSchema,
});

/** Auxiliary bus with its effects ("reverb" or {type, params}); tracks send it signal with set_send. */
const AddBusOp = z.object({
  op: z.literal("add_bus"),
  id: IdSchema.optional(),
  name: z.string().min(1).max(60),
  gainDb: GainSchema.optional(),
  devices: z.array(DeviceInput).max(8).optional(),
});

const SetBusOp = z.object({
  op: z.literal("set_bus"),
  busId: IdSchema,
  name: z.string().min(1).max(60).optional(),
  gainDb: GainSchema.optional(),
});

const RemoveBusOp = z.object({
  op: z.literal("remove_bus"),
  busId: IdSchema,
});

/** How much a track sends to a bus (dB, post-fader). remove=true removes the send. */
const SetSendOp = z.object({
  op: z.literal("set_send"),
  trackId: IdSchema,
  busId: IdSchema,
  levelDb: GainSchema.optional(),
  remove: z.boolean().optional(),
});

const RegisterAudioAssetOp = z.object({
  op: z.literal("register_audio_asset"),
  assetId: IdSchema,
  name: z.string().min(1).max(80),
  durationBeats: z.number().positive().max(4096),
  /** WAV path in the project folder ("salida/x.wav"). */
  ruta: z.string().min(1).max(200).optional(),
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
  startBar: z.number().int().min(0).max(511).optional().describe("Moves the clip to this bar"),
  offsetBeats: z.number().min(0).max(4096).optional(),
  lengthBeats: z.number().positive().max(4096).optional(),
  gainDb: GainSchema.optional(),
});

/**
 * Changes the duration of a clip, MIDI or audio. Clips are measured in bars: the
 * MIDI of an instrument and the WAV of the same material must end at the same bar,
 * even if the MIDI file ends on its last note and the WAV has a tail.
 */
const SetClipLengthOp = z.object({
  op: z.literal("set_clip_length"),
  trackId: IdSchema,
  clipId: IdSchema,
  lengthBeats: z.number().positive().max(4096),
});

const MoveClipOp = z.object({
  op: z.literal("move_clip"),
  trackId: IdSchema.describe("Track where the clip is"),
  clipId: IdSchema.describe("Clip id or name"),
  startBeat: z.number().min(0).max(16384).describe("New start in beats from bar 1"),
  trackDestinoId: IdSchema.optional().describe("Destination track when dragging vertically"),
});

const DuplicateClipOp = z.object({
  op: z.literal("duplicate_clip"),
  trackId: IdSchema.describe("Track where the original clip is"),
  clipId: IdSchema.describe("Original clip id or name"),
  startBeat: z
    .number()
    .min(0)
    .max(16384)
    .optional()
    .describe("Start of the copy; by default, right after the original"),
  trackDestinoId: IdSchema.optional().describe("Destination track of the copy"),
  name: z.string().max(60).optional(),
});

const SetMasterOp = z.object({
  op: z.literal("set_master"),
  gainDb: GainSchema,
});

const OpSchema = z.discriminatedUnion("op", [
  SetSongOp,
  AddTrackOp,
  SetTrackOp,
  SetInstrumentOp,
  RemoveTrackOp,
  AddNotesOp,
  ReplaceClipNotesOp,
  RemoveClipOp,
  AddDeviceOp,
  SetDeviceOp,
  RemoveDeviceOp,
  RegisterAudioAssetOp,
  AddAudioClipOp,
  SetAudioClipOp,
  SetClipLengthOp,
  MoveClipOp,
  DuplicateClipOp,
  SetMasterOp,
  AddBusOp,
  SetBusOp,
  RemoveBusOp,
  SetSendOp,
]);

const OpsSchema = z.array(OpSchema).min(1).max(200);

/** Operation names, in schema order. */
export const NOMBRES_OPS = OpSchema.options.map((schema) => schema.shape.op.value);

/**
 * Cheat sheet of the operations for the agent, TAKEN FROM THE SCHEMA: a new field
 * in an op appears here without touching anything else. One line per op:
 * `add_notes(trackId, notes, clipId?, startBar?, name?)`.
 */
export function firmasDeOps(): string {
  return OpSchema.options
    .map((schema) => {
      const campos = Object.entries(schema.shape as Record<string, z.ZodType>)
        .filter(([clave]) => clave !== "op")
        .map(([clave, campo]) => (campo.safeParse(undefined).success ? `${clave}?` : clave));
      return `${schema.shape.op.value}(${campos.join(", ")})`;
    })
    .join("\n");
}

export type Op = z.input<typeof OpSchema>;
type ParsedOp = z.output<typeof OpSchema>;

/** Validates and normalizes project operations. */
export function parseOps(value: unknown): ParsedOp[] {
  const result = OpsSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new OpError(`Invalid operations: ${detail}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Reference resolution
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
  throw new OpError(`I can't find track "${ref}". Available: ${available || "none"}`);
}

/**
 * A track's clip by id, exact name, or partial name (if unique).
 *
 * It does not fall back to "the only clip" when the name does not match: on a track
 * with a single clip, `remove_clip` with a misspelled name deleted the right one
 * without saying anything.
 */
function resolveClip(track: Track, ref: string) {
  const cleaned = ref.trim();
  const byId = track.clips.find((clip) => clip.id === cleaned);
  if (byId) return byId;
  const lower = cleaned.toLowerCase();
  const byName = track.clips.filter((clip) => clip.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0]!;
  const byParcial = track.clips.filter((clip) => clip.name.toLowerCase().includes(lower));
  if (lower !== "" && byParcial.length === 1) return byParcial[0]!;
  const available = track.clips.map((clip) => `${clip.id}(${clip.name})`).join(", ");
  throw new OpError(
    `I can't find clip "${ref}" on "${track.name}" (${track.clips.length} clip(s)). ` +
      `Available: ${available || "none"}`,
  );
}

function resolveBus(project: Project, ref: string): Bus {
  const buses = project.buses ?? [];
  const cleaned = ref.trim();
  const lower = cleaned.toLowerCase();
  const porNombre = buses.filter((bus) => bus.name.toLowerCase() === lower);
  const encontrado = buses.find((bus) => bus.id === cleaned) ?? (porNombre.length === 1 ? porNombre[0] : undefined);
  if (encontrado) return encontrado;
  const available = buses.map((bus) => `${bus.id}(${bus.name})`).join(", ");
  throw new OpError(`I can't find bus "${ref}". Available: ${available || "none (create it with add_bus)"}`);
}

/**
 * Where the add_device/set_device/remove_device effects go: a track or, if there is
 * no track with that name, a bus. This way the agent does not learn another op for
 * the same thing.
 */
function resolveCadena(project: Project, ref: string): { name: string; devices: Device[]; poner(devices: Device[]): void } {
  let track: Track;
  try {
    track = resolveTrack(project, ref);
  } catch (errorPista) {
    const buses = project.buses ?? [];
    if (buses.length === 0) throw errorPista;
    let bus: Bus;
    try {
      bus = resolveBus(project, ref);
    } catch {
      const lista = buses.map((b) => `${b.id}(${b.name})`).join(", ");
      throw new OpError(`${(errorPista as Error).message}. Buses: ${lista}`);
    }
    return { name: `bus ${bus.name}`, devices: bus.devices, poner: (devices) => (bus.devices = devices) };
  }
  return { name: track.name, devices: track.devices, poner: (devices) => (track.devices = devices) };
}

function resolveDevice(track: { name: string; devices: Device[] }, ref: string): Device {
  const cleaned = ref.trim().toLowerCase();
  const byId = track.devices.find((device) => device.id.toLowerCase() === cleaned);
  if (byId) return byId;
  const byType = track.devices.filter((device) => device.type === cleaned);
  if (byType.length === 1) return byType[0]!;
  if (byType.length > 1) throw new OpError(`There are ${byType.length} devices "${cleaned}" on "${track.name}"; use the id`);
  const available = track.devices.map((device) => `${device.id}(${device.type})`).join(", ");
  throw new OpError(`"${track.name}" does not have the device "${ref}". It has: ${available || "none"}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Readable part of an id ("Bajo eléctrico" → "bajo_electrico"); 24 code points
 *  at most so the id fits within IdSchema's 64 characters in any alphabet. */
function slugify(name: string): string {
  return slugDe(name, { separador: "_", max: 24, defecto: "x" });
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
      // A pre-Oct-28 name (cutoff, time, threshold…): it does NOT become silence,
      // because the model may send "cutoff: 2000" believing those are Hz.
      // It is told the new name and its unit.
      const nuevo = Object.keys(migrarParametros(type, { [name]: 0 }))[0];
      const pista = nuevo && nuevo !== name && allowed[nuevo] ? ` It is now called "${nuevo}" (${allowed[nuevo]![0]}..${allowed[nuevo]![1]}).` : "";
      throw new OpError(
        `The parameter "${name}" does not exist in ${type}.${pista} Available: ${Object.entries(allowed)
          .map(([clave, [min, max]]) => `${clave} ${min}..${max}`)
          .join(", ")}`,
      );
    }
    if (!Number.isFinite(value)) throw new OpError(`The parameter "${name}" is not a valid number`);
    result[name] = Number(Math.max(range[0], Math.min(range[1], value)).toFixed(3));
  }
  return result;
}

function defaultDeviceId(track: { devices: Device[] }, type: DeviceType): string {
  const base = `dev_${type}`;
  let index = 1;
  while (track.devices.some((device) => device.id === `${base}_${index}`)) index++;
  return `${base}_${index}`;
}

// ---------------------------------------------------------------------------
// Application
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
          throw new OpError(`Invalid tonic: "${op.key.tonic}"`);
        }
        project.key = { tonic: canonicalPitchClass(op.key.tonic), mode: op.key.mode };
      }
      return `Song: ${project.name} · ${project.bpm} BPM · ${project.key.tonic} ${project.key.mode} · ${project.lengthBars} bars`;
    }

    case "add_track": {
      const track = createTrack(project, op.name, op.instrument);
      track.kind = op.kind;
      if (op.id) {
        if (project.tracks.some((existing) => existing.id === op.id && existing !== track)) {
          throw new OpError(`A track with id "${op.id}" already exists`);
        }
        track.id = op.id;
      }
      if (op.gainDb !== undefined) track.gainDb = op.gainDb;
      if (op.pan !== undefined) track.pan = op.pan;
      return `Track created: ${track.name} (${track.id})`;
    }

    case "set_track": {
      const track = resolveTrack(project, op.trackId);
      if (op.name !== undefined) track.name = op.name;
      if (op.gainDb !== undefined) track.gainDb = op.gainDb;
      if (op.pan !== undefined) track.pan = op.pan;
      if (op.muted !== undefined) track.muted = op.muted;
      if (op.solo !== undefined) track.solo = op.solo;
      return `Track updated: ${track.name} (${track.id})`;
    }

    case "set_instrument": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "midi") throw new OpError(`"${track.name}" is an audio track: it has no instrument`);
      track.instrument = { ...op.instrument };
      const programa = op.instrument.program !== undefined ? ` (GM program ${op.instrument.program})` : "";
      return `Instrument on ${track.name}: ${op.instrument.type}${programa}`;
    }

    case "remove_track": {
      const track = resolveTrack(project, op.trackId);
      project.tracks = project.tracks.filter((existing) => existing !== track);
      return `Track removed: ${track.name} (${track.id})`;
    }

    case "add_notes": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "midi") throw new OpError(`"${track.name}" is an audio track`);
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
      return `Added ${notes.length} notes to ${track.name}`;
    }

    case "replace_clip_notes": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      clip.notes = op.notes.map((note) => ({ ...note }));
      clip.length = Math.max(clip.length, ...clip.notes.map((note) => note.start + note.duration));
      return `Clip ${clip.id} replaced with ${clip.notes.length} notes`;
    }

    case "remove_clip": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      track.clips = track.clips.filter((existing) => existing !== clip);
      return `Clip removed: ${clip.id} from ${track.name}`;
    }

    case "register_audio_asset": {
      const assets = (project.audioAssets ??= []);
      const existing = assets.find((asset) => asset.id === op.assetId);
      if (existing) {
        existing.name = op.name;
        existing.durationBeats = op.durationBeats;
        if (op.ruta) existing.ruta = op.ruta;
        return `Asset updated: ${op.name} (${op.durationBeats.toFixed(2)} beats)`;
      }
      assets.push({
        id: op.assetId,
        name: op.name,
        durationBeats: op.durationBeats,
        ...(op.ruta ? { ruta: op.ruta } : {}),
      });
      return `Asset registered: ${op.name} (${op.durationBeats.toFixed(2)} beats)`;
    }

    case "add_audio_clip": {
      const assets = (project.audioAssets ??= []);
      const asset = assets.find((candidate) => candidate.id === op.assetId);
      if (!asset) {
        throw new OpError(
          `Asset "${op.assetId}" does not exist. Registered: ${assets.map((candidate) => candidate.id).join(", ") || "none"}`,
        );
      }
      let track = op.trackId ? resolveTrack(project, op.trackId) : undefined;
      if (!track) {
        track = createTrack(project, op.track?.name ?? "Audio", { type: "sampler" });
        track.kind = "audio";
      }
      if (track.kind !== "audio") throw new OpError(`"${track.name}" is not an audio track`);

      const barBeats = beatsPerBar(project);
      const start = op.startBar * barBeats;
      const offset = op.offsetBeats ?? 0;
      const available = Math.max(0.25, asset.durationBeats - offset);
      // No artificial cap: a 6-minute stem is 560 beats and used to be trimmed to
      // 64 bars (256 beats), so the audio ended at bar 65 while the MIDI went on to 116.
      const length = Math.min(op.lengthBeats ?? available, available);
      track.clips.push({
        id: nextClipId(project),
        name: op.name ?? asset.name,
        start,
        length,
        notes: [],
        audio: { assetId: asset.id, offset, gainDb: op.gainDb ?? 0 },
      });
      project.lengthBars = Math.max(project.lengthBars, Math.ceil((start + length) / barBeats));
      return `Audio placed: ${asset.name} · ${length.toFixed(2)} beats on ${track.name}`;
    }

    case "set_audio_clip": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "audio") throw new OpError(`"${track.name}" is not an audio track`);
      const clip = resolveClip(track, op.clipId);
      if (!clip.audio) throw new OpError(`Clip "${clip.id}" is not an audio clip`);
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
      return `Audio clip updated: ${clip.id}`;
    }

    case "set_clip_length": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      const barBeats = beatsPerBar(project);
      clip.length = Math.max(0.25, op.lengthBeats);
      project.lengthBars = Math.max(
        project.lengthBars,
        Math.ceil((clip.start + clip.length) / barBeats - 1e-6),
      );
      return `Clip ${clip.id} lasts ${clip.length.toFixed(2)} beats`;
    }

    case "move_clip": {
      const origen = resolveTrack(project, op.trackId);
      const clip = resolveClip(origen, op.clipId);
      const barBeats = beatsPerBar(project);
      let destino = origen;
      if (op.trackDestinoId && op.trackDestinoId !== origen.id) {
        destino = resolveTrack(project, op.trackDestinoId);
        if (destino.kind !== origen.kind) {
          throw new OpError(
            `Cannot move a ${origen.kind} clip to a ${destino.kind} track ("${destino.name}")`,
          );
        }
        origen.clips = origen.clips.filter((existing) => existing !== clip);
        destino.clips.push(clip);
      }
      clip.start = Math.max(0, op.startBeat);
      project.lengthBars = Math.max(
        project.lengthBars,
        Math.ceil((clip.start + clip.length) / barBeats),
      );
      return `Clip moved: ${clip.id} to ${clip.start.toFixed(2)} beats on ${destino.name}`;
    }

    case "duplicate_clip": {
      const origen = resolveTrack(project, op.trackId);
      const clip = resolveClip(origen, op.clipId);
      const destino = op.trackDestinoId ? resolveTrack(project, op.trackDestinoId) : origen;
      if (destino.kind !== origen.kind) {
        throw new OpError(
          `Cannot duplicate a ${origen.kind} clip onto a ${destino.kind} track ("${destino.name}")`,
        );
      }
      const barBeats = beatsPerBar(project);
      const copia: Clip = {
        id: nextClipId(project),
        name: op.name ?? clip.name,
        start: Math.max(0, op.startBeat ?? clip.start + clip.length),
        length: clip.length,
        notes: clip.notes.map((nota) => ({ ...nota })),
      };
      if (clip.audio) copia.audio = { ...clip.audio };
      if (clip.origin) copia.origin = { ...clip.origin };
      destino.clips.push(copia);
      project.lengthBars = Math.max(
        project.lengthBars,
        Math.ceil((copia.start + copia.length) / barBeats),
      );
      return `Clip duplicated: ${copia.id} on ${destino.name} (${copia.start.toFixed(2)} beats)`;
    }

    case "add_device": {
      const track = resolveCadena(project, op.trackId);
      const device: Device = {
        id: op.id ?? defaultDeviceId(track, op.device.type),
        type: op.device.type,
        enabled: true,
        params: coerceParams(op.device.type, op.device.params),
      };
      if (track.devices.some((existing) => existing.id === device.id)) {
        throw new OpError(`Device "${device.id}" already exists on "${track.name}"`);
      }
      track.devices.push(device);
      return `Device added to ${track.name}: ${device.type} (${device.id})`;
    }

    case "set_device": {
      const track = resolveCadena(project, op.trackId);
      if (Object.keys(op.params).length === 0) throw new OpError("set_device needs at least one parameter");
      const device = resolveDevice(track, op.deviceId);
      device.params = coerceParams(device.type, op.params, device.params);
      return `Parameters of ${device.type} on ${track.name}: ${JSON.stringify(op.params)}`;
    }

    case "remove_device": {
      const track = resolveCadena(project, op.trackId);
      const device = resolveDevice(track, op.deviceId);
      track.poner(track.devices.filter((existing) => existing !== device));
      return `Device removed from ${track.name}: ${device.type}`;
    }

    case "set_master": {
      project.master.gainDb = op.gainDb;
      return `Master: ${op.gainDb} dB`;
    }

    case "add_bus": {
      const buses = (project.buses ??= []);
      const id = op.id ?? uniqueId("bus_", slugify(op.name), buses.map((bus) => bus.id));
      if (buses.some((bus) => bus.id === id)) throw new OpError(`A bus with id "${id}" already exists`);
      if (project.tracks.some((track) => track.id === id || track.name.toLowerCase() === op.name.toLowerCase())) {
        throw new OpError(`There is already a track named "${op.name}": give the bus another name`);
      }
      const bus: Bus = { id, name: op.name, gainDb: op.gainDb ?? 0, devices: [] };
      for (const entrada of op.devices ?? []) {
        bus.devices.push({
          id: defaultDeviceId(bus, entrada.type),
          type: entrada.type,
          enabled: true,
          params: coerceParams(entrada.type, entrada.params),
        });
      }
      buses.push(bus);
      const efectos = bus.devices.map((device) => device.type).join(", ") || "no effects";
      return `Bus created: ${bus.name} (${bus.id}) with ${efectos}. Send it signal with set_send.`;
    }

    case "set_bus": {
      const bus = resolveBus(project, op.busId);
      if (op.name !== undefined) bus.name = op.name;
      if (op.gainDb !== undefined) bus.gainDb = op.gainDb;
      return `Bus updated: ${bus.name} (${bus.id}) · ${bus.gainDb} dB`;
    }

    case "remove_bus": {
      const bus = resolveBus(project, op.busId);
      project.buses = (project.buses ?? []).filter((existing) => existing !== bus);
      let quitados = 0;
      for (const track of project.tracks) {
        if (!track.sends) continue;
        const quedan = track.sends.filter((send) => send.busId !== bus.id);
        quitados += track.sends.length - quedan.length;
        if (quedan.length > 0) track.sends = quedan;
        else delete track.sends;
      }
      return `Bus removed: ${bus.name}${quitados ? ` (and ${quitados} send(s) to it)` : ""}`;
    }

    case "set_send": {
      const track = resolveTrack(project, op.trackId);
      const bus = resolveBus(project, op.busId);
      const sends = track.sends ?? [];
      const existente = sends.find((send) => send.busId === bus.id);
      if (op.remove) {
        const quedan = sends.filter((send) => send !== existente);
        if (quedan.length > 0) track.sends = quedan;
        else delete track.sends;
        return existente ? `Send removed: ${track.name} → ${bus.name}` : `${track.name} was not sending anything to ${bus.name}`;
      }
      if (op.levelDb === undefined) throw new OpError("set_send needs levelDb (dB the track sends to the bus) or remove=true");
      if (existente) existente.levelDb = op.levelDb;
      else sends.push({ busId: bus.id, levelDb: op.levelDb });
      track.sends = sends;
      return `Send: ${track.name} → ${bus.name} at ${op.levelDb} dB`;
    }

    default: {
      const exhaustive: never = op;
      throw new OpError(`Unsupported operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

interface ApplyResult {
  project: Project;
  results: string[];
  warnings: Issue[];
}

/**
 * Applies operations transactionally: if any fails or the project ends up invalid,
 * nothing is returned and the original state stays untouched.
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
      throw new OpError(`Operation #${index + 1} (${op.op}) failed: ${message}`);
    }
  });

  const issues = validateProject(draft);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new OpError(
      `The project would become invalid and nothing has been applied:\n${errors
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return { project: draft, results, warnings: issues.filter((issue) => issue.severity === "warning") };
}


