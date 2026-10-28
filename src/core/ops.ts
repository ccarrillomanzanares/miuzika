/**
 * Operaciones: el vocabulario con el que la GUI modifica
 * el proyecto. Todo es validable, transaccional y reversible.
 */

import { z } from "zod";
import type { Clip, Device, DeviceType, Note, Project, Track } from "./types.ts";
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
  pitch: z.number().int().min(0).max(127).describe("Nota MIDI, 60 = Do central"),
  start: z.number().min(0).describe("Beats desde el inicio del clip"),
  duration: z.number().positive().describe("Duración en beats"),
  velocity: z.number().int().min(1).max(127).default(96),
});

const InstrumentSchema = z.object({
  type: z.enum(INSTRUMENT_TYPES),
  preset: z.string().max(64).optional(),
  program: z.number().int().min(0).max(127).optional(),
  /** .sf2 del instrumento, relativo al proyecto (sólo para `soundfont`). */
  archivo: z.string().max(200).optional(),
});

/**
 * El instrumento se acepta también como texto: el modelo escribe a menudo
 * `"instrument": "bass"` en vez de `{ "type": "bass" }` (pasó el 27-oct, y costó un
 * paso). Las dos formas significan lo mismo.
 */
const InstrumentInput = z.preprocess(
  (valor) => (typeof valor === "string" ? { type: valor.trim().toLowerCase() } : valor),
  InstrumentSchema,
);

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
  instrument: InstrumentInput.optional(),
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

/** Cambia el instrumento de una pista MIDI (p. ej. de sintetizador a guitarra General MIDI). */
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

const AddDeviceOp = z.object({
  op: z.literal("add_device"),
  trackId: IdSchema,
  id: IdSchema.optional(),
  // «"reverb"» vale igual que «{type:"reverb"}»: el modelo lo escribe así a menudo
  // (medido el 27-oct: tres add_device seguidos rechazados por eso).
  device: z.preprocess(
    (valor) => (typeof valor === "string" ? { type: valor.trim().toLowerCase() } : valor),
    z.object({
      type: z.enum(DEVICE_TYPES),
      params: z.record(z.string(), ParamValueSchema).optional(),
    }),
  ),
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
  /** Ruta del WAV en la carpeta del proyecto ("salida/x.wav"). */
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
  startBar: z.number().int().min(0).max(511).optional().describe("Mueve el clip a este compás"),
  offsetBeats: z.number().min(0).max(4096).optional(),
  lengthBeats: z.number().positive().max(4096).optional(),
  gainDb: GainSchema.optional(),
});

/**
 * Cambia la duracion de un clip, MIDI o de audio. Los clips se miden en compases:
 * el MIDI de un instrumento y el WAV del mismo material tienen que acabar en el
 * mismo compas, aunque el fichero MIDI acabe en su ultima nota y el WAV lleve cola.
 */
const SetClipLengthOp = z.object({
  op: z.literal("set_clip_length"),
  trackId: IdSchema,
  clipId: IdSchema,
  lengthBeats: z.number().positive().max(4096),
});

const MoveClipOp = z.object({
  op: z.literal("move_clip"),
  trackId: IdSchema.describe("Pista donde esta el clip"),
  clipId: IdSchema.describe("Id o nombre del clip"),
  startBeat: z.number().min(0).max(16384).describe("Nuevo inicio en beats desde el compas 1"),
  trackDestinoId: IdSchema.optional().describe("Pista destino si se arrastra en vertical"),
});

const DuplicateClipOp = z.object({
  op: z.literal("duplicate_clip"),
  trackId: IdSchema.describe("Pista donde esta el clip original"),
  clipId: IdSchema.describe("Id o nombre del clip original"),
  startBeat: z
    .number()
    .min(0)
    .max(16384)
    .optional()
    .describe("Inicio de la copia; por defecto, justo despues del original"),
  trackDestinoId: IdSchema.optional().describe("Pista destino de la copia"),
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
]);

const OpsSchema = z.array(OpSchema).min(1).max(200);

/** Nombres de las operaciones, en el orden del esquema. */
export const NOMBRES_OPS = OpSchema.options.map((schema) => schema.shape.op.value);

/**
 * Chuleta de las operaciones para el agente, SACADA DEL ESQUEMA: un campo nuevo
 * en una op aparece aquí sin tocar nada más. Una línea por op:
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

/** Valida y normaliza operaciones del proyecto. */
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

/**
 * Clip de una pista por id, por nombre exacto o por nombre parcial (si es único).
 *
 * No se cae al «único clip» cuando el nombre no coincide: con una pista de un solo
 * clip, `remove_clip` con un nombre mal escrito borraba el bueno sin decir nada.
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
    `No encuentro el clip "${ref}" en "${track.name}" (${track.clips.length} clip(s)). ` +
      `Disponibles: ${available || "ninguno"}`,
  );
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

/** Parte legible de un id ("Bajo eléctrico" → "bajo_electrico"); 24 puntos de código
 *  como mucho para que el id quepa en los 64 caracteres de IdSchema en cualquier alfabeto. */
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
      // Un nombre de antes del 28-oct (cutoff, time, threshold…): NO se convierte en
      // silencio, porque el modelo puede mandar «cutoff: 2000» creyendo que son Hz.
      // Se le dice el nombre nuevo y su unidad.
      const nuevo = Object.keys(migrarParametros(type, { [name]: 0 }))[0];
      const pista = nuevo && nuevo !== name && allowed[nuevo] ? ` Ahora se llama "${nuevo}" (${allowed[nuevo]![0]}..${allowed[nuevo]![1]}).` : "";
      throw new OpError(
        `El parámetro "${name}" no existe en ${type}.${pista} Disponibles: ${Object.entries(allowed)
          .map(([clave, [min, max]]) => `${clave} ${min}..${max}`)
          .join(", ")}`,
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

    case "set_instrument": {
      const track = resolveTrack(project, op.trackId);
      if (track.kind !== "midi") throw new OpError(`"${track.name}" es una pista de audio: no tiene instrumento`);
      track.instrument = { ...op.instrument };
      const programa = op.instrument.program !== undefined ? ` (programa GM ${op.instrument.program})` : "";
      return `Instrumento de ${track.name}: ${op.instrument.type}${programa}`;
    }

    case "remove_track": {
      const track = resolveTrack(project, op.trackId);
      project.tracks = project.tracks.filter((existing) => existing !== track);
      return `Pista eliminada: ${track.name} (${track.id})`;
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
        if (op.ruta) existing.ruta = op.ruta;
        return `Asset actualizado: ${op.name} (${op.durationBeats.toFixed(2)} beats)`;
      }
      assets.push({
        id: op.assetId,
        name: op.name,
        durationBeats: op.durationBeats,
        ...(op.ruta ? { ruta: op.ruta } : {}),
      });
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
      // Sin tope artificial: un stem de 6 minutos son 560 beats y antes se
      // recortaba a 64 compases (256 beats), asi que el audio acababa en el
      // compas 65 mientras el MIDI seguia hasta el 116.
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

    case "set_clip_length": {
      const track = resolveTrack(project, op.trackId);
      const clip = resolveClip(track, op.clipId);
      const barBeats = beatsPerBar(project);
      clip.length = Math.max(0.25, op.lengthBeats);
      project.lengthBars = Math.max(
        project.lengthBars,
        Math.ceil((clip.start + clip.length) / barBeats - 1e-6),
      );
      return `Clip ${clip.id} dura ${clip.length.toFixed(2)} beats`;
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
            `No se puede mover un clip de ${origen.kind} a una pista de ${destino.kind} ("${destino.name}")`,
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
      return `Clip movido: ${clip.id} a ${clip.start.toFixed(2)} beats en ${destino.name}`;
    }

    case "duplicate_clip": {
      const origen = resolveTrack(project, op.trackId);
      const clip = resolveClip(origen, op.clipId);
      const destino = op.trackDestinoId ? resolveTrack(project, op.trackDestinoId) : origen;
      if (destino.kind !== origen.kind) {
        throw new OpError(
          `No se puede duplicar un clip de ${origen.kind} en una pista de ${destino.kind} ("${destino.name}")`,
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
      return `Clip duplicado: ${copia.id} en ${destino.name} (${copia.start.toFixed(2)} beats)`;
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

interface ApplyResult {
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


