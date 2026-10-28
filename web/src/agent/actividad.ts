/**
 * Contabilidad del turno para la barra de actividad: tiempo POR herramienta.
 *
 * Un turno del agente dura minutos y lo unico que el usuario necesita saber es
 * DONDE se ha ido ese tiempo. El bucle (`agent.ts`) mide cada llamada y aqui
 * solo se agrupa y se formatea: sin DOM, para poder probarlo con tests.
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

/** "12,4 s": un decimal y coma decimal, sin depender del ICU del sistema. */
export function segundos(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace(".", ",")} s`;
}

/**
 * Agrupa por nombre y ordena por tiempo descendente: primero lo que se comio el
 * turno. Los empates conservan el orden de aparicion (el orden de insercion del
 * Map), para que un turno de llamadas iguales salga siempre igual.
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

/** Cuantas herramientas se nombran antes de resumir el resto con "+N mas". */
const MAX_LISTADAS = 4;

/**
 * Linea discreta para el final del historial:
 *
 *     2 paso(s) · 4 herramienta(s) · 42,1 s — ejecutar_python 38,5 s ×2 · leer_fichero 0,3 s
 *
 * Sin herramientas (el modelo solo hablo) devuelve solo la cabecera, sin raya.
 */
export function lineaResumen(turno: ResumenTurno): string {
  const cabecera = `${turno.pasos} paso(s) · ${turno.llamadas} herramienta(s) · ${segundos(turno.ms)}`;
  const agrupadas = agrupar(turno.herramientas);
  if (agrupadas.length === 0) return cabecera;
  const listadas = agrupadas.slice(0, MAX_LISTADAS).map((h) => {
    const veces = h.veces > 1 ? ` ×${h.veces}` : "";
    const fallos = h.fallos > 0 ? ` ⚠${h.fallos} fallo(s)` : "";
    return `${h.nombre} ${segundos(h.ms)}${veces}${fallos}`;
  });
  const resto = agrupadas.length - listadas.length;
  if (resto > 0) listadas.push(`+${resto} más`);
  return `${cabecera} — ${listadas.join(" · ")}`;
}

/**
 * Texto de la barra mientras corre el turno. `msPaso` es lo que lleva la
 * herramienta actual (null si el modelo esta pensando, sin herramienta en curso).
 */
export function fraseBarra(
  pasoActual: string,
  msPaso: number | null,
  msTurno: number,
): string {
  const turno = `turno ${reloj(msTurno)}`;
  if (msPaso === null) return `${pasoActual} · ${turno}`;
  return `${pasoActual} · ${reloj(msPaso)} · ${turno}`;
}

/** «8 s» por debajo del minuto; «1:20» desde el minuto (un render largo se lee mejor). */
export function reloj(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Frase de una herramienta YA terminada. El ✓ es la unica diferencia con la
 * herramienta en curso: sin el, "leer_fichero 0,0 s" parece seguir corriendo
 * mientras el modelo redacta.
 */
export function pasoTerminado(nombre: string, ms: number): string {
  return `✓ ${nombre} ${segundos(ms)}`;
}
