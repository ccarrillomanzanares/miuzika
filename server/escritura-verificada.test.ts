import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escribirComprobando } from "./escritura-verificada.ts";

const carpeta = (): string => mkdtempSync(join(tmpdir(), "miuzika-escritura-"));
const falla = async () => ({ ok: false, detalle: "SyntaxError" });
const pasa = async () => ({ ok: true, detalle: "ok" });

test("a failed check on an existing file keeps the old content (3-Nov: gpu/ files were deleted)", async () => {
  const dir = carpeta();
  const fichero = join(dir, "gpu", "generar_audio.py");
  try {
    await escribirComprobando(fichero, "print('v1')\n", pasa);
    const r = await escribirComprobando(fichero, "def roto(:\n", falla);
    assert.equal(r.ok, false);
    assert.equal(readFileSync(fichero, "utf8"), "print('v1')\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed check on a new file leaves no file behind", async () => {
  const dir = carpeta();
  const fichero = join(dir, "nuevo.py");
  try {
    const r = await escribirComprobando(fichero, "def roto(:\n", falla);
    assert.equal(r.ok, false);
    assert.equal(existsSync(fichero), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a check that throws counts as a failure and also rolls back", async () => {
  const dir = carpeta();
  const fichero = join(dir, "dsp.py");
  try {
    writeFileSync(fichero, "x = 1\n", "utf8");
    const r = await escribirComprobando(fichero, "x = (\n", async () => {
      throw new Error("python did not start");
    });
    assert.equal(r.ok, false);
    assert.match(r.detalle, /python did not start/);
    assert.equal(readFileSync(fichero, "utf8"), "x = 1\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passing check keeps the new content", async () => {
  const dir = carpeta();
  const fichero = join(dir, "dsp.py");
  try {
    writeFileSync(fichero, "x = 1\n", "utf8");
    assert.equal((await escribirComprobando(fichero, "x = 2\n", pasa)).ok, true);
    assert.equal(readFileSync(fichero, "utf8"), "x = 2\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
