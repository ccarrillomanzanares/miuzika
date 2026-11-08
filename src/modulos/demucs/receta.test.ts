import { test } from "node:test";
import assert from "node:assert/strict";

import { leerResultado, parametrosParaEnviar, pistasDe, validarParametros, type Parametros } from "./receta.ts";

const separar = (cambios: Partial<Parametros> = {}): Parametros => ({ nombre: "q01-sep", modelo: "htdemucs", audio: "entrada/q01.wav", shifts: 1, ...cambios });

test("a mix with a known model can run, and travels as it is", () => {
  assert.equal(validarParametros(separar()), null);
  assert.deepEqual(parametrosParaEnviar(separar()), { nombre: "q01-sep", modelo: "htdemucs", audio: "entrada/q01.wav", shifts: 1 });
});

test("each model says which stems it gives", () => {
  assert.deepEqual([...pistasDe("htdemucs")], ["drums", "bass", "other", "vocals"]);
  assert.equal(pistasDe("htdemucs_6s").length, 6);
});

test("refusals are explained", () => {
  assert.match(validarParametros(separar({ audio: null })) ?? "", /mix to separate/);
  assert.match(validarParametros(separar({ modelo: "mdx" as Parameters<typeof pistasDe>[0] })) ?? "", /Unknown model/);
  assert.match(validarParametros(separar({ shifts: 0 })) ?? "", /Shifts/);
  assert.match(validarParametros(separar({ nombre: "con espacio" })) ?? "", /becomes a file/);
});

test("the RESULT line gives the stems", () => {
  const r = leerResultado('[separar_demucs] RESULT {"files": ["q01-sep-drums.wav", "q01-sep-bass.wav"], "separate_s": 21.5}');
  assert.deepEqual(r, { ficheros: ["q01-sep-drums.wav", "q01-sep-bass.wav"], separate_s: 21.5 });
  assert.equal(leerResultado("no result"), null);
});
