import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guardarFicheroProveedores, leerConfigGpu, leerFicheroProveedores } from "./config-proveedores.ts";

test("saving the GPU part keeps whatever else the file holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "miuzika-prov-"));
  const fichero = join(dir, "sub", "proveedores.json");
  try {
    guardarFicheroProveedores({ otra: { a: 1 } }, fichero);
    guardarFicheroProveedores({ gpu: { proveedores: { lambda: { region: "us-west-1" } } } }, fichero);
    assert.deepEqual(leerFicheroProveedores(fichero).otra, { a: 1 });
    assert.deepEqual(leerConfigGpu(fichero), { proveedores: { lambda: { region: "us-west-1" } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no file reads as empty", () => {
  assert.equal(leerConfigGpu(join(tmpdir(), "no-existe-miuzika.json")), undefined);
});
