import { test } from "node:test";
import assert from "node:assert/strict";

import { ToolSession } from "./tools.ts";
import { runAgent } from "./agent.ts";
import { planSong, extractJson } from "./planner.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.ts";
import { createProject } from "../core/project.ts";
import { presetPlan } from "../core/plan.ts";

class FakeClient implements LlmClient {
  readonly model = "fake";
  readonly requests: LlmRequest[] = [];
  private readonly script: LlmResponse[];

  constructor(script: LlmResponse[]) {
    this.script = [...script];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) throw new Error("FakeClient sin respuestas");
    return next;
  }
}

function toolCall(name: string, args: unknown, id = "call_1"): LlmResponse {
  return {
    content: null,
    toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    raw: {},
  };
}

test("la sesión de herramientas aplica y deshace", () => {
  const session = new ToolSession(createProject({ name: "Sesión" }));
  const result = session.exec("apply_ops", {
    ops: [
      { op: "add_track", id: "trk_bass", name: "Bass", instrument: { type: "bass" } },
      { op: "set_track", trackId: "trk_bass", gainDb: -4 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(session.project.tracks[0]!.gainDb, -4);
  assert.match(result.content, /trk_bass/);

  const undo = session.exec("undo", {});
  assert.equal(undo.ok, true);
  assert.equal(session.project.tracks.length, 0);
});

test("una op inválida devuelve error y no toca el proyecto", () => {
  const session = new ToolSession(createProject({ name: "Sesión" }));
  const result = session.exec("apply_ops", { ops: [{ op: "generate_part", startBar: 0, pattern: { role: "nope", bars: 4 } }] });
  assert.equal(result.ok, false);
  assert.match(result.content, /role|inválidas/i);
  assert.equal(session.project.tracks.length, 0);
});

test("argumentos no JSON se reportan de forma accionable", () => {
  const session = new ToolSession(createProject());
  const result = session.exec("apply_ops", "{ops: bad}");
  assert.equal(result.ok, false);
  assert.match(result.content, /JSON válido/);
});

test("el bucle del agente ejecuta tool_calls y devuelve el resumen", async () => {
  const client = new FakeClient([
    toolCall("apply_ops", {
      ops: [
        { op: "set_song", bpm: 120 },
        { op: "add_track", id: "trk_lead", name: "Lead", instrument: { type: "lead" } },
      ],
    }),
    { content: "Hecho: 120 BPM y una pista de lead.", toolCalls: [], raw: {} },
  ]);

  const result = await runAgent({
    client,
    project: createProject({ name: "Agente", bpm: 90 }),
    prompt: "pon 120 bpm y crea un lead",
  });

  assert.equal(result.project.bpm, 120);
  assert.equal(result.project.tracks.length, 1);
  assert.match(result.finalText, /120 BPM/);
  assert.equal(result.toolLog.length, 1);
  assert.equal(result.toolLog[0]!.name, "apply_ops");
  assert.ok(result.messages.some((message) => message.role === "tool"));

  const second = client.requests[1]!;
  assert.equal(second.messages.at(-1)!.role, "tool");
  assert.equal(second.tools?.length, 4);
});

test("el agente puede consultar el digest antes de actuar", async () => {
  const client = new FakeClient([
    toolCall("get_project_digest", {}),
    { content: "El proyecto está vacío.", toolCalls: [], raw: {} },
  ]);
  const result = await runAgent({ client, project: createProject({ name: "Vacío" }), prompt: "¿qué hay?" });
  assert.match(result.toolLog[0]!.content, /PROYECTO "Vacío"/);
  assert.equal(result.toolLog[0]!.ok, true);
});

test("extractJson tolera markdown y texto alrededor", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Claro: {"a":2} fin'), { a: 2 });
  assert.throws(() => extractJson("sin json"), /JSON/);
});

test("planSong valida el plan que devuelve el modelo", async () => {
  const plan = presetPlan("techno", { bars: 8 });
  const client = new FakeClient([{ content: JSON.stringify(plan), toolCalls: [], raw: {} }]);
  const parsed = await planSong(client, "techno de 8 compases");
  assert.equal(parsed.tracks.length, plan.tracks.length);
  assert.equal(parsed.bpm, 132);
  assert.equal(client.requests[0]!.jsonMode, true);
});

test("planSong reintenta si el JSON no valida", async () => {
  const valid = presetPlan("rock", { bars: 8 });
  const client = new FakeClient([
    { content: '{"title":"malo"}', toolCalls: [], raw: {} },
    { content: JSON.stringify(valid), toolCalls: [], raw: {} },
  ]);
  const plan = await planSong(client, "rock");
  assert.equal(plan.genre, "rock");
  assert.equal(client.requests.length, 2);
  assert.match(String(client.requests[1]!.messages.at(-1)!.content), /rechazado/);
});

test("planSong reintenta si el plan incumple una restricción del usuario", async () => {
  const valid = presetPlan("techno", { bars: 8 });
  const invalid = { ...valid, bpm: 120 };
  const client = new FakeClient([
    { content: JSON.stringify(invalid), toolCalls: [], raw: {} },
    { content: JSON.stringify(valid), toolCalls: [], raw: {} },
  ]);
  const plan = await planSong(client, "techno a 132 bpm", { constraints: { bpm: 132 } });
  assert.equal(plan.bpm, 132);
  assert.equal(client.requests.length, 2);
  assert.match(String(client.requests[1]!.messages.at(-1)!.content), /132 BPM/);
});
