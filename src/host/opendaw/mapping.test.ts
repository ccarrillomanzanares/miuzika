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
 * Un dispositivo con los parámetros viejos (normalizados 0..1), migrado como se
 * migra al abrir un proyecto. Las cifras esperadas de estas pruebas son las del
 * mapeo anterior al 28-oct: si siguen saliendo, los proyectos guardados suenan igual.
 */
const viejo = (type: DeviceType, params: Record<string, number>) => ({
  id: "d",
  type,
  enabled: true,
  params: migrarParametros(type, params),
});

test("beats y pulsos usan 960 PPQN", () => {
  assert.equal(beatsToPulses(1), 960);
  assert.equal(beatsToPulses(4), 3840);
  assert.equal(pulsesToBeats(3840), 4);
});

test("velocidad MIDI ↔ unitValue", () => {
  assert.equal(velocityToUnit(127), 1);
  assert.equal(velocityToUnit(64), 64 / 127);
  assert.equal(unitToVelocity(1), 127);
  assert.equal(unitToVelocity(0.5), 64);
  assert.equal(unitToVelocity(0), 1, "nunca 0");
});

test("dB ↔ unitValue", () => {
  assert.ok(Math.abs(unitToDb(0.25) - -12.041) < 0.01);
  assert.equal(unitToDb(0), -60);
  assert.ok(Math.abs(dbToUnit(-12.041) - 0.25) < 0.001);
});

test("reverb mapea wet/dry a dB y preDelay a segundos", () => {
  const mapped = mapDevice(viejo("reverb", { wet: 0.25, decay: 0.5, preDelay: 0.15, damping: 0.4 }));
  assert.equal(mapped.factory, "Reverb");
  const get = (name: string) => mapped.params.find((param) => param.name === name)?.value as number;
  assert.ok(Math.abs((get("wet") ?? 0) - -12.041) < 0.01);
  assert.ok(Math.abs((get("preDelay") ?? 0) - 0.07585) < 0.0001);
  assert.equal(get("decay"), 0.5);
  assert.equal(get("damp"), 0.4);
});

test("delay usa milisegundos y feedback acotado", () => {
  const mapped = mapDevice(viejo("delay", { wet: 0.2, time: 0.5, feedback: 2, pingPong: 1 }));
  assert.equal(mapped.factory, "Delay");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params.delayMillis, 510);
  assert.equal(params.feedback, 0.95, "se recorta a 0.95");
  assert.equal(params.cross, 1);
});

test("compresor traduce umbral, ataque y release a unidades reales", () => {
  const mapped = mapDevice(viejo("compressor", { threshold: 0.5, ratio: 4, attack: 0.1, release: 0.5 }));
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params.threshold, -30);
  assert.equal(params.ratio, 4);
  assert.ok(Math.abs((params.attack as number) - 10) < 1e-9);
  assert.ok((params.release as number) > 700 && (params.release as number) < 800);
});

test("width se convierte de 0..2 a -1..1", () => {
  const wide = mapDevice({ id: "d4", type: "width", enabled: true, params: { width: 1.5 } });
  assert.equal(wide.params[0]?.value, 0.5);
  const mono = mapDevice({ id: "d5", type: "width", enabled: true, params: { width: 0 } });
  assert.equal(mono.params[0]?.value, -1);
});

test("todos los dispositivos tienen equivalente en openDAW", () => {
  const types = ["reverb", "delay", "chorus", "distortion", "filter", "eq", "compressor", "bitcrusher", "gate", "width"] as const;
  for (const type of types) {
    const mapped = mapDevice({ id: "x", type, enabled: true, params: {} });
    assert.ok(mapped.factory, `${type} sin fábrica`);
    assert.ok(mapped.params.length > 0, `${type} sin parámetros`);
  }
});

test("el EQ usa las bandas anidadas de Revamp", () => {
  const mapped = mapDevice({ id: "eq", type: "eq", enabled: true, params: { low: 3, mid: -2, high: -4 } });
  assert.equal(mapped.factory, "Revamp");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params["lowShelf.gain"], 3);
  assert.equal(params["midBell.gain"], -2);
  assert.equal(params["highShelf.gain"], -4);
  assert.equal(params["lowBell.enabled"], false);
  assert.equal(params["highPass.enabled"], false);
});

test("el filtro se aproxima con el low-pass de Revamp", () => {
  const mapped = mapDevice(viejo("filter", { cutoff: 0, resonance: 0 }));
  assert.equal(mapped.factory, "Revamp");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.equal(params["lowPass.enabled"], true);
  // Suelo del mapeo viejo, conservado al migrar.
  assert.equal(params["lowPass.frequency"], 1_200);
  assert.equal(params["lowShelf.enabled"], false);
  // En Hz explícitos ya no hay suelo: 400 Hz es lo que se pidió.
  const nuevo = mapDevice({ id: "f2", type: "filter", enabled: true, params: { cutoffHz: 400, q: 1 } });
  const nuevos = Object.fromEntries(nuevo.params.map((param) => [param.name, param.value]));
  assert.equal(nuevos["lowPass.frequency"], 400);
  assert.equal(nuevos["lowPass.q"], 1);
});

test("la migración renombra lo viejo, tira tone y deja lo nuevo como está", () => {
  assert.deepEqual(migrarParametros("distortion", { drive: 0.5, tone: 0.7, mix: 0.4 }), { driveDb: 12, mix: 0.4 });
  assert.deepEqual(migrarParametros("delay", { timeMs: 250, wet: 0.3 }), { timeMs: 250, wet: 0.3 });
  assert.deepEqual(migrarParametros("gate", { threshold: 0.5, release: 0 }), { thresholdDb: -40, releaseMs: 1 });
});

test("el chorus se aproxima con un delay corto modulado", () => {
  const mapped = mapDevice({ id: "c", type: "chorus", enabled: true, params: { wet: 0.3, rateHz: 0.9, depth: 0.5 } });
  assert.equal(mapped.factory, "Delay");
  const params = Object.fromEntries(mapped.params.map((param) => [param.name, param.value]));
  assert.ok((params.delayMillis as number) < 40, "retardo corto de chorus");
  assert.ok((params.lfoDepth as number) > 0, "debe modular");
});

test("instrumentos: batería a Playfield, resto a Vaporisateur", () => {
  assert.equal(mapInstrument("drumkit").factory, "Playfield");
  assert.equal(mapInstrument("bass").factory, "Vaporisateur");
  assert.equal(mapInstrument("pad").factory, "Vaporisateur");
  assert.ok(mapInstrument("soundfont").warning);
});

test("preset General MIDI por banco y programa, con kits en el banco 128", () => {
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
  assert.equal(indicePresetGm(presets, 40, true), 3); // kit que no existe → estándar
  assert.equal(indicePresetGm(presets, 99, false), 0);
  assert.equal(indicePresetGm([], 0, false), undefined);
});
