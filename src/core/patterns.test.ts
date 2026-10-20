import { test } from "node:test";
import assert from "node:assert/strict";

import { expandPattern } from "./patterns.ts";
import type { PatternSpec } from "./patterns.ts";
import { normalizeKey } from "./theory.ts";

const key = normalizeKey({ tonic: "D", mode: "minor" });
const context = { key, beatsPerBar: 4, stepsPerBar: 16, seed: 42 };

const spec = (overrides: Partial<PatternSpec>): PatternSpec => ({
  role: "drums",
  bars: 2,
  ...overrides,
});

test("la batería respeta compases y rangos MIDI", () => {
  const notes = expandPattern(spec({ role: "drums", style: "gated_80s", bars: 2 }), context);
  assert.ok(notes.length > 0);
  for (const note of notes) {
    assert.ok(note.start >= 0 && note.start < 8, `inicio ${note.start}`);
    assert.ok(note.pitch >= 0 && note.pitch <= 127);
    assert.ok(note.velocity >= 1 && note.velocity <= 127);
    assert.ok(note.duration > 0);
  }
  assert.ok(notes.some((note) => note.pitch === 36), "debe haber bombo");
  assert.ok(notes.some((note) => note.pitch === 38), "debe haber caja");
});

test("misma semilla, mismas notas", () => {
  const pattern = spec({ role: "drums", style: "siniestro_punk", bars: 4 });
  assert.deepEqual(expandPattern(pattern, context), expandPattern(pattern, context));
});

test("semillas distintas producen variaciones", () => {
  const pattern = spec({ role: "drums", style: "siniestro_punk", bars: 4 });
  const a = expandPattern(pattern, context);
  const b = expandPattern(pattern, { ...context, seed: 43 });
  assert.notDeepEqual(a, b);
});

test("el bajo usa la fundamental del acorde y se queda en registro grave", () => {
  const notes = expandPattern(
    spec({ role: "bass", style: "driving8", bars: 2, chords: ["Dm", "Bb"], octave: 2 }),
    context,
  );
  assert.ok(notes.length >= 8);
  for (const note of notes) {
    assert.ok(note.pitch >= 24 && note.pitch <= 60, `pitch ${note.pitch}`);
  }
  const firstBar = notes.filter((note) => note.start < 4);
  assert.equal(firstBar[0]!.pitch % 12, 2, "primer compás empieza en re");
});

test("el lead se mantiene en un registro cantable", () => {
  const notes = expandPattern(
    spec({ role: "lead", style: "hook", bars: 4, chords: ["Dm", "Bb", "F", "C"], octave: 5 }),
    context,
  );
  assert.ok(notes.length > 0);
  for (const note of notes) assert.ok(note.pitch >= 60 && note.pitch <= 88, `pitch ${note.pitch}`);
});

test("los acordes de pad duran el compás", () => {
  const notes = expandPattern(spec({ role: "pad", style: "pad", bars: 1, chords: ["Dm"], octave: 4 }), context);
  assert.equal(notes.length, 3);
  for (const note of notes) {
    assert.equal(note.start, 0);
    assert.equal(note.duration, 4);
  }
});

test("la energía alta añade recursos de arreglo", () => {
  const low = expandPattern({ role: "drums", style: "gated_80s", bars: 4, energy: 0.25 }, context);
  const high = expandPattern({ role: "drums", style: "gated_80s", bars: 4, energy: 0.95 }, context);
  assert.ok(high.length > low.length, `${high.length} vs ${low.length}`);
});

test("el bajo cambia de movimiento con la energía", () => {
  const low = expandPattern(
    { role: "bass", style: "driving8", bars: 2, energy: 0.2, chords: ["Dm"] },
    context,
  );
  const high = expandPattern(
    { role: "bass", style: "driving8", bars: 2, energy: 0.95, chords: ["Dm"] },
    context,
  );
  assert.notDeepEqual(
    low.map((note) => note.pitch),
    high.map((note) => note.pitch),
  );
});

test("la semilla cambia el motivo del lead", () => {
  const a = expandPattern(
    { role: "lead", style: "hook", bars: 1, energy: 0.6, seed: 1, chords: ["Dm"] },
    context,
  );
  const b = expandPattern(
    { role: "lead", style: "hook", bars: 1, energy: 0.6, seed: 2, chords: ["Dm"] },
    context,
  );
  assert.notDeepEqual(
    a.map((note) => note.pitch),
    b.map((note) => note.pitch),
  );
});

test("un estilo desconocido falla con la lista de válidos", () => {
  assert.throws(
    () => expandPattern(spec({ role: "drums", style: "inventado" }), context),
    /gated_80s/,
  );
});

test("la densidad baja reduce el número de eventos", () => {
  const dense = expandPattern(spec({ role: "drums", style: "driving", bars: 4, density: 1 }), context);
  const sparse = expandPattern(spec({ role: "drums", style: "driving", bars: 4, density: 0.2 }), context);
  assert.ok(sparse.length < dense.length);
});
