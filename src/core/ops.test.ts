import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "./project.ts";
import { OpError, applyOps, opsJsonSchema, parseOps } from "./ops.ts";
import type { Op } from "./ops.ts";

function baseProject() {
  return createProject({ name: "Test", bpm: 100, key: { tonic: "D", mode: "minor" }, lengthBars: 8, seed: 1 });
}

test("crea pista y genera una parte MIDI", () => {
  const ops: Op[] = [
    { op: "add_track", id: "trk_drums", name: "Drums", kind: "midi", instrument: { type: "drumkit" } },
    {
      op: "generate_part",
      trackId: "trk_drums",
      startBar: 0,
      section: "intro",
      pattern: { role: "drums", style: "gated_80s", bars: 2, density: 0.8 },
    },
  ];
  const { project } = applyOps(baseProject(), ops);
  assert.equal(project.tracks.length, 1);
  assert.equal(project.tracks[0]!.clips.length, 1);
  assert.ok(project.tracks[0]!.clips[0]!.notes.length > 0);
  assert.deepEqual(project.tracks[0]!.clips[0]!.origin?.section, "intro");
});

test("add_code_source guarda la fuente pendiente de compilar", () => {
  const { project } = applyOps(baseProject(), [
    {
      op: "add_code_source",
      name: "Strudel bass",
      code: 'note("c2 e2 g2").s("sawtooth")',
      bars: 8,
    },
  ]);
  assert.equal(project.codeSources?.length, 1);
  assert.equal(project.codeSources?.[0]?.id, "code_strudel_strudel_bass");
  assert.equal(project.codeSources?.[0]?.trackIds.length, 0);
  assert.equal(project.codeSources?.[0]?.bars, 8);
  assert.equal(project.tracks.length, 0);
});

test("add_code_source con el mismo id reemplaza el código", () => {
  const first = applyOps(baseProject(), [
    { op: "add_code_source", id: "code_bass", name: "Bass", code: 's("bd")', bars: 4 },
  ]).project;
  const { project } = applyOps(first, [
    { op: "add_code_source", id: "code_bass", name: "Bass", code: 's("sd")', bars: 8 },
  ]);
  assert.equal(project.codeSources?.length, 1);
  assert.equal(project.codeSources?.[0]?.code, 's("sd")');
  assert.equal(project.codeSources?.[0]?.bars, 8);
});

test("generate_part sin trackId crea la pista", () => {
  const { project } = applyOps(baseProject(), [
    {
      op: "generate_part",
      track: { name: "Bajo", kind: "midi", instrument: { type: "bass" } },
      startBar: 0,
      pattern: { role: "bass", style: "driving8", bars: 4, octave: 2, chords: ["Dm"] },
    },
  ]);
  assert.equal(project.tracks.length, 1);
  assert.equal(project.tracks[0]!.instrument.type, "bass");
  assert.ok(project.tracks[0]!.clips[0]!.notes.length >= 8);
});

test("resuelve pistas por índice 1-based", () => {
  const { project } = applyOps(baseProject(), [
    { op: "add_track", name: "Drums", instrument: { type: "drumkit" } },
    { op: "set_track", trackId: "1", gainDb: -6, muted: true },
  ]);
  assert.equal(project.tracks[0]!.gainDb, -6);
  assert.equal(project.tracks[0]!.muted, true);
});

test("set_device sin dispositivo explica qué hay", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_pad", name: "Pad", instrument: { type: "pad" } },
  ]).project;
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { wet: 0.5 } }]),
    /no tiene el dispositivo "reverb"/,
  );
});

test("set_device valida parámetros y enumera los válidos", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_pad", name: "Pad" },
    { op: "add_device", trackId: "trk_pad", device: { type: "reverb" } },
  ]).project;
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { brillo: 1 } }]),
    /Disponibles: wet, decay, preDelay, damping/,
  );
  const changed = applyOps(project, [
    { op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { wet: 9 } },
  ]).project;
  assert.equal(changed.tracks[0]!.devices[0]!.params.wet, 1, "se recorta al rango");
});

test("una op inválida revierte toda la transacción", () => {
  const project = baseProject();
  const ops: Op[] = [
    { op: "add_track", name: "Ok" },
    { op: "set_track", trackId: "no_existe", gainDb: 0 },
  ];
  assert.throws(() => applyOps(project, ops), OpError);
  assert.equal(project.tracks.length, 0, "el proyecto original no cambia");
});

test("parseOps rechaza operaciones desconocidas y campos fuera de rango", () => {
  assert.throws(() => parseOps([{ op: "hackear" }]), /inválidas/i);
  assert.throws(() => parseOps([{ op: "set_song", bpm: 900 }]), /bpm/i);
  assert.throws(() => parseOps([]), /inválidas/i);
});

test("parseOps normaliza defaults", () => {
  const [op] = parseOps([{ op: "generate_part", startBar: 0, pattern: { role: "bass", bars: 4 } }]);
  assert.equal(op!.op, "generate_part");
  if (op!.op === "generate_part") assert.equal(op!.pattern.bars, 4);
});

test("el JSON Schema de ops es un objeto con anyOf", () => {
  const schema = opsJsonSchema();
  assert.equal(schema.type, "object");
  const properties = schema.properties as Record<string, { items?: { oneOf?: unknown[]; anyOf?: unknown[] } }>;
  const variants = properties.ops?.items?.oneOf ?? properties.ops?.items?.anyOf;
  assert.ok(variants && variants.length >= 10);
});

test("registra un asset y coloca un clip de audio", () => {
  const { project } = applyOps(baseProject(), [
    { op: "register_audio_asset", assetId: "aud_loop", name: "Loop", durationBeats: 8 },
    { op: "add_audio_clip", track: { name: "Audio" }, assetId: "aud_loop", startBar: 2, gainDb: -3 },
  ]);
  const track = project.tracks[0]!;
  assert.equal(track.kind, "audio");
  assert.equal(track.instrument.type, "sampler");
  const clip = track.clips[0]!;
  assert.equal(clip.start, 8);
  assert.equal(clip.length, 8);
  assert.deepEqual(clip.audio, { assetId: "aud_loop", offset: 0, gainDb: -3 });
  assert.equal(project.lengthBars >= 4, true);
});

test("un clip de audio sin asset falla con la lista de disponibles", () => {
  assert.throws(
    () => applyOps(baseProject(), [{ op: "add_audio_clip", startBar: 0, assetId: "nope" }]),
    /No existe el asset "nope"/,
  );
});

test("set_audio_clip ajusta offset, duración y ganancia", () => {
  const withClip = applyOps(baseProject(), [
    { op: "register_audio_asset", assetId: "aud_a", name: "A", durationBeats: 8 },
    { op: "add_audio_clip", track: { name: "Audio" }, assetId: "aud_a", startBar: 0 },
  ]).project;
  const trackId = withClip.tracks[0]!.id;
  const clipId = withClip.tracks[0]!.clips[0]!.id;
  const { project } = applyOps(withClip, [
    { op: "set_audio_clip", trackId, clipId, offsetBeats: 2, lengthBeats: 4, gainDb: -6 },
  ]);
  const clip = project.tracks[0]!.clips[0]!;
  assert.equal(clip.audio?.offset, 2);
  assert.equal(clip.length, 4);
  assert.equal(clip.audio?.gainDb, -6);
});

test("acepta booleanos en parámetros de dispositivo", () => {
  const { project } = applyOps(baseProject(), [
    { op: "add_track", id: "trk_fx", name: "FX" },
    {
      op: "add_device",
      trackId: "trk_fx",
      device: { type: "delay", params: { pingPong: true, wet: 0.2 } },
    },
  ]);
  assert.equal(project.tracks[0]!.devices[0]!.params.pingPong, 1);
});

test("add_notes usa tiempos relativos al clip", () => {  const { project } = applyOps(baseProject(), [
    { op: "add_track", id: "trk_lead", name: "Lead" },
    {
      op: "add_notes",
      trackId: "trk_lead",
      startBar: 2,
      notes: [
        { pitch: 62, start: 0, duration: 1, velocity: 100 },
        { pitch: 65, start: 1, duration: 1, velocity: 90 },
      ],
    },
  ]);
  const clip = project.tracks[0]!.clips[0]!;
  assert.equal(clip.start, 8, "compás 2 con 4/4");
  assert.equal(clip.notes.length, 2);
  assert.equal(project.lengthBars >= 3, true);
});
