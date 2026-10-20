import { test } from "node:test";
import assert from "node:assert/strict";

import { designSample } from "./sample-designer.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.ts";

class FakeClient implements LlmClient {
  readonly model = "fake";
  calls = 0;
  private readonly script: LlmResponse[];

  constructor(script: LlmResponse[]) {
    this.script = [...script];
  }

  async complete(_request: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    const next = this.script.shift();
    if (!next) throw new Error("FakeClient sin respuestas");
    return next;
  }
}

const loop = {
  kind: "loop",
  name: "punk bass",
  bars: 2,
  bpm: 120,
  key: { tonic: "E", mode: "minor" },
  role: "bass",
  style: "punk",
};

const context = {
  bpm: 150,
  key: { tonic: "E", mode: "minor" },
  kind: "loop" as const,
  bars: 2,
};

test("diseña un loop y fuerza el BPM del proyecto", async () => {
  const client = new FakeClient([{ content: JSON.stringify(loop), toolCalls: [], raw: {} }]);
  const spec = await designSample(client, "loop de bajo punk", context);
  assert.equal(spec.kind, "loop");
  if (spec.kind === "loop") assert.equal(spec.bpm, 150);
});

test("reintenta si el estilo no es válido", async () => {
  const client = new FakeClient([
    { content: JSON.stringify({ ...loop, style: "inventado" }), toolCalls: [], raw: {} },
    { content: JSON.stringify(loop), toolCalls: [], raw: {} },
  ]);
  const spec = await designSample(client, "loop de bajo punk", context);
  assert.equal(client.calls, 2);
  if (spec.kind === "loop") assert.equal(spec.style, "punk");
});

test("diseña un one-shot industrial", async () => {
  const industrial = { kind: "industrial", name: "stab E2", duration: 2.4 };
  const client = new FakeClient([{ content: JSON.stringify(industrial), toolCalls: [], raw: {} }]);
  const spec = await designSample(client, "stab industrial en mi", {
    ...context,
    kind: "industrial",
  });
  assert.equal(spec.kind, "industrial");
});

test("fuerza industrial si el prompt lo pide y llega un one-shot básico", async () => {
  const oneShot = {
    kind: "one_shot",
    name: "stab",
    duration: 1.2,
    layers: [{ osc: "saw", freq: 82, env: { attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.2 } }],
  };
  const client = new FakeClient([{ content: JSON.stringify(oneShot), toolCalls: [], raw: {} }]);
  const spec = await designSample(client, "stab industrial metálico", {
    ...context,
    kind: "one_shot",
  });
  assert.equal(spec.kind, "industrial");
  if (spec.kind === "industrial") assert.equal(spec.duration, 1.2);
});

test("rechaza un tipo distinto al pedido", async () => {
  const oneShot = {
    kind: "one_shot",
    name: "kick",
    duration: 0.5,
    layers: [{ osc: "sine", freq: 120, env: { attack: 0.001, decay: 0.2, sustain: 0.001, release: 0.1 } }],
  };
  const client = new FakeClient([
    { content: JSON.stringify(oneShot), toolCalls: [], raw: {} },
    { content: JSON.stringify(oneShot), toolCalls: [], raw: {} },
  ]);
  await assert.rejects(() => designSample(client, "loop de bajo", context), /one_shot/);
});
