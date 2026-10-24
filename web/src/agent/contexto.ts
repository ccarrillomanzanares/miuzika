/**
 * Contexto del agente: qué se le manda al modelo y qué se guarda en el proyecto.
 *
 * Dos ideas, y las dos son por dinero y por cordura:
 *
 *  - Al modelo no se le manda la salida entera de una herramienta (un render
 *    imprime 500 líneas). Se le manda la cabeza, la cola y la ruta donde está el
 *    texto completo, que puede releer con `leer_fichero`.
 *  - La conversación no vive en el navegador: se guarda en
 *    `proyectos/<slug>/agente.json` como turnos (petición + respuesta final, sin
 *    el fontanería de tool_calls) y un resumen rodante de los turnos viejos.
 *
 * Sin DOM y sin red: todo se prueba con `node --test`.
 */

export interface TurnoAgente {
  /** Lo que pidió el usuario. */
  usuario: string;
  /** La respuesta final del agente (no los pasos intermedios). */
  asistente: string;
}

/** Turnos que se guardan enteros; los anteriores se funden en el resumen. */
export const MAX_TURNOS = 8;

/** Caracteres por campo al guardar un turno (lo que se manda luego al modelo). */
const MAX_CAMPO = 700;

/** Tamaño del bloque de resumen. */
const MAX_RESUMEN = 1800;

/** Por encima de esto una salida de herramienta se recorta antes de ir al modelo. */
export const UMBRAL_SALIDA = 4000;

export interface AgenteEnDisco {
  formato: "miuzika-agente";
  version: number;
  guardadoEn: string;
  modelo: string;
  resumen: string;
  turnos: TurnoAgente[];
}

/**
 * Recorta la salida de una herramienta: principio, final y el aviso de dónde
 * está el resto. Respeta las líneas (un log se lee por líneas).
 */
export function recortarSalida(texto: string, cabecera = 28, cola = 12): string {
  if (texto.length <= UMBRAL_SALIDA) return texto;
  const lineas = texto.split("\n");
  if (lineas.length <= cabecera + cola) {
    // Pocas líneas pero muy largas: corte por caracteres.
    return `${texto.slice(0, 900)} … ${texto.slice(-250)}`;
  }
  const cabeza = lineas.slice(0, cabecera).join("\n");
  const final = lineas.slice(-cola).join("\n");
  const quitadas = lineas.length - cabecera - cola;
  return `${cabeza}\n[ …${quitadas} línea(s) omitida(s) … ]\n${final}`;
}

/** Recorta un turno para que no crezca sin control. */
function recortarCampo(texto: string, limite = MAX_CAMPO): string {
  const limpio = texto.trim().replace(/\s+\n/g, "\n");
  if (limpio.length <= limite) return limpio;
  return `${limpio.slice(0, limite - 1)}…`;
}

/** Una línea por turno viejo, para el resumen rodante. */
function lineaDeTurno(turno: TurnoAgente): string {
  const pregunta = turno.usuario.split("\n")[0]?.trim() ?? "";
  const respuesta = turno.asistente.split("\n")[0]?.trim() ?? "";
  return `- «${recortarCampo(pregunta, 120)}» → ${recortarCampo(respuesta, 160)}`;
}

/**
 * Añade un turno y devuelve el estado nuevo: sólo los últimos MAX_TURNOS quedan
 * enteros, el resto se resume en una línea cada uno. El resumen nunca crece
 * más allá de MAX_RESUMEN: se van cayendo las líneas más viejas.
 */
export function agregarTurno(
  resumen: string,
  turnos: TurnoAgente[],
  nuevo: TurnoAgente,
): { resumen: string; turnos: TurnoAgente[] } {
  const todos = [...turnos, { usuario: recortarCampo(nuevo.usuario), asistente: recortarCampo(nuevo.asistente) }];
  const sobran = todos.length - MAX_TURNOS;
  if (sobran <= 0) return { resumen, turnos: todos };

  const viejos = todos.slice(0, sobran);
  const quedan = todos.slice(sobran);
  const lineas = [
    ...resumen.split("\n").filter((linea) => linea.trim() !== ""),
    ...viejos.map(lineaDeTurno),
  ];
  let texto = lineas.join("\n");
  while (texto.length > MAX_RESUMEN && lineas.length > 1) {
    lineas.shift();
    texto = lineas.join("\n");
  }
  return { resumen: texto, turnos: quedan };
}

/**
 * Bloque que se pega al prompt de sistema con lo que pasó en sesiones
 * anteriores: resumen de lo viejo y los últimos turnos literales.
 */
export function bloqueContexto(resumen: string, turnos: TurnoAgente[]): string {
  if (resumen.trim() === "" && turnos.length === 0) return "";
  const partes = ["\n\n=== CONVERSACIÓN ANTERIOR DE ESTE PROYECTO ==="];
  if (resumen.trim() !== "") partes.push(`Resumen:\n${resumen.trim()}`);
  if (turnos.length > 0) {
    partes.push("Últimos turnos:");
    for (const turno of turnos) {
      partes.push(`usuario: ${turno.usuario}`);
      partes.push(`tú: ${turno.asistente}`);
    }
  }
  partes.push("(No repitas lo ya hecho sin comprobarlo; el estado real es proyecto.json y los ficheros.)");
  return partes.join("\n");
}

/** Lee `agente.json` sea cual sea su estado: lo que falte, vacío. */
export function interpretarAgente(texto: string): { resumen: string; turnos: TurnoAgente[] } {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { resumen: "", turnos: [] };
  }
  const datos = (crudo ?? {}) as Partial<AgenteEnDisco>;
  const turnos: TurnoAgente[] = Array.isArray(datos.turnos)
    ? datos.turnos
        .filter((turno): turno is TurnoAgente => Boolean(turno) && typeof turno.usuario === "string")
        .map((turno) => ({
          usuario: String(turno.usuario),
          asistente: typeof turno.asistente === "string" ? turno.asistente : "",
        }))
        .slice(-MAX_TURNOS)
    : [];
  return { resumen: typeof datos.resumen === "string" ? datos.resumen : "", turnos };
}

/** Construye el fichero que se escribe en `proyectos/<slug>/agente.json`. */
export function serializarAgente(
  resumen: string,
  turnos: TurnoAgente[],
  modelo: string,
  ahora: Date = new Date(),
): AgenteEnDisco {
  return {
    formato: "miuzika-agente",
    version: 1,
    guardadoEn: ahora.toISOString(),
    modelo,
    resumen,
    turnos: turnos.slice(-MAX_TURNOS),
  };
}
