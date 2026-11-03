import { test } from "node:test";
import assert from "node:assert/strict";

import { argumentosMp3, leerMedida, problemasMp3, textoId3 } from "./mp3.ts";

test("320 kbps CBR with the title as ID3, destination last", () => {
  const a = argumentosMp3("in.wav", "out.mp3", { titulo: "Cain Uriel" });
  assert.deepEqual(a.slice(a.indexOf("-codec:a"), a.indexOf("-codec:a") + 4), ["-codec:a", "libmp3lame", "-b:a", "320k"]);
  assert.ok(a.includes("title=Cain Uriel"));
  assert.equal(a.at(-1), "out.mp3");
  assert.ok(!argumentosMp3("in.wav", "out.mp3").includes("-metadata"));
});

test("ID3 text loses control characters and runs of spaces", () => {
  assert.equal(textoId3("  Los\nochenta\t en las calles "), "Los ochenta en las calles");
});

test("reads duration and volumedetect from ffmpeg's stderr", () => {
  const stderr =
    "  Duration: 00:01:43.03, start: 0.025057, bitrate: 320 kb/s\n" +
    "[Parsed_volumedetect_0 @ 0x1] mean_volume: -16.4 dB\n" +
    "[Parsed_volumedetect_0 @ 0x1] max_volume: -0.9 dB\n";
  assert.deepEqual(leerMedida(stderr), { segundos: 103.03, picoDb: -0.9, mediaDb: -16.4 });
  assert.equal(leerMedida("max_volume: -inf dB").picoDb, -Infinity);
  assert.deepEqual(leerMedida(""), { segundos: null, picoDb: null, mediaDb: null });
});

test("a faithful MP3 has no problems; cut, silent and clipping ones are named", () => {
  const wav = { segundos: 103, picoDb: -1, mediaDb: -16 };
  assert.deepEqual(problemasMp3(wav, { segundos: 103.05, picoDb: -0.6, mediaDb: -16 }), []);
  assert.match(problemasMp3(wav, { segundos: 60, picoDb: -1, mediaDb: -16 }).join(), /shorter than the WAV: it was cut/);
  assert.match(problemasMp3(wav, { segundos: 103, picoDb: -Infinity, mediaDb: null }).join(), /silent/);
  assert.match(problemasMp3(wav, { segundos: 103, picoDb: 0.4, mediaDb: -16 }).join(), /clips/);
  assert.match(problemasMp3(wav, { segundos: null, picoDb: null, mediaDb: null }).join(), /could not read the MP3 back/);
});
