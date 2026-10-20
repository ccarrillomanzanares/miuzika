/** El LLM escribe un script Python de DSP; el sandbox lo ejecuta y valida. */

import type { LlmClient } from "./client.ts";

export interface SoundScriptContext {
  duration: number;
  sampleRate: number;
  seed: number;
  bpm?: number;
  key?: { tonic: string; mode: string };
  previousError?: string;
}

export const SOUND_SCRIPT_SYSTEM = `Eres compositor, productor y programador de DSP.

Escribe SOLO un script Python que defina exactamente:

def render(sr, duration, params, seed):
    ...
    return audio

Contrato:
- audio: numpy array float, forma (frames,) o (frames, 2). Prefiere estéreo.
- frames <= int(sr * duration); sample rate = sr; sin NaN ni infinito.
- Usa solo numpy, math y random. No uses otros imports.
- No leas ni escribas archivos, no uses red, no imprimas, no uses exec/eval/open,
  no accedas a atributos con doble guion bajo.
- Usa seed para que el sonido sea reproducible: np.random.default_rng(seed) o random.seed(seed).
- No pongas código de nivel superior ejecutable: solo imports, constantes y la función.
- Prioriza vectorización. Evita np.convolve con kernels largos y bucles anidados por muestra;
  para reverb usa delays/feedback o filtros IIR simples. El render debe tardar menos de ~30 s.
- Devuelve código Python puro, sin markdown ni explicaciones.`;

function extractCode(text: string): string {
  let code = text.trim();
  code = code.replace(/^```(?:python)?\s*/i, "").replace(/```$/, "").trim();
  if (code.startsWith("import ") || code.startsWith("from ") || code.startsWith("def ")) {
    return code;
  }
  const start = code.search(/^(?:import|from|def)\s/m);
  if (start >= 0) return code.slice(start).trim();
  return code;
}

export async function designSoundScript(
  client: LlmClient,
  prompt: string,
  context: SoundScriptContext,
): Promise<{ code: string; model: string }> {
  const user = [
    `Petición: ${prompt}`,
    `Duración: ${context.duration} s. Sample rate: ${context.sampleRate}. Seed: ${context.seed}.`,
    context.bpm ? `BPM: ${context.bpm}.` : "",
    context.key ? `Tonalidad: ${context.key.tonic} ${context.key.mode}.` : "",
    context.previousError
      ? `El script anterior falló en el sandbox:\n${context.previousError}\nCorrige el error y devuelve solo el código completo.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.complete({
    messages: [
      { role: "system", content: SOUND_SCRIPT_SYSTEM },
      { role: "user", content: user },
    ],
    temperature: context.previousError ? 0.2 : 0.7,
    reasoningEffort: "low",
    maxTokens: 20_000,
  });
  const code = extractCode(response.content ?? "");
  if (!code.includes("def render")) {
    throw new Error(`El LLM no devolvió una función render(). Respuesta: ${code.slice(0, 500)}`);
  }
  return { code, model: client.model };
}
