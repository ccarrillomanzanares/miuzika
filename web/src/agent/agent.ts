/**
 * Bucle del agente: piensa, usa herramientas, observa el resultado y repite.
 *
 * El LLM decide; el codigo (aqui y en el servidor) ejecuta; el resultado vuelve
 * al modelo como mensaje de herramienta hasta que responde sin pedir ninguna.
 */

import { chat } from "../llm.ts";
import type { ChatMessage } from "../llm.ts";
import { HERRAMIENTAS, ejecutarHerramienta, resumenLlamada } from "./tools.ts";
import type { PasoHerramienta } from "./actividad.ts";

export interface EventoAgente {
  tipo: "herramienta" | "aviso";
  texto: string;
  /** Solo en "aviso": la herramienta que acaba de terminar y lo que tardo. */
  nombre?: string;
  ms?: number;
  ok?: boolean;
}

export interface ResultadoAgente {
  texto: string;
  pasos: number;
  llamadas: number;
  ms: number;
  /** Una entrada por llamada, en orden: es lo que desglosa la barra de actividad. */
  herramientas: PasoHerramienta[];
}

export interface OpcionesAgente {
  maxPasos?: number;
  alEvento?: (evento: EventoAgente) => void;
  /** Cancelar el turno (botón «Cancelar»): corta el modelo y la herramienta en vuelo. */
  signal?: AbortSignal;
}

/** Ejecuta el bucle sobre `mensajes` (se modifican: el historial continua). */
export async function ejecutarAgente(
  mensajes: ChatMessage[],
  opciones: OpcionesAgente = {},
): Promise<ResultadoAgente> {
  const maxPasos = opciones.maxPasos ?? 12;
  const alEvento = opciones.alEvento;
  const senal = opciones.signal;
  const t0 = Date.now();
  let pasos = 0;
  let llamadas = 0;
  let texto = "";
  /** Tiempo medido de cada llamada: se devuelve para la barra de actividad. */
  const herramientas: PasoHerramienta[] = [];
  /** Escrituras seguidas sin una ejecucion correcta: corta el bucle de parches. */
  let escriturasSinEjecutar = 0;

  /** Respuesta de cierre cuando el usuario cancela. */
  const cancelado = (): ResultadoAgente => ({
    texto:
      "Turno cancelado por ti. Lo que ya se escribió en disco se queda; si había una GPU arrancada, apágala " +
      "con el interruptor de la cabecera (sigue facturando hasta que se apague).",
    pasos,
    llamadas,
    ms: Date.now() - t0,
    herramientas,
  });

  while (pasos < maxPasos) {
    if (senal?.aborted) return cancelado();
    pasos += 1;
    const respuesta = await chat(mensajes, { tools: HERRAMIENTAS, temperature: 0.2, signal: senal });
    texto = respuesta.content.trim();

    const pideHerramientas = respuesta.toolCalls.length > 0;
    const vacia = !pideHerramientas && texto === "";

    // Una respuesta vacia y sin herramientas no se guarda: solo ensuciaria el historial.
    if (!vacia) {
      mensajes.push({
        role: "assistant",
        content: respuesta.content,
        ...(pideHerramientas ? { tool_calls: respuesta.toolCalls } : {}),
      });
    }

    if (!pideHerramientas) {
      // Fallo observado (22-oct-2026): el modelo se va en bucle, agota su salida
      // (393.216 tokens en 12 minutos) y devuelve un mensaje vacio, sin texto y
      // sin pedir ninguna herramienta. Aqui solo se DETECTA y se avisa claro:
      // no se reintenta por su cuenta (la decision es del usuario).
      if (vacia) {
        const tokens = respuesta.usage?.completion_tokens ?? 0;
        const segundos = Math.round((Date.now() - t0) / 1000);
        const agotada = tokens >= 32768;
        return {
          texto: agotada
            ? "El modelo ha agotado su salida generando en bucle (" +
              `${tokens.toLocaleString("es-ES")} tokens en ${segundos} s) y no ha devuelto ` +
              "texto ni herramienta alguna. No se ha tocado nada: dime «continúa» para reintentarlo."
            : "El modelo devolvio una respuesta vacia, sin texto y sin pedir ninguna " +
              "herramienta. No se ha tocado nada: dime «continua» para reintentarlo.",
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

      if (nombre === "escribir_fichero" || nombre === "editar_fichero") {
        escriturasSinEjecutar += 1;
        if (escriturasSinEjecutar === 2) {
          const ultimo = mensajes[mensajes.length - 1];
          if (ultimo && ultimo.role === "tool") {
            ultimo.content +=
              "\n\n[AVISO DEL SISTEMA] Llevas 2 escrituras seguidas sin ejecutar nada. " +
              "Ejecuta AHORA el script con ejecutar_python (o verificar_audio) antes de escribir otra vez.";
          }
        }
      } else if ((nombre === "ejecutar_python" || nombre === "verificar_audio") && resultado.ok) {
        escriturasSinEjecutar = 0;
      }
      if (escriturasSinEjecutar >= 3) {
        alEvento?.({
          tipo: "aviso",
          texto: "3 escrituras seguidas sin una ejecucion correcta: corto para no entrar en bucle de parches.",
        });
        return {
          texto:
            "He parado: llevo 3 escrituras seguidas sin que ninguna ejecucion salga bien. " +
            "Mira el error de la ultima ejecucion y dime como seguir (o usa editar_fichero con el fragmento exacto).",
          pasos,
          llamadas,
          ms: Date.now() - t0,
          herramientas,
        };
      }
    }
  }

  if (pasos >= maxPasos) {
    alEvento?.({ tipo: "aviso", texto: `Corte de seguridad: ${maxPasos} pasos sin respuesta final.` });
  }

  return { texto, pasos, llamadas, ms: Date.now() - t0, herramientas };
}
