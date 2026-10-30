import { test } from "node:test";
import assert from "node:assert/strict";

import {
  beatsToPulses,
  dbToUnit,
  indicePresetGm,
  mapDevice,
  mapInstrument,
  pulsesToBeats,
  unitToDb,
  unitToVelocity,
  velocityToUnit,
} from "./mapping.ts";
import { migrarParametros } from "../../core/types.ts";
import type { DeviceType } from "../../core/types.ts";

/**
 * A device with the old parameters (normalized 0..1), migrated the way it is migrated
 * when opening a project. The expected figures in these tests are those of the mapping
 * before Oct 28: if they still come out, saved projects sound the same.
 */
const viejo = (type: DeviceType, params: Record<string, number>) => ({
  id: "d",
  type,
  enabled: true,
  params: migrarParametros(type, params),
});

test("beats and pulses use 960 PPQN", () => {
  assert.equal(beatsToPulses(1), 960);
  assert.equal(beatsToPulses(4), 3840);
  assert.equal(pulsesToBeats(3840), 4);
});

test("MIDI velocity ↔ unitValue", () => {
  assert.equal(velocityToUnit(127), 1);
  assert.equal(velocityToUnit(64), 64 / 127);
  assert.equal(unitToVelocity(1), 127);
  assert.equal(unitToVelocity(0.5), 64);
  assert.equal(unitToVelocity(0), 1, "never 0");
});

test("dB ↔ unitValue", () => {
  assert.ok(Math.abs(unitToDb(0.25) - -12.041) < 0.01);
  assert.equal(unitToDb(0), -60);
  assert.ok(Math.abs(dbToUnit(-12.041) - 0.25) < 0.001);
});

test("reverb maps wet/dry to dB and preDelay to seconds", () => {
  const mapped = mapDevice(viejo("reverb", { wet: 0.25, decay: 0.5, preDelay: 0.15, damping: 0.4 }));
  assert.equal(mapped.factory, "Reverb");
  const get = (name: string) => mapped.params.find((param) => param.name === name)?.value as number;
  assert.ok(Math.abs((get("wet") ?? 0) - -12.041) < 0.01);
  assert.ok(Math.abs((get("preDelay") ?? 0) - 0.07585) < 0.0001);
  assert.equal(get("decay"), 0.5);
  assert.equal(get("damp"), 0.4);
});

test("delay uses milliseconds and bounded feedback", () => {
  const mapped = mapDevice(viejo("delay", { wet: 0.2, time: 0.5, feedback: 2, pingPong: 1 }));
  assert.equal(mapped.factory, "Delay");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params.delayMillis, 510);
  assert.equal(params.feedback, 0.95, "clamped to 0.95");
  assert.equal(params.cross, 1);
});

test("compressor translates threshold, attack, and release to real units", () => {
  const mapped = mapDevice(viejo("compressor", { threshold: 0.5, ratio: 4, attack: 0.1, release: 0.5 }));
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params.threshold, -30);
  assert.equal(params.ratio, 4);
  assert.ok(Math.abs((params.attack as number) - 10) < 1e-9);
  assert.ok((params.release as number) > 700 && (params.release as number) < 800);
});

test("width is converted from 0..2 to -1..1", () => {
  const wide = mapDevice({ id: "d4", type: "width", enabled: true, params: { width: 1.5 } });
  assert.equal(wide.params[0]?.value, 0.5);
  const mono = mapDevice({ id: "d5", type: "width", enabled: true, params: { width: 0 } });
  assert.equal(mono.params[0]?.value, -1);
});

test("all devices have an equivalent in openDAW", () => {
  const types = ["reverb", "delay", "chorus", "distortion", "filter", "eq", "compressor", "bitcrusher", "gate", "width"] as const;
  for (const type of types) {
    const mapped = mapDevice({ id: "x", type, enabled: true, params: {} });
    assert.ok(mapped.factory, `${type} without a factory`);
    assert.ok(mapped.params.length > 0, `${type} without parameters`);
  }
});

test("the EQ uses Revamp's nested bands", () => {
  const mapped = mapDevice({ id: "eq", type: "eq", enabled: true, params: { low: 3, mid: -2, high: -4 } });
  assert.equal(mapped.factory, "Revamp");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params["lowShelf.gain"], 3);
  assert.equal(params["midBell.gain"], -2);
  assert.equal(params["highShelf.gain"], -4);
  assert.equal(params["lowBell.enabled"], false);
  assert.equal(params["highPass.enabled"], false);
});

test("the filter is approximated with Revamp's low-pass", () => {
  const mapped = mapDevice(viejo("filter", { cutoff: 0, resonance: 0 }));
  assert.equal(mapped.factory, "Revamp");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params["lowPass.enabled"], true);
  // Old mapping floor, kept when migrating.
  assert.equal(params["lowPass.frequency"], 1_200);
  assert.equal(params["lowShelf.enabled"], false);
  // With explicit Hz there is no floor anymore: 400 Hz is what was requested.
  const nuevo = mapDevice({ id: "f2", type: "filter", enabled: true, params: { cutoffHz: 400, q: 1 } });
  const nuevos = Object.fromEntries(nuevo.params.map((param) => [param.name, param.value]));
  assert.equal(nuevos["lowPass.frequency"], 400);
  assert.equal(nuevos["lowPass.q"], 1);
});

test("migration renames the old, drops tone, and leaves the new as it is", () => {
  assert.deepEqual(migrarParametros("distortion", { drive: 0.5, tone: 0.7, mix: 0.4 }), { driveDb: 12, mix: 0.4 });
  assert.deepEqual(migrarParametros("delay", { timeMs: 250, wet: 0.3 }), { timeMs: 250, wet: 0.3 });
  assert.deepEqual(migrarParametros("gate", { threshold: 0.5, release: 0 }), { thresholdDb: -40, releaseMs: 1 });
});

test("chorus is approximated with a short modulated delay", () => {
  const mapped = mapDevice({ id: "c", type: "chorus", enabled: true, params: { wet: 0.3, rateHz: 0.9, depth: 0.5 } });
  assert.equal(mapped.factory, "Delay");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.ok((params.delayMillis as number) < 40, "short chorus delay");
  assert.ok((params.lfoDepth as number) > 0, "it must modulate");
});

test("instruments: drums to Playfield, the rest to Vaporisateur", () => {
  assert.equal(mapInstrument("drumkit").factory, "Playfield");
  assert.equal(mapInstrument("bass").factory, "Vaporisateur");
  assert.equal(mapInstrument("pad").factory, "Vaporisateur");
  assert.ok(mapInstrument("soundfont").warning);
});

test("General MIDI preset by bank and program, with kits in bank 128", () => {
  const presets = [
    { bank: 0, preset: 0 },
    { bank: 0, preset: 33 },
    { bank: 0, preset: 29 },
    { bank: 128, preset: 0 },
    { bank: 128, preset: 25 },
  ];
  assert.equal(indicePresetGm(presets, 33, false), 1);
  assert.equal(indicePresetGm(presets, 29, false), 2);
  assert.equal(indicePresetGm(presets, 25, true), 4);
  assert.equal(indicePresetGm(presets, 40, true), 3); // kit that does not exist → standard
  assert.equal(indicePresetGm(presets, 99, false), 0);
  assert.equal(indicePresetGm([], 0, false), undefined);
});
