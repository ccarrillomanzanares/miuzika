/**
 * Expansión determinista de patrones.
 *
 * El LLM NO escribe notas: elige un rol, un estilo, una progresión y una
 * densidad. Esta capa convierte esa descripción compacta en notas reales.
 * Misma entrada + misma semilla => mismas notas (reproducible y testeable).
 */

import type { KeySignature, Note } from "./types.ts";
import { jitter, seededRng } from "./rng.ts";
import {
  canonicalPitchClass,
  chordToMidi,
  degreeOfPitchClass,
  degreeToSemitones,
  noteToMidi,
  parseChord,
  pitchClass,
  tonicChordSymbol,
} from "./theory.ts";

export type Role = "drums" | "bass" | "chords" | "lead" | "arp" | "pad";

export const ROLES: readonly Role[] = ["drums", "bass", "chords", "lead", "arp", "pad"];

export interface PatternSpec {
  role: Role;
  /** Estilo/groove. Ver DRUM_STYLES y BASS_RHYTHMS. */
  style?: string;
  bars: number;
  /** Un acorde por compás; si hay menos, se cicla. */
  chords?: string[];
  /** Octava de la fundamental (C4 = 60). */
  octave?: number;
  /** 0 = mínimo, 1 = máximo. */
  density?: number;
  /** Energía de la sección: cambia fills, movimiento y densidad. */
  energy?: number;
  /** Fundamental si no hay progresión. */
  root?: string;
  /** Grados de la escala para el motivo del lead. */
  motif?: number[];
  seed?: number;
  /** 0..1, retrasa las corcheas impares. */
  swing?: number;
}

export const DRUM = {
  kick: 36,
  snare: 38,
  clap: 39,
  hat: 42,
  pedal: 44,
  openHat: 46,
  crash: 49,
  ride: 51,
  tomLow: 45,
  tomMid: 47,
  tomHigh: 48,
  rim: 37,
} as const;

/**
 * Patrones de 16 pasos por compás.
 * "x" = acento, "o" = suave, "-" = silencio.
 */
interface DrumPattern {
  lanes: Partial<Record<keyof typeof DRUM, string>>;
  /** Relleno de toms en el último compás de la sección. */
  fill?: boolean;
}

export const DRUM_STYLES: Record<string, DrumPattern> = {
  gated_80s: {
    lanes: {
      kick: "x-------x--x----",
      snare: "----x-------x---",
      hat: "x-x-x-x-x-x-x-x-",
      openHat: "--------------x-",
      crash: "x---------------",
    },
    fill: true,
  },
  siniestro_punk: {
    lanes: {
      kick: "x--x----x--x-x--",
      snare: "----x-------x---",
      hat: "x-x-x-x-x-x-x-x-",
      openHat: "-------x-------x",
      crash: "x---------------",
    },
    fill: true,
  },
  four_on_floor: {
    lanes: {
      kick: "x---x---x---x---",
      clap: "----x-------x---",
      openHat: "--x---x---x---x-",
      crash: "x---------------",
    },
    fill: false,
  },
  half_time: {
    lanes: {
      kick: "x---------x-----",
      snare: "--------x-------",
      hat: "x---x---x---x---",
      ride: "----o-------o---",
    },
    fill: false,
  },
  breakbeat: {
    lanes: {
      kick: "x------x--x-----",
      snare: "----x--x----x---",
      hat: "x-o-x-o-x-o-x-o-",
      crash: "x---------------",
    },
    fill: true,
  },
  driving: {
    lanes: {
      kick: "x---x-x-x---x-x-",
      snare: "----x-------x---",
      hat: "xxxxxxxxxxxxxxxx",
      openHat: "------x-------x-",
      crash: "x---------------",
    },
    fill: true,
  },
  ambient: {
    lanes: {
      kick: "x---------------",
      rim: "--------o-------",
      hat: "----o-------o---",
    },
    fill: false,
  },
};

export const BASS_STYLES: Record<string, number[]> = {
  straight8: [0, 2, 4, 6, 8, 10, 12, 14],
  driving8: [0, 2, 4, 6, 8, 10, 12, 14],
  syncopated: [0, 3, 6, 8, 11, 14],
  quarters: [0, 4, 8, 12],
  punk: [0, 2, 4, 6, 8, 10, 12, 14],
  ambient: [0, 8],
  sub: [0, 10],
};

export const CHORD_STYLES = ["pad", "gated", "stab", "offbeat", "power", "sustained"] as const;

export const CHORD_RHYTHMS: Record<string, { steps: number[]; length: number }> = {
  pad: { steps: [0], length: 4 },
  sustained: { steps: [0], length: 4 },
  gated: { steps: [0, 2, 4, 6, 8, 10, 12, 14], length: 0.22 },
  stab: { steps: [0, 6, 10], length: 0.5 },
  offbeat: { steps: [2, 6, 10, 14], length: 0.4 },
  power: { steps: [0, 2, 4, 6, 8, 10, 12, 14], length: 0.4 },
};

export interface ExpandContext {
  key: KeySignature;
  beatsPerBar: number;
  stepsPerBar?: number;
  seed: number;
}

function clampVelocity(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)));
}

function stepToBeats(step: number, stepsPerBar: number, beatsPerBar: number): number {
  return (step / stepsPerBar) * beatsPerBar;
}

function resolveChords(spec: PatternSpec, key: KeySignature, bars: number): string[] {
  const source = spec.chords?.length ? spec.chords : [spec.root ? (key.mode === "major" ? canonicalPitchClass(spec.root) : `${canonicalPitchClass(spec.root)}m`) : tonicChordSymbol(key)];
  const result: string[] = [];
  for (let bar = 0; bar < bars; bar++) result.push(source[bar % source.length]!);
  return result;
}

function expandDrums(spec: PatternSpec, ctx: ExpandContext, bars: number): Note[] {
  const styleName = spec.style ?? "driving";
  const style = DRUM_STYLES[styleName];
  if (!style) {
    throw new Error(
      `Estilo de batería desconocido: "${styleName}". Usa: ${Object.keys(DRUM_STYLES).join(", ")}`,
    );
  }
  const stepsPerBar = ctx.stepsPerBar ?? 16;
  const rng = seededRng(ctx.seed, spec.seed ?? 0, "drums", styleName);
  const density = spec.density ?? 0.7;
  const energy = spec.energy ?? 0.6;
  const notes: Note[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const isLastBar = bar === bars - 1;
    const barStart = bar * ctx.beatsPerBar;
    for (const [lane, pattern] of Object.entries(style.lanes) as Array<[keyof typeof DRUM, string]>) {
      const pitch = DRUM[lane];
      for (let step = 0; step < Math.min(stepsPerBar, pattern.length); step++) {
        const symbol = pattern[step];
        if (symbol !== "x" && symbol !== "o") continue;
        // El crash solo al principio de la sección.
        if (lane === "crash" && bar !== 0) continue;
        // La densidad recorta las articulaciones suaves.
        if (symbol === "o" && density < 0.5 && rng() < 0.5) continue;
        const base = symbol === "x" ? 108 : 68;
        notes.push({
          pitch,
          start: barStart + stepToBeats(step, stepsPerBar, ctx.beatsPerBar),
          duration: 0.1,
          velocity: clampVelocity(base + jitter(rng, 7)),
        });
      }
    }

    // Aire extra en secciones de alta energía, sin saturar.
    if (energy > 0.8 && bar % 2 === 0) {
      notes.push({
        pitch: DRUM.openHat,
        start: barStart + stepToBeats(15, stepsPerBar, ctx.beatsPerBar),
        duration: 0.1,
        velocity: clampVelocity(72 + jitter(rng, 5)),
      });
    }

    const fillBar = isLastBar || (energy > 0.7 && (bar + 1) % 4 === 0 && bar > 0);
    if (style.fill && fillBar && density > 0.55) {
      const fillSteps = [12, 13, 14, 15];
      const fillPitches = [DRUM.tomHigh, DRUM.tomMid, DRUM.tomLow, DRUM.snare];
      fillSteps.forEach((step, index) => {
        notes.push({
          pitch: fillPitches[index]!,
          start: barStart + stepToBeats(step, stepsPerBar, ctx.beatsPerBar),
          duration: 0.1,
          velocity: clampVelocity(100 + index * 5),
        });
      });
    }
  }
  return notes;
}

function expandBass(spec: PatternSpec, ctx: ExpandContext, bars: number): Note[] {
  const styleName = spec.style ?? "driving8";
  const rhythm = BASS_STYLES[styleName];
  if (!rhythm) {
    throw new Error(
      `Estilo de bajo desconocido: "${styleName}". Usa: ${Object.keys(BASS_STYLES).join(", ")}`,
    );
  }
  const stepsPerBar = ctx.stepsPerBar ?? 16;
  const rng = seededRng(ctx.seed, spec.seed ?? 0, "bass", styleName);
  const octave = spec.octave ?? 2;
  const density = spec.density ?? 0.8;
  const energy = spec.energy ?? 0.6;
  const chords = resolveChords(spec, ctx.key, bars);
  const notes: Note[] = [];
  const movementPattern =
    energy < 0.4
      ? [0, 0, 0, 0, 0, 0, 0, 0]
      : energy > 0.8
        ? [0, 0, 7, 12, 0, 7, 12, 0]
        : [0, 0, 7, 0, 12, 0, 7, 0];

  for (let bar = 0; bar < bars; bar++) {
    const chord = parseChord(chords[bar]!);
    const rootPc = chord.bass ?? chord.root;
    const root = (octave + 1) * 12 + rootPc;
    const steps = density < 0.5 ? rhythm.filter((_, index) => index % 2 === 0) : rhythm;
    steps.forEach((step, index) => {
      if (rng() < 0.04) return;
      // Movimiento: fundamental, quinta, octava (según energía de la sección).
      const movement = movementPattern[index % 8]!;
      notes.push({
        pitch: Math.max(24, Math.min(60, root + movement)),
        start: bar * ctx.beatsPerBar + stepToBeats(step, stepsPerBar, ctx.beatsPerBar),
        duration: (styleName === "sub" ? 0.9 : 0.32) * ctx.beatsPerBar / 4,
        velocity: clampVelocity((styleName === "punk" ? 112 : 98) + jitter(rng, 6)),
      });
    });
  }
  return notes;
}

function expandChords(spec: PatternSpec, ctx: ExpandContext, bars: number): Note[] {
  const styleName = spec.style ?? (spec.role === "pad" ? "pad" : "gated");
  const rhythm = CHORD_RHYTHMS[styleName];
  if (!rhythm) {
    throw new Error(
      `Estilo de acordes desconocido: "${styleName}". Usa: ${Object.keys(CHORD_RHYTHMS).join(", ")}`,
    );
  }
  const stepsPerBar = ctx.stepsPerBar ?? 16;
  const rng = seededRng(ctx.seed, spec.seed ?? 0, "chords", styleName);
  const octave = spec.octave ?? 4;
  const chords = resolveChords(spec, ctx.key, bars);
  const density = spec.density ?? 0.7;
  const notes: Note[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const chord = parseChord(chords[bar]!);
    const inversion = bar % 3 === 2 ? 1 : 0;
    let pitches = chordToMidi(chord, octave, inversion);
    if (styleName === "power") pitches = pitches.filter((pitch) => (pitch - chord.root) % 12 === 0 || (pitch - chord.root) % 12 === 7);
    // Pad: voces amplias, sin choques en el registro grave.
    if (styleName === "pad" || styleName === "sustained") pitches = pitches.map((pitch) => (pitch < 48 ? pitch + 12 : pitch));

    for (const step of rhythm.steps) {
      if (rhythm.steps.length > 1 && density < 0.4 && rng() < 0.3) continue;
      const start = bar * ctx.beatsPerBar + stepToBeats(step, stepsPerBar, ctx.beatsPerBar);
      for (const pitch of pitches) {
        notes.push({
          pitch,
          start,
          duration: rhythm.length * (ctx.beatsPerBar / 4),
          velocity: clampVelocity((styleName === "pad" ? 62 : 88) + jitter(rng, 5)),
        });
      }
    }
  }
  return notes;
}

function expandLead(spec: PatternSpec, ctx: ExpandContext, bars: number): Note[] {
  const stepsPerBar = ctx.stepsPerBar ?? 16;
  const rng = seededRng(ctx.seed, spec.seed ?? 0, "lead", spec.style ?? "hook");
  const octave = spec.octave ?? 5;
  const chords = resolveChords(spec, ctx.key, bars);
  const density = spec.density ?? 0.6;
  const baseMotif = spec.motif?.length ? spec.motif : [0, 2, 4, 2, 4, 6, 4, 2];
  const variation = Math.abs(spec.seed ?? 0) % 3;
  const motif =
    variation === 1
      ? baseMotif.map((degree) => 2 * baseMotif[0]! - degree)
      : variation === 2
        ? [...baseMotif.slice(1), baseMotif[0]!]
        : baseMotif;
  const stepPattern = density > 0.75 ? [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
  const tonic = noteToMidi(ctx.key.tonic, octave);
  const notes: Note[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const chord = parseChord(chords[bar]!);
    const chordDegree = degreeOfPitchClass(ctx.key, chord.root) ?? 0;
    for (let index = 0; index < stepPattern.length; index++) {
      if (rng() < 0.12) continue; // respiración
      const degree = motif[index % motif.length]! + chordDegree;
      let pitch = tonic + degreeToSemitones(ctx.key.mode, degree);
      // Mantener el lead en un registro cantable.
      while (pitch < 60) pitch += 12;
      while (pitch > 88) pitch -= 12;
      notes.push({
        pitch,
        start: bar * ctx.beatsPerBar + stepToBeats(stepPattern[index]!, stepsPerBar, ctx.beatsPerBar),
        duration: (density > 0.75 ? 0.22 : 0.4) * (ctx.beatsPerBar / 4),
        velocity: clampVelocity(96 + jitter(rng, 8)),
      });
    }
  }
  return notes;
}

function expandArp(spec: PatternSpec, ctx: ExpandContext, bars: number): Note[] {
  const stepsPerBar = ctx.stepsPerBar ?? 16;
  const rng = seededRng(ctx.seed, spec.seed ?? 0, "arp");
  const octave = spec.octave ?? 5;
  const energy = spec.energy ?? 0.6;
  const stepSize = energy > 0.8 ? 1 : energy < 0.4 ? 4 : 2;
  const chords = resolveChords(spec, ctx.key, bars);
  const notes: Note[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const chord = parseChord(chords[bar]!);
    const tones = chordToMidi(chord, octave).map((pitch) => (pitch < 55 ? pitch + 12 : pitch));
    const cycle = bar % 2 === 0 ? [...tones, tones[0]! + 12] : [...tones].reverse();
    for (let step = 0; step < stepsPerBar; step += stepSize) {
      const pitch = cycle[(step / stepSize) % cycle.length]!;
      notes.push({
        pitch,
        start: bar * ctx.beatsPerBar + stepToBeats(step, stepsPerBar, ctx.beatsPerBar),
        duration: (stepSize === 1 ? 0.1 : 0.18) * (ctx.beatsPerBar / 4),
        velocity: clampVelocity(78 + jitter(rng, 6)),
      });
    }
  }
  return notes;
}

export function expandPattern(spec: PatternSpec, ctx: ExpandContext): Note[] {
  const bars = Math.max(1, Math.min(64, Math.round(spec.bars)));
  let notes: Note[];
  switch (spec.role) {
    case "drums":
      notes = expandDrums(spec, ctx, bars);
      break;
    case "bass":
      notes = expandBass(spec, ctx, bars);
      break;
    case "chords":
    case "pad":
      notes = expandChords(spec, ctx, bars);
      break;
    case "lead":
      notes = expandLead(spec, ctx, bars);
      break;
    case "arp":
      notes = expandArp(spec, ctx, bars);
      break;
    default:
      throw new Error(`Rol desconocido: "${String(spec.role)}"`);
  }

  const swing = spec.swing ?? 0;
  if (swing > 0) {
    for (const note of notes) {
      const positionInBeat = note.start % 1;
      if (Math.abs(positionInBeat - 0.5) < 1e-6) note.start += swing * 0.12;
    }
  }

  return notes
    .map((note) => ({
      pitch: Math.max(0, Math.min(127, Math.round(note.pitch))),
      start: Math.max(0, Number(note.start.toFixed(4))),
      duration: Math.max(0.05, Number(note.duration.toFixed(4))),
      velocity: clampVelocity(note.velocity),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Utilidad para tests y para el planificador: ¿es un acorde entendible? */
export function isValidChord(symbol: string): boolean {
  try {
    parseChord(symbol);
    return true;
  } catch {
    return false;
  }
}

/** Progresiones habituales por idioma estilístico. */
export const PROGRESSIONS: Record<string, string[]> = {
  dark80s: ["Dm", "Bb", "F", "C"],
  siniestro: ["Em", "C", "G", "D"],
  minorEpic: ["Am", "F", "C", "G"],
  andalusian: ["Am", "G", "F", "E"],
  techno: ["Am", "Am", "F", "G"],
  ambient: ["C", "Am", "F", "G"],
  hiphop: ["Fm", "Db", "Ab", "Eb"],
};

export function progressionToChords(key: KeySignature, progression?: string[]): string[] {
  if (progression?.length) return progression.filter(isValidChord).map((symbol) => parseChord(symbol).symbol);
  return [tonicChordSymbol(key)];
}

export function pitchClassOfChord(symbol: string): number {
  return pitchClass(parseChord(symbol).symbol.match(/^[A-G][#b]?/)![0]);
}
