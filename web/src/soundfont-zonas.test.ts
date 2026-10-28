import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { repartirZonasGlobales } from "./soundfont-zonas.ts";

test("la zona global llega a las zonas que no tienen ese generador; la propia manda", () => {
  const instrumento = {
    globalZone: { generators: { 54: { value: 1 }, 38: { value: 0 }, 53: { value: 7 } } },
    zones: [{ generators: { 53: { value: 0 } } }, { generators: { 53: { value: 1 }, 54: { value: 0 } } }],
  };
  const sf = {
    presets: [
      {
        globalZone: { generators: { 37: { value: 50 }, 41: { value: 9 } } },
        zones: [{ generators: { 41: { value: 0 } }, instrument: instrumento }],
      },
      { zones: [{ generators: { 41: { value: 0 } }, instrument: instrumento }] },
    ],
  };
  repartirZonasGlobales(sf);
  assert.deepEqual(instrumento.zones[0]!.generators, { 53: { value: 0 }, 54: { value: 1 }, 38: { value: 0 } });
  assert.deepEqual(instrumento.zones[1]!.generators[54], { value: 0 }, "la zona propia no se pisa");
  assert.deepEqual(sf.presets[0]!.zones[0]!.generators, { 41: { value: 0 }, 37: { value: 50 } }, "ni instrumento ni muestra se heredan");
  assert.equal(repartirZonasGlobales(sf), 0, "repetirlo no cambia nada");
});

// Con el General MIDI de verdad y el mismo código del motor de openDAW que convierte
// el SF2 para el wasm. El catálogo está fuera de git: sin él, la prueba se salta.
const GM = resolve(process.cwd(), "workspace", "catalogo", "gm", "GeneralUser-GS.sf2");

test("con GeneralUser GS, «Saw Lead» (81) suena en bucle en el motor de openDAW", { skip: !existsSync(GM) && "falta el GM" }, async () => {
  // En Node el paquete llega como CommonJS (la clase va en `default`); en Vite, con nombre.
  const modulo = (await import("soundfont2")) as unknown as { SoundFont2?: unknown; default?: { SoundFont2?: unknown } };
  const SoundFont2 = (modulo.SoundFont2 ?? modulo.default?.SoundFont2 ?? modulo.default) as new (b: Uint8Array) => never;
  const { simplifySoundfont } = (await import(
    pathToFileURL(resolve(process.cwd(), "node_modules/@opendaw/studio-core-wasm/dist/soundfont-simplify.js")).href
  )) as { simplifySoundfont: (sf: unknown) => ArrayBuffer };
  const bytes = new Uint8Array(readFileSync(GM));

  const bucles = (sf: { presets: { header: { bank: number; preset: number } }[] }) => {
    const indice = sf.presets.findIndex((p) => p.header.bank === 0 && p.header.preset === 81);
    const blob = new DataView(simplifySoundfont(sf));
    const regiones = blob.getUint32(24, true);
    const presets = blob.getUint32(28, true);
    const desde = blob.getUint32(presets + indice * 8, true);
    const cuantas = blob.getUint32(presets + indice * 8 + 4, true);
    const modos = [];
    for (let r = desde; r < desde + cuantas; r++) modos.push(blob.getUint32(regiones + r * 40 + 12, true));
    return modos;
  };

  const tal_cual = bucles(new SoundFont2(bytes));
  assert.ok(tal_cual.length > 0);
  assert.ok(tal_cual.every((modo) => modo === 0), "sin repartir, el motor no ve el bucle (el fallo medido)");

  const repartido = new SoundFont2(bytes) as never;
  repartirZonasGlobales(repartido);
  assert.ok(bucles(repartido).every((modo) => modo === 1), "repartido, todas las regiones van en bucle");
});
