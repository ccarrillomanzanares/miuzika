import { test } from "node:test";
import assert from "node:assert/strict";

import {
  argumentosGeneracion,
  leerResultadoGeneracion,
  resumenTiempos,
  tonalidadParaModelo,
  validarGeneracion,
} from "./generacion.ts";
import { createProject } from "./project.ts";

const proyecto = createProject({ name: "Stahl", bpm: 125, lengthBars: 80, key: { tonic: "E", mode: "minor" } });

test("the project fills tempo, key and time signature when the request does not", () => {
  const args = argumentosGeneracion({ prompt: "industrial rock", nombre: "riff" }, proyecto);
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(valor("--bpm"), "125");
  assert.equal(valor("--tonalidad"), "E minor");
  assert.equal(valor("--compas"), "4");
  assert.equal(valor("--letra"), "[Instrumental]");
  assert.equal(valor("--duracion"), "30");
  assert.equal(valor("--variantes"), "1");
  assert.equal(valor("--salida"), "generado");
  assert.ok(!args.includes("--semilla"), "no seed unless asked: random takes by default");
});

test("explicit values win over the project's", () => {
  const args = argumentosGeneracion(
    { prompt: "x", nombre: "n", bpm: 90, tonalidad: "A major", duracion: 60, variantes: 2, semilla: 7, letra: "hola", idioma: "es" },
    proyecto,
  );
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(valor("--bpm"), "90");
  assert.equal(valor("--tonalidad"), "A major");
  assert.equal(valor("--duracion"), "60");
  assert.equal(valor("--variantes"), "2");
  assert.equal(valor("--semilla"), "7");
  assert.equal(valor("--letra"), "hola");
  assert.equal(valor("--idioma"), "es");
});

test("modes are spelled the way the model's keyscale expects", () => {
  assert.equal(tonalidadParaModelo({ tonic: "F#", mode: "major" }), "F# major");
  assert.equal(tonalidadParaModelo({ tonic: "D", mode: "harmonicMinor" }), "D harmonic minor");
});

test("validation refuses what the model would reject anyway", () => {
  assert.equal(validarGeneracion({ prompt: "ok", nombre: "n" }), null);
  assert.match(validarGeneracion({ prompt: "", nombre: "n" }) ?? "", /prompt/);
  assert.match(validarGeneracion({ prompt: "ok", nombre: "" }) ?? "", /nombre/);
  assert.match(validarGeneracion({ prompt: "ok", nombre: "n", duracion: 5 }) ?? "", /10-600/);
  assert.match(validarGeneracion({ prompt: "ok", nombre: "n", variantes: 9 }) ?? "", /1 to 8/);
  assert.match(validarGeneracion({ prompt: "ok", nombre: "n", bpm: 500 }) ?? "", /30-300/);
  assert.match(validarGeneracion({ prompt: "a".repeat(513), nombre: "n" }) ?? "", /512/);
});

test("the RESULT line is read back; without it there is no result", () => {
  // Real stdout of the 2-Nov-2026 run on the A10, trimmed.
  const salida = [
    "[generar_audio] DiT acestep-v15-xl-turbo ready in 108.2 s",
    "[generar_audio] LM acestep-5Hz-lm-1.7B (vllm) ready in 34.3 s",
    '[generar_audio] RESULT {"files": ["stahl-xl-turbo-s1.wav"], "bootstrap_s": 20.8, "dit_init_s": 108.2, "lm_init_s": 34.3, "generate_s": 13.1, "vram_peak_gb": 15.95}',
    "[Instrumental]<|endoftext|>",
  ].join("\n");
  const r = leerResultadoGeneracion(salida);
  assert.ok(r);
  assert.deepEqual(r.ficheros, ["stahl-xl-turbo-s1.wav"]);
  assert.equal(r.tiempos.generate_s, 13.1);
  assert.equal(resumenTiempos(r.tiempos), "install 21 s · model load 143 s · generation 13.1 s · VRAM peak 16.0 GB");
  assert.equal(leerResultadoGeneracion("Traceback (most recent call last): ..."), null);
  assert.equal(leerResultadoGeneracion('RESULT {"files": []}'), null);
});
