/**
 * Herramientas del agente: sus "manos".
 *
 * El navegador no toca el disco: pide al servidor de desarrollo, que es quien
 * ejecuta y escribe, y SIEMPRE dentro de <proyecto>/workspace. Los esquemas de
 * abajo son los que ve el LLM.
 */

import type { ToolSpec } from "../llm.ts";

export interface ResultadoHerramienta {
  ok: boolean;
  /** Texto que vuelve al modelo como resultado de la herramienta. */
  texto: string;
}

/** Peticion con limite de tiempo: el chat nunca se queda colgado esperando. */
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

export function getDestino(): Destino {
  return destinoPreferido;
}

/** Cabeceras con el proyecto activo (lo usa tambien main.ts). */
export function cabecerasProyecto(extra?: Record<string, string>): Record<string, string> {
  return { "x-miuzika-proyecto": proyectoActivo, ...(extra ?? {}) };
}

async function pedirJson(
  ruta: string,
  cuerpo?: unknown,
  limiteMs = 45000,
  externo?: AbortSignal,
): Promise<Record<string, unknown>> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), limiteMs);
  // Cancelar el turno tiene que cortar también la petición en vuelo.
  const alAbortar = (): void => control.abort();
  externo?.addEventListener("abort", alAbortar, { once: true });
  try {
    const res = await fetch(ruta, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: cabecerasProyecto(
        cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      ),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
    const texto = await res.text();
    const datos = texto === "" ? {} : (JSON.parse(texto) as Record<string, unknown>);
    if (!res.ok) throw new Error(String(datos.error ?? `HTTP ${res.status}`));
    return datos;
  } finally {
    clearTimeout(temporizador);
    externo?.removeEventListener("abort", alAbortar);
  }
}

/** Peticion de pistas reales al proyecto del DAW (se ejecuta en el navegador). */
export interface PeticionPistas {
  midis: string[];
  wavs: string[];
  inicioCompas: number;
  /** Nombre del proyecto si hay que crearlo (lo pregunta el agente al usuario). */
  nombreProyecto?: string;
}

type ImportadorLocal = (peticion: PeticionPistas) => Promise<{ ok: boolean; texto: string }>;

let importadorLocal: ImportadorLocal | null = null;

export interface PeticionProyecto {
  nombre: string;
  bpm: number;
  compases: number;
}

type CreadorProyecto = (peticion: PeticionProyecto) => { ok: boolean; texto: string };

let creadorProyecto: CreadorProyecto | null = null;

/**
 * El registro vive también en `globalThis`. Con el servidor de dev, editar
 * main.ts o este fichero puede dejar DOS copias del módulo cargadas a la vez: la
 * que registra (main) y la que el bucle del agente consulta. Sin esto, la app
 * dice «no puede crear proyectos» con la app perfectamente viva y el agente
 * reintenta en bucle. Pasó el 23-oct y costó 12 pasos.
 */
interface RegistroGlobal {
  creador?: CreadorProyecto | null;
  importador?: ImportadorLocal | null;
  ajustador?: Ajustador | null;
}

const registro: RegistroGlobal =
  ((globalThis as unknown as { __miuzikaHerramientas?: RegistroGlobal }).__miuzikaHerramientas ??= {});

/** main.ts registra aqui como se crea un proyecto con nombre. */
export function registrarCreador(fn: CreadorProyecto | null): void {
  creadorProyecto = fn;
  registro.creador = fn;
}

/** main.ts registra aqui como se crean pistas de verdad (necesita el proyecto). */
export function registrarImportador(fn: ImportadorLocal | null): void {
  importadorLocal = fn;
  registro.importador = fn;
}

/** Ajuste de una pista por su nombre: es como se aplica una mezcla. */
export interface AjustePista {
  nombre: string;
  gainDb?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

type Ajustador = (peticion: { pistas: AjustePista[] }) => { ok: boolean; texto: string };

let ajustador: Ajustador | null = null;

/** main.ts registra aqui como se mueven los faders (necesita el proyecto). */
export function registrarAjustador(fn: Ajustador | null): void {
  ajustador = fn;
  registro.ajustador = fn;
}

/** Lo registrado, mirando primero lo local y después el registro compartido. */
const herramientaLocal = {
  creador: (): CreadorProyecto | null => creadorProyecto ?? registro.creador ?? null,
  importador: (): ImportadorLocal | null => importadorLocal ?? registro.importador ?? null,
  ajustador: (): Ajustador | null => ajustador ?? registro.ajustador ?? null,
};

/** Mensaje único para el caso «la app no tiene este registro»: dice qué hacer. */
const SIN_REGISTRO =
  "La app no tiene registrada esta acción (pasa cuando el servidor de dev se reinicia o se " +
  "edita código con la pestaña abierta y quedan dos copias del módulo). NO lo reintentes: " +
  "pide al usuario que recargue la página (F5) y repite después.";

export const HERRAMIENTAS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "escribir_fichero",
      description:
        "Escribe o sobrescribe un fichero de texto dentro de 'workspace/'. El MOTOR YA EXISTE " +
        "en codigo/ (dsp, instruments, render, midi, cancion): NO lo reescribas ni redefinas sus " +
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
        "Lista los ficheros de workspace/ con su tamano en bytes. Usalo para comprobar " +
        "que lo que has generado existe de verdad.",
      parameters: { type: "object", properties: {} },
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
        },
        required: ["nombre"],
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
        properties: { path: { type: "string", description: "Ruta del WAV en workspace/" } },
        required: ["path"],
      },
    },
  },
];

export async function ejecutarHerramienta(
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

  try {
    switch (nombre) {
      case "escribir_fichero": {
        const datos = await pedirJson("/api/fs/write", {
          path: args.path,
          contenido: args.contenido,
        });
        return { ok: true, texto: `Escrito ${datos.path} (${datos.bytes} bytes).` };
      }
      case "leer_fichero": {
        const datos = await pedirJson("/api/fs/read", { path: args.path });
        return { ok: true, texto: String(datos.contenido ?? "") };
      }
      case "listar_ficheros": {
        const datos = await pedirJson("/api/fs/list");
        const ficheros = (datos.ficheros ?? []) as { path: string; bytes: number }[];
        if (ficheros.length === 0) return { ok: true, texto: "workspace/ esta vacio." };
        return {
          ok: true,
          texto: ficheros.map((f) => `${f.path} (${f.bytes} B)`).join("\n"),
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
        const creador = herramientaLocal.creador();
        if (!creador) {
          return { ok: false, texto: SIN_REGISTRO };
        }
        return creador({
          nombre: String(args.nombre ?? "").trim(),
          bpm: Number(args.bpm ?? 120) || 120,
          compases: Number(args.compases ?? 32) || 32,
        });
      }
      case "anadir_pistas": {
        const importador = herramientaLocal.importador();
        if (!importador) {
          return { ok: false, texto: SIN_REGISTRO };
        }
        return importador({
          midis: Array.isArray(args.midis) ? (args.midis as unknown[]).map(String) : [],
          wavs: Array.isArray(args.wavs) ? (args.wavs as unknown[]).map(String) : [],
          inicioCompas: Number(args.inicio_compas ?? 0) || 0,
          ...(typeof args.nombre_proyecto === "string" && args.nombre_proyecto.trim() !== ""
            ? { nombreProyecto: args.nombre_proyecto.trim() }
            : {}),
        });
      }
      case "ajustar_pistas": {
        const ajustar = herramientaLocal.ajustador();
        if (!ajustar) {
          return { ok: false, texto: SIN_REGISTRO };
        }
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
        return ajustar({ pistas });
      }
      case "verificar_audio": {
        const datos = await pedirJson(
          "/api/verificar",
          { path: args.path },
          Number(args.timeout_segundos) * 1000 + 45000 || 225000,
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
