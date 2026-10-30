import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { repartirZonasGlobales } from "./soundfont-zonas.ts";

test("the global zone reaches the zones that do not have that generator; the zone's own wins", () => {
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
  assert.deepEqual(instrumento.zones[1]!.generators[54], { value: 0 }, "the zone's own is not overwritten");
  assert.deepEqual(sf.presets[0]!.zones[0]!.generators, { 41: { value: 0 }, 37: { value: 50 } }, "neither instrument nor sample is inherited");
  assert.equal(repartirZonasGlobales(sf), 0, "repeating it changes nothing");
});

// With the real General MIDI and the same openDAW engine code that converts the SF2 for
// the wasm. The catalog is outside git: without it, the test is skipped.
const GM = resolve(process.cwd(), "workspace", "catalogo", "gm", "GeneralUser-GS.sf2");

test("with GeneralUser GS, “Saw Lead” (81) loops in the openDAW engine", { skip: !existsSync(GM) && "missing the GM" }, async () => {
  // In Node the package arrives as CommonJS (the class is in `default`); in Vite, by name.
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
  assert.ok(tal_cual.every((modo) => modo === 0), "without spreading, the engine does not see the loop (the measured failure)");

  const repartido = new SoundFont2(bytes) as never;
  repartirZonasGlobales(repartido);
  assert.ok(bucles(repartido).every((modo) => modo === 1), "once spread, all regions loop");
});
