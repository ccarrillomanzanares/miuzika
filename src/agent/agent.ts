/** Fase 2: bucle de agente con tool-calling sobre el proyecto. */

import type { ChatMessage, LlmClient } from "./client.ts";
import { SYSTEM_PROMPT, userMessage } from "./prompts.ts";
import { ToolSession } from "./tools.ts";
import type { ToolLogEntry } from "./tools.ts";
import type { Project } from "../core/types.ts";
import type { SongPlan } from "../core/plan.ts";
import { composePlan } from "../core/plan.ts";
import { applyOps } from "../core/ops.ts";
import type { Op } from "../core/ops.ts";
import { planSong } from "./planner.ts";
import type { PromptConstraints } from "../core/parse.ts";
import { extractConstraints } from "../core/parse.ts";

export interface AgentOptions {
  client: LlmClient;
  project: Project;
  prompt: string;
  maxSteps?: number;
  temperature?: number;
}

export interface AgentResult {
  project: Project;
  messages: ChatMessage[];
  finalText: string;
  toolLog: ToolLogEntry[];
  steps: number;
  usage: { promptTokens: number; completionTokens: number };
}

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { client, prompt } = options;
  const maxSteps = options.maxSteps ?? 8;
  const session = new ToolSession(options.project);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(session.project, prompt) },
  ];
  const usage = { promptTokens: 0, completionTokens: 0 };
  let finalText = "";
  let steps = 0;

  for (; steps < maxSteps; steps++) {
    const response = await client.complete({
      messages: [...messages],
      tools: session.tools(),
      temperature: options.temperature ?? 0.4,
      maxTokens: 4000,
    });
    if (response.usage) {
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
    }

    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0 ? { tool_calls: response.toolCalls } : {}),
    });

    if (response.toolCalls.length === 0) {
      finalText = response.content ?? "";
      break;
    }

    for (const call of response.toolCalls) {
      const outcome = session.exec(call.function.name, call.function.arguments);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: outcome.content,
      });
    }
  }

  if (!finalText) {
    const summary = await client.complete({
      messages: [...messages, { role: "user", content: "Resume en dos frases qué has cambiado y qué debería escuchar." }],
      temperature: 0.3,
      maxTokens: 300,
    });
    finalText = summary.content ?? "Listo.";
    steps++;
  }

  return { project: session.project, messages, finalText, toolLog: session.log, steps, usage };
}

export interface ComposeOptions {
  planner: LlmClient;
  prompt: string;
  project: Project;
  constraints?: PromptConstraints;
  /** false = solo planifica y devuelve las ops, sin aplicar. */
  apply?: boolean;
}

export interface ComposeResult {
  project: Project;
  plan: SongPlan;
  ops: Op[];
  results: string[];
  warnings: string[];
}

/** Plan (LLM) + expansión determinista (código). Sin notas escritas por el modelo. */
export async function composeFromPrompt(options: ComposeOptions): Promise<ComposeResult> {
  const constraints = options.constraints ?? extractConstraints(options.prompt);
  const plan = await planSong(options.planner, options.prompt, { constraints });
  const ops = composePlan(plan);
  if (options.apply === false) {
    return { project: options.project, plan, ops, results: [], warnings: [] };
  }
  const applied = applyOps(options.project, ops);
  return {
    project: applied.project,
    plan,
    ops,
    results: applied.results,
    warnings: applied.warnings.map((issue) => `${issue.path}: ${issue.message}`),
  };
}
