/** Agente de canción: escribe song_data.py, ejecuta el worker y exporta. */

import type { ChatMessage, LlmClient, ToolDefinition } from "./client.ts";
import type { SongWorkspace } from "./song-workspace.ts";

export interface SongAgentLogEntry {
  at: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface SongAgentOptions {
  client: LlmClient;
  prompt: string;
  workspace: SongWorkspace;
  maxSteps?: number;
  onLog?: (entry: SongAgentLogEntry) => void;
}

export interface SongAgentResult {
  finalText: string;
  steps: number;
  logs: SongAgentLogEntry[];
  bundle: string | null;
}

const SYSTEM_PROMPT = `Eres un compositor, productor y programador DSP. Trabajas sin GUI.

Tienes un workspace con:
- render_song.py: renderer disk-backed. NO lo reescribas.
- bundle.py: empaqueta master + MIDI en .miuzika.zip. NO lo reescribas.
- song_data.py: la composición. Puedes leerla y reescribirla.
- README_SONG.md: instrucciones.

Objetivo: convertir la petición del usuario en una canción completa, renderizarla y exportar el bundle.

Reglas:
1. Lee song_data.py y README_SONG.md antes de componer.
2. Escribe patrones, capas, secciones y arreglo en song_data.py. No escribas audio ni WAVs a mano.
3. Primero valida con "python song_data.py".
4. Después renderiza una prueba corta: "python render_song.py --bars 1 8 --out out".
5. Inspecciona el WAV resultante con inspect_audio. Corrige niveles, silencios o errores.
6. Solo cuando la prueba esté bien, renderiza la canción completa: "python render_song.py --out out".
7. Exporta con "python bundle.py --out out".
8. Llama a finish cuando exista el .miuzika.zip.

MEMORIA: el portátil tiene ~1,8 GB libres. El renderer escribe stems por trozos; no intentes cargar todos los stems ni meter WAVs en la conversación. Usa solo las métricas.

No borres archivos. No uses red. No cambies render_song.py ni bundle.py. No uses shell: solo las herramientas.

Formato de song_data.py: usa la plantilla como contrato. Debe definir TITLE, KEY, BPM, SONG_BARS, TAIL_S, CHORDS, PROG, SECTIONS, DRUMS, BASS_PATTERN, GUITAR_PATTERN, LEAD, VOX_VERSE, VOX_CHORUS, VOX_BREAK, LEAD_LOOP_PATTERN, PIANO_OUTRO, EXTRAS y validate(). Las secciones deben cubrir 1..SONG_BARS sin huecos. Cada capa de SECTIONS debe existir en el renderer (kick, snare, hats, perc_metal, sub, bass, drone, organ, guitar, squelch, growl, reverse_swell, lead, piano, vinyl).`;

function tools(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "Lista los archivos del workspace y sus tamaños.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Lee un archivo de texto del workspace. Usa song_data.py para ver el contrato.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Escribe un archivo del workspace. Para la composición usa song_data.py.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_python",
        description:
          "Ejecuta song_data.py, render_song.py o bundle.py dentro del workspace. Ejemplo: {\"args\":[\"render_song.py\",\"--bars\",\"1\",\"8\",\"--out\",\"out\"]}",
        parameters: {
          type: "object",
          properties: {
            args: { type: "array", items: { type: "string" }, minItems: 1 },
          },
          required: ["args"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_audio",
        description: "Mide duración, pico, RMS, clipping y canales de los WAV de out/.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Archivo o carpeta; por defecto out" } },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Termina y resume la canción y el bundle generado.",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return raw as Record<string, unknown>;
}

export async function runSongAgent(options: SongAgentOptions): Promise<SongAgentResult> {
  const { client, workspace, prompt } = options;
  const maxSteps = options.maxSteps ?? 18;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Petición del usuario:\n${prompt}\n\nTrabaja en el workspace y entrega un .miuzika.zip.`,
    },
  ];
  const logs: SongAgentLogEntry[] = [];
  let finalText = "";
  let steps = 0;

  const record = (name: string, ok: boolean, content: string): void => {
    const entry = { at: new Date().toISOString(), name, ok, content };
    logs.push(entry);
    options.onLog?.(entry);
  };

  for (; steps < maxSteps; steps++) {
    const response = await client.complete({
      messages: [...messages],
      tools: tools(),
      temperature: 0.35,
      maxTokens: 18_000,
      reasoningEffort: "medium",
    });
    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0 ? { tool_calls: response.toolCalls } : {}),
    });
    if (response.toolCalls.length === 0) {
      finalText = response.content ?? "";
      if (finalText.trim()) break;
      messages.push({ role: "user", content: "Continúa con la herramienta adecuada." });
      continue;
    }

    let finished = false;
    for (const call of response.toolCalls) {
      const name = call.function.name;
      let content = "";
      let ok = true;
      try {
        const args = parseArguments(call.function.arguments);
        switch (name) {
          case "list_files":
            content = await workspace.list();
            break;
          case "read_file":
            content = await workspace.read(String(args.path ?? ""));
            break;
          case "write_file":
            content = await workspace.write(String(args.path ?? ""), String(args.content ?? ""));
            break;
          case "run_python": {
            const argv = Array.isArray(args.args) ? args.args.map(String) : [];
            const result = await workspace.runPython(argv);
            content = JSON.stringify({
              command: ["python", ...argv].join(" "),
              exit: result.code,
              timedOut: result.timedOut,
              stdout: result.stdout,
              stderr: result.stderr,
            });
            ok = result.code === 0 && !result.timedOut;
            break;
          }
          case "inspect_audio": {
            const metrics = await workspace.metrics(String(args.path ?? "out"));
            content = JSON.stringify(metrics, null, 2);
            break;
          }
          case "finish":
            finalText = String(args.summary ?? "Canción terminada.");
            content = "Fin.";
            finished = true;
            break;
          default:
            throw new Error(`Herramienta desconocida: ${name}`);
        }
      } catch (error) {
        ok = false;
        content = error instanceof Error ? error.message : String(error);
      }
      record(name, ok, content.slice(0, 12_000));
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: content.slice(0, 40_000),
      });
    }
    if (finished) break;
  }

  const bundle = await workspace.findBundle();
  if (!finalText) {
    finalText = bundle
      ? "Canción renderizada y empaquetada."
      : "El agente terminó sin generar el bundle. Revisa el log.";
  }
  return { finalText, steps: steps + 1, logs, bundle };
}
