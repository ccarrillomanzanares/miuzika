import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";

import { zipStems } from "./stems-zip.ts";

test("empaqueta varios stems y los devuelve intactos", async () => {
  const files = [
    { name: "01-lead.wav", blob: new Blob([new Uint8Array([1, 2, 3])]) },
    { name: "02-bass.wav", blob: new Blob([new Uint8Array([4, 5, 6, 7])]) },
  ];
  const archive = await zipStems(files);
  assert.equal(archive.type, "application/zip");
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(entries).sort(), ["01-lead.wav", "02-bass.wav"]);
  assert.deepEqual([...entries["01-lead.wav"]!], [1, 2, 3]);
  assert.deepEqual([...entries["02-bass.wav"]!], [4, 5, 6, 7]);
});
