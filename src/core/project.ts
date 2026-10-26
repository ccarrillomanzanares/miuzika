/** Creación y validación de proyectos. */

import type { Note, Project, Track } from "./types.ts";
import { DEVICE_PARAMS, beatsPerBar } from "./types.ts";
import type { Mode } from "./types.ts";
import { MODES } from "./theory.ts";
import { hashString } from "./rng.ts";

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
}

export function createProject(input: CreateProjectInput = {}): Project {
  const name = input.name ?? "Sin título";
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
    meta: { generator: "miuzika", createdAt: now, ...(input.prompt ? { prompt: input.prompt } : {}) },
  };
}

export function emptyTrack(track: Omit<Track, "clips" | "devices"> & Partial<Pick<Track, "clips" | "devices">>): Track {
  return { ...track, devices: track.devices ?? [], clips: track.clips ?? [] };
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  if (project.schemaVersion !== 1) error("schemaVersion", "Debe ser 1");
  if (!Number.isFinite(project.bpm) || project.bpm < 20 || project.bpm > 300) error("bpm", "Debe estar entre 20 y 300");
  if (!Number.isInteger(project.lengthBars) || project.lengthBars < 1 || project.lengthBars > 512) {
    error("lengthBars", "Entero entre 1 y 512");
  }
  if (!Number.isInteger(project.seed)) error("seed", "Debe ser un entero");
  if (!MODES.includes(project.key.mode)) error("key.mode", `Modo desconocido: ${project.key.mode}`);
  if (project.timeSignature.numerator !== 4 || project.timeSignature.denominator !== 4) {
    warn("timeSignature", "El motor de patrones asume 4/4");
  }
  if (project.tracks.length === 0) warn("tracks", "Proyecto sin pistas");
  if (project.tracks.length > 64) error("tracks", "Máximo 64 pistas");

  const assetIds = new Set<string>();
  (project.audioAssets ?? []).forEach((asset, index) => {
    const path = `audioAssets[${index}]`;
    if (!asset.id) error(`${path}.id`, "Falta el id");
    if (assetIds.has(asset.id)) error(`${path}.id`, `Id duplicado: ${asset.id}`);
    assetIds.add(asset.id);
    if (!(asset.durationBeats > 0)) error(`${path}.durationBeats`, "Debe ser > 0");
  });

  const trackIds = new Set<string>();
  const barBeats = beatsPerBar(project);
  let totalNotes = 0;

  project.tracks.forEach((track, trackIndex) => {
    const path = `tracks[${trackIndex}]`;
    if (!track.id) error(`${path}.id`, "Falta el id");
    if (trackIds.has(track.id)) error(`${path}.id`, `Id duplicado: ${track.id}`);
    trackIds.add(track.id);
    if (!track.name.trim()) error(`${path}.name`, "Nombre vacío");
    if (!Number.isFinite(track.gainDb) || track.gainDb < -60 || track.gainDb > 12) {
      error(`${path}.gainDb`, "Debe estar entre -60 y 12 dB");
    }
    if (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1) {
      error(`${path}.pan`, "Debe estar entre -1 y 1");
    }
    if (track.clips.length === 0) warn(`${path}.clips`, "Pista sin clips");

    const deviceIds = new Set<string>();
    track.devices.forEach((device, deviceIndex) => {
      const devicePath = `${path}.devices[${deviceIndex}]`;
      if (deviceIds.has(device.id)) error(`${devicePath}.id`, `Id duplicado: ${device.id}`);
      deviceIds.add(device.id);
      for (const [name, value] of Object.entries(device.params)) {
        const range = DEVICE_PARAMS[device.type]?.[name];
        if (!range) {
          error(`${devicePath}.params.${name}`, `Parámetro desconocido para ${device.type}`);
          continue;
        }
        if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
          error(`${devicePath}.params.${name}`, `Fuera de rango [${range[0]}, ${range[1]}]: ${value}`);
        }
      }
    });

    const clipIds = new Set<string>();
    track.clips.forEach((clip, clipIndex) => {
      const clipPath = `${path}.clips[${clipIndex}]`;
      if (clipIds.has(clip.id)) error(`${clipPath}.id`, `Id duplicado: ${clip.id}`);
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.start) || clip.start < 0) error(`${clipPath}.start`, "Debe ser >= 0");
      if (!Number.isFinite(clip.length) || clip.length <= 0) error(`${clipPath}.length`, "Debe ser > 0");
      if (clip.notes.length > 20000) error(`${clipPath}.notes`, "Demasiadas notas en un clip (máx. 20000)");
      totalNotes += clip.notes.length;

      if (clip.audio) {
        if (!clip.audio.assetId) error(`${clipPath}.audio.assetId`, "Falta el asset");
        if (!Number.isFinite(clip.audio.offset) || clip.audio.offset < 0) {
          error(`${clipPath}.audio.offset`, "Debe ser >= 0");
        }
        if (!Number.isFinite(clip.audio.gainDb) || clip.audio.gainDb < -60 || clip.audio.gainDb > 12) {
          error(`${clipPath}.audio.gainDb`, "Debe estar entre -60 y 12 dB");
        }
        if (assetIds.size > 0 && !assetIds.has(clip.audio.assetId)) {
          warn(`${clipPath}.audio.assetId`, `El asset "${clip.audio.assetId}" no está registrado en audioAssets`);
        }
      }

      clip.notes.forEach((note, noteIndex) => {
        validateNote(note, `${clipPath}.notes[${noteIndex}]`, error);
      });

      const end = clip.start + clip.length;
      if (end > project.lengthBars * barBeats + 1e-6) {
        warn(`${clipPath}`, `El clip termina en el compás ${(end / barBeats).toFixed(2)}, más allá de lengthBars`);
      }
    });

    if (track.kind === "audio" && track.clips.some((clip) => clip.notes.length > 0)) {
      warn(`${path}.clips`, "Una pista de audio contiene notas MIDI");
    }

    // Solapes dentro de la misma pista: aviso, no error.
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      if (current.start < previous.start + previous.length - 1e-6) {
        warn(`${path}.clips`, `Los clips "${previous.name}" y "${current.name}" se solapan`);
      }
    }
  });

  if (totalNotes > 200000) error("notes", "El proyecto supera las 200.000 notas");

  return issues;
}

function validateNote(note: Note, path: string, error: (path: string, message: string) => void): void {
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) error(`${path}.pitch`, "Entero 0..127");
  if (!Number.isFinite(note.start) || note.start < 0) error(`${path}.start`, "Debe ser >= 0");
  if (!Number.isFinite(note.duration) || note.duration <= 0) error(`${path}.duration`, "Debe ser > 0");
  if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) {
    error(`${path}.velocity`, "Entero 1..127");
  }
}

/**
 * Ids de asset que el proyecto referencia (declarados o dentro de un clip).
 *
 * Vive aquí y no en el navegador porque lo necesitan los tres que ordenan el
 * audio: el fichero maestro, la caché en memoria y el recolector de basura de RAM.
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
