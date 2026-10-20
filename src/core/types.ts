/**
 * Modelo de datos canónico de miuzika.
 *
 * Es deliberadamente independiente del motor de audio: esto es la "fuente de
 * verdad". openDAW (o cualquier otro host) es una vista/ejecutor de este modelo.
 * Tiempo musical en *beats* (negras). El PPQN solo se aplica al exportar MIDI.
 */

export type Mode =
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "harmonicMinor"
  | "pentatonicMinor";

export interface KeySignature {
  /** Nota tónica con alteración: "D", "F#", "Bb". */
  tonic: string;
  mode: Mode;
}

export type TrackKind = "midi" | "audio";

export interface InstrumentSpec {
  type: InstrumentType;
  /** Nombre del preset en el host (p. ej. "Vaporisateur"). */
  preset?: string;
  /** Programa GM para el export MIDI. */
  program?: number;
}

export const DEVICE_TYPES = [
  "reverb",
  "delay",
  "chorus",
  "distortion",
  "filter",
  "eq",
  "compressor",
  "bitcrusher",
  "gate",
  "width",
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export const INSTRUMENT_TYPES = [
  "drumkit",
  "bass",
  "synth",
  "pad",
  "lead",
  "arp",
  "soundfont",
  "sampler",
] as const;

export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export interface Device {
  id: string;
  type: DeviceType;
  enabled: boolean;
  /** Parámetros normalizados 0..1 salvo los indicados en DEVICE_PARAMS. */
  params: Record<string, number>;
}

export interface Note {
  /** MIDI 0..127. */
  pitch: number;
  /** Beats relativos al inicio del clip. */
  start: number;
  duration: number;
  /** 1..127. */
  velocity: number;
}

export interface AudioAsset {
  id: string;
  name: string;
  /** Duración en beats al tempo del proyecto. */
  durationBeats: number;
}

export interface AudioRef {
  assetId: string;
  /** Desplazamiento dentro del fichero, en beats. */
  offset: number;
  gainDb: number;
}

export interface Clip {
  id: string;
  name: string;
  /** Beats absolutos en la timeline. */
  start: number;
  length: number;
  notes: Note[];
  audio?: AudioRef;
  /** Trazabilidad: qué op y sección lo generaron. */
  origin?: { op: string; section?: string; seed?: number };
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  instrument: InstrumentSpec;
  gainDb: number;
  /** -1 izquierda, 0 centro, 1 derecha. */
  pan: number;
  muted: boolean;
  solo: boolean;
  devices: Device[];
  clips: Clip[];
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  bpm: number;
  key: KeySignature;
  timeSignature: { numerator: number; denominator: number };
  lengthBars: number;
  /** Semilla global: hace reproducibles las generaciones. */
  seed: number;
  tracks: Track[];
  /** Metadatos de los WAV importados (los bytes viven fuera del proyecto). */
  audioAssets?: AudioAsset[];
  master: { gainDb: number };
  meta: {
    prompt?: string;
    generator?: string;
    createdAt: string;
  };
}

/** Rangos por parámetro de dispositivo. Los que no figuran aquí son 0..1. */
export const DEVICE_PARAMS: Record<DeviceType, Record<string, [number, number]>> = {
  reverb: { wet: [0, 1], decay: [0, 1], preDelay: [0, 1], damping: [0, 1] },
  delay: { wet: [0, 1], time: [0, 1], feedback: [0, 0.95], pingPong: [0, 1] },
  chorus: { wet: [0, 1], rate: [0, 1], depth: [0, 1] },
  distortion: { drive: [0, 1], tone: [0, 1], mix: [0, 1] },
  filter: { cutoff: [0, 1], resonance: [0, 1] },
  eq: { low: [-24, 24], mid: [-24, 24], high: [-24, 24] },
  compressor: { threshold: [0, 1], ratio: [1, 20], attack: [0, 1], release: [0, 1] },
  bitcrusher: { bits: [1, 16], mix: [0, 1] },
  gate: { threshold: [0, 1], release: [0, 1] },
  width: { width: [0, 2] },
};

/** Valores iniciales razonables al añadir un dispositivo. */
export const DEVICE_DEFAULTS: Record<DeviceType, Record<string, number>> = {
  reverb: { wet: 0.25, decay: 0.5, preDelay: 0.15, damping: 0.4 },
  delay: { wet: 0.2, time: 0.35, feedback: 0.35, pingPong: 1 },
  chorus: { wet: 0.3, rate: 0.25, depth: 0.5 },
  distortion: { drive: 0.4, tone: 0.5, mix: 0.6 },
  filter: { cutoff: 0.7, resonance: 0.2 },
  eq: { low: 0, mid: 0, high: 0 },
  compressor: { threshold: 0.6, ratio: 4, attack: 0.3, release: 0.4 },
  bitcrusher: { bits: 8, mix: 0.3 },
  gate: { threshold: 0.4, release: 0.3 },
  width: { width: 1.2 },
};

export const INSTRUMENT_PROGRAM: Record<InstrumentType, number> = {
  drumkit: 0,
  bass: 38, // Synth Bass 1
  synth: 81, // Lead 2 (sawtooth)
  pad: 89, // Pad 2 (warm)
  lead: 81,
  arp: 82,
  soundfont: 0,
  sampler: 0,
};

export function beatsPerBar(project: Project): number {
  const { numerator, denominator } = project.timeSignature;
  return (numerator * 4) / denominator;
}

export function barsToBeats(project: Project, bars: number): number {
  return bars * beatsPerBar(project);
}
