/**
 * Cliente LLM compatible con la API OpenAI (Ollama Cloud / Ollama local).
 * Sin SDK: una sola dependencia menos y control total del timeout y del error.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Pide JSON estricto (response_format). */
  jsonMode?: boolean;
  /** Menos razonamiento = menos latencia (si el proveedor lo soporta). */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  raw: unknown;
}

export interface LlmClient {
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export interface OllamaClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://ollama.com/v1";
const DEFAULT_MODEL = "deepseek-v4.1-flash:1017";

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text);
        return "";
      })
      .join("");
  }
  return null;
}

export class OllamaClient implements LlmClient {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = config.apiKey ?? "";
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      stream: false,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
    };
    if (request.tools?.length) {
      body.tools = request.tools;
      body.tool_choice = "auto";
    }
    if (request.jsonMode) body.response_format = { type: "json_object" };
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;

    let response = await this.post(body);
    // Algunos despliegues no soportan response_format: reintento sin él.
    if (request.jsonMode && response.status === 400) {
      delete body.response_format;
      response = await this.post(body);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 800);
      throw new LlmError(`El proveedor LLM respondió ${response.status}: ${detail}`, response.status);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: unknown; tool_calls?: ToolCall[] };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmError("Respuesta del LLM sin 'choices[0].message'");

    return {
      content: textOf(message.content),
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      usage:
        data.usage
          ? {
              promptTokens: data.usage.prompt_tokens ?? 0,
              completionTokens: data.usage.completion_tokens ?? 0,
            }
          : undefined,
      raw: data,
    };
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmError(`No se pudo contactar con ${this.baseUrl}: ${message}`);
    }
  }
}

export interface ClientFromEnvOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export function clientFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  overrides: ClientFromEnvOptions = {},
): LlmClient | null {
  const baseUrl = overrides.baseUrl ?? env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = env.OLLAMA_API_KEY ?? env.OLLAMA_API_TOKEN ?? "";
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  if (!apiKey && !isLocal) return null;
  return new OllamaClient({
    baseUrl,
    apiKey,
    model: overrides.model ?? env.OLLAMA_MODEL ?? DEFAULT_MODEL,
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
  });
}

export function plannerClientFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  overrides: ClientFromEnvOptions = {},
): LlmClient | null {
  const model = overrides.model ?? env.MIUZIKA_PLANNER_MODEL?.trim();
  return clientFromEnv(env, model ? { ...overrides, model } : overrides);
}
