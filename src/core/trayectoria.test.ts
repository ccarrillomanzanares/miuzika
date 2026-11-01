import { test } from "node:test";
import assert from "node:assert/strict";

import {
  construirTrayectoria,
  nombreDeTrayectoria,
  restaurarArgumentos,
  veredictoDe,
  type DetallePaso,
  type MensajeTrayectoria,
} from "./trayectoria.ts";

const paso = (id: string, nombre: string, argumentos: string, resultado: string, ok = true): DetallePaso => ({ id, nombre, argumentos, resultado, ok, ms: 10 });

const NOTAS = JSON.stringify({ pista: "trk_bajo", compas: 1, notas: "D2:1.5 D2:.5 F2 | r:2 [D3 F3 A3]:4 ".repeat(40) });

const MENSAJES: MensajeTrayectoria[] = [
  { role: "system", content: "You are the composer…" },
  { role: "user", content: "a dark bass line" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "escribir_notas", arguments: '{"_omitido":"2411 characters already applied; the real state is in leer_proyecto"}' } },
      { id: "call_2", type: "function", function: { name: "leer_proyecto", arguments: "{}" } },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "ok: 32 notes written" },
  { role: "tool", tool_call_id: "call_2", content: "project…" },
  { role: "assistant", content: "Done." },
];

const INFORME_MAL = [
  "Listening through the openDAW engine (the same one as Play). RMS in dBFS per span of 8 bars; SILENT = …",
  "bars        1-8   9-16",
  "MIX         -18   -17",
  "Grand Piano SILENT SILENT",
  "Bajo        -20   -21",
  "PROBLEMS:",
  '- "Grand Piano" does not play in ANY span with notes: the instrument does not load or produces no signal (it is not a volume issue).',
  '- "Pad" has notes and does not play in bars 9-16.',
  "- The mix goes above 0 dBFS (peak 1.2 dB): it clips. Lower the master or the loudest tracks.",
].join("\n");
const INFORME_BIEN = "Listening through the openDAW engine…\nbars 1-8\nMIX -18\nNo problems: every track plays where it has notes.";

test("nombreDeTrayectoria follows the version naming, so both sort together", () => {
  assert.equal(nombreDeTrayectoria(new Date(2026, 10, 1, 18, 30, 12), "Make the bass darker!"), "2026-11-01_18-30-12_make-the-bass-darker.json");
});

test("restaurarArgumentos puts the real arguments back only where the loop omitted them", () => {
  const pasos = [paso("call_1", "escribir_notas", NOTAS, "ok: 32 notes written"), paso("call_2", "leer_proyecto", '{"clip":"x"}', "project…")];
  const salida = restaurarArgumentos(MENSAJES, pasos);
  assert.equal(salida[2].tool_calls?.[0].function.arguments, NOTAS);
  // Not omitted: the message keeps what it had, even if the step record differs.
  assert.equal(salida[2].tool_calls?.[1].function.arguments, "{}");
  // Copies, not the live conversation.
  assert.equal(MENSAJES[2].tool_calls?.[0].function.arguments.includes("_omitido"), true);
  assert.notEqual(salida[2], MENSAJES[2]);
});

test("restaurarArgumentos leaves an omitted call alone when no step record matches", () => {
  const salida = restaurarArgumentos(MENSAJES, []);
  assert.match(salida[2].tool_calls?.[0].function.arguments ?? "", /_omitido/);
});

test("veredictoDe reads silent tracks, clipping and the clean ending from the LAST report", () => {
  const pasos = [
    paso("c1", "escuchar_mezcla", "{}", INFORME_BIEN),
    paso("c2", "escribir_notas", "{}", "ok"),
    paso("c3", "escuchar_mezcla", "{}", INFORME_MAL),
  ];
  const v = veredictoDe(pasos);
  assert.equal(v.escuchas, 2);
  assert.deepEqual(v.pistasSilenciosas, ["Grand Piano", "Pad"]);
  assert.equal(v.sinProblemas, false);
  assert.equal(v.clipea, true);
  const limpio = veredictoDe([paso("c1", "escuchar_mezcla", "{}", INFORME_BIEN)]);
  assert.deepEqual(limpio, { escuchas: 1, pistasSilenciosas: [], sinProblemas: true, clipea: false });
});

test("veredictoDe: no listening, or only failed listening, gives null", () => {
  assert.deepEqual(veredictoDe([]), { escuchas: 0, pistasSilenciosas: [], sinProblemas: null, clipea: false });
  assert.equal(veredictoDe([paso("c1", "escuchar_mezcla", "{}", "engine not loaded", false)]).sinProblemas, null);
});

test("construirTrayectoria assembles a self-contained record", () => {
  const pasos = [paso("call_1", "escribir_notas", NOTAS, "ok: 32 notes written"), paso("c3", "escuchar_mezcla", "{}", INFORME_BIEN)];
  const t = construirTrayectoria({
    t0: new Date("2026-11-01T18:30:00Z"),
    t1: new Date("2026-11-01T18:31:30Z"),
    proyecto: "hard",
    proveedor: "ollama-cloud",
    modelo: "deepseek-v4.1-flash:1017",
    huellaPrompt: "0eaa1767",
    estado: "ok",
    pedido: "a dark bass line",
    respuesta: "Done.",
    pasos: 3,
    llamadas: 2,
    desde: 1,
    mensajes: MENSAJES,
    herramientas: pasos,
    coste: { usd: 0.0358, tokensNuevos: 13_000, tokensCache: 1_287_000, tokensSalida: 50_000, tarifa: "deepseek/deepseek-v4.1-flash-1017" },
    versionAntes: "2026-11-01_18-30-00_a-dark-bass-line.json",
    proyectoDespues: { name: "Hard", bpm: 120 },
  });
  assert.equal(t.formato, "miuzika-trayectoria");
  assert.equal(t.ms, 90_000);
  assert.equal(t.mensajes[2].tool_calls?.[0].function.arguments, NOTAS);
  assert.equal(t.veredicto.sinProblemas, true);
  assert.equal(t.herramientas.length, 2);
  assert.equal("error" in t, false);
  assert.deepEqual(t.proyectoDespues, { name: "Hard", bpm: 120 });
  const roto = construirTrayectoria({ ...t, t0: new Date(t.t0), t1: new Date(t.t1), estado: "error", error: "timed out", mensajes: MENSAJES, herramientas: pasos, proyectoDespues: undefined });
  assert.equal(roto.error, "timed out");
  assert.equal(roto.proyectoDespues, null);
});
