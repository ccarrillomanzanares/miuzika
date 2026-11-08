import { test } from "node:test";
import assert from "node:assert/strict";

import { entradasDe, ESTILO_EJEMPLO, leerResultado, parametrosParaEnviar, POR_DEFECTO, validarParametros, type Parametros } from "./receta.ts";

const desdeAudio = (cambios: Partial<Parametros> = {}): Parametros => ({
  nombre: "mc-ghosts",
  tipo: "audio",
  audio: "entrada/ghosts-again.wav",
  bpm: null,
  melodia: null,
  acordes: null,
  bateria: null,
  letra: "[Verse]\nStatic in the room like a prayer",
  estilo: ESTILO_EJEMPLO,
  semilla: 42,
  temperatura: POR_DEFECTO.temperatura,
  topk: POR_DEFECTO.topk,
  cfg: POR_DEFECTO.cfg,
  ...cambios,
});

test("an audio source with lyrics and style can run; MIDI fields do not travel", () => {
  const p = desdeAudio();
  assert.equal(validarParametros(p), null);
  assert.deepEqual(entradasDe(p), ["entrada/ghosts-again.wav"]);
  const enviado = parametrosParaEnviar(p);
  assert.equal(enviado.audio, "entrada/ghosts-again.wav");
  assert.equal("melodia" in enviado, false);
  // The text goes as written: line breaks included.
  assert.equal(enviado.letra, "[Verse]\nStatic in the room like a prayer");
});

test("MIDI needs melody and chords, drums optional, and no BPM (the CLI refuses it)", () => {
  const base = desdeAudio({ tipo: "midi", audio: null, melodia: "entrada/melody.mid", acordes: null });
  assert.match(validarParametros(base) ?? "", /melody .mid and a chord .mid/);
  const ok = { ...base, acordes: "entrada/chord.mid" };
  assert.equal(validarParametros(ok), null);
  assert.deepEqual(entradasDe(ok), ["entrada/melody.mid", "entrada/chord.mid"]);
  assert.deepEqual(entradasDe({ ...ok, bateria: "entrada/drums.mid" }), ["entrada/melody.mid", "entrada/chord.mid", "entrada/drums.mid"]);
  assert.match(validarParametros({ ...ok, bpm: 120 }) ?? "", /only used with an audio source/);
  assert.equal("audio" in parametrosParaEnviar(ok), false);
});

test("refusals are explained, never corrected", () => {
  assert.match(validarParametros(desdeAudio({ letra: "  " })) ?? "", /needs lyrics/);
  assert.match(validarParametros(desdeAudio({ estilo: "" })) ?? "", /style/);
  assert.match(validarParametros(desdeAudio({ nombre: "mi toma" })) ?? "", /becomes a file/);
  assert.match(validarParametros(desdeAudio({ audio: null })) ?? "", /source audio/);
  assert.match(validarParametros(desdeAudio({ bpm: 500 })) ?? "", /BPM/);
  assert.match(validarParametros(desdeAudio({ topk: 0 })) ?? "", /Top-k/);
});

test("the script's RESULT line is read; anything else is not a result", () => {
  const salida = 'log\n[generar_mulacover] RESULT {"wav": "mc.wav", "midi": ["mc-midi/melody.mid"], "seed": 42, "generate_s": 396.7}\n';
  assert.deepEqual(leerResultado(salida), { wav: "mc.wav", midi: ["mc-midi/melody.mid"], semilla: 42, generate_s: 396.7 });
  assert.equal(leerResultado("Traceback ..."), null);
  assert.equal(leerResultado('[x] RESULT {"midi": []}'), null);
});
