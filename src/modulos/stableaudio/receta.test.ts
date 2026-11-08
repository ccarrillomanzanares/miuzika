import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SA3_COMMIT, componerPrompt, leerResultado, parametrosParaEnviar, validarParametros, type Parametros } from "./receta.ts";

const texto = (cambios: Partial<Parametros> = {}): Parametros => ({
  nombre: "sa-song",
  modelo: "medium",
  tarea: "texto",
  prompt: "TrackType: Music, VocalType: Instrumental. Dark industrial, 92 BPM",
  negativo: "",
  duracion: 120,
  steps: 8,
  cfg: 1,
  semilla: 7111,
  tomas: 1,
  audio: null,
  ruido: null,
  desde: null,
  hasta: null,
  largoFuente: null,
  ...cambios,
});

test("the prompt is the kind's tags, the description and the BPM, and nothing else", () => {
  assert.equal(componerPrompt("cancion", "Dark synth-pop, industrial", 92), "TrackType: Music, VocalType: Instrumental. Dark synth-pop, industrial, 92 BPM");
  assert.equal(componerPrompt("instrumento", "Instruments: Drums. Dry kick", null), "TrackType: Instrument. Instruments: Drums. Dry kick");
  // A BPM already written is not repeated.
  assert.equal(componerPrompt("libre", "techno at 128 BPM", 92), "techno at 128 BPM");
});

test("text to audio can run and sends no source", () => {
  assert.equal(validarParametros(texto()), null);
  const enviado = parametrosParaEnviar(texto());
  assert.equal("audio" in enviado, false);
  assert.equal(enviado.cfg, 1);
});

test("each model has its limit; the refusals say why", () => {
  assert.match(validarParametros(texto({ modelo: "small-music", duracion: 200 })) ?? "", /1 to 120 s/);
  assert.equal(validarParametros(texto({ modelo: "medium", duracion: 380 })), null);
  assert.match(validarParametros(texto({ prompt: " " })) ?? "", /prompt is empty/);
  assert.match(validarParametros(texto({ tomas: 5 })) ?? "", /Takes/);
  assert.match(validarParametros(texto({ cfg: 20 })) ?? "", /CFG/);
});

test("audio to audio needs a source and a change amount", () => {
  assert.match(validarParametros(texto({ tarea: "audio" })) ?? "", /source audio/);
  const p = texto({ tarea: "audio", audio: "entrada/x.wav", ruido: 0.9 });
  assert.equal(validarParametros(p), null);
  assert.deepEqual([parametrosParaEnviar(p).audio, parametrosParaEnviar(p).ruido], ["entrada/x.wav", 0.9]);
});

test("repaint sends its region; continue becomes a region from the source's end to the new end", () => {
  const r = texto({ tarea: "repintar", audio: "entrada/x.wav", desde: 4, hasta: 8, duracion: 30 });
  assert.equal(validarParametros(r), null);
  assert.deepEqual([parametrosParaEnviar(r).desde, parametrosParaEnviar(r).hasta], [4, 8]);
  assert.match(validarParametros({ ...r, hasta: 3 }) ?? "", /end after the start/);
  const c = texto({ tarea: "continuar", audio: "entrada/x.wav", largoFuente: 30, duracion: 60 });
  assert.equal(validarParametros(c), null);
  assert.deepEqual([parametrosParaEnviar(c).desde, parametrosParaEnviar(c).hasta], [30, 60]);
  assert.match(validarParametros({ ...c, duracion: 20 }) ?? "", /longer than the source/);
});

test("the RESULT line is read", () => {
  assert.deepEqual(leerResultado('[generar_stableaudio] RESULT {"files": ["a.wav", "a-2.wav"], "seed": 7111, "generate_s": 12.5}'), {
    ficheros: ["a.wav", "a-2.wav"],
    semilla: 7111,
    generate_s: 12.5,
  });
  assert.equal(leerResultado("Traceback"), null);
});

test("the GPU script installs the version the window shows", () => {
  const script = readFileSync(new URL("../../../workspace/gpu/generar_stableaudio.py", import.meta.url), "utf8");
  assert.match(script, new RegExp(`^COMMIT = "${SA3_COMMIT}"$`, "m"));
});
