import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guardarFicheroProveedores, leerConfigGpu, leerFicheroProveedores } from "./config-proveedores.ts";

test("saving the LLM part keeps the GPU part and the other way round", () => {
  const dir = mkdtempSync(join(tmpdir(), "miuzika-prov-"));
  const fichero = join(dir, "proveedores.json");
  try {
    guardarFicheroProveedores({ activo: "deepseek", proveedores: { deepseek: { modelo: "x" } } }, fichero);
    guardarFicheroProveedores({ gpu: { activo: "lambda", proveedores: { lambda: { region: "us-west-1" } } } }, fichero);
    guardarFicheroProveedores({ activo: "ollama-cloud" }, fichero);
    const todo = leerFicheroProveedores(fichero);
    assert.equal(todo.activo, "ollama-cloud");
    assert.deepEqual(todo.proveedores, { deepseek: { modelo: "x" } });
    assert.deepEqual(leerConfigGpu(fichero), { activo: "lambda", proveedores: { lambda: { region: "us-west-1" } } });
    assert.ok(readFileSync(fichero, "utf8").includes("us-west-1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no file, or a broken one, reads as empty", () => {
  assert.equal(leerConfigGpu(join(tmpdir(), "no-existe-miuzika.json")), undefined);
});
