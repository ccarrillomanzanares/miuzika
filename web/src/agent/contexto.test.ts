import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TURNOS,
  UMBRAL_SALIDA,
  agregarTurno,
  bloqueContexto,
  interpretarAgente,
  recortarConversacion,
  recortarSalida,
  serializarAgente,
  type TurnoAgente,
} from "./contexto.ts";

test("a short output passes through as is", () => {
  const texto = "exit=0 in 400 ms\n14 stems written";
  assert.equal(recortarSalida(texto), texto);
});

test("a long output is trimmed by lines and says how many are missing", () => {
  const lineas = Array.from({ length: 200 }, (_, i) => `[${i}] line from a render`);
  const recortado = recortarSalida(lineas.join("\n"));
  assert.ok(recortado.length < lineas.join("\n").length);
  assert.match(recortado, /\[0\] line from a render/); // head
  assert.match(recortado, /\[199\] line from a render/); // tail
  assert.match(recortado, /…160 line\(s\) omitted …/);
});

test("an output with few lines but enormous is cut by characters", () => {
  const texto = "x".repeat(5000);
  const recortado = recortarSalida(texto);
  assert.ok(recortado.length < UMBRAL_SALIDA * 2);
  assert.match(recortado, /…/);
});

test("the first turns fit whole", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i < MAX_TURNOS; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, { usuario: `petición ${i}`, asistente: `hecho ${i}` });
  }
  assert.equal(estado.turnos.length, MAX_TURNOS);
  assert.equal(estado.resumen, "");
  assert.equal(estado.turnos[0]!.usuario, "petición 0");
});

test("past the cap, the old turn goes into the summary in one line", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i <= MAX_TURNOS; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, { usuario: `petición ${i}`, asistente: `hecho ${i}` });
  }
  assert.equal(estado.turnos.length, MAX_TURNOS);
  assert.match(estado.resumen, /«petición 0»/);
  assert.doesNotMatch(estado.resumen, /petición 1/); // only what falls off is summarized
  assert.equal(estado.turnos[0]!.usuario, "petición 1");
});

test("turns are trimmed: a 4000-character answer is not saved whole", () => {
  const estado = agregarTurno("", [], { usuario: "hola", asistente: "y".repeat(4000) });
  assert.ok(estado.turnos[0]!.asistente.length <= 700);
  assert.match(estado.turnos[0]!.asistente, /…$/);
});

test("the summary does not grow without end", () => {
  let estado = { resumen: "", turnos: [] as TurnoAgente[] };
  for (let i = 0; i < 80; i++) {
    estado = agregarTurno(estado.resumen, estado.turnos, {
      usuario: `petición número ${i} con bastante texto para llenar`,
      asistente: `respuesta número ${i}`,
    });
  }
  assert.ok(estado.resumen.length <= 1800, `summary of ${estado.resumen.length}`);
  // The last one is always in the summary or in the turns.
  assert.match(estado.turnos.at(-1)!.usuario, /petición número 79/);
});

test("the context block does not dirty the prompt if there is nothing", () => {
  assert.equal(bloqueContexto("", []), "");
  const bloque = bloqueContexto("- «crea vitrina» → hecho", [{ usuario: "¿cómo va?", asistente: "va bien" }]);
  assert.match(bloque, /PREVIOUS CONVERSATION IN THIS PROJECT/);
  assert.match(bloque, /Summary:\n- «crea vitrina»/);
  assert.match(bloque, /user: ¿cómo va\?/);
  assert.match(bloque, /the real state is proyecto\.json/);
});

test("agente.json is written and read back", () => {
  const texto = JSON.stringify(
    serializarAgente("- «x» → y", [{ usuario: "a", asistente: "b" }], "modelo-1", new Date("2026-10-24T08:00:00Z")),
  );
  const leido = interpretarAgente(texto);
  assert.equal(leido.resumen, "- «x» → y");
  assert.deepEqual(leido.turnos, [{ usuario: "a", asistente: "b" }]);
});

test("a broken or empty agente.json does not break loading", () => {
  assert.deepEqual(interpretarAgente("{roto"), { resumen: "", turnos: [] });
  assert.deepEqual(interpretarAgente("null"), { resumen: "", turnos: [] });
  assert.deepEqual(interpretarAgente('{"turnos":[{"usuario":3},{"usuario":"ok","asistente":"b"}]}'), {
    resumen: "",
    turnos: [{ usuario: "ok", asistente: "b" }],
  });
});

test("trimming the conversation never leaves an orphaned tool result", () => {
  const conversacion = [{ role: "system" }];
  for (let turno = 0; turno < 6; turno += 1) {
    conversacion.push({ role: "user" }, { role: "assistant" }, { role: "tool" }, { role: "tool" }, { role: "assistant" });
  }
  recortarConversacion(conversacion, 12);
  assert.equal(conversacion[0]!.role, "system");
  assert.equal(conversacion[1]!.role, "user");
  assert.ok(conversacion.length - 1 <= 12);
});

test("a turn longer than the cap is kept whole from its request", () => {
  const conversacion = [{ role: "system" }, { role: "user" }, { role: "assistant" }, { role: "user" }];
  for (let i = 0; i < 20; i += 1) conversacion.push({ role: i % 2 ? "tool" : "assistant" });
  recortarConversacion(conversacion, 5);
  assert.equal(conversacion[1]!.role, "user");
  assert.equal(conversacion.length, 22);
});
