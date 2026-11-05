import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODELOS,
  PISTAS_MODELO,
  TAREAS,
  argumentosGeneracion,
  leerResultadoGeneracion,
  modeloPorNombre,
  modelosPara,
  resumenTiempos,
  segundosHastaCompas,
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

// --- 4-Nov-2026: every checkpoint, every task (Carlos: "base, sft y turbo con las propiedades de que dispongan") ---

test("the six checkpoints and seven tasks match ACE-Step's own tables (constants.py, README, read 4-Nov)", () => {
  assert.deepEqual([...TAREAS], ["text2music", "cover", "cover-nofsq", "repaint", "extract", "lego", "complete"]);
  assert.equal(MODELOS.length, 6);
  // base knows the stem tasks; turbo and sft do not (README: "Base Model Only").
  assert.deepEqual(modelosPara("extract"), ["acestep-v15-base", "acestep-v15-xl-base"]);
  assert.deepEqual(modelosPara("lego"), modelosPara("complete"));
  assert.equal(modelosPara("cover").length, 6);
  assert.equal(modeloPorNombre("acestep-v15-xl-turbo")?.pasos, 8);
  assert.equal(modeloPorNombre("acestep-v15-xl-base")?.pasos, 50);
  assert.equal(PISTAS_MODELO.length, 12);
  assert.ok(PISTAS_MODELO.includes("backing_vocals"));
});

test("a task the checkpoint cannot do is refused with the ones that can", () => {
  const r = validarGeneracion({ prompt: "x", nombre: "n", tarea: "extract", audio: "entrada/mix.wav", pista: "drums" });
  assert.match(r ?? "", /acestep-v15-xl-turbo cannot do extract/);
  assert.match(r ?? "", /acestep-v15-xl-base/);
  assert.equal(
    validarGeneracion({ prompt: "", nombre: "n", tarea: "extract", audio: "entrada/mix.wav", pista: "drums", modelo: "acestep-v15-xl-base" }),
    null,
    "extract needs no caption, only the track",
  );
  assert.match(validarGeneracion({ prompt: "x", nombre: "n", tarea: "nada" as never }) ?? "", /Unknown `tarea`/);
  assert.match(validarGeneracion({ prompt: "x", nombre: "n", modelo: "acestep-v2" }) ?? "", /Unknown `modelo`/);
});

test("the source tasks need a source, and the track names are the model's", () => {
  assert.match(validarGeneracion({ prompt: "x", nombre: "n", tarea: "cover" }) ?? "", /fuente/);
  const base = { prompt: "x", nombre: "n", audio: "entrada/mix.wav", modelo: "acestep-v15-xl-base" };
  assert.match(validarGeneracion({ ...base, tarea: "lego" }) ?? "", /ONE `pista`/);
  assert.match(validarGeneracion({ ...base, tarea: "lego", pista: "drums, bass" }) ?? "", /ONE `pista`/);
  assert.match(validarGeneracion({ ...base, tarea: "lego", pista: "batería" }) ?? "", /no track "batería"/);
  assert.equal(validarGeneracion({ ...base, tarea: "lego", pista: "Drums" }), null, "case does not matter");
  assert.equal(validarGeneracion({ ...base, tarea: "complete" }), null, "complete may let the model choose");
  assert.equal(validarGeneracion({ ...base, tarea: "complete", pista: "drums, backing vocals" }), null);
  assert.match(validarGeneracion({ ...base, tarea: "cover", pista: "drums" }) ?? "", /only applies to extract/);
  assert.match(validarGeneracion({ ...base, tarea: "repaint", fuerza: 0.5 }) ?? "", /only applies to cover/);
  assert.match(validarGeneracion({ ...base, tarea: "cover", fuerza: 1.5 }) ?? "", /outside 0-1/);
  assert.match(validarGeneracion({ ...base, tarea: "repaint", desdeCompas: 9, hastaCompas: 4 }) ?? "", /hasta_compas/);
  assert.match(validarGeneracion({ ...base, tarea: "repaint", desdeCompas: 0 }) ?? "", /desde_compas/);
  // The source tasks last what the source lasts: a duration out of range is not their problem.
  assert.equal(validarGeneracion({ ...base, tarea: "cover", duracion: 5 }), null);
});

test("the arguments carry the task, the source, the family's steps and no LM for the source tasks", () => {
  const args = argumentosGeneracion(
    { prompt: "industrial", nombre: "b", tarea: "extract", audio: "entrada/b-fuente.wav", pista: "Drums", modelo: "acestep-v15-xl-base" },
    proyecto,
  );
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(valor("--tarea"), "extract");
  assert.equal(valor("--audio"), "entrada/b-fuente.wav");
  assert.equal(valor("--pista"), "drums");
  assert.equal(valor("--pasos"), "50");
  assert.equal(valor("--lm"), "none", "the handler skips the LM for the source tasks: do not load it");
  assert.ok(!args.includes("--duracion"), "the source decides the length");
  assert.ok(!args.includes("--desde"));

  const t2m = argumentosGeneracion({ prompt: "x", nombre: "n" }, proyecto);
  const v2 = (flag: string) => t2m[t2m.indexOf(flag) + 1];
  assert.equal(v2("--tarea"), "text2music");
  assert.equal(v2("--pasos"), "8");
  assert.equal(v2("--lm"), "acestep-5Hz-lm-1.7B");
  assert.equal(v2("--duracion"), "30");

  const cover = argumentosGeneracion({ prompt: "x", nombre: "n", tarea: "cover", audio: "a.wav", fuerza: 0.4, pasos: 20 }, proyecto);
  const v3 = (flag: string) => cover[cover.indexOf(flag) + 1];
  assert.equal(v3("--fuerza"), "0.4");
  assert.equal(v3("--pasos"), "20", "explicit steps win");
});

test("repaint and lego ranges go to the model in seconds, from bar 1, hasta inclusive", () => {
  // 125 BPM, 4/4: a bar is 1.92 s. Bars 5-8 are 7.68 s to 15.36 s.
  const args = argumentosGeneracion(
    { prompt: "x", nombre: "n", tarea: "repaint", audio: "a.wav", desdeCompas: 5, hastaCompas: 8 },
    proyecto,
  );
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(valor("--desde"), "7.680");
  assert.equal(valor("--hasta"), "15.360");
  assert.equal(segundosHastaCompas(1, proyecto), 0);
  // The other tasks take the range inside the input file: nothing goes to the model.
  const cover = argumentosGeneracion({ prompt: "x", nombre: "n", tarea: "cover", audio: "a.wav", desdeCompas: 5, hastaCompas: 8 }, proyecto);
  assert.ok(!cover.includes("--desde") && !cover.includes("--hasta"));
});
