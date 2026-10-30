import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agrupar,
  fraseBarra,
  lineaResumen,
  pasoTerminado,
  segundos,
  type PasoHerramienta,
} from "./actividad.ts";

const paso = (nombre: string, ms: number, ok = true): PasoHerramienta => ({ nombre, ms, ok });

test("segundos uses a decimal point and a single decimal", () => {
  assert.equal(segundos(0), "0.0 s");
  assert.equal(segundos(940), "0.9 s");
  assert.equal(segundos(42_140), "42.1 s");
  assert.equal(segundos(1_234), "1.2 s");
});

test("segundos does not print negative times", () => {
  assert.equal(segundos(-5), "0.0 s");
});

test("agrupar sums by name and sorts by descending time", () => {
  const grupos = agrupar([
    paso("leer_fichero", 300),
    paso("ejecutar_python", 30_000),
    paso("escribir_fichero", 1_000),
    paso("ejecutar_python", 8_000),
  ]);
  assert.deepEqual(
    grupos.map((g) => [g.nombre, g.ms, g.veces]),
    [
      ["ejecutar_python", 38_000, 2],
      ["escribir_fichero", 1_000, 1],
      ["leer_fichero", 300, 1],
    ],
  );
});

test("agrupar counts failures and ties keep the order of appearance", () => {
  const grupos = agrupar([
    paso("b", 1_000, false),
    paso("a", 1_000),
    paso("b", 1_000, false),
  ]);
  assert.deepEqual(
    grupos.map((g) => [g.nombre, g.veces, g.fallos]),
    [
      ["b", 2, 2],
      ["a", 1, 0],
    ],
  );
});

test("agrupar on an empty list invents no groups", () => {
  assert.deepEqual(agrupar([]), []);
});

test("lineaResumen carries header, breakdown and a times marker", () => {
  const linea = lineaResumen({
    pasos: 2,
    llamadas: 4,
    ms: 42_140,
    herramientas: [
      paso("ejecutar_python", 30_000),
      paso("ejecutar_python", 8_000),
      paso("leer_fichero", 300),
      paso("verificar_audio", 2_000),
    ],
  });
  assert.equal(
    linea,
    "2 step(s) · 4 tool(s) · 42.1 s — ejecutar_python 38.0 s ×2 · verificar_audio 2.0 s · leer_fichero 0.3 s",
  );
});

test("lineaResumen warns about a tool's failures", () => {
  const linea = lineaResumen({
    pasos: 1,
    llamadas: 2,
    ms: 3_000,
    herramientas: [paso("ejecutar_python", 1_000, false), paso("ejecutar_python", 1_000)],
  });
  assert.match(linea, /ejecutar_python 2\.0 s ×2 ⚠1 fail\(s\)/);
});

test("lineaResumen without tools leaves no dangling dash", () => {
  const linea = lineaResumen({ pasos: 1, llamadas: 0, ms: 1_500, herramientas: [] });
  assert.equal(linea, "1 step(s) · 0 tool(s) · 1.5 s");
});

test("lineaResumen names 4 and summarizes the rest with +N more", () => {
  const linea = lineaResumen({
    pasos: 6,
    llamadas: 6,
    ms: 6_000,
    herramientas: [
      paso("a", 1_000),
      paso("b", 2_000),
      paso("c", 3_000),
      paso("d", 4_000),
      paso("e", 5_000),
      paso("f", 6_000),
    ],
  });
  assert.match(linea, /— f 6\.0 s · e 5\.0 s · d 4\.0 s · c 3\.0 s · \+2 more$/);
});

test("fraseBarra shows the step in progress and the turn clock", () => {
  assert.equal(fraseBarra("Agent: thinking", null, 12_400), "Agent: thinking · turn 12 s");
  assert.equal(
    fraseBarra("ejecutar_python(a.py)", 8_600, 41_000),
    "ejecutar_python(a.py) · 9 s · turn 41 s",
  );
  assert.equal(
    fraseBarra("ejecutando hacer_audio.py", 80_400, 612_000),
    "ejecutando hacer_audio.py · 1:20 · turn 10:12",
  );
});

test("pasoTerminado marks the tick so it is not confused with one in progress", () => {
  assert.equal(pasoTerminado("leer_fichero", 40), "✓ leer_fichero 0.0 s");
  assert.equal(pasoTerminado("ejecutar_python", 38_500), "✓ ejecutar_python 38.5 s");
});
