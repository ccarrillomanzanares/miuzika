import { test } from "node:test";
import assert from "node:assert/strict";

import { planSamples } from "./sample-plan.ts";
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

const context = {
  bpm: 100,
  key: { tonic: "D", mode: "minor" },
  lengthBars: 32,
};

const plan = {
  samples: [
    {
      prompt: "loop de sintetizador dark wave",
      name: "Synth Dark Wave",
      track: "Synth",
      kind: "loop",
      bars: 4,
      role: "chords",
    },
    {
      prompt: "loop de batería dark wave",
      name: "Drums Dark Wave",
      track: "Drums",
      kind: "loop",
      bars: 4,
      role: "drums",
    },
  ],
};

test("planifica varios samples para una petición", async () => {
  const client = new FakeClient([{ content: JSON.stringify(plan), toolCalls: [], raw: {} }]);
  const samples = await planSamples(client, "samples de synth, batería y bajo", context);
  assert.equal(samples.length, 2);
  assert.equal(samples[0]!.kind, "loop");
  assert.equal(samples[1]!.role, "drums");
});

test("reintenta si el plan no valida", async () => {
  const client = new FakeClient([
    { content: JSON.stringify({ samples: [] }), toolCalls: [], raw: {} },
    { content: JSON.stringify(plan), toolCalls: [], raw: {} },
  ]);
  const samples = await planSamples(client, "samples dark wave", context);
  assert.equal(client.calls, 2);
  assert.equal(samples.length, 2);
});
