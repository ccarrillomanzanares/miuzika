import { test } from "node:test";
import assert from "node:assert/strict";

import { checkConstraints, describeConstraints, extractConstraints, parsePrompt } from "./parse.ts";
import { loopPlan, presetPlan } from "./plan.ts";

test("interpreta el ejemplo synth pop oscuro", () => {
  const parsed = parsePrompt("créame una canción synth pop 80's oscura en re menor, lenta");
  assert.equal(parsed.genre, "synthpop80s");
  assert.equal(parsed.plan.key.tonic, "D");
  assert.equal(parsed.plan.key.mode, "minor");
  assert.ok(parsed.plan.bpm < 96, `bpm ${parsed.plan.bpm}`);
  assert.ok(parsed.plan.sections.length >= 4);
});

test("interpreta el loop siniestro punk con dos pistas", () => {
  const parsed = parsePrompt("créame un loop de bajo y batería estilo siniestro punk español");
  assert.equal(parsed.genre, "siniestroPunk");
  assert.equal(parsed.plan.tracks.length, 2);
  assert.deepEqual(
    parsed.plan.tracks.map((track) => track.role).sort(),
    ["bass", "drums"],
  );
  assert.equal(parsed.plan.sections[0]!.bars, 4);
});

test("detecta bpm y compases explícitos", () => {
  const parsed = parsePrompt("techno hipnótico en la menor a 132 bpm, 32 compases");
  assert.equal(parsed.genre, "techno");
  assert.equal(parsed.plan.key.tonic, "A");
  assert.equal(parsed.plan.bpm, 132);
  assert.equal(
    parsed.plan.sections.reduce((sum, section) => sum + section.bars, 0),
    32,
  );
});

test("detecta tonalidad mayor en español", () => {
  const parsed = parsePrompt("canción de 16 compases en do mayor, alegre");
  assert.equal(parsed.plan.key.tonic, "C");
  assert.equal(parsed.plan.key.mode, "major");
  assert.deepEqual(parsed.plan.chords, ["C", "Am", "F", "G"]);
});

test("acepta notación anglosajona Dm y F#m", () => {
  assert.equal(parsePrompt("algo en Dm").plan.key.tonic, "D");
  assert.equal(parsePrompt("algo en F#m").plan.key.tonic, "F#");
});

test("'sin batería' elimina la pista de batería", () => {
  const parsed = parsePrompt("ambient melancólico para estudiar, sin batería");
  assert.ok(parsed.plan.tracks.every((track) => track.role !== "drums"));
  assert.ok(parsed.plan.sections.every((section) => !section.roles.includes("drums")));
});

test("'distorsionadas' añade distorsión", () => {
  const parsed = parsePrompt("rock en mi menor con guitarras distorsionadas");
  const guitars = parsed.plan.tracks.filter((track) => track.role === "chords");
  assert.ok(guitars.length > 0);
  assert.ok(guitars.every((track) => track.devices.some((device) => device.type === "distortion")));
});

test("sin género reconocible cae en synthpop", () => {
  assert.equal(parsePrompt("hazme algo bonito").genre, "synthpop80s");
});

test("extrae restricciones duras del prompt", () => {
  const constraints = extractConstraints("créame una canción synth pop 80's oscura en re menor, lenta");
  assert.equal(constraints.genre, "synthpop80s");
  assert.equal(constraints.key?.tonic, "D");
  assert.equal(constraints.key?.mode, "minor");
  assert.deepEqual(constraints.bpmRange, [75, 91]);
  assert.match(describeConstraints(constraints), /tonalidad: D minor/);
});

test("las restricciones se cumplen con el plan correcto y fallan con otro", () => {
  const constraints = extractConstraints("créame una canción synth pop 80's oscura en re menor, lenta");
  const ok = presetPlan("synthpop80s", { key: { tonic: "D", mode: "minor" }, bpm: 84 });
  assert.deepEqual(checkConstraints(ok, constraints), []);

  const fast = presetPlan("synthpop80s", { key: { tonic: "D", mode: "minor" }, bpm: 130 });
  assert.ok(checkConstraints(fast, constraints).some((issue) => issue.includes("entre 75 y 91")));

  const wrongKey = presetPlan("synthpop80s", { key: { tonic: "A", mode: "minor" }, bpm: 84 });
  assert.ok(checkConstraints(wrongKey, constraints).some((issue) => issue.includes("tonalidad")));
});

test("un loop exige una sola sección y solo los roles pedidos", () => {
  const constraints = extractConstraints("loop de bajo y batería estilo siniestro punk español");
  assert.equal(constraints.loop, true);
  assert.equal(constraints.bars, 4);
  assert.deepEqual(constraints.roles?.slice().sort(), ["bass", "drums"]);

  const ok = loopPlan("siniestroPunk", ["drums", "bass"], 4);
  assert.deepEqual(checkConstraints(ok, constraints), []);

  const extra = presetPlan("siniestroPunk", { bars: 4 });
  assert.ok(checkConstraints(extra, constraints).some((issue) => issue.includes("Sobran pistas")));
});

test("un prompt sin género no fuerza el género", () => {
  assert.equal(extractConstraints("hazme algo bonito").genre, undefined);
});
