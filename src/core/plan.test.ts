import { test } from "node:test";
import assert from "node:assert/strict";

import { GENRES, SongPlanSchema, composePlan, loopPlan, normalizePlan, parseSongPlan, presetPlan, validatePlan } from "./plan.ts";
import { applyOps } from "./ops.ts";
import { createProject } from "./project.ts";
import { normalizeKey } from "./theory.ts";

test("todos los presets generan planes válidos", () => {
  for (const genre of GENRES) {
    const plan = presetPlan(genre);
    const result = SongPlanSchema.safeParse(plan);
    assert.ok(result.success, `${genre}: ${result.error?.issues.map((issue) => issue.message).join(", ")}`);
    assert.ok(plan.sections.length > 0);
    assert.ok(plan.tracks.length > 0);
  }
});

test("todos los presets se expanden a proyectos válidos", () => {
  for (const genre of GENRES) {
    const plan = presetPlan(genre);
    const { project } = applyOps(createProject(), composePlan(plan));
    assert.equal(project.tracks.length, plan.tracks.length, genre);
    assert.equal(project.lengthBars, plan.sections.reduce((sum, section) => sum + section.bars, 0), genre);
    const notes = project.tracks.reduce(
      (sum, track) => sum + track.clips.reduce((clipSum, clip) => clipSum + clip.notes.length, 0),
      0,
    );
    assert.ok(notes > 0, `${genre} sin notas`);
  }
});

test("la progresión se adapta a la tonalidad pedida", () => {
  const plan = presetPlan("synthpop80s", { key: normalizeKey({ tonic: "F", mode: "minor" }) });
  assert.deepEqual(plan.chords, ["Fm", "Db", "Ab", "Eb"]);
});

test("bars ajusta la duración total exactamente", () => {
  for (const bars of [8, 16, 24, 33, 64]) {
    const plan = presetPlan("synthpop80s", { bars });
    const total = plan.sections.reduce((sum, section) => sum + section.bars, 0);
    assert.equal(total, bars);
    assert.ok(plan.sections.every((section) => section.bars >= 1));
  }
});

test("un loop solo incluye los roles pedidos", () => {
  const plan = loopPlan("siniestroPunk", ["bass", "drums"], 4);
  assert.equal(plan.tracks.length, 2);
  assert.deepEqual(
    plan.tracks.map((track) => track.role).sort(),
    ["bass", "drums"],
  );
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0]!.bars, 4);
});

test("los dispositivos del plan existen y sus parámetros son válidos", () => {
  const plan = presetPlan("siniestroPunk");
  const { project } = applyOps(createProject(), composePlan(plan));
  for (const track of project.tracks) {
    for (const device of track.devices) {
      assert.ok(Object.keys(device.params).length > 0, `${track.name}/${device.type} sin params`);
    }
  }
  const guitar = project.tracks.find((track) => track.name === "Guitarra");
  assert.ok(guitar?.devices.some((device) => device.type === "distortion"));
});

test("synthpop no incluye arp por defecto", () => {
  const plan = presetPlan("synthpop80s");
  assert.ok(plan.tracks.every((track) => track.role !== "arp"));
  assert.ok(plan.sections.every((section) => !section.roles.includes("arp")));
});

test("un loop puede pedir arp aunque el preset no lo tenga", () => {
  const plan = loopPlan("synthpop80s", ["arp"], 4);
  assert.equal(plan.tracks.length, 1);
  assert.equal(plan.tracks[0]!.role, "arp");
  assert.equal(plan.sections[0]!.roles.includes("arp"), true);
});

test("acepta booleanos en parámetros de dispositivo", () => {
  const raw = {
    ...presetPlan("techno", { bars: 4 }),
    tracks: [
      {
        name: "Delay",
        role: "lead",
        style: "hook",
        gainDb: 0,
        pan: 0,
        devices: [{ type: "delay", params: { pingPong: true, wet: 0.2 } }],
      },
    ],
    sections: [{ name: "loop", bars: 4, energy: 0.6, roles: ["lead"] }],
  };
  const parsed = parseSongPlan(raw);
  assert.equal(parsed.tracks[0]!.devices[0]!.params!.pingPong, 1);
  assert.deepEqual(validatePlan(parsed), []);
});

test("composePlan usa ids de pista estables", () => {
  const ops = composePlan(presetPlan("techno"));
  const addTrack = ops.filter((op) => op.op === "add_track");
  const ids = addTrack.map((op) => (op.op === "add_track" ? op.id : undefined));
  assert.ok(ids.every((id) => typeof id === "string" && id.startsWith("trk_")));
  assert.equal(new Set(ids).size, ids.length);
});

// Plan real devuelto por el modelo en la primera prueba de integración.
const llmPlan = {
  title: "Sombras en Re",
  genre: "synthpop80s",
  bpm: 84,
  key: { tonic: "D", mode: "minor" },
  chords: ["Dm", "Bb", "Gm", "A"],
  sections: [
    { name: "intro", bars: 4, energy: 0.2, roles: ["pad"] },
    { name: "verse", bars: 8, energy: 0.5, roles: ["drums", "pad"] },
  ],
  tracks: [
    {
      name: "Drums",
      role: "drums",
      style: "gated_80s",
      gainDb: -3,
      pan: 0,
      devices: [
        { type: "compressor", params: { threshold: 0.55, ratio: 4 } },
        { type: "reverb", params: { size: 0.35, mix: 0.18 } },
      ],
    },
    {
      name: "Pad",
      role: "pad",
      style: "gated",
      gainDb: -9,
      pan: -0.2,
      devices: [
        { type: "chorus", params: { rate: 0.25, depth: 0.45, mix: 0.4 } },
        { type: "width", params: { amount: 0.6 } },
      ],
    },
  ],
  mixNotes: "oscuro y espacioso",
};

test("normalizePlan traduce sinónimos habituales de DAW", () => {
  const plan = normalizePlan(parseSongPlan(llmPlan));
  const reverb = plan.tracks[0]!.devices.find((device) => device.type === "reverb")!;
  assert.equal(reverb.params!.size, undefined);
  assert.equal(reverb.params!.decay, 0.35);
  assert.equal(reverb.params!.wet, 0.18);
  const width = plan.tracks[1]!.devices.find((device) => device.type === "width")!;
  assert.equal(width.params!.width, 0.6);
  assert.deepEqual(validatePlan(plan), []);
});

test("el plan del LLM se aplica sin tocar el código de ops", () => {
  const plan = normalizePlan(parseSongPlan(llmPlan));
  const { project } = applyOps(createProject(), composePlan(plan));
  assert.equal(project.bpm, 84);
  assert.equal(project.lengthBars, 12);
  assert.equal(project.tracks.length, 2);
});

test("validatePlan detecta estilos y parámetros inventados", () => {
  const bad = structuredClone(llmPlan) as typeof llmPlan;
  bad.tracks[0]!.style = "trap";
  bad.tracks[1]!.devices[1] = { type: "width", params: { brillo: 1 } } as never;
  const issues = validatePlan(parseSongPlan(bad));
  assert.ok(issues.some((issue) => issue.includes('estilo de batería "trap"')));
  assert.ok(issues.some((issue) => issue.includes('parámetro "brillo" desconocido')));
});

test("validatePlan detecta roles sin pista y acordes inválidos", () => {
  const bad = structuredClone(llmPlan) as typeof llmPlan;
  bad.sections[1]!.roles = ["drums", "lead"];
  bad.chords = ["Dm", "Hm", "F", "C"];
  const issues = validatePlan(parseSongPlan(bad));
  assert.ok(issues.some((issue) => issue.includes('rol "lead"')));
  assert.ok(issues.some((issue) => issue.includes('acorde no reconocido "Hm"')));
});
