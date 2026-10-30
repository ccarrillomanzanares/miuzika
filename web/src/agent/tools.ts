/**
 * Agent tools: its "hands".
 *
 * The browser does not touch the disk: it asks the dev server, which is what executes and
 * writes, and ALWAYS inside <project>/workspace. The schemas below are what the LLM sees.
 */

import type { ToolSpec } from "../llm.ts";
import { UMBRAL_SALIDA, recortarSalida } from "./contexto.ts";
import { buscarEnCatalogo } from "../../../src/core/buscar.ts";
import type { EntradaCatalogo } from "../../../src/core/buscar.ts";
import { etiquetasEnFrase } from "../../../src/core/taxonomia.ts";
import type { PeticionProgresion } from "../../../src/core/composicion.ts";
import type { PeticionBateria } from "../../../src/core/bateria.ts";
import { PATRONES } from "../../../src/core/composicion.ts";
import { PALABRAS } from "../../../src/core/palabras.ts";
import { DEVICE_PARAMS, DEVICE_TYPES, INSTRUMENT_TYPES } from "../../../src/core/types.ts";
import { firmasDeOps } from "../../../src/core/ops.ts";
import { MODE_NAMES } from "../../../src/core/theory.ts";

/** Text that goes back to the model as the tool result. */
export type ResultadoHerramienta = ResultadoAccion;

/** Slug of the open project: the server resolves non-shared paths there. */
/**
 * It lives in `globalThis`, like the actions (see `registrarAcciones`): after a hot
 * reload there can be two copies of this module, and the one that sets the project
 * (main.ts) is not the one making the agent's requests. Measured on Oct 27:
 * ejecutar_python and listar_ficheros fell into "proyectos/sin-proyecto/" with a
 * project open.
 */
const estadoProyecto = globalThis as unknown as { __miuzikaProyectoActivo?: string };

export function setProyectoActivo(slug: string): void {
  estadoProyecto.__miuzikaProyectoActivo = slug;
}

function proyectoActivo(): string {
  return estadoProyecto.__miuzikaProyectoActivo ?? "";
}

/** Where Python runs: on this laptop (cpu) or on a Lambda Cloud GPU. */
export type Destino = "cpu" | "lambda";

let destinoPreferido: Destino = "cpu";

/** The interface (or main.ts) sets the default destination for the tools here. */
export function setDestino(destino: Destino): void {
  destinoPreferido = destino === "lambda" ? "lambda" : "cpu";
}

/**
 * Header with a project's folder. It goes ENCODED: an HTTP header only accepts Latin-1
 * and `fetch` throws with a folder like "夜の歌". The server decodes it in
 * `slugProyecto` (server/contexto.ts).
 */
export function cabeceraDeProyecto(slug: string): Record<string, string> {
  return { "x-miuzika-proyecto": encodeURIComponent(slug) };
}

/** Headers with the active project (also used by main.ts). */
export function cabecerasProyecto(extra?: Record<string, string>): Record<string, string> {
  return { ...cabeceraDeProyecto(proyectoActivo()), ...(extra ?? {}) };
}

/**
 * Request with a time limit and cancellable: the chat never hangs waiting and the
 * "Cancel" button also cuts whatever is in flight.
 *
 * `senal` is the turn's AbortSignal: without it, cancelling left the tool running until
 * its own limit.
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
// Actions that touch the open project
//
// The tools that change the project run in the tab, because it is the owner of
// `proyecto.json` (see docs/ARCHITECTURE.md §3). The tab registers them here with
// `registrarAcciones`, all at once. Before, they were seven loose registrations, each
// duplicated in `globalThis`.
// ---------------------------------------------------------------------------

/** Result of an action: the text goes back to the model as the tool result. */
export interface ResultadoAccion {
  ok: boolean;
  texto: string;
}

/** Real tracks from files in workspace/ (the delivery of a song). */
export interface PeticionPistas {
  midis: string[];
  wavs: string[];
  inicioCompas: number;
  /**
   * How many bars the take lasts. All clips in the call (MIDI and WAV) last exactly
   * that: duration is counted in bars, not file seconds, so the MIDI and the WAV of the
   * same instrument end up the same.
   */
  compases?: number;
  /** Project name if it has to be created (the agent asks the user). */
  nombreProyecto?: string;
}

export interface PeticionProyecto {
  nombre: string;
  bpm: number;
  compases: number;
  /** Tonic and mode, if the user said them ("re menor" → D minor). */
  tonica?: string;
  modo?: string;
}

/** Converts a library instrument to .sf2 and puts it as a track. */
export interface PeticionInstrumento {
  /** Name from listar_instrumentos ("Grand Piano, Steinway B") or the .sfz path. */
  sfz: string;
  nombre: string;
  /** Existing track whose instrument is changed (keeps its notes). */
  pista?: string;
}

/** Adjustment of a track by name: this is how a mix is applied. */
export interface AjustePista {
  nombre: string;
  gainDb?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

/** Match the clip durations (in bars) without touching the rest of the project. */
export interface PeticionIgualar {
  /** Bars the clips should last. If missing, the longest clip is taken. */
  compases?: number;
  /** Only these tracks (by name). Empty = all. */
  pistas?: string[];
}

/**
 * Create a sound: the voice comes from the engine catalog and the words are the
 * canonical vocabulary ("short", "fat", "dirty"), translated into parameters.
 */
export interface PeticionSonido {
  nombre: string;
  /** Voice key in the catalog (kick, metal_hit, cowbell…). */
  voz: string;
  /** Words from the vocabulary, in the order they are said. */
  palabras?: string[];
  /** Concrete values of the voice's parameters (optional). */
  args?: Record<string, number | boolean | number[]>;
}

/** Put a library sample into the project (clip + asset, normalized). */
export interface PeticionSample {
  /** Path inside workspace/catalogo/ (the one buscar_sonido returns). */
  archivo: string;
  /** Name for the file and the track; if missing, it is taken from the archive. */
  nombre?: string;
  /** Clip duration in bars (optional: by default, whatever the audio lasts). */
  compases?: number;
}

/** Write a chord progression as notes on a track. */
/** What all the tools that write notes on a track have in common. */
export interface PeticionEscritura {
  /** Destination track (id or name). If it does not exist, it is created with that name. */
  pista: string;
  /** Instrument type if the track is created (or to change it). */
  instrumento?: string;
  /** General MIDI program (0-127): it sounds with the GM SoundFont if installed. */
  programa?: number;
  /** Bar where it starts, counting from 1. */
  desdeCompas?: number;
  /** Clip name (by default, the track's). */
  nombreClip?: string;
}

export interface PeticionProgresionPista extends PeticionProgresion, PeticionEscritura {}

/** A line in compact notation ("D2:1.5 D2:.5 F2 Eb2 | r:2 [D3 F3 A3]:4"). */
export interface PeticionNotas extends PeticionEscritura {
  notas: string;
  velocidad?: number;
  repeticiones?: number;
}

/** Drums in a grid: piece → row of steps. */
export interface PeticionBateriaPista extends PeticionBateria, PeticionEscritura {}

export interface AccionesEstudio {
  exportar(peticion: { midi: boolean; wav: boolean }): Promise<ResultadoAccion>;
  escuchar(peticion: { pistas?: string[]; compasesPorTramo?: number }): Promise<ResultadoAccion>;
  versiones(peticion: { accion: string; version?: string; pistas?: string[] }): Promise<ResultadoAccion>;
  leerProyecto(peticion: { clipId?: string }): ResultadoAccion;
  editarProyecto(peticion: { ops: unknown[] }): ResultadoAccion;
  escribirProgresion(peticion: PeticionProgresionPista): ResultadoAccion;
  escribirNotas(peticion: PeticionNotas): ResultadoAccion;
  escribirBateria(peticion: PeticionBateriaPista): ResultadoAccion;
  crearProyecto(peticion: PeticionProyecto): Promise<ResultadoAccion>;
  anadirPistas(peticion: PeticionPistas): Promise<ResultadoAccion>;
  ajustarPistas(peticion: { pistas: AjustePista[] }): ResultadoAccion;
  igualarClips(peticion: PeticionIgualar): ResultadoAccion;
  crearSonido(peticion: PeticionSonido): Promise<ResultadoAccion>;
  usarSample(peticion: PeticionSample): Promise<ResultadoAccion>;
  usarInstrumento(peticion: PeticionInstrumento): Promise<ResultadoAccion>;
}

/**
 * The registry also lives in `globalThis`. With the dev server, editing main.ts or this
 * file can leave TWO copies of the module loaded at once: the one that registers (main)
 * and the one the agent loop consults. Without this, the app says "cannot create
 * projects" with the app perfectly alive and the agent retries in a loop. It happened on
 * Oct 23 and cost 12 steps.
 */
const almacen = globalThis as unknown as { __miuzikaAcciones?: AccionesEstudio | null };

export function registrarAcciones(acciones: AccionesEstudio | null): void {
  almacen.__miuzikaAcciones = acciones;
}

function acciones(): AccionesEstudio | null {
  return almacen.__miuzikaAcciones ?? null;
}

/** Tools resolved in the tab, against the open project. */
const HERRAMIENTAS_DEL_PROYECTO = new Set([
  "exportar",
  "escuchar_mezcla",
  "versiones",
  "leer_proyecto",
  "editar_proyecto",
  "escribir_progresion",
  "escribir_notas",
  "escribir_bateria",
  "crear_proyecto",
  "anadir_pistas",
  "ajustar_pistas",
  "igualar_clips",
  "crear_sonido",
  "usar_sample",
  "usar_instrumento",
]);

/** "reverb(wet 0..1, decay 0..1, …); eq(low -24..24, …)": what each effect accepts. */
function parametrosDeEfectos(): string {
  return DEVICE_TYPES.map(
    (tipo) =>
      `${tipo}(${Object.entries(DEVICE_PARAMS[tipo])
        .map(([clave, [min, max]]) => `${clave} ${min}..${max}`)
        .join(", ")})`,
  ).join("; ");
}

/** Tools that return text page by page and do not go through the trimming. */
// listar_instrumentos: the GM list plus the library exceeds 4000 characters; trimmed,
// the agent spent another step reading the rest from _salidas (Oct 28).
const PAGINADAS = new Set(["leer_fichero", "leer_web", "leer_proyecto", "listar_instrumentos"]);

/** Cap for a single escribir_fichero (≈200 lines). See the why in the case. */
const MAX_FICHERO = 8000;

/** Single message for the case "the app has no actions registered": it says what to do. */
const SIN_REGISTRO =
  "The app does not have this action registered (it happens when the dev server restarts or " +
  "code is edited with the tab open and two copies of the module are left). Do NOT retry it: " +
  "ask the user to reload the page (F5) and try again afterwards.";
export const HERRAMIENTAS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "leer_proyecto",
      description:
        "Returns the REAL state of the open project: tempo, time signature, key, tracks with their id, " +
        "instrument, gain, pan, effects (with their parameters) and clips (bar, duration, note range). " +
        "With `clip`, ONLY that clip and its notes (shorter). Read it before editing: the ids it " +
        "returns are the ones editar_proyecto and escribir_progresion ask for.",
      parameters: {
        type: "object",
        properties: {
          clip: { type: "string", description: "Optional: a clip id (clp_3) to see its notes" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exportar",
      description:
        "Exports the project to salida/: midi=true writes a .mid with one track per MIDI track " +
        "(tempo, time signature, GM programs, drums on channel 10); wav=true renders the mix with the " +
        "same engine as Play (instruments, effects, volumes) to a .wav. Use it only if the " +
        "brief asks for MIDI or WAV; if not, the result is the project itself. Do not write scripts " +
        "to export.",
      parameters: {
        type: "object",
        properties: {
          midi: { type: "boolean" },
          wav: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escuchar_mezcla",
      description:
        "Renders the project with the SAME engine as Play (openDAW) and measures the level (RMS dBFS) " +
        "by bar ranges: the mix and each track alone, crossed with where there are notes. It marks MUTE " +
        "where a track has notes and no sound comes out, the mix that clips and the instruments that do " +
        "not load. Use it when the person says something cannot be heard or sounds odd, and before " +
        "changing instruments or volumes: your Python render is not what sounds in the app. It takes a " +
        "while (one render per track): with `pistas` you measure only the ones that matter.",
      parameters: {
        type: "object",
        properties: {
          pistas: { type: "array", items: { type: "string" }, description: "Id or name of the tracks to measure alone; empty = all" },
          compases_por_tramo: { type: "number", description: "Bars per column (4 by default)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "versiones",
      description:
        "Saved versions of the project: at the start of EACH turn a snapshot is saved of the project as " +
        "it was. Use it when the person wants to go back (“the drums from before”, “undo the " +
        "melody”): accion=listar shows the snapshots with the request that came after them; accion=restaurar " +
        "copies the requested `pistas` (id or name), or without `pistas`, the whole project, from a snapshot. " +
        "Restore from the snapshot, do not rebuild by hand: that way exactly what was there comes back.",
      parameters: {
        type: "object",
        properties: {
          accion: { type: "string", enum: ["listar", "restaurar"] },
          version: { type: "string", description: "Snapshot name or its number in the list (1 = the newest)" },
          pistas: { type: "array", items: { type: "string" }, description: "Tracks to restore; empty = all" },
        },
        required: ["accion"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editar_proyecto",
      description:
        "Changes the project with validated and TRANSACTIONAL operations: either all of them go in or none, and " +
        "they are undone with Ctrl+Z. It is the direct way to compose (notes), fix (clips), produce " +
        "(effects) and mix (gain, pan, master) without writing Python. trackId accepts an id, exact name " +
        "or track number. Notes: {pitch 0-127 (60 = C4), start and duration in quarter notes from " +
        "the clip start, velocity 1-127}. startBar starts at 0. Effect types: " +
        `${DEVICE_TYPES.join(", ")}; their parameters in real units (Ms suffix = milliseconds, Hz, Db = decibels; without suffix, ` +
        `ratio 0..1 or whatever the range says): ${parametrosDeEfectos()}. ` +
        `Instruments: ${INSTRUMENT_TYPES.join(", ")} (with program 0-127 they sound with General MIDI). ` +
        "Buses: a reverb or delay shared by several tracks goes in a bus (add_bus with its effects, " +
        "set_send from each track, wet 1 on the bus) instead of one per track; add_device/set_device " +
        "accept the bus in trackId. " +
        "Operations:\n" +
        firmasDeOps(),
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "List of operations; each one is an object with `op` and its fields",
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
        "Writes a chord progression as MIDI notes on a track (creates it if it does not exist), with " +
        "voice leading. Give `acordes` in American notation (Am, F, C/E, G7, Bbmaj7, Dm7b5) or " +
        "`grados` of the project key (1-7). Patterns: block (held chords), pulse " +
        "(chords repeated every `paso`), arpeggio, alberti, bass (root or slash-chord bass with " +
        "bar). For a full backing, call it several times: pad in block, bass in “bass”, etc.",
      parameters: {
        type: "object",
        properties: {
          pista: { type: "string", description: "Id or name of the destination track" },
          acordes: { type: "array", items: { type: "string" }, description: "Chord symbols: ['Am','F','C','G']" },
          grados: { type: "array", items: { type: "integer" }, description: "Degrees 1-7: [1,6,4,5]" },
          patron: { type: "string", enum: [...PATRONES] },
          compases_por_acorde: { type: "number", description: "1 by default" },
          desde_compas: { type: "integer", description: "Start bar, from 1 (1 by default)" },
          octava: { type: "integer", description: "Octave (C4 = 60). 4 by default; in “bass”, 2" },
          paso: { type: "number", description: "Step in quarter notes for pulse/arpeggio/bass (0.5 = eighth notes)" },
          velocidad: { type: "integer", description: "1-127, 90 by default" },
          repeticiones: { type: "integer", description: "Times the progression repeats (1 by default)" },
          instrumento: { type: "string", enum: [...INSTRUMENT_TYPES], description: "If the track has to be created" },
          programa: { type: "integer", description: "General MIDI program 0-127 (48 strings, 89 warm pad, 19 organ…)" },
        },
        required: ["pista"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_notas",
      description:
        "Writes a melody, a bass or any line on a track with COMPACT NOTATION (creates it if it does not " +
        "exist; if there are already clips in those bars, it replaces them). Notation: note = letter or solfège + " +
        "accidental + octave, C4 = 60 (D2, Eb4, F#3, do4, sib2) or MIDI number; ':dur' in quarter notes " +
        "(1 quarter, .5 eighth, 1/3 triplet, 4 whole) and if missing the previous one repeats; '!vel' 1-127 " +
        "for a note; 'r' rest; [D3 F3 A3] chord; '|' bar line (ignored); '~' ties with " +
        "the next equal one; '( … )x4' repeats a group. Example, one-bar riff four times and a " +
        "turnaround: \"(E2:.5 B2 E3 B2 E2 B2 E3 B2)x4 | D2:2 r:2\".",
      parameters: {
        type: "object",
        properties: {
          pista: { type: "string", description: "Id or name of the track" },
          notas: { type: "string", description: "The phrase in compact notation" },
          desde_compas: { type: "integer", description: "Start bar, from 1 (1 by default)" },
          repeticiones: { type: "integer", description: "Times in a row the phrase is played (1 by default)" },
          velocidad: { type: "integer", description: "Default velocity, 1-127 (90)" },
          programa: { type: "integer", description: "General MIDI program 0-127 (33 electric bass, 29 overdriven guitar, 0 piano…)" },
          instrumento: { type: "string", enum: [...INSTRUMENT_TYPES], description: "Type if the track is created (lead by default)" },
          nombre_clip: { type: "string" },
        },
        required: ["pista", "notas"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_bateria",
      description:
        "Writes drums in a GRID, like a drum machine: one row per piece, one character per step " +
        "(16 per bar = sixteenth notes). 'x' hit, 'X' accent, 'o' medium, 'g' ghost, '.' nothing, '|' is " +
        "ignored. The row repeats until it fills `compases`; `final` replaces the last bar (fill). " +
        "Pieces: kick, snare, rim, clap, hat, pedal, openhat, lowtom, midtom, hightom, floortom, crash, " +
        "ride, bell, china, splash, tambourine, cowbell, shaker (or the GM note). If there are already clips in those " +
        "bars, it replaces them. Example: {\"kick\":\"x...x...x...x...\", \"snare\":\"....X.......X...\"}.",
      parameters: {
        type: "object",
        properties: {
          pista: { type: "string", description: "Id or name of the track (by default it is created as drums)" },
          patrones: { type: "object", description: "piece → row of steps", additionalProperties: { type: "string" } },
          compases: { type: "integer", description: "Bars to fill" },
          desde_compas: { type: "integer", description: "Start bar, from 1" },
          final: { type: "object", description: "Rows of the last bar (fill)", additionalProperties: { type: "string" } },
          pasos_por_compas: { type: "integer", description: "16 by default; 12 for eighth-note triplets" },
          swing: { type: "number", description: "0-0.5" },
          humanizar: { type: "boolean", description: "Slight velocity variation (true by default)" },
          programa: { type: "integer", description: "General MIDI kit (0 standard, 8 room, 16 power, 25 electronic…)" },
          nombre_clip: { type: "string" },
        },
        required: ["pista", "patrones"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_instrumentos",
      description:
        "Lists the instruments that sound in the DAW: the General MIDI ones (guitars, basses, strings, " +
        "winds, synths, pads, drum kits), with their `programa` number for escribir_notas, " +
        "escribir_progresion or escribir_bateria; and those in the recorded sample library (grand " +
        "pianos, organs, harpsichords, harps, sax, mallets), which are set with usar_instrumento. For " +
        "piano, organ, harpsichord, harp, sax and mallets, choose the library: it sounds like a real instrument.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_web",
      description:
        "Searches the internet and returns the title, link and an excerpt of each result. For data about a " +
        "reference (key, tempo, structure, instrumentation, year, producer) or about technique. NEVER " +
        "to copy lyrics or scores of copyrighted works.",
      parameters: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "The search (better in English for Anglo-American music)" },
          resultados: { type: "integer", description: "1-10, 5 by default" },
        },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leer_web",
      description:
        "Reads the text of a web page (a link from buscar_web), in pages of 6,000 characters.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          desde: { type: "integer", description: "Character from which to keep reading (0 by default)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_fichero",
      description:
        "Writes or overwrites a text file inside 'workspace/'. The ENGINE ALREADY EXISTS " +
        "in codigo/ (dsp, instruments, render, midi): do NOT rewrite it or redefine its " +
        "functions, import them. A new file that redefines an engine symbol is REJECTED " +
        "(409), just like patch*/parche* scripts (that is what editar_fichero is for). " +
        "For a quick sample: copy plantillas/one_shot.py and change PARAMS.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path inside workspace/, with /" },
          contenido: { type: "string", description: "Full contents of the file" },
        },
        required: ["path", "contenido"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leer_fichero",
      description:
        "Returns a file from workspace/ in pages of 6,000 characters; if there is more, the result " +
        "says the `desde` to continue with.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          desde: { type: "integer", description: "Character from which to read (0 by default)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_ficheros",
      description:
        "Lists the files in the open project's folder (or in the folder you ask for) with " +
        "their size in bytes. Use it to check that what you generated really exists. " +
        "It does not list the sample catalog: that is what buscar_sonido is for.",
      parameters: {
        type: "object",
        properties: {
          carpeta: {
            type: "string",
            description:
              "Optional. By default, the project folder. Others: 'codigo', 'gpu', " +
              "'herramientas', 'plantillas', '_salidas' or '' (the workspace root).",
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
        "Runs with Python a script that is already in workspace/ ('codigo/render.py') and " +
        "returns its output, its errors and the exit code. The process's working directory " +
        "is the project folder and numpy is available. For long jobs " +
        "raise timeout_segundos (300 by default, 1800 maximum). If the script renders several " +
        "stems, write each one with render.stem(ruta, funcion, datos...): when fixing something and " +
        "running again, only what changed is recomputed. With destino='lambda' the SAME " +
        "script runs on a Lambda Cloud GPU (the first time it takes ~3 min to start the " +
        "machine); the files it writes in salida/ come back to the local project by themselves.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the script inside workspace/" },
          argumentos: {
            type: "array",
            items: { type: "string" },
            description: "Command-line arguments",
          },
          timeout_segundos: {
            type: "number",
            description: "Time limit in seconds (300 by default, 1800 maximum)",
          },
          destino: {
            type: "string",
            enum: ["cpu", "lambda"],
            description:
              "Where to run: 'cpu' (this machine, by default) or 'lambda' (cloud GPU, PAID). " +
              "'lambda' only for scripts that use motor_gpu or torch, and only if the person has " +
              "allowed it in the chat selector.",
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
        "Replaces an EXACT fragment of a file (search -> replace). It is the right way " +
        "to fix existing code: atomic, auditable and without patch scripts. If the text does not " +
        "appear it returns 409; use leer_fichero to copy the exact fragment.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the file in workspace/" },
          busca: { type: "string", description: "Exact fragment to find (with its indentation)" },
          reemplaza: { type: "string", description: "Text to replace it with (empty to delete it)" },
          todas: { type: "boolean", description: "Replace all occurrences (true by default)" },
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
        "Creates an empty project in the DAW. Call it ONLY after asking the user what they want to " +
        "call it: its name is also its folder's (proyectos/<nombre>/), and the files you " +
        "write in 'salida/...' will go there. If there is already an open project, do not use it.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Name the user has asked for" },
          bpm: { type: "number", description: "Tempo (120 by default)" },
          compases: {
            type: "integer",
            description: "Do not set it unless the duration is decided: the project grows on its own with the material",
          },
          tonica: { type: "string", description: "Tonic in American notation: C, F#, Bb (re = D)" },
          modo: {
            type: "string",
            enum: [...MODE_NAMES],
            description: "Key mode (menor = minor, mayor = major)",
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
        "Lists the timbres the engine can synthesize, with their family and their parameters (range and " +
        "unit). It is the real catalog, read from the code: if a voice is not here, it does not exist.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_sonido",
      description:
        "Searches the engine catalog and the CC0 library for what the user asks for in natural language. " +
        "It understands the usual names and regionalisms (tarola = snare, hi-hat = charles, crash " +
        "cymbal = crash) and the measured character (short, long, dry, bright, dark, low, high, dirty, " +
        "clean). Use it to choose a loose sample (a hit, an effect, a texture). To PLAY " +
        "notes with a recorded instrument it is not needed: listar_instrumentos and usar_instrumento. One or two " +
        "queries are enough; do not repeat it with synonyms.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description:
              "The request in Spanish or English (the index is in those two languages): if the user " +
              "writes in another language, translate it yourself, e.g. «短くて汚いチャイナ» → 'china dirty and short'.",
          },
          familia: {
            type: "string",
            enum: ["percusión", "tonal", "textura", "ruido", "efecto"],
            description: "Optional: narrow it to one family",
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
        "Puts a sample from the CC0 library into the project (the 4,231 VCSL files) as an audio " +
        "track: it converts it to 44.1k/16b, normalizes it to -1 dBFS and leaves it in proyectos/<slug>/samples/. " +
        "Use it after buscar_sonido, with the path it returns.",
      parameters: {
        type: "object",
        properties: {
          archivo: {
            type: "string",
            description: "Path of the sample inside workspace/catalogo/ (the one buscar_sonido gives)",
          },
          nombre: { type: "string", description: "Name of the file and of the track" },
          compases: { type: "integer", description: "Clip duration in bars (optional)" },
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
        "Measures a reference song and returns tempo, key, duration, bars and the " +
        "energy curve by 4-bar blocks, plus the character in words. It accepts a " +
        "YouTube link or the path of an audio file. It does NOT extract the melody or the chords: if the song " +
        "has to be played, the melody has to come from somewhere else.",
      parameters: {
        type: "object",
        properties: {
          origen: {
            type: "string",
            description: "YouTube link or path of an audio file inside workspace/",
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
        "Puts a RECORDED instrument from the sample library (VCSL) on a track: grand pianos " +
        "(Steinway B, Kawai), organs, harpsichords, harps, sax, mallets, percussion… (the list comes out in " +
        "listar_instrumentos). With `pista`, it changes that track's sound and keeps its notes; without it, " +
        "it creates a new track. It takes a few seconds (it converts the instrument). Afterwards write or leave " +
        "the notes as usual.",
      parameters: {
        type: "object",
        properties: {
          sfz: {
            type: "string",
            description: "Instrument name as it appears in listar_instrumentos (e.g. «Grand Piano, Steinway B», «Pipe Organ - Quiet»)",
          },
          nombre: { type: "string", description: "Track name (if it is created)" },
          pista: { type: "string", description: "Optional: id or name of an existing track to change its instrument" },
        },
        required: ["sfz"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_sonido",
      description:
        "Creates a real sound and saves it in the project: it picks a voice from the catalog, applies the " +
        "user's words (short, fat, dirty...) and renders the WAV. If the user asks for a sound " +
        "that does not exist as a voice, use crear_voz.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Name of the sound; also the file's" },
          voz: { type: "string", description: "Voice key from the catalog (kick, snare, metal_hit...)" },
          palabras: {
            type: "array",
            items: { type: "string", enum: PALABRAS.map((p) => p.clave) },
            description:
              "The system's canonical vocabulary. The user will say it in their language («punchy», «kurz», " +
              "«短い»…): translate it yourself to these keys, in the order they say it.",
          },
          args: {
            type: "object",
            description: "Voice parameters, only if precision is needed (dur, pitch, midi...)",
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
        "Adds a NEW timbre to the engine: you write the Python function, it is rendered, measured and, if " +
        "it passes the gate (duration 0.05-16 s, RMS > -60 dBFS, crest 2-30 dB, DC < 0.01, reproducible, " +
        "< 3 s), it stays in instruments.py forever and appears in the catalog. If it does not pass, it returns " +
        "the measurements for you to fix it. Use it only when listar_voces does not have what they ask for.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Function name: lowercase, letters/numbers/_, 3-31" },
          destino: {
            type: "string",
            enum: ["cpu", "gpu"],
            description:
              "cpu: local numpy, free and instant. gpu: torch on Lambda ($1.29/h, ~3 min to " +
              "start); use it only if the voice needs torch or a heavy render. Ask first.",
          },
          fuente: {
            type: "string",
            description:
              "COMPLETE Python code of the function, with imports (numpy, dsp, instruments or torch) and a mandatory " +
              "docstring: first line = description, then 'familia: percusion|tonal|ruido|textura' and " +
              "one line per parameter 'nombre: min..max Label (unit)' or 'nombre: bool Label'. " +
              "All parameters with a default value and deterministic through 'seed'.",
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
        "Matches the duration of ALL the project's clips (MIDI and audio) to the same number of bars. " +
        "Use it when the user says the clips do not end together or when the MIDI and the WAV of the same " +
        "instrument end in different bars. It touches neither notes, nor levels, nor tempo.",
      parameters: {
        type: "object",
        properties: {
          compases: {
            type: "integer",
            description: "Bars all clips should last. If you do not say it, the longest clip is used.",
          },
          pistas: {
            type: "array",
            items: { type: "string" },
            description: "Only these tracks (by name). Empty = the whole project.",
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
        "Creates REAL tracks in the DAW project: each .mid comes in as a MIDI track with its notes and each " +
        ".wav as an audio track. It is the delivery of a song: leave the files in salida/ and call it. " +
        "Do NOT master or normalize the final mix: the master is done in the DAW.",
      parameters: {
        type: "object",
        properties: {
          midis: {
            type: "array",
            items: { type: "string" },
            description: "Paths of .mid files in workspace/ (e.g. ['salida/tema_multitrack.mid'])",
          },
          wavs: {
            type: "array",
            items: { type: "string" },
            description: "Paths of .wav files for audio tracks (each stereo minute takes ~10 MB of RAM)",
          },
          inicio_compas: {
            type: "integer",
            description: "Bar where the tracks start (0 = beginning)",
          },
          compases: {
            type: "integer",
            description:
              "Duration of the take in BARS (e.g. 80). All clips you add last that, " +
              "both MIDI and WAV: that way they end in the same bar. Always set it when you know it.",
          },
          nombre_proyecto: {
            type: "string",
            description:
              "Only if there is NO open project: the name the user has asked for. If you do not know it, " +
              "ask me in the chat before calling (do not invent the name).",
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
        "Changes gainDb, pan, mute or solo of the project's tracks, by their name. " +
        "It is THE way to apply a chosen mix without touching the synthesis: the change is " +
        "an op, it can be undone with Ctrl+Z and the audio readjusts instantly. " +
        "The names are the ones seen in the track list (Kick, Bass, Pad...).",
      parameters: {
        type: "object",
        properties: {
          pistas: {
            type: "array",
            description: "One entry per track to touch",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Track name (as seen)" },
                gainDb: { type: "number", description: "Gain in dB (-60 to +12)" },
                pan: { type: "number", description: "Pan -1 (left) to +1 (right)" },
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
        "Measures a WAV from workspace/ and returns format, duration, peak, RMS, crest, DC, clipped " +
        "samples and stereo correlation. Use it instead of writing your own analyzer.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the WAV in workspace/" },
          timeout_segundos: {
            type: "number",
            description: "How long the measurement may take (180 by default, 1800 maximum)",
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
      texto: `The arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // The ones that change or read the project run in the tab (see registrarAcciones).
  const registradas = acciones();
  if (!registradas && HERRAMIENTAS_DEL_PROYECTO.has(nombre)) return { ok: false, texto: SIN_REGISTRO };
  const local = registradas as AccionesEstudio;

  try {
    switch (nombre) {
      case "escribir_fichero": {
        // A file of 9,700 tokens in one go (measured on Oct 25) makes the
        // provider cut the next turn with finish_reason 'load'. The cap is
        // mechanical on purpose: asking for it in the prompt did not work.
        const contenido = String(args.contenido ?? "");
        if (contenido.length > MAX_FICHERO) {
          return {
            ok: false,
            texto:
              `Too long: ${contenido.length} characters (the cap is ${MAX_FICHERO}). ` +
              "Write the file in pieces: first the structure and the base functions, and " +
              "then add the rest with editar_fichero (search/replace) or with a second " +
              "escribir_fichero to another file if they are different things.",
          };
        }
        const datos = await pedirJson("/api/fs/write", {
          path: args.path,
          contenido: args.contenido,
        });
        // `nota` says whether the engine passed the smoke test (or that in gpu/ only the
        // syntax has been checked): it is the proof that the change is safe.
        const nota = typeof datos.nota === "string" && datos.nota !== "" ? ` ${datos.nota}` : "";
        return { ok: true, texto: `Wrote ${datos.path} (${datos.bytes} bytes).${nota}` };
      }
      case "leer_fichero": {
        const desde = Math.max(0, Math.trunc(Number(args.desde) || 0));
        const datos = await pedirJson("/api/fs/read", { path: args.path, desde });
        const siguiente = typeof datos.siguiente === "number" ? datos.siguiente : null;
        return {
          ok: true,
          texto:
            String(datos.contenido ?? "") +
            (siguiente !== null
              ? `\n[… continues: ${Number(datos.total) - siguiente} more characters. leer_fichero(path, desde=${siguiente})]`
              : ""),
        };
      }
      case "listar_ficheros": {
        const carpeta = typeof args.carpeta === "string" ? args.carpeta.trim() : "";
        const consulta = carpeta === "" ? "/api/fs/list" : `/api/fs/list?carpeta=${encodeURIComponent(carpeta)}`;
        const datos = await pedirJson(consulta, undefined, 30000, senal);
        const ficheros = (datos.ficheros ?? []) as { path: string; bytes: number }[];
        const donde = String(datos.carpeta ?? ".");
        if (ficheros.length === 0) {
          return { ok: true, texto: `There are no files in ${donde}/.` };
        }
        const total = ficheros.reduce((suma, f) => suma + f.bytes, 0);
        const truncado = datos.truncado === true;
        return {
          ok: true,
          texto:
            `${ficheros.length}${truncado ? "+ (truncated)" : ""} file(s) in ${donde}/ ` +
            `(${(total / 1024).toFixed(0)} KB):\n` +
            ficheros.map((f) => `${f.path} (${f.bytes} B)`).join("\n") +
            (truncado
              ? "\n[The list is truncated: ask for a more specific folder (e.g. 'salida').]"
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
        return { ok: true, texto: `Edited ${datos.path ?? args.path}: ${datos.reemplazos} replacement(s).` };
      }
      case "crear_proyecto": {
        const tonica = typeof args.tonica === "string" ? args.tonica.trim() : "";
        const modo = typeof args.modo === "string" ? args.modo.trim() : "";
        return local.crearProyecto({
          nombre: String(args.nombre ?? "").trim(),
          bpm: Number(args.bpm ?? 120) || 120,
          compases: Number(args.compases ?? 8) || 8,
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
            if (voz.excluida) return `- ${voz.clave}: NOT USABLE (${voz.excluida})`;
            const params = voz.params
              .map((p) =>
                p.min === undefined ? p.clave : `${p.clave} ${p.min}..${p.max}${p.unidad ? " " + p.unidad : ""}`,
              )
              .join(", ");
            return `- ${voz.clave} [${voz.familia}${(voz as { destino?: string }).destino === "gpu" ? ", GPU" : ""}] ${voz.descripcion} (${params})`;
          });
          return { ok: true, texto: `Engine voices (${lineas.length}):\n${lineas.join("\n")}` };
        } catch (error) {
          return {
            ok: false,
            texto: "I could not read the catalog: " + (error instanceof Error ? error.message : String(error)),
          };
        }
      }
      case "buscar_sonido": {
        const consulta = String(args.consulta ?? "").trim();
        if (consulta === "") return { ok: false, texto: "missing query" };
        try {
          // Measuring the 16 voices costs ~2 s: it is only requested if the query carries a
          // character word (short, bright…), which is when it is needed.
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
          // The CC0 library (4,231 samples), searched on the server.
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
                  (r.strudel ? ` · in Strudel: s("${r.strudel}")` : "")
                );
              });
            }
          } catch {
            /* no library: continue with the engine voices */
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
                `There is nothing like "${consulta}" in the catalog` +
                (etiquetas.length > 0 ? ` (closest by tag: ${etiquetas.join(", ")})` : "") +
                ". You can create it with crear_sonido if there is a suitable voice, or with crear_voz if not.",
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
            `Candidates for "${consulta}":`,
            lineas.join("\n"),
            biblioteca.length > 0
              ? `\nIn the CC0 library (${biblioteca.length}):\n${biblioteca.join("\n")}\nTo bring it in: usar_sample(archivo="...").`
              : "",
            "To synthesize a new one: crear_sonido with the voice you choose.",
          ].filter((x) => x !== "");
          return { ok: true, texto: partes.join("\n") };
        } catch (error) {
          return { ok: false, texto: "I could not search: " + (error instanceof Error ? error.message : String(error)) };
        }
      }
      case "medir_referencia": {
        const origen = String(args.origen ?? "").trim();
        if (!origen) return { ok: false, texto: "Missing the reference link or path." };
        const res = await pedir("/api/referencia/medir", {
          cuerpo: { origen },
          // Downloading from YouTube and analyzing 4 minutes: the server allows 900 s.
          limiteMs: 900000,
          senal,
        });
        const datos = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
        if (!datos.ok) return { ok: false, texto: `Could not measure: ${datos.error ?? res.status}` };
        const linea =
          `${datos.duracion_s} s · ${datos.tempo_bpm} BPM · ` +
          (datos.tonalidad && (datos.tonalidad as { tonica?: string }).tonica
            ? `${(datos.tonalidad as { tonica: string }).tonica} ${(datos.tonalidad as { modo: string }).modo}`
            : "no clear key") +
          ` · ${datos.compases} bars\n` +
          `character: ${(datos.palabras as string[])?.join(", ") ?? ""}\n` +
          `shape (energy per 4 bars): ${JSON.stringify(datos.forma)}`;
        return { ok: true, texto: linea };
      }
      case "usar_instrumento":
        return local.usarInstrumento({
          sfz: String(args.sfz ?? "").trim(),
          nombre: String(args.nombre ?? "").trim(),
          ...(typeof args.pista === "string" && args.pista.trim() !== "" ? { pista: args.pista.trim() } : {}),
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
          return { ok: false, texto: "missing name or source" };
        }
        try {
          const destino = args.destino === "gpu" ? "gpu" : "cpu";
          const res = await pedir("/api/voces/nueva", {
            cuerpo: { nombre, fuente, destino },
            // On GPU the gate renders on Lambda: 900 s limit there.
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
                ? ` Measurements: ${Object.entries(datos.perfil)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" ")}`
                : "";
            return {
              ok: false,
              texto: `The gate rejects it: ${(datos.motivos ?? [`HTTP ${res.status}`]).join("; ")}.${perfil}`,
            };
          }
          return {
            ok: true,
            texto:
              `Voice "${datos.voz?.clave ?? nombre}" added to the ${destino.toUpperCase()} engine (family ${datos.voz?.familia ?? "?"}, ` +
              `parameters: ${(datos.voz?.params ?? []).map((p) => p.clave).join(", ")}). Catalog: ${datos.total ?? "?"} voices. ` +
              `It can now be used with crear_sonido.`,
          };
        } catch (error) {
          return { ok: false, texto: "I could not call the gate: " + (error instanceof Error ? error.message : String(error)) };
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
        if (lista.length === 0) return { ok: false, texto: "You have not named any track." };
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
      case "exportar":
        return await local.exportar({ midi: args.midi === true, wav: args.wav === true });
      case "escuchar_mezcla":
        return await local.escuchar({
          pistas: Array.isArray(args.pistas) ? args.pistas.map(String) : undefined,
          compasesPorTramo: Number(args.compases_por_tramo) > 0 ? Number(args.compases_por_tramo) : undefined,
        });
      case "versiones":
        return await local.versiones({
          accion: String(args.accion ?? "listar"),
          version: args.version === undefined ? undefined : String(args.version),
          pistas: Array.isArray(args.pistas) ? args.pistas.map(String) : undefined,
        });
      case "leer_proyecto":
        return local.leerProyecto(typeof args.clip === "string" && args.clip.trim() !== "" ? { clipId: args.clip.trim() } : {});
      case "editar_proyecto": {
        const ops = Array.isArray(args.ops) ? (args.ops as unknown[]) : [];
        if (ops.length === 0) return { ok: false, texto: "Missing `ops`: a list of operations (see the tool description)." };
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
        Object.assign(peticion, escrituraDe(args));
        return local.escribirProgresion(peticion);
      }
      case "escribir_notas": {
        if (typeof args.notas !== "string" || args.notas.trim() === "") {
          return { ok: false, texto: "Missing `notas`: the phrase in compact notation." };
        }
        return local.escribirNotas({
          ...escrituraDe(args),
          notas: args.notas,
          ...(typeof args.velocidad === "number" ? { velocidad: args.velocidad } : {}),
          ...(typeof args.repeticiones === "number" ? { repeticiones: args.repeticiones } : {}),
        });
      }
      case "escribir_bateria": {
        const filas = (valor: unknown): Record<string, string> | undefined =>
          typeof valor === "object" && valor !== null
            ? Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
            : undefined;
        const patrones = filas(args.patrones);
        if (!patrones || Object.keys(patrones).length === 0) {
          return { ok: false, texto: "Missing `patrones`: piece → row of steps, e.g. {\"kick\":\"x...x...\"}." };
        }
        const final = filas(args.final);
        return local.escribirBateria({
          ...escrituraDe(args),
          patrones,
          ...(final ? { final } : {}),
          ...(typeof args.compases === "number" ? { compases: args.compases } : {}),
          ...(typeof args.pasos_por_compas === "number" ? { pasosPorCompas: args.pasos_por_compas } : {}),
          ...(typeof args.swing === "number" ? { swing: args.swing } : {}),
          humanizar: args.humanizar !== false,
        });
      }
      case "listar_instrumentos": {
        const datos = (await pedirJson("/api/gm", undefined, 30000, senal)) as {
          ruta?: string | null;
          instrumentos?: string;
          biblioteca?: string;
        };
        const gm = datos.ruta
          ? (datos.instrumentos ?? "(no list)")
          : "There is no General MIDI SoundFont installed (workspace/catalogo/gm/): MIDI tracks sound with " +
            "openDAW's synths.";
        return { ok: true, texto: [gm, datos.biblioteca ?? ""].filter(Boolean).join("\n\n") };
      }
      case "buscar_web": {
        const consulta = String(args.consulta ?? "").trim();
        if (consulta === "") return { ok: false, texto: "Missing the query." };
        const maximo = Math.min(10, Math.max(1, Math.round(Number(args.resultados) || 5)));
        const datos = (await pedirJson("/api/llm/api/web_search", { query: consulta, max_results: maximo }, 45000, senal)) as {
          results?: { title?: string; url?: string; content?: string }[];
        };
        const resultados = datos.results ?? [];
        if (resultados.length === 0) return { ok: true, texto: `No results for “${consulta}”.` };
        return {
          ok: true,
          texto: resultados
            .map((r, i) => `${i + 1}. ${r.title ?? "(no title)"}\n   ${r.url ?? ""}\n   ${(r.content ?? "").replace(/\s+/g, " ").slice(0, 500)}`)
            .join("\n"),
        };
      }
      case "leer_web": {
        const url = String(args.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, texto: "A full URL is needed (https://…)." };
        const datos = (await pedirJson("/api/llm/api/web_fetch", { url }, 60000, senal)) as {
          title?: string;
          content?: string;
        };
        const contenido = (datos.content ?? "").trim();
        if (contenido === "") return { ok: false, texto: `The page returned no text: ${url}` };
        const desde = Math.max(0, Math.trunc(Number(args.desde) || 0));
        const trozo = contenido.slice(desde, desde + 6000);
        const resto = contenido.length - (desde + trozo.length);
        return {
          ok: true,
          texto:
            `${datos.title ?? url}\n\n${trozo}` +
            (resto > 0 ? `\n[… continues: ${resto} more characters. leer_web(url, desde=${desde + trozo.length})]` : ""),
        };
      }
      case "verificar_audio": {
        const tope = Number(args.timeout_segundos);
        const datos = await pedirJson(
          "/api/verificar",
          { path: args.path },
          Number.isFinite(tope) && tope > 0 ? tope * 1000 + 45000 : 225000,
          senal,
        );
        return { ok: datos.ok === true, texto: String(datos.informe ?? "(no report)") };
      }
      case "ejecutar_python": {
        const segundos = Number(args.timeout_segundos) || 300;
        // The GPU only if the model ASKS for it and the person ALLOWS it in the selector.
        // Before, it was enough for the selector to be on GPU: on Oct 27 a script that only
        // looked for files switched on a paid A10.
        if (args.destino === "lambda" && destinoPreferido !== "lambda") {
          return {
            ok: false,
            texto:
              "The GPU is not allowed: the chat selector is on CPU. Run on CPU, or ask the " +
              "person to enable it if it is really needed (it costs money per hour).",
          };
        }
        const destino: Destino = args.destino === "lambda" ? "lambda" : "cpu";
        // On Lambda the first start is ~3 minutes: the client limit covers it.
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
            `machine ${String(info.ip ?? "?")} (${String(info.nota ?? "")})` +
              (traidos.length > 0 ? `; returned: ${traidos.join(", ")}` : ""),
          );
        }
        const escritos = Array.isArray(datos.escritos) ? (datos.escritos as string[]) : [];
        if (escritos.length > 0) {
          partes.push(
            `files written: ${escritos.slice(0, 12).join(", ")}` +
              (escritos.length > 12 ? ` and ${escritos.length - 12} more` : ""),
          );
        }
        if (salida !== "") partes.push(`output:\n${salida}`);
        if (errores !== "") partes.push(`errors:\n${errores}`);
        return { ok: datos.ok === true, texto: partes.join("\n") };
      }
      default:
        return { ok: false, texto: `Unknown tool: ${nombre}` };
    }
  } catch (error) {
    const abortado = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      texto: abortado
        ? "The tool's wait time ran out and the process was cut off."
        : `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Common fields of the tools that write notes (track, bar, instrument). */
function escrituraDe(args: Record<string, unknown>): PeticionEscritura {
  const peticion: PeticionEscritura = { pista: String(args.pista ?? "").trim() || "Pista" };
  if (typeof args.desde_compas === "number") peticion.desdeCompas = args.desde_compas;
  if (typeof args.instrumento === "string") peticion.instrumento = args.instrumento;
  if (typeof args.programa === "number") peticion.programa = args.programa;
  if (typeof args.nombre_clip === "string" && args.nombre_clip.trim() !== "") peticion.nombreClip = args.nombre_clip.trim();
  return peticion;
}

/** Summary of a call, to show it in the chat. */
/**
 * What is seen in the bar while a tool runs, in words (in English, like the whole
 * interface): "running
 * hacer_audio.py". Measured on Oct 28: with "ejecutar_python(proyectos/stahl/…)" a
 * 2.5-minute render looked like the model thinking.
 */
export function resumenLlamada(nombre: string, argumentosJson: string): string {
  try {
    const args = JSON.parse(argumentosJson === "" ? "{}" : argumentosJson) as Record<string, unknown>;
    const fichero = String(args.path ?? "").split("/").pop() || String(args.path ?? "");
    if (nombre === "escribir_fichero") {
      return `writing ${fichero} (${String(args.contenido ?? "").length} chars)`;
    }
    if (nombre === "ejecutar_python") {
      const extra = Array.isArray(args.argumentos) && args.argumentos.length > 0 ? ` ${args.argumentos.join(" ")}` : "";
      const gpu = args.destino === "lambda" ? " @lambda on the GPU" : "";
      return `running ${fichero}${extra}${gpu}`;
    }
    if (nombre === "leer_fichero") return `reading ${fichero}`;
    if (nombre === "editar_fichero") return `editing ${fichero}`;
    if (nombre === "verificar_audio") return `checking ${fichero}`;
    if (nombre === "ajustar_pistas") {
      const n = Array.isArray(args.pistas) ? (args.pistas as unknown[]).length : 0;
      return `adjusting ${n} track(s)`;
    }
    if (nombre === "anadir_pistas") {
      const m = Array.isArray(args.midis) ? (args.midis as unknown[]).length : 0;
      const w = Array.isArray(args.wavs) ? (args.wavs as unknown[]).length : 0;
      return `adding tracks (${m} midi, ${w} wav)`;
    }
    if (nombre === "usar_instrumento") return `loading ${String(args.sfz ?? "the instrument")}`;
    if (nombre === "exportar") return `exporting ${[args.midi === true ? "MIDI" : "", args.wav === true ? "WAV" : ""].filter(Boolean).join(" and ")}`;
    if (nombre === "escuchar_mezcla") return "listening to the mix with the engine";
    if (nombre === "buscar_web") return `searching the web “${String(args.consulta ?? "").slice(0, 60)}”`;
    if (nombre === "leer_web") return `reading ${String(args.url ?? "a page")}`;
    return nombre;
  } catch {
    return nombre;
  }
}

/**
 * Full output of a tool -> `_salidas/` at the workspace root, NOT inside the project:
 * if the agent creates a new project halfway through a turn, the earlier files must
 * still be findable (it happened: 4 "does not exist" reads because they had been written
 * in the previous project). Only the head and the tail are passed to the model: a render
 * prints hundreds of lines and dragging them through the context makes every turn more
 * expensive and distracts it.
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
 * Runs a tool and leaves the result ready for the model: if the output is long it is
 * trimmed and the whole text is saved in the project so it can be re-read with
 * `leer_fichero`.
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentosJson: string,
  senal?: AbortSignal,
): Promise<ResultadoHerramienta> {
  const resultado = await ejecutarCrudo(nombre, argumentosJson, senal);
  // The ones that already read page by page are not trimmed: otherwise each page was saved in
  // another file that, when read, was trimmed again (the agent read in circles).
  if (resultado.texto.length <= UMBRAL_SALIDA || PAGINADAS.has(nombre)) return resultado;

  let aviso: string;
  try {
    const fichero = await guardarSalidaLarga(nombre, resultado.texto);
    aviso = `\n[Full output (${resultado.texto.length} characters) in ${fichero}: read it with leer_fichero if you need it]`;
  } catch {
    aviso = `\n[Output trimmed from ${resultado.texto.length} characters: it could not be saved whole]`;
  }
  return { ...resultado, texto: recortarSalida(resultado.texto) + aviso };
}
