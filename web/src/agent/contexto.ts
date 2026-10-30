/**
 * Agent context: what is sent to the model and what is saved in the project.
 *
 * Two ideas, and both are about money and sanity:
 *
 *  - The model is not sent a tool's entire output (a render prints 500 lines). It is
 *    sent the head, the tail and the path where the full text is, which it can re-read
 *    with `leer_fichero`.
 *  - The conversation does not live in the browser: it is saved in
 *    `proyectos/<slug>/agente.json` as turns (request + final answer, without the
 *    tool_calls plumbing) and a rolling summary of the old turns.
 *
 * No DOM and no network: everything is tested with `node --test`.
 */

export interface TurnoAgente {
  /** What the user asked for. */
  usuario: string;
  /** The agent's final answer (not the intermediate steps). */
  asistente: string;
}

/** Turns kept whole; earlier ones are merged into the summary. */
export const MAX_TURNOS = 8;

/** Characters per field when saving a turn (what is later sent to the model). */
const MAX_CAMPO = 700;

/** Summary block size. */
const MAX_RESUMEN = 1800;

/** Above this, a tool output is trimmed before going to the model. */
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
 * Trims a tool's output: beginning, end and the notice of where the rest is. It
 * respects lines (a log is read line by line).
 */
export function recortarSalida(texto: string, cabecera = 28, cola = 12): string {
  if (texto.length <= UMBRAL_SALIDA) return texto;
  const lineas = texto.split("\n");
  if (lineas.length <= cabecera + cola) {
    // Few lines but very long: cut by characters.
    return `${texto.slice(0, 900)} … ${texto.slice(-250)}`;
  }
  const cabeza = lineas.slice(0, cabecera).join("\n");
  const final = lineas.slice(-cola).join("\n");
  const quitadas = lineas.length - cabecera - cola;
  return `${cabeza}\n[ …${quitadas} line(s) omitted … ]\n${final}`;
}

/** Trims a turn so it does not grow without control. */
function recortarCampo(texto: string, limite = MAX_CAMPO): string {
  const limpio = texto.trim().replace(/\s+\n/g, "\n");
  if (limpio.length <= limite) return limpio;
  return `${limpio.slice(0, limite - 1)}…`;
}

/** One line per old turn, for the rolling summary. */
function lineaDeTurno(turno: TurnoAgente): string {
  const pregunta = turno.usuario.split("\n")[0]?.trim() ?? "";
  const respuesta = turno.asistente.split("\n")[0]?.trim() ?? "";
  return `- «${recortarCampo(pregunta, 120)}» → ${recortarCampo(respuesta, 160)}`;
}

/**
 * Adds a turn and returns the new state: only the last MAX_TURNOS stay whole, the rest
 * are summarized in one line each. The summary never grows beyond MAX_RESUMEN: the
 * oldest lines fall off.
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
 * Block pasted onto the system prompt with what happened in previous sessions:
 * a summary of the old stuff and the last turns verbatim.
 */
export function bloqueContexto(resumen: string, turnos: TurnoAgente[]): string {
  if (resumen.trim() === "" && turnos.length === 0) return "";
  const partes = ["\n\n=== PREVIOUS CONVERSATION IN THIS PROJECT ==="];
  if (resumen.trim() !== "") partes.push(`Summary:\n${resumen.trim()}`);
  if (turnos.length > 0) {
    partes.push("Last turns:");
    for (const turno of turnos) {
      partes.push(`user: ${turno.usuario}`);
      partes.push(`you: ${turno.asistente}`);
    }
  }
  partes.push("(Do not repeat what has already been done without checking it; the real state is proyecto.json and the files.)");
  return partes.join("\n");
}

/** Reads `agente.json` whatever its state: whatever is missing is empty. */
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

/** Builds the file that is written to `proyectos/<slug>/agente.json`. */
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

/** The bare minimum of a chat message needed to trim the conversation. */
interface MensajeRecortable {
  role: string;
}

/**
 * Leaves the conversation as `[system, ...last messages]` with at most `max` messages
 * after the system one, ALWAYS cutting right before a user message.
 *
 * Before, it was cut by number alone, and the cut could fall between an `assistant`
 * with `tool_calls` and its `tool`: the first message left was a tool result without
 * the call that requested it, and the provider rejects that conversation (or the model
 * gets confused by a result whose origin it does not know).
 */
export function recortarConversacion<T extends MensajeRecortable>(mensajes: T[], max: number): void {
  if (mensajes.length - 1 <= max) return;
  const desde = mensajes.length - max;
  let corte = -1;
  for (let i = desde; i < mensajes.length; i += 1) {
    if (mensajes[i]!.role === "user") {
      corte = i;
      break;
    }
  }
  // If there is no user message in the window (a very long turn), the whole turn is
  // kept from its request: better long than broken.
  if (corte === -1) {
    for (let i = desde - 1; i >= 1; i -= 1) {
      if (mensajes[i]!.role === "user") {
        corte = i;
        break;
      }
    }
  }
  if (corte > 1) mensajes.splice(1, corte - 1);
}
