import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TURNOS,
  UMBRAL_SALIDA,
  agregarTurno,
  bloqueContexto,
  interpretarAgente,
  recortarSalida,
  serializarAgente,
  type TurnoAgente,
} from "./contexto.ts";

test("una salida corta pasa tal cual", () => {
  const texto = "exit=0 en 400 ms\n14 stems escritos";
  assert.equal(recortarSalida(texto), texto);
});

test("una salida larga se recorta por líneas y dice cuántas faltan", () => {
  const lineas = Array.from({ length: 200 }, (_, i) => `[${i}] línea de un render`);
  const recortado = recortarSalida(lineas.join("\n"));
  assert.ok(recortado.length < lineas.join("\n").length);
  assert.match(recortado, /\[0\] línea de un render/); // cabeza
  assert.match(recortado, /\[199\] línea de un render/); // cola
  assert.match(recortado, /…160 línea\(s\) omitida\(s\) …/);
});

test("una salida con pocas líneas pero enorme se corta por caracteres", () => {
  const texto = "x".repeat(5000);
  const recortado = recortarSalida(texto);
  assert.ok(recortado.length < UMBRAL_SALIDA * 2);
  assert.match(recortado, /…/);
});

test("los primeros turnos caben enteros", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i < MAX_TURNOS; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, { usuario: `petición ${i}`, asistente: `hecho ${i}` });
  }
  assert.equal(estado.turnos.length, MAX_TURNOS);
  assert.equal(estado.resumen, "");
  assert.equal(estado.turnos[0]!.usuario, "petición 0");
});

test("al pasar del tope, el turno viejo pasa al resumen en una línea", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i <= MAX_TURNOS; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, { usuario: `petición ${i}`, asistente: `hecho ${i}` });
  }
  assert.equal(estado.turnos.length, MAX_TURNOS);
  assert.match(estado.resumen, /«petición 0»/);
  assert.doesNotMatch(estado.resumen, /petición 1/); // sólo se resume lo que se cae
  assert.equal(estado.turnos[0]!.usuario, "petición 1");
});

test("los turnos se recortan: una respuesta de 4000 caracteres no se guarda entera", () => {
  const estado = agregarTurno("", [], { usuario: "hola", asistente: "y".repeat(4000) });
  assert.ok(estado.turnos[0]!.asistente.length <= 700);
  assert.match(estado.turnos[0]!.asistente, /…$/);
});

test("el resumen no crece sin fin", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i < 80; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, {
      usuario: `petición número ${i} con bastante texto para llenar`,
      asistente: `respuesta número ${i}`,
    });
  }
  assert.ok(estado.resumen.length <= 1800, `resumen de ${estado.resumen.length}`);
  // Lo último siempre está en el resumen o en los turnos.
  assert.match(estado.turnos.at(-1)!.usuario, /petición número 79/);
});

test("el bloque de contexto no ensucia el prompt si no hay nada", () => {
  assert.equal(bloqueContexto("", []), "");
  const bloque = bloqueContexto("- «crea vitrina» → hecho", [{ usuario: "¿cómo va?", asistente: "va bien" }]);
  assert.match(bloque, /CONVERSACIÓN ANTERIOR DE ESTE PROYECTO/);
  assert.match(bloque, /Resumen:\n- «crea vitrina»/);
  assert.match(bloque, /usuario: ¿cómo va\?/);
  assert.match(bloque, /el estado real es proyecto\.json/);
});

test("agente.json se escribe y se vuelve a leer", () => {
  const texto = JSON.stringify(
    serializarAgente("- «x» → y", [{ usuario: "a", asistente: "b" }], "modelo-1", new Date("2026-10-24T08:00:00Z")),
  );
  const leido = interpretarAgente(texto);
  assert.equal(leido.resumen, "- «x» → y");
  assert.deepEqual(leido.turnos, [{ usuario: "a", asistente: "b" }]);
});

test("un agente.json roto o vacío no rompe la carga", () => {
  assert.deepEqual(interpretarAgente("{roto"), { resumen: "", turnos: [] });
  assert.deepEqual(interpretarAgente("null"), { resumen: "", turnos: [] });
  assert.deepEqual(interpretarAgente('{"turnos":[{"usuario":3},{"usuario":"ok","asistente":"b"}]}'), {
    resumen: "",
    turnos: [{ usuario: "ok", asistente: "b" }],
  });
});
