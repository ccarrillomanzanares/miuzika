/** Compilador Strudel → eventos MIDI del IR. No ejecuta el motor de audio. */

import type { InstrumentType, Note } from "../../src/core/types.ts";

export interface StrudelCompileGroup {
  key: string;
  label: string;
  instrument: InstrumentType;
  notes: Note[];
}

export interface StrudelCompileResult {
  groups: StrudelCompileGroup[];
  warnings: string[];
  hapCount: number;
}

interface GroupBuilder {
  key: string;
  label: string;
  instrument: InstrumentType;
  notes: Note[];
}

const DRUM_PITCH: Record<string, number> = {
  bd: 36,
  bassdrum: 36,
  kick: 36,
  sd: 38,
  snare: 38,
  cp: 39,
  clap: 39,
  hh: 42,
  hat: 42,
  hihat: 42,
  sh: 42,
  shaker: 42,
  oh: 46,
  openhat: 46,
  rim: 37,
  lt: 45,
  mt: 47,
  ht: 48,
  tom: 45,
  crash: 49,
  ride: 51,
  cb: 56,
  cowbell: 56,
};

const SYNTHS: ReadonlyArray<{
  match: RegExp;
  instrument: InstrumentType;
}> = [
  { match: /^(sine|triangle|sin|tri)$/i, instrument: "pad" },
  { match: /^(sawtooth|saw|supersaw|pulse)$/i, instrument: "lead" },
  { match: /^(square|sqr)$/i, instrument: "synth" },
  { match: /^(noise|white|pink)$/i, instrument: "synth" },
];

interface Scope {
  core: any;
  transpiler: any;
}

let scopePromise: Promise<Scope> | null = null;

async function getScope(): Promise<Scope> {
  if (scopePromise) return scopePromise;
  scopePromise = (async () => {
    const core: any = await import("@strudel/core");
    const mini: any = await import("@strudel/mini");
    const tonal: any = await import("@strudel/tonal");
    const transpiler: any = await import("@strudel/transpiler");
    // evalScope publica note/s/stack/... en el worker, no en la ventana.
    await core.evalScope(core, mini, tonal);
    return { core, transpiler };
  })();
  return scopePromise;
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

const NOTE_NAMES: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

function noteToMidi(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const midi = Math.round(value);
    return midi >= 0 && midi <= 127 ? midi : null;
  }
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([a-gA-G])([#bsf]*)(-?\d+)?$/);
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const accidental = (match[2] ?? "").replace(/s/g, "#").replace(/f/g, "b");
  const octave = match[3] === undefined ? 3 : Number(match[3]);
  const semitone = NOTE_NAMES[name];
  if (semitone === undefined) return null;
  let midi = (octave + 1) * 12 + semitone;
  for (const char of accidental) {
    if (char === "#") midi++;
    else if (char === "b") midi--;
  }
  return midi >= 0 && midi <= 127 ? midi : null;
}

function soundBase(sound: string): string {
  return sound.split(":")[0]!.trim().toLowerCase();
}

function groupFor(sound: string, hasNote: boolean): {
  key: string;
  label: string;
  instrument: InstrumentType;
  drumPitch?: number;
} | null {
  const base = soundBase(sound);
  if (base && DRUM_PITCH[base] !== undefined) {
    return { key: "drums", label: "drums", instrument: "drumkit", drumPitch: DRUM_PITCH[base] };
  }
  if (base) {
    const synth = SYNTHS.find((candidate) => candidate.match.test(base));
    if (synth) {
      return { key: `sound_${base}`, label: base, instrument: synth.instrument };
    }
    if (!hasNote) return null;
    return { key: `sound_${base}`, label: base, instrument: "synth" };
  }
  if (hasNote) return { key: "notes", label: "notes", instrument: "synth" };
  return null;
}

function timeValue(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value.valueOf === "function") {
    const numeric = Number(value.valueOf());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

/**
 * Evalúa `code` en el worker y consulta `bars` ciclos. Un ciclo Strudel se
 * interpreta como un compás del proyecto; `slow(2)` dura dos compases.
 */
export async function compileStrudelSource(
  code: string,
  bars: number,
  beatsPerBar: number,
): Promise<StrudelCompileResult> {
  const source = code.trim();
  if (!source) throw new Error("El código Strudel está vacío.");
  if (!(bars >= 1 && bars <= 64)) throw new Error("Los compases deben estar entre 1 y 64.");
  const { transpiler } = await getScope();
  const evaluated = await transpiler.evaluate(source, transpiler.transpiler);
  const pattern = evaluated?.pattern;
  if (!pattern || typeof pattern.queryArc !== "function") {
    throw new Error("El código no devuelve un patrón Strudel (¿falta una expresión al final?).");
  }

  const haps: any[] = pattern.queryArc(0, bars);
  const groups = new Map<string, GroupBuilder>();
  const warnings = new Set<string>();
  let hapCount = 0;

  for (const hap of haps) {
    hapCount++;
    const span = hap.whole ?? hap.part;
    const begin = timeValue(span?.begin);
    const end = timeValue(span?.end);
    if (begin === null || end === null) continue;
    const startCycle = Math.max(0, begin);
    const endCycle = Math.min(bars, end);
    if (endCycle <= startCycle) continue;

    const value = hap.value;
    if (!value || typeof value !== "object") continue;
    const sound = value.s ?? value.sound ?? "";
    const noteRaw = value.note ?? value.n;
    const hasNote = noteRaw !== undefined && noteRaw !== null;
    const target = groupFor(String(sound), hasNote);
    if (!target) {
      if (String(sound).trim()) {
        warnings.add(`Sonido sin nota ni kit reconocido: "${String(sound)}"`);
      }
      continue;
    }

    const pitch = hasNote ? noteToMidi(noteRaw) : target.drumPitch ?? null;
    if (pitch === null) {
      warnings.add(
        `No se pudo convertir a MIDI: note=${JSON.stringify(noteRaw)}, s=${JSON.stringify(sound)}`,
      );
      continue;
    }

    let group = groups.get(target.key);
    if (!group) {
      group = {
        key: target.key,
        label: target.label,
        instrument: target.instrument,
        notes: [],
      };
      groups.set(target.key, group);
    }

    const rawVelocity = value.velocity ?? value.gain ?? 1;
    let velocity = Number(rawVelocity);
    if (!Number.isFinite(velocity)) velocity = 1;
    if (velocity > 1) velocity /= 127;
    const note: Note = {
      pitch,
      start: startCycle * beatsPerBar,
      duration: Math.max(1 / 32, (endCycle - startCycle) * beatsPerBar),
      velocity: Math.round(clamp(velocity, 0.02, 1) * 127),
    };
    group.notes.push(note);
  }

  for (const group of groups.values()) {
    group.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }

  return {
    groups: [...groups.values()],
    warnings: [...warnings],
    hapCount,
  };
}
