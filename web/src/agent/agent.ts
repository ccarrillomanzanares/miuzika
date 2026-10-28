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

/**
 * Tope de pasos de un turno: sin esto, un bucle no termina nunca. Un paso es una
 * respuesta del modelo (que puede pedir varias herramientas a la vez); los
 * reintentos por respuesta vacía del proveedor NO cuentan. Con las herramientas de
 * composición una sección son 6-10 pasos (leer, progresiones, notas, mezcla); una
 * canción entera, unos 30. No es un tope de gasto (el plan de Ollama es una cuota
 * fija): es el freno por si el modelo entra en bucle. Los cortes por fallos
 * repetidos y por escribir sin ejecutar siguen actuando antes.
 * Subido a 80 el 27-oct: un pase de arreglo sobre una canción de 92 compases
 * (melodía, coro, guitarra y efectos de 6 pistas) gastó 33 pasos en un turno.
 */
const MAX_PASOS_POR_DEFECTO = 80;

/** Corregir y volver a ejecutar sin éxito: a la cuarta, el turno se corta. */
const MAX_CICLOS_FALLIDOS = 4;

/** Argumentos de una llamada ya ejecutada por encima de esto se resumen en el historial. */
const UMBRAL_ARGUMENTOS = 1200;

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
  /** Ejecuciones que fallan después de haber corregido algo. */
  let ciclosFallidos = 0;
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
      // Con streaming se puede decir que está trabajando de verdad: cuántos trozos
      // lleva y cuánto tiempo. Se emite cada 700 ms para no saturar la barra.
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
          // Un vacío del proveedor no es trabajo del modelo: no gasta paso. Antes seis
          // 'load' seguidos se comían la mitad del turno.
          pasos -= 1;
          continue;
        }
        // Si el proveedor sigue sin contestar, se retoma el turno solo una vez: lo que
        // el usuario haría escribiendo «continúa». Si tampoco, se para y se avisa.
        if (!cortada && reanudaciones < 1) {
          reanudaciones += 1;
          vaciosSeguidos = 0;
          mensajes.push({ role: "user", content: "Continúa desde donde lo dejaste." });
          pasos -= 1;
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

      // Lo que ya se aplicó no hace falta reenviarlo: los argumentos largos (listas de
      // notas, scripts) se sustituyen en el historial por un resumen. Medido el 27-oct:
      // 20 llamadas de un mismo turno reenviaron 389.000 tokens, casi todo notas ya
      // escritas. Si la llamada FALLÓ se deja entera: el modelo la necesita para corregir.
      if (resultado.ok && llamada.function && llamada.function.arguments.length > UMBRAL_ARGUMENTOS) {
        llamada.function.arguments = JSON.stringify({
          _omitido: `${llamada.function.arguments.length} caracteres ya aplicados; el estado real está en leer_proyecto`,
        });
      }

      // Reintentar exactamente lo que falla igual no arregla nada: corta el turno
      // (pasó con crear_proyecto devolviendo 12 veces el mismo error).
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

      // Freno de bucles de parches. Medido el 28-oct: el freno viejo (3 escrituras sin
      // una ejecución correcta) cortó un turno sano: escribir el script, ejecutarlo
      // (falla), corregir DOS sitios con editar_fichero → cortado antes de reintentar.
      // Ahora cuentan los CICLOS: una ejecución que falla tras haber escrito. Escribir
      // varias veces seguidas sólo lleva un aviso.
      if (nombre === "escribir_fichero" || nombre === "editar_fichero") {
        escriturasSinEjecutar += 1;
        if (escriturasSinEjecutar === 4) {
          const ultimo = mensajes[mensajes.length - 1];
          if (ultimo && ultimo.role === "tool") {
            ultimo.content +=
              "\n\n[AVISO DEL SISTEMA] Llevas 4 escrituras seguidas sin ejecutar nada. " +
              "Ejecuta AHORA el script con ejecutar_python (o verificar_audio) antes de escribir otra vez.";
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
    // Se acabaron los pasos con trabajo a medias: una última llamada SIN herramientas
    // para que el modelo diga qué ha hecho y qué falta. Antes el turno acababa en
    // «(sin respuesta final)» y la persona no sabía en qué punto estaba.
    if (!senal?.aborted) {
      mensajes.push({
        role: "user",
        content:
          "[AVISO DEL SISTEMA] Se ha acabado el presupuesto de pasos de este turno. No llames a " +
          "ninguna herramienta: resume, en el idioma de la persona, lo que has hecho de verdad " +
          "(comprobado), lo que falta y el siguiente paso que propones.",
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
        /* sin resumen: se devuelve lo que haya */
      }
    }
  }

  return { texto, pasos, llamadas, ms: Date.now() - t0, herramientas };
}
