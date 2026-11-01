/**
 * A trajectory: everything one agent turn did, saved whole.
 *
 * Why (1-Nov-2026, docs/PLAN-MODELO-PROPIO.md): to train a model of our own and to
 * audit what the paid tier costs we need complete records of "brief -> steps the agent
 * took -> result". Until today nothing kept them: `tmp/llm.log` stores the first 200
 * characters of each message, and `agente.json` only the user/assistant text (32 turns
 * in total on 1-Nov, no tool calls, no tool results).
 *
 * One file per turn in `proyectos/<slug>/trayectorias/`, next to `versiones/`. It is
 * self-contained: the whole conversation as the model saw it (system prompt with the
 * manifest and the context block included), the tool calls with their REAL arguments
 * (the loop replaces long ones with "_omitido" after applying them; here they are
 * restored from the step records), the full tool results, the project after the turn,
 * the cost, and a verdict read from the last `escuchar_mezcla` report.
 *
 * This module is pure (tests in trayectoria.test.ts); the browser assembles the record
 * at the end of a turn (web/src/main.ts) and the server writes it (/api/trayectorias).
 */

import { nombreDeVersion } from "./versiones.ts";

export const CARPETA_TRAYECTORIAS = "trayectorias";

/** What the loop records about each tool call, beyond the summary shown in the bar. */
export interface DetallePaso {
  /** tool_call id, to match the assistant message that requested it. */
  id: string;
  nombre: string;
  /** Arguments as the model wrote them, before the loop summarised them. */
  argumentos: string;
  /** Result text the tool returned (whole, not the 12,000-character cut the model saw). */
  resultado: string;
  ok: boolean;
  ms: number;
}

export interface MensajeTrayectoria {
  role: string;
  content: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export type EstadoTurno = "ok" | "cancelado" | "error";

export interface Veredicto {
  /** How many times the agent listened to the mix in the turn. */
  escuchas: number;
  /** From the LAST report: tracks that have notes and produce no sound. */
  pistasSilenciosas: string[];
  /** The last report ended with "No problems". null when it never listened. */
  sinProblemas: boolean | null;
  clipea: boolean;
}

export interface Trayectoria {
  formato: "miuzika-trayectoria";
  version: 1;
  t0: string;
  t1: string;
  proyecto: string;
  proveedor: string;
  modelo: string;
  /** FNV-1a fingerprint of the base prompt (web/src/agente-prompt.ts, HUELLA_PROMPT). */
  huellaPrompt: string;
  estado: EstadoTurno;
  error?: string;
  pedido: string;
  respuesta: string;
  pasos: number;
  llamadas: number;
  ms: number;
  /** Index in `mensajes` of this turn's user message; what precedes it is context. */
  desde: number;
  mensajes: MensajeTrayectoria[];
  herramientas: DetallePaso[];
  veredicto: Veredicto;
  coste: { usd: number; tokensNuevos: number; tokensCache: number; tokensSalida: number; tarifa: string | null } | null;
  /** Name of the snapshot in versiones/ taken before the turn (null without a project). */
  versionAntes: string | null;
  /** The project after the turn, as proyecto.json stores it (null without a project). */
  proyectoDespues: unknown;
}

/** `2026-11-01_18-30-12_make-the-bass-darker.json`: the same rule as the versions, so a
 *  trajectory and the snapshot taken before its turn sort side by side. */
export const nombreDeTrayectoria = nombreDeVersion;

/**
 * Puts the real arguments back into the assistant messages: the loop replaces
 * arguments longer than a threshold with `{"_omitido": "..."}` once applied (it saved
 * 389,000 tokens in one turn), but the dataset needs what the model actually wrote.
 * Returns copies; the live conversation is not touched.
 */
export function restaurarArgumentos(mensajes: readonly MensajeTrayectoria[], pasos: readonly DetallePaso[]): MensajeTrayectoria[] {
  const porId = new Map(pasos.map((p) => [p.id, p.argumentos]));
  return mensajes.map((m) => {
    if (!m.tool_calls) return { ...m };
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc) => {
        const reales = porId.get(tc.id);
        const omitida = tc.function.arguments.includes('"_omitido"');
        return reales !== undefined && omitida ? { ...tc, function: { ...tc.function, arguments: reales } } : { ...tc, function: { ...tc.function } };
      }),
    };
  });
}

/**
 * Reads the verdict from the `escuchar_mezcla` reports (src/core/escucha.ts writes
 * them): which tracks have notes and no sound, whether the mix clips, and whether the
 * last listen ended clean. Text parsing on purpose: the report is what the model saw.
 */
export function veredictoDe(pasos: readonly DetallePaso[]): Veredicto {
  const escuchas = pasos.filter((p) => p.nombre === "escuchar_mezcla" && p.ok);
  if (escuchas.length === 0) return { escuchas: 0, pistasSilenciosas: [], sinProblemas: null, clipea: false };
  const ultimo = escuchas[escuchas.length - 1].resultado;
  const silenciosas = new Set<string>();
  for (const m of ultimo.matchAll(/^- "([^"]+)" (?:does not play in ANY span|has notes and does not play)/gm)) silenciosas.add(m[1]);
  return {
    escuchas: escuchas.length,
    pistasSilenciosas: [...silenciosas],
    sinProblemas: /^No problems:/m.test(ultimo),
    clipea: /goes above 0 dBFS/.test(ultimo),
  };
}

export interface DatosTurno {
  t0: Date;
  t1: Date;
  proyecto: string;
  proveedor: string;
  modelo: string;
  huellaPrompt: string;
  estado: EstadoTurno;
  error?: string;
  pedido: string;
  respuesta: string;
  pasos: number;
  llamadas: number;
  desde: number;
  mensajes: readonly MensajeTrayectoria[];
  herramientas: readonly DetallePaso[];
  coste: Trayectoria["coste"];
  versionAntes: string | null;
  proyectoDespues: unknown;
}

export function construirTrayectoria(d: DatosTurno): Trayectoria {
  return {
    formato: "miuzika-trayectoria",
    version: 1,
    t0: d.t0.toISOString(),
    t1: d.t1.toISOString(),
    proyecto: d.proyecto,
    proveedor: d.proveedor,
    modelo: d.modelo,
    huellaPrompt: d.huellaPrompt,
    estado: d.estado,
    ...(d.error ? { error: d.error } : {}),
    pedido: d.pedido,
    respuesta: d.respuesta,
    pasos: d.pasos,
    llamadas: d.llamadas,
    ms: d.t1.getTime() - d.t0.getTime(),
    desde: d.desde,
    mensajes: restaurarArgumentos(d.mensajes, d.herramientas),
    herramientas: d.herramientas.map((p) => ({ ...p })),
    veredicto: veredictoDe(d.herramientas),
    coste: d.coste,
    versionAntes: d.versionAntes,
    proyectoDespues: d.proyectoDespues ?? null,
  };
}
