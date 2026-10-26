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

/**
 * Tope de salida por turno. El modelo razona antes de contestar y ese razonamiento
 * gasta del mismo presupuesto (medido: 8.192 tokens y 22.823 caracteres pensando
 * sin llegar a escribir nada), así que se le deja margen de sobra.
 */
const MAX_TOKENS_SALIDA = 32768;

/** Tope de pasos de un turno: sin esto, un bucle no termina nunca. */
const MAX_PASOS_POR_DEFECTO = 12;

export interface EventoAgente {
  /** "progreso": el modelo está escribiendo; se emite como mucho cada 700 ms. */
  tipo: "herramienta" | "aviso" | "progreso";
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
  const maxPasos = opciones.maxPasos ?? MAX_PASOS_POR_DEFECTO;
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
  /**
   * Fallos identicos seguidos, POR TURNO. Antes vivia fuera de la funcion y un
   * fallo de una sesion anterior contaba en la siguiente: el segundo intento del
   * dia cortaba el turno por «tres veces igual».
   */
  const fallosIguales = new Map<string, number>();
  // Un vacío aislado es un fallo del proveedor, no del modelo: se reintenta una vez
  // en silencio. Si se repite, se para y se avisa (para no entrar en bucle).
  let vaciosSeguidos = 0;
  let reanudaciones = 0;

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
    let ultimoAviso = 0;
    let respuesta = await chat(mensajes, {
      tools: HERRAMIENTAS,
      temperature: 0.2,
      signal: senal,
      maxTokens: MAX_TOKENS_SALIDA,
      // Con streaming se puede decir que está trabajando de verdad: cuántos trozos
      // lleva y cuánto tiempo. Se emite cada 700 ms para no saturar la barra.
      onProgreso: ({ tokens, ms }) => {
        if (ms - ultimoAviso < 700) return;
        ultimoAviso = ms;
        alEvento?.({
          tipo: "progreso",
          texto: `pensando · ${(ms / 1000).toFixed(1)} s · ${tokens} tokens`,
        });
      },
    });
    texto = respuesta.content.trim();

    // Si se quedó pensando y no escribió, se repite SIN razonamiento: es más rápido y
    // la respuesta llega igual. Pensar no es el problema; cortarlo a mitad sí.
    if (respuesta.finishReason === "sin_salida") {
      respuesta = await chat(mensajes, {
        tools: HERRAMIENTAS,
        temperature: 0.2,
        signal: senal,
        maxTokens: MAX_TOKENS_SALIDA,
        sinRazonamiento: true,
      });
      // Se recalcula con la SEGUNDA respuesta: antes se quedaba el texto de la
      // primera (vacía) y una respuesta buena del reintento se tiraba como si
      // fuera otro turno en blanco.
      texto = respuesta.content.trim();
    }

    const pideHerramientas = respuesta.toolCalls.length > 0;
    const vacia = !pideHerramientas && texto === "";
    if (!vacia) vaciosSeguidos = 0;

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
        const cortada = respuesta.finishReason === "length" || respuesta.finishReason === "sin_salida";
        const agotada = tokens >= 32768;
        // 'load' es lo que devuelve el proveedor cuando está saturado: cero tokens y
        // 250 ms (medido dos veces seguidas el 25-oct). Reintentar al instante no sirve;
        // se espera y se prueba hasta tres veces.
        if (!cortada && vaciosSeguidos < 5) {
          vaciosSeguidos += 1;
          // 'load' en Ollama es el modelo cargándose: hace falta esperar de verdad.
          await new Promise((listo) => setTimeout(listo, 1000 * 2 ** (vaciosSeguidos - 1)));
          continue;
        }
        // Si el proveedor sigue sin contestar, se retoma el turno solo una vez: lo que
        // el usuario haría escribiendo «continúa». Si tampoco, se para y se avisa.
        if (!cortada && reanudaciones < 1) {
          reanudaciones += 1;
          vaciosSeguidos = 0;
          mensajes.push({ role: "user", content: "Continúa desde donde lo dejaste." });
          continue;
        }
        return {
          texto: cortada
            ? respuesta.finishReason === "sin_salida"
              ? "El modelo se ha pasado el turno razonando y no llegó a escribir la respuesta. " +
                "No es un fallo de la app: se le dio más presupuesto y se reintenta solo. Si vuelve " +
                "a pasar, pídelo en trozos más pequeños."
              : "El modelo se ha cortado a mitad de la respuesta (tope de salida) y no ha llegado a " +
                "terminar. Lo escrito en disco se queda. Dime «continúa» y sigo desde ahí, o pídeme " +
                "que lo haga en trozos más pequeños."
            : agotada
            ? "El modelo ha agotado su salida generando en bucle (" +
              `${tokens.toLocaleString("es-ES")} tokens en ${segundos} s) y no ha devuelto ` +
              "texto ni herramienta alguna. No se ha tocado nada: dime «continúa» para reintentarlo."
            : respuesta.finishReason === "load"
              ? "El proveedor del modelo está saturado (finish_reason 'load': cero tokens en " +
                "un cuarto de segundo). He reintentado tres veces con espera y sigue igual. " +
                "Lo escrito en disco se queda. Prueba en un minuto, o cambia de modelo en el " +
                "selector; si vuelve a pasar siempre después de un fichero grande, es que el " +
                "turno anterior pidió demasiado."
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

      // Reintentar exactamente lo que falla igual no arregla nada: corta el turno
      // (pasó con crear_proyecto devolviendo 12 veces el mismo error).
      if (!resultado.ok) {
        const clave = `${nombre}|${resultado.texto.slice(0, 160)}`;
        const veces = (fallosIguales.get(clave) ?? 0) + 1;
        fallosIguales.set(clave, veces);
        if (veces >= 3) {
          alEvento?.({ tipo: "aviso", texto: `Corto: «${nombre}» falla igual 3 veces.` });
          return {
            texto:
              `He parado: «${nombre}» da el mismo error tres veces seguidas y reintentarlo no lo arregla.\n\n` +
              `> ${resultado.texto.split("\n")[0].slice(0, 300)}\n\n` +
              "Dime cómo seguir (si es un fallo de la app, recarga la página y repite).",
            pasos,
            llamadas,
            ms: Date.now() - t0,
            herramientas,
          };
        }
      } else {
        fallosIguales.clear();
      }

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
