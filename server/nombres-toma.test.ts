import assert from "node:assert/strict";
import test from "node:test";
import { choqueDeNombre } from "./nombres-toma.ts";

test("a take name clashes with any file its run could write, whatever the case", () => {
  const generado = ["Toma.wav", "Toma.lineage.json", "bajo-1.wav", "bajo-1.lineage.json", "vein-drums.wav", "otra.wav"];
  assert.equal(choqueDeNombre(generado, "toma"), "Toma.wav"); // NTFS: same file
  assert.equal(choqueDeNombre(generado, "bajo"), "bajo-1.wav"); // a 2-take run writes bajo-1.wav
  assert.equal(choqueDeNombre(generado, "vein"), "vein-drums.wav"); // Demucs stems
  assert.equal(choqueDeNombre(generado, "bajo-1"), "bajo-1.wav");
  assert.equal(choqueDeNombre(generado, "bajo-2"), null);
  assert.equal(choqueDeNombre(generado, "otr"), null); // a prefix without "-" is another name
  assert.equal(choqueDeNombre([], "x"), null);
});
