import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afinarZonas, repartirZonasGlobales } from "./soundfont-zonas.ts";

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

test("scaleTuning and coarseTune end up in the root key, the only tuning openDAW reads", () => {
  const instrumento = {
    zones: [
      // A drum zone that must not transpose (scaleTuning 0), sample root 60, keys 38-39.
      {
        generators: { 43: { range: { lo: 38, hi: 39 } }, 56: { value: 0 }, 53: { value: 0 } } as Record<number, unknown>,
        keyRange: { lo: 38, hi: 39 },
        sample: { header: { originalPitch: 60 } },
      },
      // Coarse -4 with normal scale: four semitones down at every key.
      { generators: { 51: { value: -4 }, 58: { value: 40 }, 53: { value: 1 } } as Record<number, unknown>, sample: { header: { originalPitch: 60 } } },
      // scaleTuning 0 plus coarse +2: the key sounds the sample two semitones up.
      {
        generators: { 43: { range: { lo: 50, hi: 50 } }, 56: { value: 0 }, 51: { value: 2 }, 53: { value: 2 } } as Record<number, unknown>,
        sample: { header: { originalPitch: 28 } },
      },
      // Plain zone: untouched (the same object).
      { generators: { 53: { value: 3 } } as Record<number, unknown> },
    ],
  };
  const plano = instrumento.zones[3];
  const sf = { presets: [{ zones: [{ generators: {}, instrument: instrumento }] }] };
  assert.equal(afinarZonas(sf), 3);
  const g = (i: number, t: number) => instrumento.zones[i]!.generators[t] as { value?: number; range?: unknown } | undefined;
  assert.equal(instrumento.zones.length, 5, "the 38-39 zone becomes two");
  assert.deepEqual([g(0, 43)?.range, g(0, 58)?.value], [{ lo: 38, hi: 38 }, 38], "key 38 plays the sample as recorded");
  assert.deepEqual([g(1, 43)?.range, g(1, 58)?.value], [{ lo: 39, hi: 39 }, 39]);
  assert.deepEqual((instrumento.zones[1] as { keyRange?: unknown }).keyRange, { lo: 39, hi: 39 });
  assert.equal(g(2, 58)?.value, 44, "root 40 - (-4)");
  assert.equal(g(3, 58)?.value, 48, "key 50 - 2: two semitones up");
  assert.equal(instrumento.zones[4], plano);
  assert.equal(afinarZonas(sf), 0, "repeating it changes nothing");
});

test("with GeneralUser GS, the GM kit 0 snare (key 38) plays at its own pitch", { skip: !existsSync(GM) && "missing the GM" }, async () => {
  const modulo = (await import("soundfont2")) as unknown as { SoundFont2?: unknown; default?: { SoundFont2?: unknown } };
  const SoundFont2 = (modulo.SoundFont2 ?? modulo.default?.SoundFont2 ?? modulo.default) as new (b: Uint8Array) => never;
  const { simplifySoundfont } = (await import(
    pathToFileURL(resolve(process.cwd(), "node_modules/@opendaw/studio-core-wasm/dist/soundfont-simplify.js")).href
  )) as { simplifySoundfont: (sf: unknown) => ArrayBuffer };

  const raices = (sf: { presets: { header: { bank: number; preset: number } }[] }) => {
    const indice = sf.presets.findIndex((p) => p.header.bank === 128 && p.header.preset === 0);
    const blob = new DataView(simplifySoundfont(sf));
    const regiones = blob.getUint32(24, true);
    const presets = blob.getUint32(28, true);
    const desde = blob.getUint32(presets + indice * 8, true);
    const cuantas = blob.getUint32(presets + indice * 8 + 4, true);
    const out: number[] = [];
    for (let r = desde; r < desde + cuantas; r++) {
      const base = regiones + r * 40;
      if (blob.getUint8(base) <= 38 && 38 <= blob.getUint8(base + 1)) out.push(blob.getUint32(base + 8, true));
    }
    return out;
  };
  const bytes = new Uint8Array(readFileSync(GM));
  const antes = new SoundFont2(bytes) as never;
  repartirZonasGlobales(antes);
  assert.ok(raices(antes).some((r) => r !== 38), "without retuning, key 38 is transposed (the measured failure)");

  const despues = new SoundFont2(bytes) as never;
  repartirZonasGlobales(despues);
  afinarZonas(despues);
  const r = raices(despues);
  assert.ok(r.length > 0);
  assert.deepEqual([...new Set(r)], [38], "every key-38 region has root 38: no transposition");
});
