import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "./project.ts";
import { OpError, applyOps, parseOps } from "./ops.ts";
import type { Op } from "./ops.ts";

function baseProject() {
  return createProject({ name: "Test", bpm: 100, key: { tonic: "D", mode: "minor" }, lengthBars: 8, seed: 1 });
}

test("resolves tracks by 1-based index", () => {
  const { project } = applyOps(baseProject(), [
    { op: "add_track", name: "Drums", instrument: { type: "drumkit" } },
    { op: "set_track", trackId: "1", gainDb: -6, muted: true },
  ]);
  assert.equal(project.tracks[0]!.gainDb, -6);
  assert.equal(project.tracks[0]!.muted, true);
});

test("set_device with no device explains what is there", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_pad", name: "Pad", instrument: { type: "pad" } },
  ]).project;
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { wet: 0.5 } }]),
    /does not have the device "reverb"/,
  );
});

test("set_device validates parameters and lists the valid ones", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_pad", name: "Pad" },
    { op: "add_device", trackId: "trk_pad", device: { type: "reverb" } },
  ]).project;
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { brillo: 1 } }]),
    /Available: wet 0..1, decay 0..1, preDelayMs 1..500, damping 0..1/,
  );
  // A pre-Oct-28 name is not converted blindly: it says which one is the new one.
  assert.throws(
    () => applyOps(project, [{ op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { preDelay: 0.2 } }]),
    /It is now called "preDelayMs" \(1\.\.500\)/,
  );
  const changed = applyOps(project, [
    { op: "set_device", trackId: "trk_pad", deviceId: "reverb", params: { wet: 9 } },
  ]).project;
  assert.equal(changed.tracks[0]!.devices[0]!.params.wet, 1, "clamped to the range");
});

test("a wrongly named clip is not replaced by the only one there is", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, name: "unico", notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const clipId = project.tracks[0]!.clips[0]!.id;
  assert.throws(
    () => applyOps(project, [{ op: "remove_clip", trackId: "trk_a", clipId: "otro-que-no-existe" }]),
    new RegExp(`Available: ${clipId}`),
  );
  assert.equal(project.tracks[0]!.clips.length, 1, "the clip is still there");
});

test("a unique partial name does resolve the clip", () => {
  const project = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, name: "Redoble de caja", notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const { project: borrado } = applyOps(project, [
    { op: "remove_clip", trackId: "trk_a", clipId: "redoble" },
  ]);
  assert.equal(borrado.tracks[0]!.clips.length, 0);
});

test("an invalid op reverts the whole transaction", () => {
  const project = baseProject();
  const ops: Op[] = [
    { op: "add_track", name: "Ok" },
    { op: "set_track", trackId: "no_existe", gainDb: 0 },
  ];
  assert.throws(() => applyOps(project, ops), OpError);
  assert.equal(project.tracks.length, 0, "the original project does not change");
});

test("parseOps rejects unknown operations and out-of-range fields", () => {
  assert.throws(() => parseOps([{ op: "hackear" }]), /invalid/i);
  assert.throws(() => parseOps([{ op: "set_song", bpm: 900 }]), /bpm/i);
  assert.throws(() => parseOps([]), /invalid/i);
});

test("registers an asset and places an audio clip", () => {
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

test("an audio clip with no asset fails with the list of available ones", () => {
  assert.throws(
    () => applyOps(baseProject(), [{ op: "add_audio_clip", startBar: 0, assetId: "nope" }]),
    /Asset "nope" does not exist/,
  );
});

test("set_audio_clip adjusts offset, duration, and gain", () => {
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

test("accepts booleans in device parameters", () => {
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

test("add_notes uses times relative to the clip", () => {  const { project } = applyOps(baseProject(), [
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
  assert.equal(clip.start, 8, "bar 2 in 4/4");
  assert.equal(clip.notes.length, 2);
  assert.equal(project.lengthBars >= 3, true);
});

test("move_clip changes the start in beats", () => {
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_a", name: "A" },
    { op: "add_notes", trackId: "trk_a", startBar: 0, notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }] },
  ]).project;
  const clipId = inicio.tracks[0]!.clips[0]!.id;
  const { project } = applyOps(inicio, [{ op: "move_clip", trackId: "trk_a", clipId, startBeat: 6 }]);
  assert.equal(project.tracks[0]!.clips[0]!.start, 6);
  assert.equal(project.tracks[0]!.clips[0]!.id, clipId, "the clip keeps its id");
});

test("move_clip can change track and rejects mixing MIDI with audio", () => {
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
  assert.equal(movido.tracks[0]!.clips.length, 0, "leaves the original track");
  assert.equal(movido.tracks[1]!.clips.length, 1, "enters the destination");
  assert.equal(movido.tracks[1]!.clips[0]!.start, 4);

  assert.throws(
    () =>
      applyOps(inicio, [
        { op: "move_clip", trackId: "trk_a", clipId, startBeat: 0, trackDestinoId: "trk_w" },
      ]),
    /audio track/,
  );
});

test("duplicate_clip places the copy right after and does not share notes", () => {
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
  assert.equal(clips[1]!.start, original.start + original.length, "stuck to the end of the original");
  assert.notEqual(clips[1]!.id, original.id, "new id");

  // mutating the copy does not touch the original
  clips[1]!.notes[0]!.pitch = 72;
  assert.equal(clips[0]!.notes[0]!.pitch, 60);
});

test("add_audio_clip does not trim a long stem to 64 bars", () => {
  const { project } = applyOps(baseProject(), [
    { op: "register_audio_asset", assetId: "aud_largo", name: "stem", durationBeats: 560 },
    { op: "add_audio_clip", assetId: "aud_largo", startBar: 0, track: { name: "Stem" } },
  ]);
  const clip = project.tracks[0]!.clips[0]!;
  assert.equal(clip.length, 560, "must keep the stem's 140 bars");
});

test("duplicate_clip can copy to another track and to a specific start", () => {
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

test("set_clip_length matches a MIDI clip with the audio clip of the same take", () => {
  // A MIDI kick that ends at bar 76 and its 85-bar WAV: both clips have to measure
  // the same, because duration is counted in bars.
  const inicio = applyOps(baseProject(), [
    { op: "add_track", id: "trk_bat", name: "Bombo", instrument: { type: "drumkit" } },
    { op: "add_notes", trackId: "trk_bat", startBar: 0, notes: [{ pitch: 36, start: 300, duration: 1, velocity: 100 }] },
    { op: "register_audio_asset", assetId: "aud1", name: "bombo", durationBeats: 336.6666666666667 },
    { op: "add_audio_clip", assetId: "aud1", startBar: 0, track: { name: "bombo" } },
  ]).project;
  const midi = inicio.tracks[0]!.clips[0]!;
  assert.equal(midi.length, 304); // ends where its note ends (bar 76)
  const { project } = applyOps(inicio, [
    { op: "set_clip_length", trackId: "trk_bat", clipId: midi.id, lengthBeats: 340 },
  ]);
  assert.equal(project.tracks[0]!.clips[0]!.length, 340);
  assert.equal(project.lengthBars, 85);
});


test("buses: a shared reverb with sends, effects on the bus, and clean deletion", () => {
  const { project } = applyOps(baseProject(), [
    { op: "add_track", id: "trk_voz", name: "Voz", instrument: { type: "lead" } },
    { op: "add_track", id: "trk_gtr", name: "Guitarra", instrument: { type: "synth" } },
    { op: "add_bus", name: "Sala", devices: ["reverb"] },
    { op: "set_send", trackId: "Voz", busId: "Sala", levelDb: -8 },
    { op: "set_send", trackId: "trk_gtr", busId: "bus_sala", levelDb: -14 },
    { op: "set_send", trackId: "Voz", busId: "Sala", levelDb: -6 }, // changes, does not duplicate
    { op: "add_device", trackId: "Sala", device: { type: "eq", params: { lowHz: 300, low: -6 } } },
    { op: "set_device", trackId: "bus_sala", deviceId: "reverb", params: { preDelayMs: 40 } },
  ]);
  const bus = project.buses![0]!;
  assert.equal(bus.id, "bus_sala");
  assert.deepEqual(bus.devices.map((d) => d.type), ["reverb", "eq"]);
  assert.equal(bus.devices[0]!.params.preDelayMs, 40);
  assert.deepEqual(project.tracks[0]!.sends, [{ busId: "bus_sala", levelDb: -6 }]);
  assert.equal(project.tracks[0]!.devices.length, 0, "the eq goes to the bus, not the track");

  const sinBus = applyOps(project, [{ op: "remove_bus", busId: "Sala" }]).project;
  assert.deepEqual(sinBus.buses, []);
  assert.equal(sinBus.tracks[0]!.sends, undefined, "sends to the deleted bus go with it");

  const sinEnvio = applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Sala", remove: true }]).project;
  assert.equal(sinEnvio.tracks[0]!.sends, undefined);
  assert.throws(() => applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Sala" }]), /needs levelDb/);
  assert.throws(() => applyOps(project, [{ op: "set_send", trackId: "Voz", busId: "Delay", levelDb: -6 }]), /can't find bus "Delay"/);
  assert.throws(() => applyOps(project, [{ op: "add_bus", name: "Voz" }]), /already a track named "Voz"/);
});

test("a device's loose parameters are applied, not lost (what happened in \"Hard\" on Oct 28)", () => {
  // The ops exactly as the model sent them: parameters next to `type`, without `params`.
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
  assert.equal(delay!.params.timeMs, 300, "loose and `params` together");
  assert.equal(delay!.params.feedback, 0.4);
  assert.deepEqual(project.buses![0]!.devices[0]!.params, { wet: 1, decay: 0.62, preDelayMs: 40, damping: 0.45 });
  // A loose name that does not exist gives an error, just like inside `params`.
  assert.throws(
    () => applyOps(conPad, [{ op: "add_device", trackId: "trk_pad", device: { type: "compressor", threshold: -20 } }]),
    /It is now called "thresholdDb"/,
  );
});
