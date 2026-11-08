/**
 * What a MIDI track can sound with, for the instrument picker (8-Nov-2026, Carlos: "¿y el selector de instrumentos para
 * midi?"). Before it, nothing in the GUI changed a track's instrument: an imported .mid with no program sounded as a piano
 * (GM 0) for good. The `set_instrument` op already existed (the agent's, in old miuzika).
 *
 * Three families, as the engine plays them (src/host/opendaw/adapter.ts): a GM program through the General MIDI SoundFont
 * (bank 0), a GM drum kit (bank 128), or openDAW's own synth by type when there is no program.
 */

import type { InstrumentType, Track } from "./types.ts";
import { PROGRAMAS_GM } from "./gm-nombres.ts";

type Instrumento = Track["instrument"];

/** GM 1's sixteen families of eight programs. */
export const FAMILIAS_GM = [
  "Piano", "Chromatic percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass",
  "Reed", "Pipe", "Synth lead", "Synth pad", "Synth effects", "Ethnic", "Percussive", "Sound effects",
] as const;

/**
 * The kits in bank 128 of workspace/catalogo/gm/GeneralUser-GS.sf2, read from its preset headers on 8-Nov. A kit the
 * SoundFont lacks plays the standard one (indicePresetGm).
 */
export const KITS_GM: readonly { programa: number; nombre: string }[] = [
  { programa: 0, nombre: "Standard 1" }, { programa: 1, nombre: "Standard 2" }, { programa: 2, nombre: "Standard 3" },
  { programa: 8, nombre: "Room" }, { programa: 16, nombre: "Power" }, { programa: 24, nombre: "Electronic" },
  { programa: 25, nombre: "808/909" }, { programa: 26, nombre: "Dance" }, { programa: 32, nombre: "Jazz" },
  { programa: 40, nombre: "Brush" }, { programa: 48, nombre: "Orchestral" }, { programa: 56, nombre: "SFX" },
];

/** openDAW's own instruments, used when a track has no program. */
export const SINTES: readonly { tipo: InstrumentType; nombre: string }[] = [
  { tipo: "synth", nombre: "Synth" }, { tipo: "bass", nombre: "Bass synth" }, { tipo: "pad", nombre: "Pad synth" },
  { tipo: "lead", nombre: "Lead synth" }, { tipo: "arp", nombre: "Arp synth" },
];

const mayuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The type that goes with a GM program, as importar-midi.ts gives it: basses 32-39, leads 80-87, pads 88-95. */
export function tipoDePrograma(programa: number): InstrumentType {
  if (programa >= 32 && programa <= 39) return "bass";
  if (programa >= 80 && programa <= 87) return "lead";
  if (programa >= 88 && programa <= 95) return "pad";
  return "synth";
}

export type Opcion =
  | { clase: "gm"; programa: number; nombre: string; familia: string }
  | { clase: "kit"; programa: number; nombre: string }
  | { clase: "synth"; tipo: InstrumentType; nombre: string };

export const OPCIONES: readonly Opcion[] = [
  ...PROGRAMAS_GM.map((n, programa): Opcion => ({ clase: "gm", programa, nombre: mayuscula(n), familia: FAMILIAS_GM[Math.floor(programa / 8)]! })),
  ...KITS_GM.map((k): Opcion => ({ clase: "kit", programa: k.programa, nombre: k.nombre })),
  ...SINTES.map((s): Opcion => ({ clase: "synth", tipo: s.tipo, nombre: s.nombre })),
];

/** The instrument an option sets. */
export function instrumentoDe(o: Opcion): Instrumento {
  if (o.clase === "gm") return { type: tipoDePrograma(o.programa), program: o.programa };
  if (o.clase === "kit") return { type: "drumkit", program: o.programa };
  return { type: o.tipo };
}

/** Whether a track's instrument is this option (to mark the current one). */
export function esActual(i: Instrumento, o: Opcion): boolean {
  if (i.type === "soundfont" || i.type === "sampler") return false;
  if (o.clase === "kit") return i.type === "drumkit" && (i.program ?? 0) === o.programa;
  if (o.clase === "gm") return i.type !== "drumkit" && i.program === o.programa;
  return i.program === undefined && i.type === o.tipo;
}

/** What the track head says: "Synth bass 1", "Drums · Room", "Pad synth (openDAW)". */
export function etiquetaInstrumento(i: Instrumento): string {
  if (i.type === "soundfont") return i.archivo ? `SoundFont · ${i.archivo.split("/").pop()}` : "SoundFont";
  if (i.type === "sampler") return "Sampler";
  if (i.type === "drumkit") {
    const kit = KITS_GM.find((k) => k.programa === (i.program ?? 0));
    return `Drums · ${kit?.nombre ?? `kit ${i.program}`}`;
  }
  if (i.program !== undefined) return mayuscula(PROGRAMAS_GM[i.program] ?? `program ${i.program}`);
  return `${SINTES.find((s) => s.tipo === i.type)?.nombre ?? i.type} (openDAW)`;
}

/** Options whose name or family contain every word typed ("bass synth", "drum", "string"). */
export function buscar(texto: string): Opcion[] {
  const palabras = texto.toLowerCase().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [...OPCIONES];
  return OPCIONES.filter((o) => {
    const donde = `${o.nombre} ${o.clase === "gm" ? o.familia : o.clase === "kit" ? "drums kit percussion" : "opendaw synth"}`.toLowerCase();
    return palabras.every((p) => donde.includes(p));
  });
}
