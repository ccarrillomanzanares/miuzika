import { test } from "node:test";
import assert from "node:assert/strict";

import { correrProceso } from "./proceso.ts";

const node = process.execPath;

test("collects stdout, stderr and the exit code", async () => {
  const r = await correrProceso(node, ["-e", "process.stdout.write('hola'); process.stderr.write('aviso'); process.exit(3)"], {
    segundos: 20,
  });
  assert.equal(r.codigo, 3);
  assert.equal(r.salida, "hola");
  assert.equal(r.errores, "aviso");
  assert.equal(r.porTiempo, false);
  assert.equal(r.cancelado, false);
});

test("a silent failure gets the exit code in errores", async () => {
  const r = await correrProceso(node, ["-e", "process.exit(2)"], { segundos: 20 });
  assert.match(r.errores, /code 2/);
});

test("the time limit kills the process and says so", async () => {
  const r = await correrProceso(node, ["-e", "setInterval(() => {}, 1000)"], { segundos: 1, nombre: "espera" });
  assert.equal(r.porTiempo, true);
  assert.match(r.errores, /espera cut off after 1 s/);
  assert.ok(r.ms < 6000, `took ${r.ms} ms`);
});

test("aborting the signal kills the process and is reported as a cancel", async () => {
  const control = new AbortController();
  const promesa = correrProceso(node, ["-e", "setInterval(() => {}, 1000)"], { segundos: 60, senal: control.signal });
  setTimeout(() => control.abort(), 300);
  const r = await promesa;
  assert.equal(r.cancelado, true);
  assert.equal(r.porTiempo, false);
  assert.match(r.errores, /cancelled/);
});

test("an already aborted signal does not let the process run", async () => {
  const control = new AbortController();
  control.abort();
  const r = await correrProceso(node, ["-e", "setInterval(() => {}, 1000)"], { segundos: 60, senal: control.signal });
  assert.equal(r.cancelado, true);
});

test("a command that does not exist reports errorArranque", async () => {
  const r = await correrProceso("no-existe-miuzika-xyz", [], { segundos: 5 });
  assert.ok(r.errorArranque);
  assert.equal(r.codigo, null);
});
