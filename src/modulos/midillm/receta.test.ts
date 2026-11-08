import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MIDILLM_COMMIT, MIDILLM_PESOS, componerPrompt, leerResultado, parametrosParaEnviar, validarParametros, type Parametros } from "./receta.ts";

const p = (c: Partial<Parametros> = {}): Parametros => ({
  nombre: "idea", prompt: "A dark industrial track.", propuestas: 4, temperatura: 1, top_p: 0.98, max_tokens: 2046, semilla: -1, bpm: 92, ...c,
});

test("the prompt takes the training captions' shape", () => {
  assert.equal(
    componerPrompt({ texto: "A dark industrial synth-pop track.", instrumentos: "synth bass, drums, pad", tonalidad: "D minor", compas: "4/4", tempo: "fast-paced", acordes: "Dm, Bb, F, C" }),
    "A dark industrial synth-pop track. Featuring synth bass, drums, and pad. Set in the key of D minor with a 4/4 time signature. The track is fast-paced. It follows a chord progression of Dm, Bb, F, and C.",
  );
  assert.equal(componerPrompt({ texto: "free text", instrumentos: "", tonalidad: "", compas: "", tempo: "", acordes: "" }), "free text.");
  assert.equal(componerPrompt({ texto: "", instrumentos: "piano, drums", tonalidad: "", compas: "3/4", tempo: "", acordes: "" }), "Featuring piano and drums. Written in 3/4 time.");
  assert.equal(componerPrompt({ texto: "", instrumentos: "", tonalidad: "", compas: "", tempo: "", acordes: "" }), "");
});

test("refusals say why", () => {
  assert.equal(validarParametros(p()), null);
  assert.match(validarParametros(p({ prompt: " " })) ?? "", /prompt is empty/);
  assert.match(validarParametros(p({ propuestas: 9 })) ?? "", /Proposals/);
  assert.match(validarParametros(p({ max_tokens: 4000 })) ?? "", /Length/);
  assert.match(validarParametros(p({ nombre: "a b" })) ?? "", /becomes a file/);
  assert.equal(validarParametros(p({ bpm: null })), null);
});

test("what travels", () => {
  assert.deepEqual(Object.keys(parametrosParaEnviar(p())).sort(), ["bpm", "max_tokens", "nombre", "prompt", "propuestas", "semilla", "temperatura", "top_p"]);
});

test("the RESULT line is read", () => {
  const r = leerResultado('[generar_midillm] RESULT {"files": ["idea-1.mid", "idea-2.mid"], "seed": 5, "dropped": 1, "outputs": [{"file": "idea-1.mid", "tracks": 4, "notes": 610, "seconds": 41.2}], "generate_s": 30.1}');
  assert.deepEqual(r, { ficheros: ["idea-1.mid", "idea-2.mid"], semilla: 5, descartadas: 1, detalle: [{ file: "idea-1.mid", tracks: 4, notes: 610, seconds: 41.2 }], generate_s: 30.1 });
  assert.equal(leerResultado("Traceback"), null);
});

test("the GPU script installs the version the window shows", () => {
  const script = readFileSync(new URL("../../../workspace/gpu/generar_midillm.py", import.meta.url), "utf8");
  assert.match(script, new RegExp(`^COMMIT = "${MIDILLM_COMMIT}"$`, "m"));
  assert.match(script, new RegExp(`^REVISION = "${MIDILLM_PESOS}"$`, "m"));
});
