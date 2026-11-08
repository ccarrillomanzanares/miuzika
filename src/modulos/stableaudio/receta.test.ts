import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MODELOS, MODELOS_HF_CON_PUERTA, SA3_COMMIT, avisos, componerPrompt, etiquetas, leerCompases, leerResultado, parametrosParaEnviar,
  promptsPorToma, regionesDeCompases, validarParametros, type Parametros,
} from "./receta.ts";

const texto = (cambios: Partial<Parametros> = {}): Parametros => ({
  nombre: "sa-song",
  modelo: "medium",
  tarea: "texto",
  prompt: "TrackType: Music, VocalType: Instrumental. Dark industrial, 92 BPM",
  variaciones: [],
  negativo: "",
  duracion: 120,
  steps: 8,
  cfg: 1,
  apg: 1,
  sampler: null,
  semilla: 7111,
  tomas: 1,
  audio: null,
  ruido: null,
  regiones: [],
  largoFuente: null,
  ...cambios,
});

const d = { tipo: "cancion" as const, generos: "", instrumentos: "", texto: "", bpm: null };

test("the prompt is the kind's tags, genre and instrument tags, the description and the BPM, and nothing else", () => {
  assert.equal(componerPrompt({ ...d, texto: "Dark synth-pop, industrial", bpm: 92 }), "TrackType: Music, VocalType: Instrumental. Dark synth-pop, industrial, 92 BPM");
  assert.equal(
    componerPrompt({ ...d, tipo: "instrumento", instrumentos: "Drums", texto: "Dry kick" }),
    "TrackType: Instrument, Instruments: Drums. Dry kick",
  );
  assert.equal(
    componerPrompt({ ...d, generos: "Industrial, EBM", texto: "cold" }),
    "TrackType: Music, VocalType: Instrumental, Genre: Industrial, Genre: EBM. cold",
  );
  // A BPM already written is not repeated.
  assert.equal(componerPrompt({ ...d, tipo: "libre", texto: "techno at 128 BPM", bpm: 92 }), "techno at 128 BPM");
  assert.equal(componerPrompt({ ...d, tipo: "libre" }), "");
  assert.equal(etiquetas("Instruments", " Guitar, Bass ,"), "Instruments: Guitar, Bass");
});

test("text to audio can run, sends no source, and an empty prompt is allowed with a note", () => {
  assert.equal(validarParametros(texto()), null);
  const enviado = parametrosParaEnviar(texto());
  assert.equal("audio" in enviado, false);
  assert.equal("apg" in enviado, false);
  assert.equal(enviado.cfg, 1);
  assert.equal(validarParametros(texto({ prompt: "" })), null);
  assert.match(avisos(texto({ prompt: "" })).join(" "), /unconditional/);
});

test("each model has its limit; the refusals say why", () => {
  assert.match(validarParametros(texto({ modelo: "small-music", duracion: 200 })) ?? "", /1 to 120 s/);
  assert.equal(validarParametros(texto({ modelo: "medium", duracion: 380 })), null);
  assert.match(validarParametros(texto({ tomas: 5 })) ?? "", /Takes/);
  assert.match(validarParametros(texto({ cfg: 20 })) ?? "", /CFG/);
  assert.match(validarParametros(texto({ apg: 2 })) ?? "", /APG/);
});

test("a sampler only for base models", () => {
  assert.match(validarParametros(texto({ sampler: "euler" })) ?? "", /only for -base/);
  const b = texto({ modelo: "medium-base", sampler: "rk4", steps: 50, cfg: 7 });
  assert.equal(validarParametros(b), null);
  assert.equal(parametrosParaEnviar(b).sampler, "rk4");
  assert.match(avisos(b).join(" "), /not been run/);
});

test("the negative prompt is flagged as unused at cfg 1 (dit.py only guides when cfg != 1)", () => {
  assert.match(avisos(texto({ negativo: "vocals" })).join(" "), /not used/);
  assert.doesNotMatch(avisos(texto({ negativo: "vocals", cfg: 3 })).join(" "), /not used/);
  assert.match(avisos(texto({ cfg: 7 })).join(" "), /saturated/);
});

test("variations: one prompt per take, and as many takes as lines", () => {
  const p = texto({ tomas: 2, variaciones: ["with a lead synth melody", "with a memorable synth hook"] });
  assert.equal(validarParametros(p), null);
  assert.deepEqual(promptsPorToma(p), [`${p.prompt}. with a lead synth melody`, `${p.prompt}. with a memorable synth hook`]);
  assert.deepEqual(parametrosParaEnviar(p).prompts, promptsPorToma(p));
  assert.match(validarParametros({ ...p, tomas: 3 }) ?? "", /One variation line per take/);
  assert.equal("prompts" in parametrosParaEnviar(texto()), false);
});

test("audio to audio needs a source and a change amount", () => {
  assert.match(validarParametros(texto({ tarea: "audio" })) ?? "", /source audio/);
  const p = texto({ tarea: "audio", audio: "entrada/x.wav", ruido: 0.9 });
  assert.equal(validarParametros(p), null);
  assert.deepEqual([parametrosParaEnviar(p).audio, parametrosParaEnviar(p).ruido], ["entrada/x.wav", 0.9]);
});

test("bars read as regions, several of them", () => {
  assert.deepEqual(leerCompases("13-16"), [[13, 16]]);
  assert.deepEqual(leerCompases("5-8, 13 to 16, 20"), [[5, 8], [13, 16], [20, 20]]);
  assert.equal(leerCompases("8-5"), null);
  assert.equal(leerCompases("a"), null);
  // 92 BPM, 4/4: a bar is 2.6087 s.
  assert.deepEqual(regionesDeCompases([[13, 16]], (4 * 60) / 92), [{ desde: 31.304, hasta: 41.739 }]);
});

test("repaint sends its regions; continue becomes a region from the source's end to the new end", () => {
  const r = texto({ tarea: "repintar", audio: "entrada/x.wav", regiones: [{ desde: 4, hasta: 8 }, { desde: 12, hasta: 16 }], duracion: 30, largoFuente: 30 });
  assert.equal(validarParametros(r), null);
  assert.deepEqual(parametrosParaEnviar(r).regiones, [[4, 8], [12, 16]]);
  assert.match(validarParametros({ ...r, regiones: [{ desde: 4, hasta: 3 }] }) ?? "", /end after it starts/);
  assert.match(validarParametros({ ...r, regiones: [{ desde: 4, hasta: 10 }, { desde: 8, hasta: 12 }] }) ?? "", /overlap/);
  assert.match(validarParametros({ ...r, regiones: [] }) ?? "", /needs bars/);
  // Two seconds of thirty: the guide's warning that it may come back close to the original.
  assert.match(avisos({ ...r, regiones: [{ desde: 4, hasta: 6 }] }).join(" "), /close to the original/);
  const c = texto({ tarea: "continuar", audio: "entrada/x.wav", largoFuente: 30, duracion: 60 });
  assert.equal(validarParametros(c), null);
  assert.deepEqual(parametrosParaEnviar(c).regiones, [[30, 60]]);
  assert.match(validarParametros({ ...c, duracion: 20 }) ?? "", /longer than the source/);
});

test("the gated list covers every post-trained model and no base one", () => {
  const puerta = new Set<string>(MODELOS_HF_CON_PUERTA);
  for (const m of MODELOS) assert.equal(puerta.has(`stabilityai/stable-audio-3-${m.nombre}`), !m.base, m.nombre);
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
