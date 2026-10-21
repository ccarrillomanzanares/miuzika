/**
 * Mapeo puro miuzika → openDAW.
 *
 * Sin imports del SDK a propósito: se puede testear con node:test y sobrevive
 * a cambios de versión. El adaptador (`adapter.ts`) es quien habla con el SDK.
 */

import type { Device, InstrumentType } from "../../core/types.ts";

type OpenDawEffectFactory =
  | "Reverb"
  | "Delay"
  | "Waveshaper"
  | "Crusher"
  | "Compressor"
  | "Gate"
  | "StereoTool"
  | "Revamp";

interface MappedParam {
  /** Ruta con puntos para parámetros anidados (p. ej. "lowShelf.gain"). */
  name: string;
  value: number | boolean;
}

interface MappedDevice {
  factory: OpenDawEffectFactory | null;
  params: MappedParam[];
  /** Motivo cuando no hay equivalente en openDAW. */
  reason?: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

const unit = (value: number | undefined, fallback: number): number => clamp(value ?? fallback, 0, 1);

/** 0..1 → dB, con suelo audible en -60 dB. */
export function unitToDb(value: number): number {
  return clamp(20 * Math.log10(Math.max(value, 0.001)), -60, 6);
}

/** dB → 0..1 (inverso de unitToDb). */
export function dbToUnit(db: number): number {
  return clamp(10 ** (db / 20), 0.001, 2);
}

/**
 * Nuestros parámetros son normalizados 0..1. openDAW usa unidades reales
 * (dB, ms, segundos, índices). Aquí se hace la conversión explícita.
 */export function mapDevice(device: Device): MappedDevice {
  const params = device.params;
  switch (device.type) {
    case "reverb": {
      const wet = unit(params.wet, 0.25);
      return {
        factory: "Reverb",
        params: [
          { name: "decay", value: unit(params.decay, 0.5) },
          { name: "damp", value: unit(params.damping, 0.4) },
          { name: "preDelay", value: 0.001 + unit(params.preDelay, 0.15) * 0.499 },
          { name: "wet", value: unitToDb(wet) },
          { name: "dry", value: unitToDb(1 - wet) },
        ],
      };
    }
    case "delay": {
      const wet = unit(params.wet, 0.2);
      return {
        factory: "Delay",
        params: [
          { name: "delayMillis", value: 20 + unit(params.time, 0.35) * 980 },
          { name: "feedback", value: clamp(params.feedback ?? 0.35, 0, 0.95) },
          { name: "cross", value: unit(params.pingPong, 1) },
          { name: "wet", value: unitToDb(wet) },
          { name: "dry", value: unitToDb(1 - wet) },
        ],
      };
    }
    case "distortion":
      return {
        factory: "Waveshaper",
        params: [
          { name: "inputGain", value: unit(params.drive, 0.4) * 24 },
          { name: "mix", value: unit(params.mix, 0.6) },
        ],
      };
    case "compressor":
      return {
        factory: "Compressor",
        params: [
          { name: "threshold", value: -60 + unit(params.threshold, 0.6) * 60 },
          { name: "ratio", value: clamp(params.ratio ?? 4, 1, 24) },
          { name: "attack", value: unit(params.attack, 0.3) * 100 },
          { name: "release", value: 5 + unit(params.release, 0.4) * 1495 },
          { name: "mix", value: 1 },
        ],
      };
    case "gate":
      return {
        factory: "Gate",
        params: [
          { name: "threshold", value: -80 + unit(params.threshold, 0.4) * 80 },
          { name: "release", value: 1 + unit(params.release, 0.3) * 1999 },
        ],
      };
    case "bitcrusher":
      return {
        factory: "Crusher",
        params: [
          { name: "bits", value: clamp(params.bits ?? 8, 1, 16) },
          { name: "mix", value: unit(params.mix, 0.3) },
        ],
      };
    case "width":
      return {
        factory: "StereoTool",
        // width 1 = estéreo neutro; openDAW usa -1..1 con 0 neutro.
        params: [{ name: "stereo", value: clamp((params.width ?? 1.2) - 1, -1, 1) }],
      };
    case "chorus": {
      // openDAW no tiene chorus: delay corto modulado (ensemble).
      const wet = unit(params.wet, 0.3);
      return {
        factory: "Delay",
        params: [
          { name: "delayMillis", value: 16 + unit(params.depth, 0.5) * 12 },
          { name: "lfoSpeed", value: 0.2 + unit(params.rate, 0.25) * 2.8 },
          { name: "lfoDepth", value: 1 + unit(params.depth, 0.5) * 7 },
          { name: "feedback", value: 0.15 },
          { name: "cross", value: 0.5 },
          { name: "wet", value: unitToDb(wet) },
          { name: "dry", value: unitToDb(1 - wet) },
        ],
      };
    }
    case "filter":
      return {
        factory: "Revamp",
        params: [
          { name: "highPass.enabled", value: false },
          { name: "lowShelf.enabled", value: false },
          { name: "lowBell.enabled", value: false },
          { name: "midBell.enabled", value: false },
          { name: "highBell.enabled", value: false },
          { name: "highShelf.enabled", value: false },
          { name: "lowPass.enabled", value: true },
          // Vaporisateur tiene menos armónicos que nuestro motor WebAudio; con el
          // mapeo literal, un cutoff de 0.2-0.35 dejaba pistas enteras inaudibles.
          { name: "lowPass.frequency", value: Math.max(1_200, 20 * 1000 ** unit(params.cutoff, 0.7)) },
          { name: "lowPass.q", value: 0.5 + unit(params.resonance, 0.2) * 9.5 },
          { name: "lowPass.order", value: 1 },
        ],
      };
    case "eq":
      return {
        factory: "Revamp",
        params: [
          { name: "highPass.enabled", value: false },
          { name: "lowPass.enabled", value: false },
          { name: "lowBell.enabled", value: false },
          { name: "highBell.enabled", value: false },
          { name: "lowShelf.enabled", value: true },
          { name: "lowShelf.frequency", value: 100 },
          { name: "lowShelf.gain", value: clamp(params.low ?? 0, -24, 24) },
          { name: "midBell.enabled", value: true },
          { name: "midBell.frequency", value: 1000 },
          { name: "midBell.gain", value: clamp(params.mid ?? 0, -24, 24) },
          { name: "highShelf.enabled", value: true },
          { name: "highShelf.frequency", value: 8000 },
          { name: "highShelf.gain", value: clamp(params.high ?? 0, -24, 24) },
        ],
      };
    default: {
      const exhaustive: never = device.type;
      return { factory: null, params: [], reason: `Dispositivo no soportado: ${String(exhaustive)}` };
    }
  }
}

interface InstrumentMapping {
  factory: "Playfield" | "Vaporisateur";
  warning?: string;
}

export function mapInstrument(type: InstrumentType): InstrumentMapping {
  if (type === "drumkit") return { factory: "Playfield" };
  if (type === "soundfont" || type === "sampler") {
    return {
      factory: "Vaporisateur",
      warning: `${type} necesita un asset (SoundFont/sample); se usa Vaporisateur como sustituto`,
    };
  }
  return { factory: "Vaporisateur" };
}

/** openDAW usa 960 pulsos por negra. */
const PULSES_PER_BEAT = 960;

export function beatsToPulses(beats: number): number {
  return Math.round(beats * PULSES_PER_BEAT);
}

export function pulsesToBeats(pulses: number): number {
  return pulses / PULSES_PER_BEAT;
}

export function velocityToUnit(velocity: number): number {
  return clamp(velocity / 127, 0, 1);
}

export function unitToVelocity(value: number): number {
  return clamp(Math.round(value * 127), 1, 127);
}
