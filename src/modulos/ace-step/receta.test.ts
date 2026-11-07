import { test } from "node:test";
import assert from "node:assert/strict";

import { instruccionDe, leerResultado, letraPropuesta, MODELOS, nombreDeArchivo, nombreLibre, parametrosParaEnviar, validarParametros, valoresDeModelo, type Parametros } from "./receta.ts";

const cancion = (cambios: Partial<Parametros> = {}): Parametros => ({
  tarea: "text2music",
  modelo: "acestep-v15-xl-turbo",
  instruccion: instruccionDe("text2music", null),
  prompt: "dark wave",
  letra: "[Instrumental]",
  idioma: "unknown",
  duracion: 60,
  bpm: null,
  tonalidad: "",
  compas: "",
  semilla: -1,
  variantes: 1,
  ...valoresDeModelo("text2music", "acestep-v15-xl-turbo"),
  fuerza: null,
  desde: null,
  hasta: null,
  pista: null,
  nombre: "toma",
  audio: null,
  silencio: null,
  ...cambios,
});

test("the text travels untouched: spaces, accents, quotes and line breaks", () => {
  const prompt = "  Canción \"oscura\" 'sucia' — niño $HOME `x` \\ \n fin  ";
  const letra = "\n[Verse]\n  ¿Quién?\t¡Nadie!  \n";
  const enviado = JSON.parse(JSON.stringify(parametrosParaEnviar(cancion({ prompt, letra })))) as Record<string, unknown>;
  assert.equal(enviado.prompt, prompt);
  assert.equal(enviado.letra, letra);
});

test("an empty field stays empty: no project tempo or key sneaks in", () => {
  const enviado = parametrosParaEnviar(cancion());
  assert.equal(enviado.bpm, null);
  assert.equal(enviado.tonalidad, "");
  assert.equal(enviado.compas, "");
});

test("too long a caption is refused, never cut", () => {
  assert.match(validarParametros(cancion({ prompt: "x".repeat(513) })) ?? "", /513 characters/);
  assert.equal(validarParametros(cancion({ prompt: "x".repeat(512) })), null);
});

test("a model that cannot do the task is refused and the ones that can are named", () => {
  const error = validarParametros(cancion({ tarea: "lego", pista: "drums", silencio: 30, modelo: "acestep-v15-xl-turbo" }));
  assert.match(error ?? "", /acestep-v15-xl-base or acestep-v15-base/);
});

test("the 30 model and task pairs of the README", () => {
  assert.equal(MODELOS.flatMap((m) => m.tareas).length, 30);
});

test("source tasks need a source, and silence counts only when asked for", () => {
  const lego = cancion({ tarea: "lego", modelo: "acestep-v15-xl-base", pista: "drums", duracion: null });
  assert.match(validarParametros(lego) ?? "", /needs a source/);
  assert.equal(validarParametros({ ...lego, silencio: 30 }), null);
  const enviado = parametrosParaEnviar({ ...lego, silencio: 30 });
  assert.equal(enviado.silencio, 30);
  assert.equal(enviado.audio, undefined);
  assert.equal(enviado.lm, "none");
});

test("an instrument outside the model's twelve is refused, not translated", () => {
  const lego = cancion({ tarea: "lego", modelo: "acestep-v15-xl-base", pista: "batería", silencio: 30, duracion: null });
  assert.match(validarParametros(lego) ?? "", /no track "batería"/);
});

test("only what the task uses travels", () => {
  const enviado = parametrosParaEnviar(cancion({ fuerza: 0.5, desde: 1, hasta: 2, pista: "drums", audio: "entrada/x.wav" }));
  for (const clave of ["fuerza", "desde", "hasta", "pista", "audio"]) assert.equal(enviado[clave], undefined, clave);
});

test("the lyrics proposed follow what was heard on 5-Nov", () => {
  assert.equal(letraPropuesta("extract", "vocals"), "");
  assert.equal(letraPropuesta("extract", "drums"), "[Instrumental]");
  assert.equal(letraPropuesta("lego", "vocals"), "[Instrumental]");
});

test("the instructions name the instrument", () => {
  assert.equal(instruccionDe("lego", "drums"), "Generate the drums track based on the audio context:");
  assert.equal(instruccionDe("complete", "drums, bass"), "Complete the input track with drums, bass:");
  assert.equal(instruccionDe("complete", null), "Complete the input track:");
});

test("names for a file and free names for a repeat", () => {
  assert.equal(nombreDeArchivo("Canción  nº 1!"), "Cancion-n-1");
  assert.equal(nombreLibre("x", new Set(["x", "x-2"])), "x-3");
  assert.match(validarParametros(cancion({ nombre: "con espacio" })) ?? "", /becomes a file/);
});

test("the script's result line, or null when it did not get there", () => {
  const salida = 'log\n[generar_audio] RESULT {"files": ["a-1.wav", "a-2.wav"], "task": "text2music", "generate_s": 40.5}\n';
  assert.deepEqual(leerResultado(salida), { ficheros: ["a-1.wav", "a-2.wav"], tiempos: { generate_s: 40.5 } });
  assert.equal(leerResultado("Traceback"), null);
});
