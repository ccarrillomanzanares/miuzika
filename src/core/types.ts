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

type TrackKind = "midi" | "audio";

interface InstrumentSpec {
  type: InstrumentType;
  /** Nombre del preset en el host (p. ej. "Vaporisateur"). */
  preset?: string;
  /** Programa GM para el export MIDI. */
  program?: number;
  /** Fichero del instrumento, relativo al proyecto (un .sf2 para `soundfont`). */
  archivo?: string;
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
  /**
   * Ruta del WAV dentro de la carpeta del proyecto ("salida/x.wav"). Es lo que
   * hace el proyecto portable: los bytes viven en el disco, no en el navegador.
   */
  ruta?: string;
}

interface AudioRef {
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
  /** Envíos a buses (post-fader). Sin envíos, la pista va sólo al master. */
  sends?: Send[];
}

/** Envío de una pista a un bus: cuánta señal le manda, en dB. */
export interface Send {
  busId: string;
  levelDb: number;
}

/**
 * Bus auxiliar (retorno de efectos): una reverb o un delay que comparten varias
 * pistas por envío, en vez de una reverb por pista. Suena en el master. En
 * openDAW es un AudioBusBox con su AudioUnit de tipo «aux».
 */
export interface Bus {
  id: string;
  name: string;
  gainDb: number;
  devices: Device[];
}

export interface CodeSource {
  id: string;
  name: string;
  language: "strudel";
  code: string;
  /** Compases que se consultan al patrón. 1 ciclo Strudel = 1 compás. */
  bars: number;
  /** Pistas generadas por la última compilación. */
  trackIds: string[];
  compiledAt: string;
  /** MIDI editable o audio renderizado con el motor real de Strudel. */
  mode?: "midi" | "audio";
  /** Asset WAV cuando mode es audio. */
  assetId?: string;
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
  /** Fuentes de código que generaron pistas; las notas viven en tracks. */
  codeSources?: CodeSource[];
  /** Buses auxiliares; las pistas les mandan señal con `sends`. */
  buses?: Bus[];
  master: { gainDb: number };
  meta: {
    /**
     * Carpeta del proyecto en `workspace/proyectos/`. Se fija al crearlo y NO cambia
     * al renombrarlo: antes la carpeta salía del nombre en cada guardado, así que
     * renombrar un proyecto lo mudaba a otra carpeta sin sus WAV.
     */
    carpeta?: string;
    prompt?: string;
    generator?: string;
    createdAt: string;
  };
}

/**
 * Rangos por parámetro de dispositivo, en unidades reales: el sufijo dice cuál
 * (Ms, Hz, Db). Sin sufijo son proporciones 0..1 (wet, mix, decay…) o lo que diga
 * el rango (ratio, bits). Los rangos son los de openDAW (ValueMapping de cada
 * efecto, leídos el 28-oct).
 *
 * Antes todo era 0..1 y la conversión vivía escondida en mapping.ts: el agente
 * escribía «cutoff 0.34» sin saber que eran 2.000 Hz, ni «time 0.35» que eran
 * 363 ms (ESTADO 28-oct, pendiente 3). Los proyectos guardados con los nombres
 * viejos se convierten al leerse (`migrarParametros`) y suenan igual.
 */
export const DEVICE_PARAMS: Record<DeviceType, Record<string, [number, number]>> = {
  reverb: { wet: [0, 1], decay: [0, 1], preDelayMs: [1, 500], damping: [0, 1] },
  delay: { wet: [0, 1], timeMs: [20, 1000], feedback: [0, 0.95], pingPong: [0, 1] },
  chorus: { wet: [0, 1], rateHz: [0.1, 5], depth: [0, 1] },
  distortion: { driveDb: [0, 40], mix: [0, 1] },
  filter: { cutoffHz: [20, 20000], q: [0.5, 10] },
  eq: {
    low: [-24, 24],
    mid: [-24, 24],
    high: [-24, 24],
    lowHz: [20, 1000],
    midHz: [100, 10000],
    highHz: [1000, 20000],
  },
  compressor: { thresholdDb: [-60, 0], ratio: [1, 20], attackMs: [0, 100], releaseMs: [5, 1500] },
  bitcrusher: { bits: [1, 16], mix: [0, 1] },
  gate: { thresholdDb: [-80, 0], releaseMs: [1, 2000] },
  width: { width: [0, 2] },
};

/** Valores iniciales razonables al añadir un dispositivo (los de antes, pasados a unidades). */
export const DEVICE_DEFAULTS: Record<DeviceType, Record<string, number>> = {
  reverb: { wet: 0.25, decay: 0.5, preDelayMs: 75, damping: 0.4 },
  delay: { wet: 0.2, timeMs: 363, feedback: 0.35, pingPong: 1 },
  chorus: { wet: 0.3, rateHz: 0.9, depth: 0.5 },
  distortion: { driveDb: 9.6, mix: 0.6 },
  filter: { cutoffHz: 2500, q: 2.4 },
  eq: { low: 0, mid: 0, high: 0, lowHz: 100, midHz: 1000, highHz: 8000 },
  compressor: { thresholdDb: -24, ratio: 4, attackMs: 30, releaseMs: 600 },
  bitcrusher: { bits: 8, mix: 0.3 },
  gate: { thresholdDb: -48, releaseMs: 600 },
  width: { width: 1.2 },
};

/**
 * Parámetros con los nombres de antes (normalizados 0..1) → unidades reales, con
 * la MISMA fórmula que usaba mapping.ts, para que un proyecto guardado suene igual.
 * Lo que ya está en el formato nuevo pasa tal cual. `tone` de la distorsión se
 * tira: openDAW no tenía dónde ponerlo y nunca sonó.
 */
export function migrarParametros(tipo: DeviceType, params: Record<string, number>): Record<string, number> {
  const salida: Record<string, number> = {};
  const r = (v: number, d = 1): number => Number(v.toFixed(d));
  for (const [clave, valor] of Object.entries(params)) {
    const v = Number(valor);
    switch (`${tipo}.${clave}`) {
      case "reverb.preDelay":
        salida.preDelayMs = r(1 + v * 499);
        break;
      case "delay.time":
        salida.timeMs = r(20 + v * 980);
        break;
      case "chorus.rate":
        salida.rateHz = r(0.2 + v * 2.8, 2);
        break;
      case "distortion.drive":
        salida.driveDb = r(v * 24);
        break;
      case "distortion.tone":
        break;
      case "filter.cutoff":
        // El suelo de 1.200 Hz era un parche del mapeo viejo (Vaporisateur sonaba
        // inaudible con cutoff 0.2-0.35); se conserva al migrar para no cambiar el sonido.
        salida.cutoffHz = Math.round(Math.max(1200, 20 * 1000 ** v));
        break;
      case "filter.resonance":
        salida.q = r(0.5 + v * 9.5, 2);
        break;
      case "compressor.threshold":
        salida.thresholdDb = r(-60 + v * 60);
        break;
      case "compressor.attack":
        salida.attackMs = r(v * 100);
        break;
      case "compressor.release":
        salida.releaseMs = r(5 + v * 1495);
        break;
      case "gate.threshold":
        salida.thresholdDb = r(-80 + v * 80);
        break;
      case "gate.release":
        salida.releaseMs = r(1 + v * 1999);
        break;
      default:
        salida[clave] = v;
    }
  }
  return salida;
}

export function beatsPerBar(project: Project): number {
  const { numerator, denominator } = project.timeSignature;
  return (numerator * 4) / denominator;
}
