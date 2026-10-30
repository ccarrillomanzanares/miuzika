/**
 * Agent loop: thinks, uses tools, observes the result and repeats.
 *
 * The LLM decides; the code (here and on the server) executes; the result goes back to
 * the model as a tool message until it answers without requesting any.
 */

import { chat } from "../llm.ts";
import type { ChatMessage } from "../llm.ts";
import { HERRAMIENTAS, ejecutarHerramienta, resumenLlamada } from "./tools.ts";
import type { PasoHerramienta } from "./actividad.ts";

/**
 * Output cap per turn. The model reasons before answering and that reasoning spends the
 * same budget (measured: 8,192 tokens and 22,823 characters thinking without writing
 * anything), so it is given plenty of room.
 */
const MAX_TOKENS_SALIDA = 32768;

/**
 * Step cap per turn: without this, a loop never ends. A step is one model response
 * (which may request several tools at once); retries because of an empty provider
 * response do NOT count. With the composition tools one section is 6-10 steps (read,
 * progressions, notes, mix); a whole song, about 30. It is not a spending cap (the
 * Ollama plan is a fixed quota): it is the brake in case the model loops. Cuts for
 * repeated failures and for writing without executing still act first.
 * Raised to 80 on Oct 27: one arrangement pass over a 92-bar song (melody, chorus,
 * guitar and effects across 6 tracks) spent 33 steps in a turn.
 */
const MAX_PASOS_POR_DEFECTO = 80;

/** Fix and run again without success: on the fourth, the turn is cut. */
const MAX_CICLOS_FALLIDOS = 4;

/** Arguments of an already executed call above this are summarized in the history. */
const UMBRAL_ARGUMENTOS = 1200;

export interface EventoAgente {
  /** "progreso": the model is writing; emitted at most every 700 ms. */
  tipo: "herramienta" | "aviso" | "progreso";
  texto: string;
  /** Only in "aviso": the tool that just finished and how long it took. */
  nombre?: string;
  ms?: number;
  ok?: boolean;
}

export interface ResultadoAgente {
  texto: string;
  pasos: number;
  llamadas: number;
  ms: number;
  /** One entry per call, in order: it is what the activity bar breaks down. */
  herramientas: PasoHerramienta[];
}

export interface OpcionesAgente {
  maxPasos?: number;
  alEvento?: (evento: EventoAgente) => void;
  /** Cancel the turn ("Cancel" button): cuts the model and the tool in flight. */
  signal?: AbortSignal;
}

/** Runs the loop over `mensajes` (they are modified: the history continues). */
export async function ejecutarAgente(
  mensajes: ChatMessage[],
  opciones: OpcionesAgente = {},
): Promise<ResultadoAgente> {
  const maxPasos = opciones.maxPasos ?? MAX_PASOS_POR_DEFECTO;
  const alEvento = opciones.alEvento;
  const senal = opciones.signal;
  const t0 = Date.now();
  let pasos = 0;
  let llamadas = 0;
  let texto = "";
  /** Measured time of each call: returned for the activity bar. */
  const herramientas: PasoHerramienta[] = [];
  /** Consecutive writes without a successful run: cuts the patching loop. */
  let escriturasSinEjecutar = 0;
  /** Runs that fail after having fixed something. */
  let ciclosFallidos = 0;
  /**
   * Identical failures in a row, PER TURN. Before, it lived outside the function and a
   * failure from a previous session counted in the next one: the day's second attempt
   * cut the turn for "three times the same".
   */
  const fallosIguales = new Map<string, number>();
  // An isolated empty response is a provider failure, not the model's: it is retried once
  // silently. If it repeats, it stops and warns (so as not to loop).
  let vaciosSeguidos = 0;
  let reanudaciones = 0;

  /** Closing answer when the user cancels. */
  const cancelado = (): ResultadoAgente => ({
    texto:
      "Turn cancelled. Whatever was already written to disk stays; if a GPU was running, switch it off " +
      "with the header toggle (it keeps billing until it shuts down).",
    pasos,
    llamadas,
    ms: Date.now() - t0,
    herramientas,
  });

  while (pasos < maxPasos) {
    if (senal?.aborted) return cancelado();
    pasos += 1;
    let ultimoAviso = 0;
    let respuesta = await chat(mensajes, {
      tools: HERRAMIENTAS,
      temperature: 0.2,
      signal: senal,
      maxTokens: MAX_TOKENS_SALIDA,
      // With streaming it is possible to honestly say it is working: how many chunks it
      // has and how long. It is emitted every 700 ms so as not to saturate the bar.
      onProgreso: ({ tokens, ms }) => {
        if (ms - ultimoAviso < 700) return;
        ultimoAviso = ms;
        alEvento?.({
          tipo: "progreso",
          texto: `thinking · ${(ms / 1000).toFixed(1)} s · ${tokens} tokens`,
        });
      },
    });
    texto = respuesta.content.trim();

    // If it stayed thinking and wrote nothing, it is repeated WITHOUT reasoning: it is
    // faster and the answer arrives just the same. Thinking is not the problem; cutting
    // it off halfway is.
    if (respuesta.finishReason === "sin_salida") {
      respuesta = await chat(mensajes, {
        tools: HERRAMIENTAS,
        temperature: 0.2,
        signal: senal,
        maxTokens: MAX_TOKENS_SALIDA,
        sinRazonamiento: true,
      });
      // It is recalculated with the SECOND response: before, the first (empty) text was
      // kept and a good answer from the retry was thrown away as if it were another
      // blank turn.
      texto = respuesta.content.trim();
    }

    const pideHerramientas = respuesta.toolCalls.length > 0;
    const vacia = !pideHerramientas && texto === "";
    if (!vacia) vaciosSeguidos = 0;

    // An empty response without tools is not saved: it would only dirty the history.
    if (!vacia) {
      mensajes.push({
        role: "assistant",
        content: respuesta.content,
        ...(pideHerramientas ? { tool_calls: respuesta.toolCalls } : {}),
      });
    }

    if (!pideHerramientas) {
      // Observed failure (Oct 22, 2026): the model loops, exhausts its output
      // (393,216 tokens in 12 minutes) and returns an empty message, with no text and
      // without requesting any tool. Here it is only DETECTED and clearly reported: it is
      // not retried on its own (the decision is the user's).
      if (vacia) {
        const tokens = respuesta.usage?.completion_tokens ?? 0;
        const segundos = Math.round((Date.now() - t0) / 1000);
        const cortada = respuesta.finishReason === "length" || respuesta.finishReason === "sin_salida";
        const agotada = tokens >= 32768;
        // 'load' is what the provider returns when it is saturated: zero tokens and
        // 250 ms (measured twice in a row on Oct 25). Retrying instantly does not help;
        // it waits and tries up to three times.
        if (!cortada && vaciosSeguidos < 5) {
          vaciosSeguidos += 1;
          // 'load' in Ollama means the model is loading: a real wait is needed.
          await new Promise((listo) => setTimeout(listo, 1000 * 2 ** (vaciosSeguidos - 1)));
          // An empty provider response is not the model's work: it does not spend a step.
          // Before, six 'load's in a row ate half the turn.
          pasos -= 1;
          continue;
        }
        // If the provider still does not answer, the turn is resumed only once: what the
        // user would do by typing "continue". If that fails too, it stops and warns.
        if (!cortada && reanudaciones < 1) {
          reanudaciones += 1;
          vaciosSeguidos = 0;
          mensajes.push({ role: "user", content: "Continue from where you left off." });
          pasos -= 1;
          continue;
        }
        return {
          texto: cortada
            ? respuesta.finishReason === "sin_salida"
              ? "The model spent the turn reasoning and never got to write the answer. " +
                "It is not an app failure: it was given more budget and is retried automatically. " +
                "If it keeps happening, ask for it in smaller pieces."
              : "The model was cut off halfway through the answer (output cap) and did not finish. " +
                "Whatever was written to disk stays. Tell me “continue” and I will pick up from there, " +
                "or ask me to do it in smaller pieces."
            : agotada
            ? "The model exhausted its output generating in a loop (" +
              `${tokens.toLocaleString("es-ES")} tokens in ${segundos} s) and returned ` +
              "neither text nor any tool. Nothing has been touched: tell me “continue” to retry it."
            : respuesta.finishReason === "load"
              ? "The model provider is saturated (finish_reason 'load': zero tokens in a " +
                "quarter of a second). I retried three times with a wait and it is still the same. " +
                "Whatever was written to disk stays. Try again in a minute, or change the model in the " +
                "selector; if it always happens after a large file, the previous turn asked for too much."
              : "The model returned an empty response, with no text and without requesting any " +
                "tool. Nothing has been touched: tell me “continue” to retry it.",
          pasos,
          llamadas,
          ms: Date.now() - t0,
          herramientas,
        };
      }
      break;
    }

    for (let i = 0; i < respuesta.toolCalls.length; i += 1) {
      if (senal?.aborted) return cancelado();
      const llamada = respuesta.toolCalls[i];
      const nombre = llamada.function?.name ?? "";
      const argumentos = llamada.function?.arguments ?? "{}";
      llamadas += 1;
      alEvento?.({ tipo: "herramienta", texto: resumenLlamada(nombre, argumentos) });

      const tHerramienta = Date.now();
      const resultado = await ejecutarHerramienta(nombre, argumentos, senal);
      const msHerramienta = Date.now() - tHerramienta;
      herramientas.push({ nombre, ms: msHerramienta, ok: resultado.ok });
      alEvento?.({
        tipo: "aviso",
        texto: resultado.texto.split("\n")[0].slice(0, 160),
        nombre,
        ms: msHerramienta,
        ok: resultado.ok,
      });

      mensajes.push({
        role: "tool",
        tool_call_id: llamada.id ?? `call_${pasos}_${i}`,
        content: resultado.texto.slice(0, 12000),
      });

      // What was already applied does not need to be sent again: long arguments (note
      // lists, scripts) are replaced in the history with a summary. Measured on Oct 27:
      // 20 calls in the same turn resent 389,000 tokens, almost all notes already
      // written. If the call FAILED it is left whole: the model needs it to correct.
      if (resultado.ok && llamada.function && llamada.function.arguments.length > UMBRAL_ARGUMENTOS) {
        llamada.function.arguments = JSON.stringify({
          _omitido: `${llamada.function.arguments.length} characters already applied; the real state is in leer_proyecto`,
        });
      }

      // Retrying exactly what fails the same way fixes nothing: it cuts the turn
      // (it happened with crear_proyecto returning the same error 12 times).
      if (!resultado.ok) {
        const clave = `${nombre}|${resultado.texto.slice(0, 160)}`;
        const veces = (fallosIguales.get(clave) ?? 0) + 1;
        fallosIguales.set(clave, veces);
        if (veces >= 3) {
          alEvento?.({ tipo: "aviso", texto: `Stopping: “${nombre}” failed the same way 3 times.` });
          return {
            texto:
              `I stopped: “${nombre}” gave the same error three times in a row and retrying won't fix it.\n\n` +
              `> ${resultado.texto.split("\n")[0].slice(0, 300)}\n\n` +
              "Tell me how to continue (if it is an app failure, reload the page and try again).",
            pasos,
            llamadas,
            ms: Date.now() - t0,
            herramientas,
          };
        }
      } else {
        fallosIguales.clear();
      }

      // Patch-loop brake. Measured on Oct 28: the old brake (3 writes without a
      // successful run) cut a healthy turn: write the script, run it (fails), fix TWO
      // places with editar_fichero → cut before retrying. Now CYCLES count: a run that
      // fails after having written. Writing several times in a row only earns a warning.
      if (nombre === "escribir_fichero" || nombre === "editar_fichero") {
        escriturasSinEjecutar += 1;
        if (escriturasSinEjecutar === 4) {
          const ultimo = mensajes[mensajes.length - 1];
          if (ultimo && ultimo.role === "tool") {
            ultimo.content +=
              "\n\n[SYSTEM NOTICE] You have 4 writes in a row without running anything. " +
              "Run the script NOW with ejecutar_python (or verificar_audio) before writing again.";
          }
        }
      } else if (nombre === "ejecutar_python" || nombre === "verificar_audio") {
        if (resultado.ok) {
          ciclosFallidos = 0;
        } else if (escriturasSinEjecutar > 0) {
          ciclosFallidos += 1;
        }
        escriturasSinEjecutar = 0;
      }
      if (ciclosFallidos >= MAX_CICLOS_FALLIDOS || escriturasSinEjecutar >= 8) {
        alEvento?.({
          tipo: "aviso",
          texto: `${MAX_CICLOS_FALLIDOS} fixes in a row and the script still fails: stopping to avoid a loop.`,
        });
        return {
          texto:
            `I stopped: ${MAX_CICLOS_FALLIDOS} fixes in a row and the script still fails. ` +
            "Look at the last run's error and tell me how to continue.",
          pasos,
          llamadas,
          ms: Date.now() - t0,
          herramientas,
        };
      }
    }
  }

  if (pasos >= maxPasos && texto === "") {
    alEvento?.({ tipo: "aviso", texto: `Safety stop: ${maxPasos} steps; asking for a summary.` });
    // The steps ran out with work half done: one last call WITHOUT tools so the model
    // says what it has done and what is missing. Before, the turn ended in
    // "(no final answer)" and the person did not know where things stood.
    if (!senal?.aborted) {
      mensajes.push({
        role: "user",
        content:
          "[SYSTEM NOTICE] The step budget for this turn is over. Do not call any " +
          "tool: summarize, in the person's language, what you have actually done " +
          "(verified), what is missing and the next step you propose.",
      });
      try {
        const cierre = await chat(mensajes, {
          temperature: 0.2,
          signal: senal,
          maxTokens: 4096,
          sinRazonamiento: true,
        });
        texto = cierre.content.trim();
        if (texto !== "") mensajes.push({ role: "assistant", content: cierre.content });
      } catch {
        /* no summary: whatever there is gets returned */
      }
    }
  }

  return { texto, pasos, llamadas, ms: Date.now() - t0, herramientas };
}
