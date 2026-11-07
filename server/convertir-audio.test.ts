import assert from "node:assert/strict";
import { test } from "node:test";
import { argumentosAWav, debeConvertirse, formatoWav } from "./convertir-audio.ts";

function cabecera(formato: number, relleno = 0): Uint8Array {
  const b = Buffer.alloc(36 + relleno);
  b.write("RIFF", 0, "latin1");
  b.write("WAVE", 8, "latin1");
  let pos = 12;
  if (relleno > 0) {
    b.write("JUNK", pos, "latin1");
    b.writeUInt32LE(relleno - 8, pos + 4);
    pos += relleno;
  }
  b.write("fmt ", pos, "latin1");
  b.writeUInt32LE(16, pos + 4);
  b.writeUInt16LE(formato, pos + 8);
  return b;
}

test("reads the format tag, also after other chunks", () => {
  assert.equal(formatoWav(cabecera(1)), 1);
  assert.equal(formatoWav(cabecera(3)), 3);
  assert.equal(formatoWav(cabecera(1, 28)), 1);
  assert.equal(formatoWav(Buffer.from("ID3 not a wav at all")), null);
});

test("only PCM WAV and MIDI stay as they arrive", () => {
  assert.equal(debeConvertirse("a.wav", cabecera(1)), false);
  assert.equal(debeConvertirse("a.wav", cabecera(3)), true, "float WAV: Python's wave cannot read it");
  assert.equal(debeConvertirse("a.mp3", Buffer.from("ID3")), true);
  assert.equal(debeConvertirse("a.flac", Buffer.from("fLaC")), true);
  assert.equal(debeConvertirse("a.mid", Buffer.from("MThd")), false);
});

test("the conversion writes a WAV to the given path, overwriting nothing else", () => {
  const args = argumentosAWav("o.mp3", "d.wav");
  assert.equal(args.at(-1), "d.wav");
  assert.ok(args.includes("pcm_s24le"));
});
