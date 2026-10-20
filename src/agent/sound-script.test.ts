import { test } from "node:test";
import assert from "node:assert/strict";

import { designSoundScript } from "./sound-script.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.ts";

class FakeClient implements LlmClient {
  readonly model = "fake";
  private readonly content: string;

  constructor(content: string) {
    this.content = content;
  }

  async complete(_request: LlmRequest): Promise<LlmResponse> {
    return { content: this.content, toolCalls: [], raw: {} };
  }
}

const context = { duration: 2.4, sampleRate: 48_000, seed: 7 };

test("extrae el código de un bloque markdown", async () => {
  const code = "import numpy as np\n\ndef render(sr, duration, params, seed):\n    return np.zeros((int(sr * duration), 2))";
  const client = new FakeClient("```python\n" + code + "\n```");
  const designed = await designSoundScript(client, "un kick", context);
  assert.equal(designed.code, code);
  assert.equal(designed.model, "fake");
});

test("rechaza una respuesta sin render()", async () => {
  const client = new FakeClient("No puedo escribir código.");
  await assert.rejects(() => designSoundScript(client, "un kick", context), /render/);
});
