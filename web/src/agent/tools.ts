/**
 * Herramientas del agente: sus "manos".
 *
 * El navegador no toca el disco: pide al servidor de desarrollo, que es quien
 * ejecuta y escribe, y SIEMPRE dentro de <proyecto>/workspace. Los esquemas de
 * abajo son los que ve el LLM.
 */

import type { ToolSpec } from "../llm.ts";
import { UMBRAL_SALIDA, recortarSalida } from "./contexto.ts";
import { buscarEnCatalogo } from "../../../src/core/buscar.ts";
import type { EntradaCatalogo } from "../../../src/core/buscar.ts";
import { etiquetasEnFrase } from "../../../src/core/taxonomia.ts";
import type { PeticionProgresion } from "../../../src/core/composicion.ts";
import { PATRONES } from "../../../src/core/composicion.ts";
import { PALABRAS } from "../../../src/core/palabras.ts";
import { DEVICE_TYPES, INSTRUMENT_TYPES } from "../../../src/core/types.ts";
import { firmasDeOps } from "../../../src/core/ops.ts";
import { MODE_NAMES } from "../../../src/core/theory.ts";

/** Texto que vuelve al modelo como resultado de la herramienta. */
export type ResultadoHerramienta = ResultadoAccion;

/** Slug del proyecto abierto: el servidor resuelve ahi las rutas no compartidas. */
let proyectoActivo = "";

export function setProyectoActivo(slug: string): void {
  proyectoActivo = slug;
}

/** Donde corre Python: en este portatil (cpu) o en una GPU de Lambda Cloud. */
export type Destino = "cpu" | "lambda";

let destinoPreferido: Destino = "cpu";

/** La interfaz (o main.ts) fija aqui el destino por defecto de las herramientas. */
export function setDestino(destino: Destino): void {
  destinoPreferido = destino === "lambda" ? "lambda" : "cpu";
}

/**
 * Cabecera con la carpeta de un proyecto. Va CODIFICADA: una cabecera HTTP sólo
 * admite Latin-1 y `fetch` lanza con una carpeta como «夜の歌». El servidor la
 * descodifica en `slugProyecto` (server/contexto.ts).
 */
export function cabeceraDeProyecto(slug: string): Record<string, string> {
  return { "x-miuzika-proyecto": encodeURIComponent(slug) };
}

/** Cabeceras con el proyecto activo (lo usa tambien main.ts). */
export function cabecerasProyecto(extra?: Record<string, string>): Record<string, string> {
  return { ...cabeceraDeProyecto(proyectoActivo), ...(extra ?? {}) };
}

/**
 * Peticion con limite de tiempo y cancelable: el chat nunca se queda colgado
 * esperando y el boton «Cancelar» corta tambien lo que este en vuelo.
 *
 * `senal` es el AbortSignal del turno: sin el, cancelar dejaba la herramienta
 * corriendo hasta su propio tope.
 */
async function pedir(
  ruta: string,
  opciones: { cuerpo?: unknown; metodo?: "GET" | "POST"; limiteMs?: number; senal?: AbortSignal } = {},
): Promise<Response> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), opciones.limiteMs ?? 45000);
  const alAbortar = (): void => control.abort();
  opciones.senal?.addEventListener("abort", alAbortar, { once: true });
  const cuerpo = opciones.cuerpo;
  const metodo = opciones.metodo ?? (cuerpo === undefined ? "GET" : "POST");
  try {
    return await fetch(ruta, {
      method: metodo,
      headers: cabecerasProyecto(
        cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      ),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
  } finally {
    clearTimeout(temporizador);
    opciones.senal?.removeEventListener("abort", alAbortar);
  }
}

async function pedirJson(
  ruta: string,
  cuerpo?: unknown,
  limiteMs = 45000,
  senal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await pedir(ruta, { cuerpo, limiteMs, senal });
  const texto = await res.text();
  let datos: Record<string, unknown> = {};
  try {
    datos = texto === "" ? {} : (JSON.parse(texto) as Record<string, unknown>);
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(String(datos.error ?? `HTTP ${res.status}`));
  return datos;
}

// ---------------------------------------------------------------------------
// Acciones que tocan el proyecto abierto
//
// Las herramientas que cambian el proyecto se ejecutan en la pestaña, porque es
// la dueña de `proyecto.json` (ver docs/ARCHITECTURE.md §3). La pestaña las
// registra aquí con `registrarAcciones`, de una vez. Antes eran siete registros
// sueltos, cada uno duplicado en `globalThis`.
// ---------------------------------------------------------------------------

/** Resultado de una acción: el texto vuelve al modelo como resultado de la herramienta. */
export interface ResultadoAccion {
  ok: boolean;
  texto: string;
}

/** Pistas reales a partir de ficheros de workspace/ (la entrega de una canción). */
export interface PeticionPistas {
  midis: string[];
  wavs: string[];
  inicioCompas: number;
  /**
   * Cuantos compases dura la toma. Todos los clips de la llamada (MIDI y WAV)
   * duran exactamente eso: la duracion se cuenta en compases, no en segundos de
   * fichero, asi que el MIDI y el WAV del mismo instrumento acaban igual.
   */
  compases?: number;
  /** Nombre del proyecto si hay que crearlo (lo pregunta el agente al usuario). */
  nombreProyecto?: string;
}

export interface PeticionProyecto {
  nombre: string;
  bpm: number;
  compases: number;
  /** Tónica y modo, si el usuario los ha dicho («re menor» → D minor). */
  tonica?: string;
  modo?: string;
}

/** Convierte un instrumento de la biblioteca a .sf2 y lo pone como pista. */
export interface PeticionInstrumento {
  sfz: string;
  nombre: string;
}

/** Ajuste de una pista por su nombre: es como se aplica una mezcla. */
export interface AjustePista {
  nombre: string;
  gainDb?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

/** Igualar la duracion de los clips (en compases) sin tocar el resto del proyecto. */
export interface PeticionIgualar {
  /** Compases que deben durar los clips. Si falta, se toma el clip mas largo. */
  compases?: number;
  /** Solo estas pistas (por nombre). Vacio = todas. */
  pistas?: string[];
}

/**
 * Crear un sonido: la voz sale del catálogo del motor y las palabras son el
 * vocabulario canónico («corto», «gordo», «sucio»), traducido a parámetros.
 */
export interface PeticionSonido {
  nombre: string;
  /** Clave de la voz en el catálogo (kick, metal_hit, cowbell…). */
  voz: string;
  /** Palabras del vocabulario, en el orden en que se dicen. */
  palabras?: string[];
  /** Valores concretos de parámetros de la voz (opcional). */
  args?: Record<string, number | boolean | number[]>;
}

/** Meter un sample de la biblioteca en el proyecto (clip + asset, normalizado). */
export interface PeticionSample {
  /** Ruta dentro de workspace/catalogo/ (la que devuelve buscar_sonido). */
  archivo: string;
  /** Nombre para el fichero y la pista; si falta, se saca del archivo. */
  nombre?: string;
  /** Duración del clip en compases (opcional: por defecto, lo que dure el audio). */
  compases?: number;
}

/** Escribir una progresión de acordes como notas en una pista. */
export interface PeticionProgresionPista extends PeticionProgresion {
  /** Pista destino (id o nombre). Si no existe, se crea con ese nombre. */
  pista: string;
  /** Instrumento de la pista si se crea (por defecto: bass para «bajo», pad para el resto). */
  instrumento?: string;
  /** Compás donde empieza, contando desde 1. */
  desdeCompas?: number;
}

export interface AccionesEstudio {
  leerProyecto(peticion: { clipId?: string }): ResultadoAccion;
  editarProyecto(peticion: { ops: unknown[] }): ResultadoAccion;
  escribirProgresion(peticion: PeticionProgresionPista): ResultadoAccion;
  crearProyecto(peticion: PeticionProyecto): Promise<ResultadoAccion>;
  anadirPistas(peticion: PeticionPistas): Promise<ResultadoAccion>;
  ajustarPistas(peticion: { pistas: AjustePista[] }): ResultadoAccion;
  igualarClips(peticion: PeticionIgualar): ResultadoAccion;
  crearSonido(peticion: PeticionSonido): Promise<ResultadoAccion>;
  usarSample(peticion: PeticionSample): Promise<ResultadoAccion>;
  usarInstrumento(peticion: PeticionInstrumento): Promise<ResultadoAccion>;
}

/**
 * El registro vive también en `globalThis`. Con el servidor de dev, editar
 * main.ts o este fichero puede dejar DOS copias del módulo cargadas a la vez: la
 * que registra (main) y la que el bucle del agente consulta. Sin esto, la app
 * dice «no puede crear proyectos» con la app perfectamente viva y el agente
 * reintenta en bucle. Pasó el 23-oct y costó 12 pasos.
 */
const almacen = globalThis as unknown as { __miuzikaAcciones?: AccionesEstudio | null };

export function registrarAcciones(acciones: AccionesEstudio | null): void {
  almacen.__miuzikaAcciones = acciones;
}

function acciones(): AccionesEstudio | null {
  return almacen.__miuzikaAcciones ?? null;
}

/** Herramientas que se resuelven en la pestaña, contra el proyecto abierto. */
const HERRAMIENTAS_DEL_PROYECTO = new Set([
  "leer_proyecto",
  "editar_proyecto",
  "escribir_progresion",
  "crear_proyecto",
  "anadir_pistas",
  "ajustar_pistas",
  "igualar_clips",
  "crear_sonido",
  "usar_sample",
  "usar_instrumento",
]);

/** Tope de un solo escribir_fichero (≈200 líneas). Ver el porqué en el case. */
const MAX_FICHERO = 8000;

/** Mensaje único para el caso «la app no tiene registradas sus acciones»: dice qué hacer. */
const SIN_REGISTRO =
  "La app no tiene registrada esta acción (pasa cuando el servidor de dev se reinicia o se " +
  "edita código con la pestaña abierta y quedan dos copias del módulo). NO lo reintentes: " +
  "pide al usuario que recargue la página (F5) y repite después.";
export const HERRAMIENTAS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "leer_proyecto",
      description:
        "Devuelve el estado REAL del proyecto abierto: tempo, compás, tonalidad, pistas con su id, " +
        "instrumento, ganancia, paneo, efectos (con sus parámetros) y clips (compás, duración, rango " +
        "de notas). Con `clip`, además las notas de ese clip. Léelo antes de editar: los ids que " +
        "devuelve son los que piden editar_proyecto y escribir_progresion.",
      parameters: {
        type: "object",
        properties: {
          clip: { type: "string", description: "Opcional: id de un clip (clp_3) para ver sus notas" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editar_proyecto",
      description:
        "Cambia el proyecto con operaciones validadas y TRANSACCIONALES: o entran todas o ninguna, y " +
        "se deshacen con Ctrl+Z. Es la forma directa de componer (notas), arreglar (clips), producir " +
        "(efectos) y mezclar (ganancia, paneo, master) sin escribir Python. trackId acepta id, nombre " +
        "exacto o número de pista. Notas: {pitch 0-127 (60 = C4), start y duration en negras desde " +
        "el inicio del clip, velocity 1-127}. startBar empieza en 0. Tipos de efecto: " +
        `${DEVICE_TYPES.join(", ")}. Instrumentos: ${INSTRUMENT_TYPES.join(", ")}. Operaciones:\n` +
        firmasDeOps(),
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "Lista de operaciones; cada una es un objeto con `op` y sus campos",
            items: { type: "object", properties: { op: { type: "string" } }, required: ["op"] },
          },
        },
        required: ["ops"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_progresion",
      description:
        "Escribe una progresión de acordes como notas MIDI en una pista (la crea si no existe), con " +
        "conducción de voces. Da `acordes` en cifrado americano (Am, F, C/E, G7, Bbmaj7, Dm7b5) o " +
        "`grados` de la tonalidad del proyecto (1-7). Patrones: bloque (acordes tenidos), pulso " +
        "(acordes repetidos cada `paso`), arpegio, alberti, bajo (fundamental o bajo del acorde con " +
        "barra). Para una base completa llámala varias veces: pad en bloque, bajo en «bajo», etc.",
      parameters: {
        type: "object",
        properties: {
          pista: { type: "string", description: "Id o nombre de la pista destino" },
          acordes: { type: "array", items: { type: "string" }, description: "Cifrado: ['Am','F','C','G']" },
          grados: { type: "array", items: { type: "integer" }, description: "Grados 1-7: [1,6,4,5]" },
          patron: { type: "string", enum: [...PATRONES] },
          compases_por_acorde: { type: "number", description: "Por defecto 1" },
          desde_compas: { type: "integer", description: "Compás de inicio, desde 1 (por defecto 1)" },
          octava: { type: "integer", description: "Octava (C4 = 60). Por defecto 4; en «bajo», 2" },
          paso: { type: "number", description: "Paso en negras para pulso/arpegio/bajo (0.5 = corcheas)" },
          velocidad: { type: "integer", description: "1-127, por defecto 90" },
          repeticiones: { type: "integer", description: "Veces que se repite la progresión (por defecto 1)" },
          instrumento: { type: "string", enum: [...INSTRUMENT_TYPES], description: "Si hay que crear la pista" },
        },
        required: ["pista"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_fichero",
      description:
        "Escribe o sobrescribe un fichero de texto dentro de 'workspace/'. El MOTOR YA EXISTE " +
        "en codigo/ (dsp, instruments, render, midi): NO lo reescribas ni redefinas sus " +
        "funciones, importalas. Un fichero nuevo que redefina un simbolo del motor es RECHAZADO " +
        "(409), igual que los scripts patch*/parche* (para eso esta editar_fichero). " +
        "Para un sample rapido: copia plantillas/one_shot.py y cambia PARAMS.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa dentro de workspace/, con /" },
          contenido: { type: "string", description: "Contenido completo del fichero" },
        },
        required: ["path", "contenido"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leer_fichero",
      description: "Devuelve el contenido de un fichero de workspace/ (hasta 20.000 caracteres).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_ficheros",
      description:
        "Lista los ficheros de la carpeta del proyecto abierto (o de la carpeta que pidas) con " +
        "su tamano en bytes. Usalo para comprobar que lo que has generado existe de verdad. " +
        "No lista el catalogo de samples: para eso esta buscar_sonido.",
      parameters: {
        type: "object",
        properties: {
          carpeta: {
            type: "string",
            description:
              "Opcional. Por defecto, la carpeta del proyecto. Otras: 'codigo', 'gpu', " +
              "'herramientas', 'plantillas', '_salidas' o '' (la raiz del espacio de trabajo).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ejecutar_python",
      description:
        "Ejecuta con Python un script que ya este en workspace/ ('codigo/render.py') y " +
        "devuelve su salida, sus errores y el codigo de salida. El directorio de trabajo " +
        "del proceso es la carpeta del proyecto y hay numpy disponible. Para trabajos largos " +
        "sube timeout_segundos (por defecto 300, maximo 1800). Con destino='lambda' el MISMO " +
        "script corre en una GPU de Lambda Cloud (la primera vez tarda ~3 min en arrancar la " +
        "maquina); los ficheros que escriba en salida/ vuelven solos al proyecto local.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del script dentro de workspace/" },
          argumentos: {
            type: "array",
            items: { type: "string" },
            description: "Argumentos de linea de comandos",
          },
          timeout_segundos: {
            type: "number",
            description: "Limite de tiempo en segundos (por defecto 300, maximo 1800)",
          },
          destino: {
            type: "string",
            enum: ["cpu", "lambda"],
            description:
              "Donde ejecutar: 'cpu' (este portatil) o 'lambda' (GPU en la nube). Si se omite " +
              "se usa lo que tenga elegido la persona en el panel; no lo cambies por tu cuenta.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editar_fichero",
      description:
        "Reemplaza un fragmento EXACTO de un fichero (busca -> reemplaza). Es la forma correcta " +
        "de corregir codigo existente: atomica, auditable y sin scripts de parche. Si el texto no " +
        "aparece devuelve 409; usa leer_fichero para copiar el fragmento exacto.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del fichero en workspace/" },
          busca: { type: "string", description: "Fragmento exacto a localizar (con su indentacion)" },
          reemplaza: { type: "string", description: "Texto por el que se sustituye (vacio para borrarlo)" },
          todas: { type: "boolean", description: "Reemplazar todas las apariciones (por defecto true)" },
        },
        required: ["path", "busca", "reemplaza"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_proyecto",
      description:
        "Crea un proyecto vacio en el DAW. Llamala SOLO despues de preguntar al usuario como quiere " +
        "llamarlo: su nombre es tambien el de su carpeta (proyectos/<nombre>/), y los ficheros que " +
        "escribas en 'salida/...' iran ahi. Si ya hay un proyecto abierto, no la uses.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre que ha pedido el usuario" },
          bpm: { type: "number", description: "Tempo (por defecto 120)" },
          compases: { type: "integer", description: "Duracion en compases (por defecto 32)" },
          tonica: { type: "string", description: "Tónica en notación americana: C, F#, Bb (re = D)" },
          modo: {
            type: "string",
            enum: [...MODE_NAMES],
            description: "Modo de la tonalidad (menor = minor, mayor = major)",
          },
        },
        required: ["nombre"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_voces",
      description:
        "Lista los timbres que sabe sintetizar el motor, con su familia y sus parametros (rango y " +
        "unidad). Es el catalogo real, leido del codigo: si una voz no sale aqui, no existe.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_sonido",
      description:
        "Busca en el catalogo del motor y en la biblioteca CC0 lo que pide el usuario en lenguaje natural. " +
        "Entiende los nombres habituales y los regionalismos (tarola = caja, hi-hat = charles, platillo " +
        "crash = crash) y el caracter medido (corto, largo, seco, brillante, oscuro, grave, agudo, sucio, " +
        "limpio). Usala para elegir un sample o un timbre concreto ANTES de crearlo. Para componer " +
        "notas NO hace falta: las pistas MIDI ya suenan con los instrumentos del DAW. Una o dos " +
        "consultas bastan; no la repitas con sinónimos.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description:
              "La petición en español o en inglés (el índice está en esos dos idiomas): si el usuario " +
              "escribe en otro idioma, tradúcela tú, p. ej. «短くて汚いチャイナ» → 'china sucio y corto'.",
          },
          familia: {
            type: "string",
            enum: ["percusión", "tonal", "textura", "ruido", "efecto"],
            description: "Opcional: acota a una familia",
          },
        },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "usar_sample",
      description:
        "Mete en el proyecto un sample de la biblioteca CC0 (los 4.231 ficheros de VCSL) como pista de " +
        "audio: lo convierte a 44,1k/16b, lo normaliza a -1 dBFS y lo deja en proyectos/<slug>/samples/. " +
        "Usalo despues de buscar_sonido, con la ruta que devuelve.",
      parameters: {
        type: "object",
        properties: {
          archivo: {
            type: "string",
            description: "Ruta del sample dentro de workspace/catalogo/ (la que da buscar_sonido)",
          },
          nombre: { type: "string", description: "Nombre del fichero y de la pista" },
          compases: { type: "integer", description: "Duracion del clip en compases (opcional)" },
        },
        required: ["archivo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "medir_referencia",
      description:
        "Mide una canción de referencia y devuelve tempo, tonalidad, duración, compases y la " +
        "curva de energía por bloques de 4 compases, más el carácter en palabras. Acepta un " +
        "enlace de YouTube o la ruta de un audio. NO saca la melodía ni los acordes: si hay que " +
        "tocar el tema, la melodía tiene que venir de otro sitio.",
      parameters: {
        type: "object",
        properties: {
          origen: {
            type: "string",
            description: "Enlace de YouTube o ruta de un audio dentro de workspace/",
          },
        },
        required: ["origen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "usar_instrumento",
      description:
        "Convierte un instrumento de la biblioteca (.sfz de VCSL) en un SoundFont dentro del proyecto y " +
        "crea su pista MIDI. ESTA es la forma de tener un instrumento afinado: usa sus 46 regiones y la " +
        "raíz que declara el SFZ. NO cojas un solo sample y lo estires para tocar varias notas: suena a " +
        "armonica y desafina (medido: +1054 cents). Después escribe sus notas con escribir_progresion o " +
        "editar_proyecto (add_notes) sobre la pista que crea.",
      parameters: {
        type: "object",
        properties: {
          sfz: {
            type: "string",
            description: "Ruta del .sfz dentro de workspace/catalogo/ (p. ej. catalogo/VCSL-1.2.2-RC/Aerophones/Reed Aerophones/Tenor Saxophone - Non-Vibrato.sfz)",
          },
          nombre: { type: "string", description: "Nombre del instrumento y de la pista" },
        },
        required: ["sfz", "nombre"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_sonido",
      description:
        "Crea un sonido de verdad y lo guarda en el proyecto: elige una voz del catalogo, aplica las " +
        "palabras del usuario (corto, gordo, sucio...) y renderiza el WAV. Si el usuario pide un sonido " +
        "que no existe como voz, usa crear_voz.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del sonido; tambien el del fichero" },
          voz: { type: "string", description: "Clave de la voz del catalogo (kick, snare, metal_hit...)" },
          palabras: {
            type: "array",
            items: { type: "string", enum: PALABRAS.map((p) => p.clave) },
            description:
              "Vocabulario canónico del sistema. El usuario lo dirá en su idioma («punchy», «kurz», " +
              "«短い»…): tradúcelo tú a estas claves, en el orden en que lo dice.",
          },
          args: {
            type: "object",
            description: "Parametros de la voz, solo si hace falta precision (dur, pitch, midi...)",
          },
        },
        required: ["nombre", "voz"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_voz",
      description:
        "Anade un timbre NUEVO al motor: escribes la funcion de Python, se renderiza, se mide y, si " +
        "pasa la puerta (duracion 0,05-16 s, RMS > -60 dBFS, crest 2-30 dB, DC < 0,01, reproducible, " +
        "< 3 s), queda en instruments.py para siempre y aparece en el catalogo. Si no pasa, te devuelve " +
        "las medidas para que la corrijas. Usala solo cuando listar_voces no tenga lo que piden.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre de la funcion: minusculas, letras/numeros/_, 3-31" },
          destino: {
            type: "string",
            enum: ["cpu", "gpu"],
            description:
              "cpu: numpy local, gratis e instantaneo. gpu: torch en Lambda (1,29 $/h, ~3 min de " +
              "arranque); usalo solo si la voz necesita torch o un render pesado. Pregunta antes.",
          },
          fuente: {
            type: "string",
            description:
              "Codigo Python COMPLETO de la funcion, con imports (numpy, dsp, instruments o torch) y docstring " +
              "obligatorio: primera linea = descripcion, luego 'familia: percusion|tonal|ruido|textura' y " +
              "una linea por parametro 'nombre: min..max Etiqueta (unidad)' o 'nombre: bool Etiqueta'. " +
              "Todos los parametros con valor por defecto y deterministas por 'seed'.",
          },
        },
        required: ["nombre", "fuente"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "igualar_clips",
      description:
        "Iguala la duracion de TODOS los clips del proyecto (MIDI y audio) al mismo numero de compases. " +
        "Usalo cuando el usuario diga que los clips no acaban igual o cuando el MIDI y el WAV de un mismo " +
        "instrumento terminen en compases distintos. No toca ni notas, ni niveles, ni el tempo.",
      parameters: {
        type: "object",
        properties: {
          compases: {
            type: "integer",
            description: "Compases que deben durar todos los clips. Si no lo dices, se usa el clip mas largo.",
          },
          pistas: {
            type: "array",
            items: { type: "string" },
            description: "Solo estas pistas (por nombre). Vacio = todo el proyecto.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "anadir_pistas",
      description:
        "Crea pistas REALES en el proyecto del DAW: cada .mid entra como pista MIDI con sus notas y cada " +
        ".wav como pista de audio. Es la entrega de una cancion: deja los ficheros en salida/ y llamala. " +
        "NO masterices ni normalices la mezcla final: el master se hace en el DAW.",
      parameters: {
        type: "object",
        properties: {
          midis: {
            type: "array",
            items: { type: "string" },
            description: "Rutas .mid de workspace/ (p.ej. ['salida/tema_multitrack.mid'])",
          },
          wavs: {
            type: "array",
            items: { type: "string" },
            description: "Rutas .wav para pistas de audio (cada minuto estereo ocupa ~10 MB de RAM)",
          },
          inicio_compas: {
            type: "integer",
            description: "Compas donde empiezan las pistas (0 = principio)",
          },
          compases: {
            type: "integer",
            description:
              "Duracion de la toma en COMPASES (p.ej. 80). Todos los clips que anadas duran eso, " +
              "tanto los MIDI como los WAV: asi acaban en el mismo compas. Ponlo siempre que lo sepas.",
          },
          nombre_proyecto: {
            type: "string",
            description:
              "Solo si NO hay proyecto abierto: el nombre que ha pedido el usuario. Si no lo sabes, " +
              "preguntamelo en el chat antes de llamar (no inventes el nombre).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ajustar_pistas",
      description:
        "Cambia gainDb, paneo, mute o solo de las pistas del proyecto, por su nombre. " +
        "Es LA forma de aplicar una mezcla elegida sin tocar la sintesis: el cambio es " +
        "un op, se puede deshacer con Ctrl+Z y el audio se reajusta en el momento. " +
        "Los nombres son los que se ven en la lista de pistas (Bombo, Bajo, Pad...).",
      parameters: {
        type: "object",
        properties: {
          pistas: {
            type: "array",
            description: "Una entrada por pista a tocar",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Nombre de la pista (tal como se ve)" },
                gainDb: { type: "number", description: "Ganancia en dB (-60 a +12)" },
                pan: { type: "number", description: "Paneo -1 (izquierda) a +1 (derecha)" },
                muted: { type: "boolean" },
                solo: { type: "boolean" },
              },
              required: ["nombre"],
            },
          },
        },
        required: ["pistas"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verificar_audio",
      description:
        "Mide un WAV de workspace/ y devuelve formato, duracion, pico, RMS, crest, DC, muestras " +
        "clipeadas y correlacion estereo. Usala en vez de escribir tu propio analizador.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del WAV en workspace/" },
          timeout_segundos: {
            type: "number",
            description: "Cuanto puede tardar la medida (por defecto 180, maximo 1800)",
          },
        },
        required: ["path"],
      },
    },
  },
];

async function ejecutarCrudo(
  nombre: string,
  argumentosJson: string,
  senal?: AbortSignal,
): Promise<ResultadoHerramienta> {
  let args: Record<string, unknown> = {};
  try {
    args = argumentosJson.trim() === "" ? {} : (JSON.parse(argumentosJson) as Record<string, unknown>);
  } catch (error) {
    return {
      ok: false,
      texto: `Los argumentos no son JSON valido: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Las que cambian o leen el proyecto se ejecutan en la pestaña (ver registrarAcciones).
  const registradas = acciones();
  if (!registradas && HERRAMIENTAS_DEL_PROYECTO.has(nombre)) return { ok: false, texto: SIN_REGISTRO };
  const local = registradas as AccionesEstudio;

  try {
    switch (nombre) {
      case "escribir_fichero": {
        // Un fichero de 9.700 tokens de una sola vez (medido el 25-oct) hace que el
        // proveedor corte el turno siguiente con finish_reason 'load'. El tope es
        // mecánico a propósito: pedirlo por prompt no funcionó.
        const contenido = String(args.contenido ?? "");
        if (contenido.length > MAX_FICHERO) {
          return {
            ok: false,
            texto:
              `Demasiado largo: ${contenido.length} caracteres (el tope son ${MAX_FICHERO}). ` +
              "Escribe el fichero en trozos: primero la estructura y las funciones base, y " +
              "luego añade el resto con editar_fichero (busca/reemplaza) o con un segundo " +
              "escribir_fichero a otro fichero si son cosas distintas.",
          };
        }
        const datos = await pedirJson("/api/fs/write", {
          path: args.path,
          contenido: args.contenido,
        });
        // `nota` dice si el motor pasó el smoke test (o que en gpu/ sólo se ha
        // comprobado la sintaxis): es la prueba de que el cambio es seguro.
        const nota = typeof datos.nota === "string" && datos.nota !== "" ? ` ${datos.nota}` : "";
        return { ok: true, texto: `Escrito ${datos.path} (${datos.bytes} bytes).${nota}` };
      }
      case "leer_fichero": {
        const datos = await pedirJson("/api/fs/read", { path: args.path });
        return { ok: true, texto: String(datos.contenido ?? "") };
      }
      case "listar_ficheros": {
        const carpeta = typeof args.carpeta === "string" ? args.carpeta.trim() : "";
        const consulta = carpeta === "" ? "/api/fs/list" : `/api/fs/list?carpeta=${encodeURIComponent(carpeta)}`;
        const datos = await pedirJson(consulta, undefined, 30000, senal);
        const ficheros = (datos.ficheros ?? []) as { path: string; bytes: number }[];
        const donde = String(datos.carpeta ?? ".");
        if (ficheros.length === 0) {
          return { ok: true, texto: `No hay ficheros en ${donde}/.` };
        }
        const total = ficheros.reduce((suma, f) => suma + f.bytes, 0);
        const truncado = datos.truncado === true;
        return {
          ok: true,
          texto:
            `${ficheros.length}${truncado ? "+ (cortado)" : ""} fichero(s) en ${donde}/ ` +
            `(${(total / 1024).toFixed(0)} KB):\n` +
            ficheros.map((f) => `${f.path} (${f.bytes} B)`).join("\n") +
            (truncado
              ? "\n[La lista está cortada: pide una carpeta más concreta (p. ej. 'salida').]"
              : ""),
        };
      }
      case "editar_fichero": {
        const datos = await pedirJson("/api/fs/edit", {
          path: args.path,
          busca: args.busca,
          reemplaza: args.reemplaza,
          todas: args.todas,
        });
        return { ok: true, texto: `Editado ${datos.path}: ${datos.reemplazos} reemplazo(s).` };
      }
      case "crear_proyecto": {
        const tonica = typeof args.tonica === "string" ? args.tonica.trim() : "";
        const modo = typeof args.modo === "string" ? args.modo.trim() : "";
        return local.crearProyecto({
          nombre: String(args.nombre ?? "").trim(),
          bpm: Number(args.bpm ?? 120) || 120,
          compases: Number(args.compases ?? 32) || 32,
          ...(tonica ? { tonica } : {}),
          ...(modo ? { modo } : {}),
        });
      }
      case "listar_voces": {
        try {
          const datos = (await pedirJson("/api/voces", undefined, 240000, senal)) as {
            voces?: {
              clave: string;
              familia: string;
              descripcion: string;
              excluida?: string | null;
              params: { clave: string; min?: number; max?: number; unidad?: string }[];
            }[];
          };
          const lineas = (datos.voces ?? []).map((voz) => {
            if (voz.excluida) return `- ${voz.clave}: NO USABLE (${voz.excluida})`;
            const params = voz.params
              .map((p) =>
                p.min === undefined ? p.clave : `${p.clave} ${p.min}..${p.max}${p.unidad ? " " + p.unidad : ""}`,
              )
              .join(", ");
            return `- ${voz.clave} [${voz.familia}${(voz as { destino?: string }).destino === "gpu" ? ", GPU" : ""}] ${voz.descripcion} (${params})`;
          });
          return { ok: true, texto: `Voces del motor (${lineas.length}):\n${lineas.join("\n")}` };
        } catch (error) {
          return {
            ok: false,
            texto: "No pude leer el catalogo: " + (error instanceof Error ? error.message : String(error)),
          };
        }
      }
      case "buscar_sonido": {
        const consulta = String(args.consulta ?? "").trim();
        if (consulta === "") return { ok: false, texto: "falta la consulta" };
        try {
          // Medir las 16 voces cuesta ~2 s: sólo se pide si la consulta lleva una
          // palabra de carácter (corto, brillante…), que es cuando hace falta.
          const pideCaracter = /\b(corto|largo|seco|brillante|oscuro|grave|agudo|sucio|limpio|redondo|apagado|chillon|metalico|short|long|dry|bright|dark|low|deep|high|dirty|clean)\b/i.test(
            consulta,
          );
          const datos = (await pedirJson(
            pideCaracter ? "/api/voces?medir=1" : "/api/voces",
            undefined,
            240000,
            senal,
          )) as {
            voces?: {
              clave: string;
              etiqueta: string;
              familia: string;
              descripcion: string;
              destino?: string;
              excluida?: string | null;
              perfil?: Record<string, number>;
            }[];
          };
          const catalogo: EntradaCatalogo[] = (datos.voces ?? [])
            .filter((voz) => !voz.excluida)
            .map((voz) => ({
              clave: voz.clave,
              etiqueta: voz.etiqueta,
              familia: voz.familia,
              descripcion: voz.descripcion,
              destino: voz.destino === "gpu" ? "gpu" : "cpu",
              perfil: voz.perfil,
            }));
          // La biblioteca CC0 (4.231 samples), buscada en el servidor.
          let biblioteca: string[] = [];
          try {
            const rc = await pedir("/api/catalogo/buscar", {
              cuerpo: { consulta, limite: 6 },
              limiteMs: 30000,
              senal,
            });
            if (rc.ok) {
              const dc = (await rc.json()) as {
                resultados?: {
                  archivo: string;
                  instrumento: string;
                  familia: string;
                  strudel: string | null;
                  perfil?: Record<string, number>;
                }[];
              };
              biblioteca = (dc.resultados ?? []).map((r) => {
                const p = r.perfil ?? {};
                const medidas = [
                  p.duracion_s !== undefined ? `${p.duracion_s} s` : "",
                  p.centroide_hz !== undefined ? `${Math.round(p.centroide_hz)} Hz` : "",
                ]
                  .filter((x) => x !== "")
                  .join(", ");
                return (
                  `- ${r.archivo} (${r.instrumento}, ${r.familia}) [${medidas}]` +
                  (r.strudel ? ` · en Strudel: s("${r.strudel}")` : "")
                );
              });
            }
          } catch {
            /* sin biblioteca: se sigue con las voces del motor */
          }

          const encontrados = buscarEnCatalogo(catalogo, consulta, {
            ...(typeof args.familia === "string" ? { familia: args.familia } : {}),
            limite: 6,
          });
          const etiquetas = etiquetasEnFrase(consulta).map((e) => e.id);
          if (encontrados.length === 0) {
            return {
              ok: true,
              texto:
                `No hay nada parecido a "${consulta}" en el catalogo` +
                (etiquetas.length > 0 ? ` (lo mas cercano por etiqueta: ${etiquetas.join(", ")})` : "") +
                ". Puedes crearlo con crear_sonido si existe una voz que sirva, o con crear_voz si no.",
            };
          }
          const lineas = encontrados.map((r) => {
            const p = r.entrada.perfil ?? {};
            const medidas = [
              p.duracion_s !== undefined ? `${p.duracion_s} s` : "",
              p.centroide_hz !== undefined ? `${Math.round(p.centroide_hz)} Hz` : "",
              p.crest_db !== undefined ? `crest ${p.crest_db} dB` : "",
            ]
              .filter((x) => x !== "")
              .join(", ");
            return `- ${r.entrada.clave} (${r.entrada.familia}, ${r.entrada.destino}): ${r.entrada.descripcion} [${medidas}] (${r.motivos.join("; ")})`;
          });
          const partes = [
            `Candidatos para "${consulta}":`,
            lineas.join("\n"),
            biblioteca.length > 0
              ? `\nEn la biblioteca CC0 (${biblioteca.length}):\n${biblioteca.join("\n")}\nPara meterlo: usar_sample(archivo="...").`
              : "",
            "Para sintetizar uno nuevo: crear_sonido con la voz que elijas.",
          ].filter((x) => x !== "");
          return { ok: true, texto: partes.join("\n") };
        } catch (error) {
          return { ok: false, texto: "No pude buscar: " + (error instanceof Error ? error.message : String(error)) };
        }
      }
      case "medir_referencia": {
        const origen = String(args.origen ?? "").trim();
        if (!origen) return { ok: false, texto: "Falta el enlace o la ruta de la referencia." };
        const res = await pedir("/api/referencia/medir", {
          cuerpo: { origen },
          // Descargar de YouTube y analizar 4 minutos: el servidor da 900 s.
          limiteMs: 900000,
          senal,
        });
        const datos = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
        if (!datos.ok) return { ok: false, texto: `No se pudo medir: ${datos.error ?? res.status}` };
        const linea =
          `${datos.duracion_s} s · ${datos.tempo_bpm} BPM · ` +
          (datos.tonalidad && (datos.tonalidad as { tonica?: string }).tonica
            ? `${(datos.tonalidad as { tonica: string }).tonica} ${(datos.tonalidad as { modo: string }).modo}`
            : "sin tonalidad clara") +
          ` · ${datos.compases} compases\n` +
          `carácter: ${(datos.palabras as string[])?.join(", ") ?? ""}\n` +
          `forma (energía por 4 compases): ${JSON.stringify(datos.forma)}`;
        return { ok: true, texto: linea };
      }
      case "usar_instrumento":
        return local.usarInstrumento({
          sfz: String(args.sfz ?? "").trim(),
          nombre: String(args.nombre ?? "").trim() || "instrumento",
        });
      case "usar_sample":
        return local.usarSample({
          archivo: String(args.archivo ?? "").trim(),
          ...(typeof args.nombre === "string" && args.nombre.trim() !== ""
            ? { nombre: args.nombre.trim() }
            : {}),
          ...(Number(args.compases) > 0 ? { compases: Math.trunc(Number(args.compases)) } : {}),
        });
      case "crear_sonido": {
        const argsSonido =
          typeof args.args === "object" && args.args !== null
            ? (args.args as Record<string, number | boolean | number[]>)
            : undefined;
        return local.crearSonido({
          nombre: String(args.nombre ?? "").trim(),
          voz: String(args.voz ?? "").trim(),
          ...(Array.isArray(args.palabras) ? { palabras: (args.palabras as unknown[]).map(String) } : {}),
          ...(argsSonido ? { args: argsSonido } : {}),
        });
      }
      case "crear_voz": {
        const nombre = String(args.nombre ?? "").trim().toLowerCase();
        const fuente = String(args.fuente ?? "");
        if (nombre === "" || fuente.trim() === "") {
          return { ok: false, texto: "faltan nombre o fuente" };
        }
        try {
          const destino = args.destino === "gpu" ? "gpu" : "cpu";
          const res = await pedir("/api/voces/nueva", {
            cuerpo: { nombre, fuente, destino },
            // En GPU la puerta renderiza en Lambda: 900 s de tope alli.
            limiteMs: destino === "gpu" ? 960000 : 120000,
            senal,
          });
          const datos = (await res.json()) as {
            ok?: boolean;
            motivos?: string[];
            voz?: { clave?: string; familia?: string; params?: { clave: string }[] };
            perfil?: Record<string, number>;
            total?: number;
            traza?: string | null;
          };
          if (!res.ok || !datos.ok) {
            const perfil =
              datos.perfil && Object.keys(datos.perfil).length > 0
                ? ` Medidas: ${Object.entries(datos.perfil)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" ")}`
                : "";
            return {
              ok: false,
              texto: `La puerta la rechaza: ${(datos.motivos ?? [`HTTP ${res.status}`]).join("; ")}.${perfil}`,
            };
          }
          return {
            ok: true,
            texto:
              `Voz "${datos.voz?.clave ?? nombre}" anadida al motor de ${destino.toUpperCase()} (familia ${datos.voz?.familia ?? "?"}, ` +
              `parametros: ${(datos.voz?.params ?? []).map((p) => p.clave).join(", ")}). Catalogo: ${datos.total ?? "?"} voces. ` +
              `Ya se puede usar con crear_sonido.`,
          };
        } catch (error) {
          return { ok: false, texto: "No pude llamar a la puerta: " + (error instanceof Error ? error.message : String(error)) };
        }
      }
      case "igualar_clips":
        return local.igualarClips({
          ...(Number(args.compases) > 0 ? { compases: Math.trunc(Number(args.compases)) } : {}),
          ...(Array.isArray(args.pistas) ? { pistas: (args.pistas as unknown[]).map(String) } : {}),
        });
      case "anadir_pistas":
        return local.anadirPistas({
          midis: Array.isArray(args.midis) ? (args.midis as unknown[]).map(String) : [],
          wavs: Array.isArray(args.wavs) ? (args.wavs as unknown[]).map(String) : [],
          inicioCompas: Number(args.inicio_compas ?? 0) || 0,
          ...(Number(args.compases) > 0 ? { compases: Math.trunc(Number(args.compases)) } : {}),
          ...(typeof args.nombre_proyecto === "string" && args.nombre_proyecto.trim() !== ""
            ? { nombreProyecto: args.nombre_proyecto.trim() }
            : {}),
        });
      case "ajustar_pistas": {
        const lista = Array.isArray(args.pistas) ? (args.pistas as Record<string, unknown>[]) : [];
        if (lista.length === 0) return { ok: false, texto: "No has dicho ninguna pista." };
        const pistas: AjustePista[] = lista.map((p) => {
          const ajuste: AjustePista = { nombre: String(p.nombre ?? "").trim() };
          if (typeof p.gainDb === "number") ajuste.gainDb = p.gainDb;
          if (typeof p.pan === "number") ajuste.pan = p.pan;
          if (typeof p.muted === "boolean") ajuste.muted = p.muted;
          if (typeof p.solo === "boolean") ajuste.solo = p.solo;
          return ajuste;
        });
        return local.ajustarPistas({ pistas });
      }
      case "leer_proyecto":
        return local.leerProyecto(typeof args.clip === "string" && args.clip.trim() !== "" ? { clipId: args.clip.trim() } : {});
      case "editar_proyecto": {
        const ops = Array.isArray(args.ops) ? (args.ops as unknown[]) : [];
        if (ops.length === 0) return { ok: false, texto: "Falta `ops`: una lista de operaciones (ver la descripción de la herramienta)." };
        return local.editarProyecto({ ops });
      }
      case "escribir_progresion": {
        const lista = (valor: unknown): unknown[] | undefined => (Array.isArray(valor) ? valor : undefined);
        const numero = (valor: unknown): number | undefined =>
          typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
        const acordes = lista(args.acordes)?.map(String);
        const grados = lista(args.grados)?.map(Number);
        const patron = PATRONES.find((p) => p === args.patron);
        const peticion: PeticionProgresionPista = { pista: String(args.pista ?? "").trim() || "Acordes" };
        if (acordes && acordes.length > 0) peticion.acordes = acordes;
        if (grados && grados.length > 0) peticion.grados = grados;
        if (patron) peticion.patron = patron;
        const opcionales: [keyof PeticionProgresionPista, unknown][] = [
          ["compasesPorAcorde", numero(args.compases_por_acorde)],
          ["octava", numero(args.octava)],
          ["paso", numero(args.paso)],
          ["velocidad", numero(args.velocidad)],
          ["repeticiones", numero(args.repeticiones)],
          ["desdeCompas", numero(args.desde_compas)],
        ];
        for (const [clave, valor] of opcionales) if (valor !== undefined) (peticion as unknown as Record<string, unknown>)[clave] = valor;
        if (typeof args.instrumento === "string") peticion.instrumento = args.instrumento;
        return local.escribirProgresion(peticion);
      }
      case "verificar_audio": {
        const tope = Number(args.timeout_segundos);
        const datos = await pedirJson(
          "/api/verificar",
          { path: args.path },
          Number.isFinite(tope) && tope > 0 ? tope * 1000 + 45000 : 225000,
          senal,
        );
        return { ok: datos.ok === true, texto: String(datos.informe ?? "(sin informe)") };
      }
      case "ejecutar_python": {
        const segundos = Number(args.timeout_segundos) || 300;
        const destino: Destino =
          args.destino === "lambda" || args.destino === "cpu" ? args.destino : destinoPreferido;
        // En Lambda el primer arranque son ~3 minutos: el limite del cliente lo cubre.
        const margen = destino === "lambda" ? segundos * 1000 + 15 * 60 * 1000 : segundos * 1000 + 45000;
        const datos = await pedirJson(
          destino === "lambda" ? "/api/run/lambda" : "/api/run/python",
          {
            path: args.path,
            argumentos: args.argumentos,
            timeout_segundos: args.timeout_segundos,
          },
          margen,
          senal,
        );
        const salida = String(datos.salida ?? "").trim();
        const errores = String(datos.errores ?? "").trim();
        const partes = [
          `${destino === "lambda" ? "GPU" : "CPU"}: exit=${datos.codigo} en ${datos.ms} ms`,
        ];
        if (destino === "lambda") {
          const info = (datos.lambda ?? {}) as { ip?: string; traidos?: string[]; nota?: string };
          const traidos = Array.isArray(info.traidos) ? info.traidos : [];
          partes.push(
            `maquina ${String(info.ip ?? "?")} (${String(info.nota ?? "")})` +
              (traidos.length > 0 ? `; devueltos: ${traidos.join(", ")}` : ""),
          );
        }
        const escritos = Array.isArray(datos.escritos) ? (datos.escritos as string[]) : [];
        if (escritos.length > 0) {
          partes.push(
            `ficheros escritos: ${escritos.slice(0, 12).join(", ")}` +
              (escritos.length > 12 ? ` y ${escritos.length - 12} mas` : ""),
          );
        }
        if (salida !== "") partes.push(`salida:\n${salida}`);
        if (errores !== "") partes.push(`errores:\n${errores}`);
        return { ok: datos.ok === true, texto: partes.join("\n") };
      }
      default:
        return { ok: false, texto: `Herramienta desconocida: ${nombre}` };
    }
  } catch (error) {
    const abortado = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      texto: abortado
        ? "Se agoto el tiempo de espera de la herramienta y se corto el proceso."
        : `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Resumen de una llamada, para ensenarlo en el chat. */
export function resumenLlamada(nombre: string, argumentosJson: string): string {
  try {
    const args = JSON.parse(argumentosJson === "" ? "{}" : argumentosJson) as Record<string, unknown>;
    if (nombre === "escribir_fichero") {
      return `${nombre}(${String(args.path)}, ${String(args.contenido ?? "").length} chars)`;
    }
    if (nombre === "ejecutar_python") {
      const extra = args.argumentos ? ` ${JSON.stringify(args.argumentos)}` : "";
      const gpu = args.destino === "lambda" ? "@lambda" : "";
      return `${nombre}${gpu}(${String(args.path)}${extra})`;
    }
    if (nombre === "leer_fichero") return `${nombre}(${String(args.path)})`;
    if (nombre === "editar_fichero") return `${nombre}(${String(args.path)}, ${String(args.busca).length} chars)`;
    if (nombre === "verificar_audio") return `${nombre}(${String(args.path)})`;
    if (nombre === "ajustar_pistas") {
      const n = Array.isArray(args.pistas) ? (args.pistas as unknown[]).length : 0;
      return `${nombre}(${n} pista(s))`;
    }
    if (nombre === "anadir_pistas") {
      const m = Array.isArray(args.midis) ? (args.midis as unknown[]).length : 0;
      const w = Array.isArray(args.wavs) ? (args.wavs as unknown[]).length : 0;
      return `${nombre}(${m} midi, ${w} wav)`;
    }
    return nombre;
  } catch {
    return nombre;
  }
}

/**
 * Salida completa de una herramienta -> `_salidas/` en la raíz del espacio de
 * trabajo, NO dentro del proyecto: si el agente crea un proyecto nuevo a mitad de
 * turno, los ficheros de antes tienen que seguir encontrándose (pasó: 4 lecturas
 * «no existe» porque se habían escrito en el proyecto anterior). Se le pasa al
 * modelo sólo la cabeza y la cola: un render imprime cientos de líneas y
 * arrastrarlas en el contexto encarece cada turno y lo distrae.
 */
async function guardarSalidaLarga(nombre: string, texto: string): Promise<string> {
  const fichero = `_salidas/${nombre}_${Date.now().toString(36)}.txt`;
  const res = await fetch("/api/fs/write", {
    method: "POST",
    headers: cabecerasProyecto({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path: fichero, contenido: texto }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return fichero;
}

/**
 * Ejecuta una herramienta y deja el resultado listo para el modelo: si la salida
 * es larga se recorta y el texto entero se guarda en el proyecto para poder
 * releerlo con `leer_fichero`.
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentosJson: string,
  senal?: AbortSignal,
): Promise<ResultadoHerramienta> {
  const resultado = await ejecutarCrudo(nombre, argumentosJson, senal);
  if (resultado.texto.length <= UMBRAL_SALIDA) return resultado;

  let aviso: string;
  try {
    const fichero = await guardarSalidaLarga(nombre, resultado.texto);
    aviso = `\n[Salida completa (${resultado.texto.length} caracteres) en ${fichero}: léela con leer_fichero si la necesitas]`;
  } catch {
    aviso = `\n[Salida recortada de ${resultado.texto.length} caracteres: no se pudo guardar entera]`;
  }
  return { ...resultado, texto: recortarSalida(resultado.texto) + aviso };
}
