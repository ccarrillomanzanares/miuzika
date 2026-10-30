/** Project creation and validation. */

import type { Device, Note, Project, Track } from "./types.ts";
import { DEVICE_PARAMS, beatsPerBar, migrarParametros } from "./types.ts";
import type { Mode } from "./types.ts";
import { MODES } from "./theory.ts";
import { hashString } from "./rng.ts";
import { slugDe } from "./nombres.ts";

/**
 * Brings a project read from disk up to date: today, effect parameters using the
 * pre-Oct-28 names (0..1) become real units. It mutates and returns the same
 * object. Without this, any edit to an old project failed validation with
 * "Unknown parameter".
 */
export function migrarProyecto(project: Project): Project {
  for (const cadena of [...(project.tracks ?? []), ...(project.buses ?? [])]) {
    for (const device of cadena.devices ?? []) {
      if (device && DEVICE_PARAMS[device.type]) device.params = migrarParametros(device.type, device.params ?? {});
    }
  }
  return project;
}

/** Folder slug from a project name (in any alphabet). */
export function carpetaDeNombre(nombre: string): string {
  return slugDe(nombre, { max: 40, defecto: "proyecto" });
}

/** Project folder: the one fixed at creation or, in old projects, the one from its name. */
export function carpetaDeProyecto(project: Project): string {
  return project.meta.carpeta || carpetaDeNombre(project.name);
}

export interface Issue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

interface CreateProjectInput {
  name?: string;
  bpm?: number;
  key?: { tonic: string; mode: Mode };
  lengthBars?: number;
  seed?: number;
  prompt?: string;
  /** Folder in `workspace/proyectos/`; by default, the one from the name. */
  carpeta?: string;
}

export function createProject(input: CreateProjectInput = {}): Project {
  const name = input.name ?? "Untitled";
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `prj_${hashString(`${name}|${now}`).toString(16)}`,
    name,
    bpm: input.bpm ?? 100,
    key: input.key ?? { tonic: "D", mode: "minor" },
    timeSignature: { numerator: 4, denominator: 4 },
    lengthBars: input.lengthBars ?? 32,
    seed: input.seed ?? 1,
    tracks: [],
    audioAssets: [],
    master: { gainDb: -1 },
    meta: {
      generator: "miuzika",
      createdAt: now,
      carpeta: input.carpeta ?? carpetaDeNombre(name),
      ...(input.prompt ? { prompt: input.prompt } : {}),
    },
  };
}

export function emptyTrack(track: Omit<Track, "clips" | "devices"> & Partial<Pick<Track, "clips" | "devices">>): Track {
  return { ...track, devices: track.devices ?? [], clips: track.clips ?? [] };
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  if (project.schemaVersion !== 1) error("schemaVersion", "Must be 1");
  if (!Number.isFinite(project.bpm) || project.bpm < 20 || project.bpm > 300) error("bpm", "Must be between 20 and 300");
  if (!Number.isInteger(project.lengthBars) || project.lengthBars < 1 || project.lengthBars > 512) {
    error("lengthBars", "Integer between 1 and 512");
  }
  if (!Number.isInteger(project.seed)) error("seed", "Must be an integer");
  if (!MODES.includes(project.key.mode)) error("key.mode", `Unknown mode: ${project.key.mode}`);
  if (project.timeSignature.numerator !== 4 || project.timeSignature.denominator !== 4) {
    warn("timeSignature", "The pattern engine assumes 4/4");
  }
  if (project.tracks.length === 0) warn("tracks", "Project with no tracks");
  if (project.tracks.length > 64) error("tracks", "Maximum 64 tracks");

  const assetIds = new Set<string>();
  (project.audioAssets ?? []).forEach((asset, index) => {
    const path = `audioAssets[${index}]`;
    if (!asset.id) error(`${path}.id`, "Missing id");
    if (assetIds.has(asset.id)) error(`${path}.id`, `Duplicate id: ${asset.id}`);
    assetIds.add(asset.id);
    if (!(asset.durationBeats > 0)) error(`${path}.durationBeats`, "Must be > 0");
  });

  const busIds = new Set<string>();
  (project.buses ?? []).forEach((bus, index) => {
    const path = `buses[${index}]`;
    if (!bus.id) error(`${path}.id`, "Missing id");
    if (busIds.has(bus.id)) error(`${path}.id`, `Duplicate id: ${bus.id}`);
    busIds.add(bus.id);
    if (!bus.name?.trim()) error(`${path}.name`, "Empty name");
    if (!Number.isFinite(bus.gainDb) || bus.gainDb < -60 || bus.gainDb > 12) error(`${path}.gainDb`, "Must be between -60 and 12 dB");
    validateDevices(bus.devices, path, error);
  });
  if (busIds.size > 16) error("buses", "Maximum 16 buses");

  const trackIds = new Set<string>();
  const barBeats = beatsPerBar(project);
  let totalNotes = 0;

  project.tracks.forEach((track, trackIndex) => {
    const path = `tracks[${trackIndex}]`;
    if (!track.id) error(`${path}.id`, "Missing id");
    if (trackIds.has(track.id)) error(`${path}.id`, `Duplicate id: ${track.id}`);
    trackIds.add(track.id);
    if (!track.name.trim()) error(`${path}.name`, "Empty name");
    if (!Number.isFinite(track.gainDb) || track.gainDb < -60 || track.gainDb > 12) {
      error(`${path}.gainDb`, "Must be between -60 and 12 dB");
    }
    if (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1) {
      error(`${path}.pan`, "Must be between -1 and 1");
    }
    if (track.clips.length === 0) warn(`${path}.clips`, "Track with no clips");

    validateDevices(track.devices, path, error);

    (track.sends ?? []).forEach((send, sendIndex) => {
      const sendPath = `${path}.sends[${sendIndex}]`;
      // Warning and not error: restoring a track from an old version can bring a
      // send to a bus that no longer exists, and that should not block the rest. Without a bus, it does not play.
      if (!busIds.has(send.busId)) warn(`${sendPath}.busId`, `Bus "${send.busId}" does not exist: the send does not play`);
      if (!Number.isFinite(send.levelDb) || send.levelDb < -60 || send.levelDb > 12) {
        error(`${sendPath}.levelDb`, "Must be between -60 and 12 dB");
      }
    });

    const clipIds = new Set<string>();
    track.clips.forEach((clip, clipIndex) => {
      const clipPath = `${path}.clips[${clipIndex}]`;
      if (clipIds.has(clip.id)) error(`${clipPath}.id`, `Duplicate id: ${clip.id}`);
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.start) || clip.start < 0) error(`${clipPath}.start`, "Must be >= 0");
      if (!Number.isFinite(clip.length) || clip.length <= 0) error(`${clipPath}.length`, "Must be > 0");
      if (clip.notes.length > 20000) error(`${clipPath}.notes`, "Too many notes in a clip (max. 20000)");
      totalNotes += clip.notes.length;

      if (clip.audio) {
        if (!clip.audio.assetId) error(`${clipPath}.audio.assetId`, "Missing asset");
        if (!Number.isFinite(clip.audio.offset) || clip.audio.offset < 0) {
          error(`${clipPath}.audio.offset`, "Must be >= 0");
        }
        if (!Number.isFinite(clip.audio.gainDb) || clip.audio.gainDb < -60 || clip.audio.gainDb > 12) {
          error(`${clipPath}.audio.gainDb`, "Must be between -60 and 12 dB");
        }
        if (assetIds.size > 0 && !assetIds.has(clip.audio.assetId)) {
          warn(`${clipPath}.audio.assetId`, `Asset "${clip.audio.assetId}" is not registered in audioAssets`);
        }
      }

      clip.notes.forEach((note, noteIndex) => {
        validateNote(note, `${clipPath}.notes[${noteIndex}]`, error);
      });

      const end = clip.start + clip.length;
      if (end > project.lengthBars * barBeats + 1e-6) {
        warn(`${clipPath}`, `The clip ends at bar ${(end / barBeats).toFixed(2)}, beyond lengthBars`);
      }
    });

    if (track.kind === "audio" && track.clips.some((clip) => clip.notes.length > 0)) {
      warn(`${path}.clips`, "An audio track contains MIDI notes");
    }

    // Overlaps within the same track: warning, not error.
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      if (current.start < previous.start + previous.length - 1e-6) {
        warn(`${path}.clips`, `Clips "${previous.name}" and "${current.name}" overlap`);
      }
    }
  });

  if (totalNotes > 200000) error("notes", "The project exceeds 200,000 notes");

  return issues;
}

/** Effects on a track or a bus: unique ids and known, in-range parameters. */
function validateDevices(devices: Device[], path: string, error: (path: string, message: string) => void): void {
  const deviceIds = new Set<string>();
  devices.forEach((device, deviceIndex) => {
    const devicePath = `${path}.devices[${deviceIndex}]`;
    if (deviceIds.has(device.id)) error(`${devicePath}.id`, `Duplicate id: ${device.id}`);
    deviceIds.add(device.id);
    for (const [name, value] of Object.entries(device.params)) {
      const range = DEVICE_PARAMS[device.type]?.[name];
      if (!range) {
        error(`${devicePath}.params.${name}`, `Unknown parameter for ${device.type}`);
        continue;
      }
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
        error(`${devicePath}.params.${name}`, `Out of range [${range[0]}, ${range[1]}]: ${value}`);
      }
    }
  });
}

function validateNote(note: Note, path: string, error: (path: string, message: string) => void): void {
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) error(`${path}.pitch`, "Integer 0..127");
  if (!Number.isFinite(note.start) || note.start < 0) error(`${path}.start`, "Must be >= 0");
  if (!Number.isFinite(note.duration) || note.duration <= 0) error(`${path}.duration`, "Must be > 0");
  if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) {
    error(`${path}.velocity`, "Integer 1..127");
  }
}

/**
 * Asset ids the project references (declared or inside a clip).
 *
 * It lives here and not in the browser because all three things that manage audio
 * need it: the master file, the in-memory cache, and the RAM garbage collector.
 */
export function idsDeAssets(project: Project): string[] {
  const ids = new Set<string>();
  for (const asset of project.audioAssets ?? []) ids.add(asset.id);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio) ids.add(clip.audio.assetId);
    }
  }
  return [...ids];
}

interface ProjectStats {
  tracks: number;
  clips: number;
  notes: number;
  bars: number;
  seconds: number;
  midiTracks: number;
  audioTracks: number;
}

export function projectStats(project: Project): ProjectStats {
  const notes = project.tracks.reduce(
    (sum, track) => sum + track.clips.reduce((clipSum, clip) => clipSum + clip.notes.length, 0),
    0,
  );
  const clips = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  return {
    tracks: project.tracks.length,
    clips,
    notes,
    bars: project.lengthBars,
    seconds: (project.lengthBars * beatsPerBar(project) * 60) / project.bpm,
    midiTracks: project.tracks.filter((track) => track.kind === "midi").length,
    audioTracks: project.tracks.filter((track) => track.kind === "audio").length,
  };
}
