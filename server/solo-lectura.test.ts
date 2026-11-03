import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { soloLecturaParaElAgente } from "./solo-lectura.ts";

const ws = resolve("/repo/workspace");
const ruta = (rel: string) => resolve(ws, rel);

test("the server's own scripts are read-only for the agent (3-Nov bug 2)", () => {
  for (const rel of [
    "herramientas/smoke.py",
    "herramientas/nuevo.py",
    "herramientas/touchpad/captura.py",
    "codigo/voces.py",
    "codigo/gate_voz.py",
    "codigo/sfz2sf2.py",
    "codigo/sfz_a_proyecto.py",
    "codigo/analizar_referencia.py",
    "codigo/sub/dsp.py",
    "proyectos/x/../../herramientas/smoke.py",
  ]) {
    assert.equal(soloLecturaParaElAgente(ruta(rel), ws), true, rel);
  }
});

test("the engine, gpu/ and projects stay writable", () => {
  for (const rel of ["codigo/dsp.py", "codigo/instruments.py", "codigo/render.py", "codigo/midi.py", "gpu/generar_audio.py", "proyectos/x/script.py", "plantillas/one_shot.py"]) {
    assert.equal(soloLecturaParaElAgente(ruta(rel), ws), false, rel);
  }
});
