import assert from "node:assert/strict";
import test from "node:test";
import { presetsDeSf2, textoDePresets } from "./gm.ts";

/** Un .sf2 mínimo: RIFF sfbk → LIST pdta → phdr con dos presets y el EOP. */
function sf2De(presets: { nombre: string; programa: number; banco: number }[]): Uint8Array {
  const registros = [...presets, { nombre: "EOP", programa: 0, banco: 0 }];
  const phdr = new Uint8Array(8 + registros.length * 38);
  const v = new DataView(phdr.buffer);
  phdr.set(new TextEncoder().encode("phdr"), 0);
  v.setUint32(4, registros.length * 38, true);
  registros.forEach((p, i) => {
    const r = 8 + i * 38;
    phdr.set(new TextEncoder().encode(p.nombre).subarray(0, 20), r);
    v.setUint16(r + 20, p.programa, true);
    v.setUint16(r + 22, p.banco, true);
  });
  const list = new Uint8Array(12 + phdr.length);
  list.set(new TextEncoder().encode("LIST"), 0);
  new DataView(list.buffer).setUint32(4, 4 + phdr.length, true);
  list.set(new TextEncoder().encode("pdta"), 8);
  list.set(phdr, 12);
  const riff = new Uint8Array(12 + list.length);
  riff.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(riff.buffer).setUint32(4, 4 + list.length, true);
  riff.set(new TextEncoder().encode("sfbk"), 8);
  riff.set(list, 12);
  return riff;
}

test("lee los presets de la tabla phdr y descarta el EOP", () => {
  const presets = presetsDeSf2(
    sf2De([
      { nombre: "Overdrive Guitar", programa: 29, banco: 0 },
      { nombre: "Standard 1", programa: 0, banco: 128 },
    ]),
  );
  assert.deepEqual(presets, [
    { nombre: "Overdrive Guitar", programa: 29, banco: 0 },
    { nombre: "Standard 1", programa: 0, banco: 128 },
  ]);
  const texto = textoDePresets(presets);
  assert.match(texto, /29 Overdrive Guitar/);
  assert.match(texto, /Kits[^\n]*\n0 Standard 1/);
  assert.throws(() => presetsDeSf2(new Uint8Array(20)), /SoundFont/);
});
