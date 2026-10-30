/**
 * Turn accounting for the activity bar: time PER tool.
 *
 * An agent turn lasts minutes and the only thing the user needs to know is WHERE that
 * time went. The loop (`agent.ts`) times each call and here it is only grouped and
 * formatted: no DOM, so it can be tested with tests.
 */

export interface PasoHerramienta {
  nombre: string;
  ms: number;
  ok: boolean;
}

export interface HerramientaAgrupada {
  nombre: string;
  ms: number;
  veces: number;
  fallos: number;
}

/** "12.4 s": one decimal and a dot, so it does not depend on the system ICU. */
export function segundos(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/**
 * Groups by name and sorts by descending time: first what ate the turn. Ties keep the
 * order of appearance (the Map's insertion order), so a turn of equal calls always
 * comes out the same.
 */
export function agrupar(pasos: readonly PasoHerramienta[]): HerramientaAgrupada[] {
  const porNombre = new Map<string, HerramientaAgrupada>();
  for (const paso of pasos) {
    const ya = porNombre.get(paso.nombre);
    if (ya) {
      ya.ms += paso.ms;
      ya.veces += 1;
      if (!paso.ok) ya.fallos += 1;
      continue;
    }
    porNombre.set(paso.nombre, {
      nombre: paso.nombre,
      ms: paso.ms,
      veces: 1,
      fallos: paso.ok ? 0 : 1,
    });
  }
  return [...porNombre.values()].sort((a, b) => b.ms - a.ms);
}

export interface ResumenTurno {
  pasos: number;
  llamadas: number;
  ms: number;
  herramientas: readonly PasoHerramienta[];
}

/** How many tools are named before summarizing the rest as "+N more". */
const MAX_LISTADAS = 4;

/**
 * Discreet line for the end of the history:
 *
 *     2 step(s) · 4 tool(s) · 42.1 s — ejecutar_python 38.5 s ×2 · leer_fichero 0.3 s
 *
 * With no tools (the model only talked) it returns just the header, without a dash.
 */
export function lineaResumen(turno: ResumenTurno): string {
  const cabecera = `${turno.pasos} step(s) · ${turno.llamadas} tool(s) · ${segundos(turno.ms)}`;
  const agrupadas = agrupar(turno.herramientas);
  if (agrupadas.length === 0) return cabecera;
  const listadas = agrupadas.slice(0, MAX_LISTADAS).map((h) => {
    const veces = h.veces > 1 ? ` ×${h.veces}` : "";
    const fallos = h.fallos > 0 ? ` ⚠${h.fallos} fail(s)` : "";
    return `${h.nombre} ${segundos(h.ms)}${veces}${fallos}`;
  });
  const resto = agrupadas.length - listadas.length;
  if (resto > 0) listadas.push(`+${resto} more`);
  return `${cabecera} — ${listadas.join(" · ")}`;
}

/**
 * Bar text while the turn runs. `msPaso` is how long the current tool has been going
 * (null if the model is thinking, with no tool in progress).
 */
export function fraseBarra(
  pasoActual: string,
  msPaso: number | null,
  msTurno: number,
): string {
  const turno = `turn ${reloj(msTurno)}`;
  if (msPaso === null) return `${pasoActual} · ${turno}`;
  return `${pasoActual} · ${reloj(msPaso)} · ${turno}`;
}

/** "8 s" below a minute; "1:20" from a minute on (a long render reads better). */
export function reloj(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Phrase for a tool that has ALREADY finished. The ✓ is the only difference from the
 * tool in progress: without it, "leer_fichero 0.0 s" looks like it is still running
 * while the model writes.
 */
export function pasoTerminado(nombre: string, ms: number): string {
  return `✓ ${nombre} ${segundos(ms)}`;
}
