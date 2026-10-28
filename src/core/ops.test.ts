import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "./project.ts";
import { OpError, applyOps, parseOps } from "./ops.ts";
import type { Op } from "./ops.ts";

function baseProject() {
  return createProject({ name: "Test", bpm: 100, key: { tonic: "D", mode: "minor" }, lengthBars: 8, seed: 1 });
}

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
    /Disponibles: wet 0..1, decay 0..1, preDelayMs 1..500, damping 0..1/,
  );
  // Un nombre de antes del 28-oct no se convierte a ciegas: se dice cuál es el nuevo.
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { preDelay: 0.2 } }]),
    /Ahora se llama "preDelayMs" \(1\.\.500\)/,
  );
  const changed = applyOps(project, [
    { op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { wet: 9 } },
  ]).project;
  assert.equal(changed.tracks[0]!.devices[0]!.params.wet, 1, "se recorta al rango");
});

test("un clip mal nombrado no se sustituye por el único que haya", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, name: "unico", notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const clipId = project.tracks[0]!.clips[0]!.id;
  assert.throws(
    () => applyOps(project, [{ op: "remove_clip", trackId: "trk_a", clipId: "otro-que-no-existe" }]),
    new RegExp(`Disponibles: ${clipId}`),
  );
  assert.equal(project.tracks[0]!.clips.length, 1, "el clip sigue ahí");
});

test("un nombre parcial único sí resuelve el clip", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, name: "Redoble de caja", notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const { project: borrado } = applyOps(project, [
    { op: "remove_clip", trackId: "trk_a", clipId: "redoble" },
  ]);
  assert.equal(borrado.tracks[0]!.clips.length, 0);
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

test("move_clip cambia el inicio en beats", () => {
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const clipId = inicio.tracks[0]!.clips[0]!.id;
  const { project } = applyOps(inicio, [{ op: "move_clip", trackId: "trk_a", clipId, startBeat: 6 }]);
  assert.equal(project.tracks[0]!.clips[0]!.start, 6);
  assert.equal(project.tracks[0]!.clips[0]!.id, clipId, "el clip conserva su id");
});

test("move_clip puede cambiar de pista y rechaza mezclar midi con audio", () => {
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_track", id: "trk_b", name: "B" },
    { op: "add_track", id: "trk_w", name: "Wav", kind: "audio" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const clipId = inicio.tracks[0]!.clips[0]!.id;

  const movido = applyOps(inicio, [
    { op: "move_clip", trackId: "trk_a", clipId, startBeat: 4, trackDestinoId: "trk_b" },
  ]).project;
  assert.equal(movido.tracks[0]!.clips.length, 0, "sale de la pista original");
  assert.equal(movido.tracks[1]!.clips.length, 1, "entra en la destino");
  assert.equal(movido.tracks[1]!.clips[0]!.start, 4);

  assert.throws(
    () =>
      applyOps(inicio, [
        { op: "move_clip", trackId: "trk_a", clipId, startBeat: 0, trackDestinoId: "trk_w" },
      ]),
    /pista de audio/,
  );
});

test("duplicate_clip coloca la copia justo después y no comparte notas", () => {
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 60, start: 0, duration: 2, velocity: 100 }] },
  ]).project;
  const original = inicio.tracks[0]!.clips[0]!;

  const { project } = applyOps(inicio, [
    { op: "duplicate_clip", trackId: "trk_a", clipId: original.id },
  ]);
  const clips = project.tracks[0]!.clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[1]!.start, original.start + original.length, "pegado al final del original");
  assert.notEqual(clips[1]!.id, original.id, "id nuevo");

  // mutar la copia no toca al original
  clips[1]!.notes[0]!.pitch = 72;
  assert.equal(clips[0]!.notes[0]!.pitch, 60);
});

test("add_audio_clip no recorta un stem largo a 64 compases", () => {
  const { project } = applyOps(baseProject(), [
    { op: "register_audio_asset", assetId: "aud_largo", name: "stem", durationBeats: 560 },
    { op: "add_audio_clip", assetId: "aud_largo", startBar: 0, track: { name: "Stem" } },
  ]);
  const clip = project.tracks[0]!.clips[0]!;
  assert.equal(clip.length, 560, "debe conservar los 140 compases del stem");
});

test("duplicate_clip puede copiar a otra pista y a un inicio concreto", () => {
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_track", id: "trk_b", name: "B" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 64, start: 0, duration: 1, velocity: 90 }] },
  ]).project;
  const original = inicio.tracks[0]!.clips[0]!;
  const { project } = applyOps(inicio, [
    { op: "duplicate_clip", trackId: "trk_a", clipId: original.id, startBeat: 16, trackDestinoId: "trk_b" },
  ]);
  assert.equal(project.tracks[0]!.clips.length, 1);
  assert.equal(project.tracks[1]!.clips.length, 1);
  assert.equal(project.tracks[1]!.clips[0]!.start, 16);
  assert.equal(project.tracks[1]!.clips[0]!.notes[0]!.pitch, 64);
});

test("set_clip_length iguala un clip MIDI con el de audio de la misma toma", () => {
  // Un bombo MIDI que acaba en el compas 76 y su WAV de 85 compases: los dos
  // clips tienen que medir lo mismo, porque la duracion se cuenta en compases.
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_bat", name: "Bombo", instrument: { type: "drumkit" } },
    { op: "add_notes", trackId: "trk_bat", startBar: 0, notes: [{ pitch: 36, start: 300, duration: 1, velocity: 100 }] },
    { op: "register_audio_asset", assetId: "aud1", name: "bombo", durationBeats: 336.6666666666667 },
    { op: "add_audio_clip", assetId: "aud1", startBar: 0, track: { name: "bombo" } },
  ]).project;
  const midi = inicio.tracks[0]!.clips[0]!;
  assert.equal(midi.length, 304); // acaba donde acaba su nota (compas 76)
  const { project } = applyOps(inicio, [
    { op: "set_clip_length", trackId: "trk_bat", clipId: midi.id, lengthBeats: 340 },
  ]);
  assert.equal(project.tracks[0]!.clips[0]!.length, 340);
  assert.equal(project.lengthBars, 85);
});


test("buses: una reverb compartida con envíos, efectos en el bus y borrado limpio", () => {
  const { project } = applyOps(baseProject(), [
    { op: "add_track", id: "trk_voz", name: "Voz", instrument: { type: "lead" } },
    { op: "add_track", id: "trk_gtr", name: "Guitarra", instrument: { type: "synth" } },
    { op: "add_bus", name: "Sala", devices: ["reverb"] },
    { op: "set_send", trackId: "Voz", busId: "Sala", levelDb: -8 },
    { op: "set_send", trackId: "trk_gtr", busId: "bus_sala", levelDb: -14 },
    { op: "set_send", trackId: "Voz", busId: "Sala", levelDb: -6 }, // cambia, no duplica
    { op: "add_device", trackId: "Sala", device: { type: "eq", params: { lowHz: 300, low: -6 } } },
    { op: "set_device", trackId: "bus_sala", deviceId: "reverb", params: { preDelayMs: 40 } },
  ]);
  const bus = project.buses![0]!;
  assert.equal(bus.id, "bus_sala");
  assert.deepEqual(bus.devices.map((d) => d.type), ["reverb", "eq"]);
  assert.equal(bus.devices[0]!.params.preDelayMs, 40);
  assert.deepEqual(project.tracks[0]!.sends, [{ busId: "bus_sala", levelDb: -6 }]);
  assert.equal(project.tracks[0]!.devices.length, 0, "el eq va al bus, no a la pista");

  const sinBus = applyOps(project, [{ op: "remove_bus", busId: "Sala" }]).project;
  assert.deepEqual(sinBus.buses, []);
  assert.equal(sinBus.tracks[0]!.sends, undefined, "los envíos al bus borrado se van con él");

  const sinEnvio = applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Sala", remove: true }]).project;
  assert.equal(sinEnvio.tracks[0]!.sends, undefined);
  assert.throws(() => applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Sala" }]), /necesita levelDb/);
  assert.throws(() => applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Delay", levelDb: -6 }]), /No encuentro el bus "Delay"/);
  assert.throws(() => applyOps(project, [{ op: "add_bus", name: "Voz" }]), /Ya hay una pista llamada "Voz"/);
});

test("los parámetros sueltos de un dispositivo se aplican, no se pierden (lo que pasó en «Hard» el 28-oct)", () => {
  // Las ops tal cual las mandó el modelo: parámetros al lado de `type`, sin `params`.
  const conPad = applyOps(baseProject(), [{ op: "add_track", id: "trk_pad", name: "Pad", instrument: { type: "pad" } }]).project;
  const { project } = applyOps(conPad, [
    { op: "add_device", trackId: "trk_pad", device: { type: "compressor", thresholdDb: -20, ratio: 3.5, attackMs: 8, releaseMs: 120 } },
    { op: "add_device", trackId: "trk_pad", device: { type: "eq", low: -3, mid: 2, high: -2 } },
    { op: "add_bus", id: "bus_verb", name: "Reverb", devices: [{ type: "reverb", wet: 1, decay: 0.62, preDelayMs: 40, damping: 0.45 }] },
    { op: "add_device", trackId: "trk_pad", device: { type: "delay", timeMs: 300, params: { feedback: 0.4 } } },
  ]);
  const [compresor, eq, delay] = project.tracks[0]!.devices;
  assert.deepEqual(compresor!.params, { thresholdDb: -20, ratio: 3.5, attackMs: 8, releaseMs: 120 });
  assert.equal(eq!.params.low, -3);
  assert.equal(eq!.params.mid, 2);
  assert.equal(eq!.params.high, -2);
  assert.equal(delay!.params.timeMs, 300, "sueltos y `params` juntos");
  assert.equal(delay!.params.feedback, 0.4);
  assert.deepEqual(project.buses![0]!.devices[0]!.params, { wet: 1, decay: 0.62, preDelayMs: 40, damping: 0.45 });
  // Un nombre suelto que no existe da error, igual que dentro de `params`.
  assert.throws(
    () => applyOps(conPad, [{ op: "add_device", trackId: "trk_pad", device: { type: "compressor", threshold: -20 } }]),
    /Ahora se llama "thresholdDb"/,
  );
});
