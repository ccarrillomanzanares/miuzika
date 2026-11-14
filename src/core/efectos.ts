/**
 * What the effects panel needs to draw a chain: one control per parameter, taken from DEVICE_PARAMS, so the
 * ten effects come out of the table and none has a screen of its own. Pure: names, units, the slider's scale.
 */

import { DEVICE_PARAMS, type DeviceType } from "./types.ts";

export const NOMBRE_EFECTO: Record<DeviceType, string> = {
  reverb: "Reverb",
  delay: "Delay",
  chorus: "Chorus",
  distortion: "Distortion",
  filter: "Filter",
  eq: "EQ (3 bands)",
  compressor: "Compressor",
  bitcrusher: "Bitcrusher",
  gate: "Gate",
  width: "Stereo width",
};

const ETIQUETAS: Record<string, string> = {
  wet: "Wet",
  decay: "Decay",
  preDelayMs: "Pre-delay",
  damping: "Damping",
  timeMs: "Time",
  feedback: "Feedback",
  pingPong: "Ping-pong",
  rateHz: "Rate",
  depth: "Depth",
  driveDb: "Drive",
  mix: "Mix",
  cutoffHz: "Cutoff",
  q: "Q",
  highpass: "High-pass (cuts below the cutoff)",
  low: "Low",
  mid: "Mid",
  high: "High",
  lowHz: "Low freq.",
  midHz: "Mid freq.",
  highHz: "High freq.",
  thresholdDb: "Threshold",
  ratio: "Ratio",
  attackMs: "Attack",
  releaseMs: "Release",
  bits: "Bits",
  width: "Width",
};

type Unidad = "ms" | "hz" | "db" | "porciento" | "ratio" | "bits" | "numero";

export interface ControlEfecto {
  clave: string;
  etiqueta: string;
  min: number;
  max: number;
  /** A 0/1 parameter (the filter's high-pass): a checkbox, not a slider. */
  interruptor: boolean;
  /** Frequencies and times are heard in proportion: a logarithmic slider gives 20-200 Hz the room of 2-20 kHz. */
  logaritmico: boolean;
  unidad: Unidad;
}

/** Steps of the slider: fine enough that one step of a 20 Hz-20 kHz cutoff is 0.7 %, under a semitone. */
export const PASOS = 1000;

function unidadDe(tipo: DeviceType, clave: string): Unidad {
  if (clave.endsWith("Ms")) return "ms";
  if (clave.endsWith("Hz")) return "hz";
  if (clave.endsWith("Db")) return "db";
  if (tipo === "eq") return "db";
  if (clave === "ratio") return "ratio";
  if (clave === "bits") return "bits";
  if (clave === "q") return "numero";
  return "porciento";
}

export function controlesDe(tipo: DeviceType): ControlEfecto[] {
  return Object.entries(DEVICE_PARAMS[tipo]).map(([clave, [min, max]]) => {
    const unidad = unidadDe(tipo, clave);
    return {
      clave,
      etiqueta: ETIQUETAS[clave] ?? clave,
      min,
      max,
      interruptor: clave === "highpass",
      logaritmico: (unidad === "hz" || unidad === "ms") && min > 0,
      unidad,
    };
  });
}

const limitar = (valor: number, min: number, max: number): number => Math.max(min, Math.min(max, valor));

/** Slider position (0..PASOS) -> the parameter's value, in its unit. */
export function valorDePosicion(control: ControlEfecto, posicion: number): number {
  const t = limitar(posicion / PASOS, 0, 1);
  const crudo = control.logaritmico
    ? control.min * (control.max / control.min) ** t
    : control.min + t * (control.max - control.min);
  if (control.unidad === "bits") return Math.round(crudo);
  // Three significant figures: what the label shows is what is saved, with no 2499.9999 in the project file.
  return limitar(Number(crudo.toPrecision(3)), control.min, control.max);
}

export function posicionDeValor(control: ControlEfecto, valor: number): number {
  const v = limitar(valor, control.min, control.max);
  const t = control.logaritmico
    ? Math.log(v / control.min) / Math.log(control.max / control.min)
    : (v - control.min) / (control.max - control.min);
  return Math.round(t * PASOS);
}

export function formatearValor(control: ControlEfecto, valor: number): string {
  switch (control.unidad) {
    case "ms":
      return `${valor < 10 ? valor.toFixed(1) : Math.round(valor)} ms`;
    case "hz":
      if (valor >= 1000) return `${(valor / 1000).toFixed(valor < 10_000 ? 2 : 1)} kHz`;
      return `${valor < 10 ? valor.toFixed(2) : Math.round(valor)} Hz`;
    case "db":
      return `${valor > 0 ? "+" : ""}${valor.toFixed(1)} dB`;
    case "ratio":
      return `${valor.toFixed(1)}:1`;
    case "bits":
      return `${Math.round(valor)} bit`;
    case "numero":
      return valor.toFixed(1);
    case "porciento":
      return `${Math.round(valor * 100)} %`;
  }
}
