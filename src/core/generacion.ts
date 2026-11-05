/**
 * Audio generation with a music model (ACE-Step 1.5 on the Lambda GPU): the pure part.
 *
 * Two things live here so they can be tested without a browser or an instance:
 * how a request plus the open project become the arguments of
 * `workspace/gpu/generar_audio.py`, and how the script's stdout is read back.
 *
 * Measured on 2-Nov-2026 on a Lambda A10 (22 GB): XL turbo + 1.7B LM, 30 s of audio in
 * 13 s once loaded (first load 108 s + 34 s, peak 16 GB). The defaults below follow that
 * run: XL turbo, 8 steps, the LM on.
 *
 * 4-Nov-2026 (Carlos: "quiero usar base, sft y turbo y poder usarlos con las propiedades
 * de que dispongan"): every checkpoint and every task the model has. The tables come from
 * `acestep/constants.py` and the README of ACE-Step-1.5 (`main`, read 4-Nov), not from a
 * run: TASK_TYPES, TASK_TYPES_TURBO, TRACK_NAMES and the instruction templates are copied
 * verbatim. Only `text2music` has been run here so far.
 */

import type { Project } from "./types.ts";
import { beatsPerBar } from "./types.ts";
import { segundosPorTiempo } from "./tiempo.ts";

/** `task_type` strings of ACE-Step 1.5, verbatim (`TASK_TYPES` in constants.py). */
export const TAREAS = ["text2music", "cover", "cover-nofsq", "repaint", "extract", "lego", "complete"] as const;
export type Tarea = (typeof TAREAS)[number];

/** What a turbo or sft checkpoint can do (`TASK_TYPES_TURBO`); base does all of TAREAS. */
const TAREAS_TURBO: readonly Tarea[] = ["text2music", "cover", "cover-nofsq", "repaint"];

/** Every task but text2music works from a source WAV (`src_audio`). */
export const TAREAS_CON_AUDIO: ReadonlySet<Tarea> = new Set<Tarea>(TAREAS.filter((t) => t !== "text2music"));

/** Instrument names the model understands in extract / lego / complete (`TRACK_NAMES`). */
export const PISTAS_MODELO = [
  "vocals", "backing_vocals", "drums", "percussion", "bass", "guitar",
  "keyboard", "synth", "strings", "brass", "woodwinds", "fx",
] as const;
export type PistaModelo = (typeof PISTAS_MODELO)[number];

export interface Checkpoint {
  nombre: string;
  /** base: pretrained, knows the stem tasks; sft: fine-tuned on top; turbo: sft distilled to 8 steps. */
  familia: "base" | "sft" | "turbo";
  parametros: "2B" | "4B";
  /** Diffusion steps the README gives for the family (8 turbo, 50 base/sft). */
  pasos: number;
  /** Classifier-free guidance: base and sft use it (7.0); the handler forces 1.0 on turbo. */
  cfg: boolean;
  tareas: readonly Tarea[];
}

/** The six DiT checkpoints of ACE-Step 1.5 (README tables, read 4-Nov-2026). */
export const MODELOS: readonly Checkpoint[] = [
  { nombre: "acestep-v15-turbo", familia: "turbo", parametros: "2B", pasos: 8, cfg: false, tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-sft", familia: "sft", parametros: "2B", pasos: 50, cfg: true, tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-base", familia: "base", parametros: "2B", pasos: 50, cfg: true, tareas: TAREAS },
  { nombre: "acestep-v15-xl-turbo", familia: "turbo", parametros: "4B", pasos: 8, cfg: false, tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-xl-sft", familia: "sft", parametros: "4B", pasos: 50, cfg: true, tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-xl-base", familia: "base", parametros: "4B", pasos: 50, cfg: true, tareas: TAREAS },
];

export function modeloPorNombre(nombre: string): Checkpoint | undefined {
  return MODELOS.find((m) => m.nombre === nombre);
}

/** The checkpoints that can run `tarea`, for an error message or a menu. */
export function modelosPara(tarea: Tarea): string[] {
  return MODELOS.filter((m) => m.tareas.includes(tarea)).map((m) => m.nombre);
}

export interface PeticionGeneracion {
  /**
   * Caption for the model: style, instruments, mood (max 512 characters). Required for
   * every task but extract (which only needs the track name).
   */
  prompt: string;
  /** Lyrics; empty or "[Instrumental]" means no voice. */
  letra?: string;
  /** Vocal language code (en, es...) when there are lyrics. */
  idioma?: string;
  /** Seconds, 10-600. Default 30. Only text2music: the other tasks last what the source lasts. */
  duracion?: number;
  /** Override the project's tempo / key / time signature (by default they are taken from it). */
  bpm?: number;
  tonalidad?: string;
  /** How many takes of the same prompt (1-8). */
  variantes?: number;
  /** Fixed seed for reproducibility; omitted = random. */
  semilla?: number;
  /** Output name (file and track). */
  nombre: string;
  /** DiT checkpoint (one of MODELOS). */
  modelo?: string;
  /** Diffusion steps; by default the checkpoint's (8 turbo, 50 base/sft). */
  pasos?: number;
  /** What to do (default text2music). */
  tarea?: Tarea;
  /** Source WAV, relative to the project folder (the action renders it there). Every task but text2music. */
  audio?: string;
  /** cover: 1.0 follows the source closely, 0.2 keeps only its style (README). Default 1.0. */
  fuerza?: number;
  /**
   * repaint / lego: bar range to redo or to fill, from 1 and inclusive, counted from the
   * start of the source audio (a rendered mix starts at bar 1). Omitted = the whole source.
   */
  desdeCompas?: number;
  hastaCompas?: number;
  /**
   * extract / lego: the instrument, one of PISTAS_MODELO. complete: the instruments to add,
   * comma-separated, each one of PISTAS_MODELO; omitted = the model chooses.
   */
  pista?: string;
}

export const MODELO_POR_DEFECTO = "acestep-v15-xl-turbo";
export const LM_POR_DEFECTO = "acestep-5Hz-lm-1.7B";
/** Folder inside the project where generated takes land. */
export const CARPETA_GENERADO = "generado";

const NOMBRE_MODO: Record<string, string> = {
  major: "major",
  minor: "minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  harmonicMinor: "harmonic minor",
  pentatonicMinor: "minor pentatonic",
};

/** "E minor", "F# major": the key as ACE-Step's `keyscale` wants it. */
export function tonalidadParaModelo(key: Project["key"]): string {
  return `${key.tonic} ${NOMBRE_MODO[key.mode] ?? key.mode}`;
}

/** The instrument names of a `pista` value ("Drums, bass" -> ["drums", "bass"]). */
export function pistasDelModelo(pista: string | undefined): string[] {
  return (pista ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean);
}

/** Seconds from the start of a source that begins at bar 1 to the start of `compas` (from 1). */
export function segundosHastaCompas(compas: number, proyecto: Pick<Project, "bpm" | "timeSignature">): number {
  return (compas - 1) * beatsPerBar(proyecto as Project) * segundosPorTiempo(proyecto.bpm);
}

/** Caps the free values to what the model accepts; the rest is rejected with a reason. */
export function validarGeneracion(p: PeticionGeneracion): string | null {
  const tarea = p.tarea ?? "text2music";
  if (!TAREAS.includes(tarea)) return `Unknown \`tarea\` "${String(tarea)}": one of ${TAREAS.join(", ")}.`;
  const modelo = modeloPorNombre(p.modelo ?? MODELO_POR_DEFECTO);
  if (!modelo) return `Unknown \`modelo\` "${p.modelo}": one of ${MODELOS.map((m) => m.nombre).join(", ")}.`;
  if (!modelo.tareas.includes(tarea)) {
    return `${modelo.nombre} cannot do ${tarea} (only ${modelo.tareas.join(", ")}); use ${modelosPara(tarea).join(" or ")}.`;
  }
  if (tarea !== "extract" && p.prompt.trim() === "") return "Missing `prompt`: describe style, instruments and mood.";
  if (p.prompt.length > 512) return `The prompt has ${p.prompt.length} characters; the model takes 512 at most.`;
  if (p.nombre.trim() === "") return "Missing `nombre` for the file and the track.";
  if (TAREAS_CON_AUDIO.has(tarea) && (p.audio ?? "").trim() === "") {
    return `${tarea} works from a source audio: give \`fuente\` ("mix", a track name or a WAV path in the project).`;
  }
  if (p.fuerza !== undefined) {
    if (tarea !== "cover" && tarea !== "cover-nofsq") return "`fuerza` only applies to cover.";
    if (!(p.fuerza >= 0 && p.fuerza <= 1)) return `\`fuerza\` ${p.fuerza} is outside 0-1.`;
  }
  if (p.desdeCompas !== undefined || p.hastaCompas !== undefined) {
    const d = p.desdeCompas ?? 1;
    const h = p.hastaCompas ?? d;
    if (!(Number.isInteger(d) && d >= 1)) return `\`desde_compas\` must be an integer from 1 (got ${d}).`;
    if (!(Number.isInteger(h) && h >= d)) return `\`hasta_compas\` must be an integer >= desde_compas (got ${h}).`;
  }
  const pistas = pistasDelModelo(p.pista);
  if ((tarea === "extract" || tarea === "lego") && pistas.length !== 1) {
    return `${tarea} needs ONE \`pista\`: ${PISTAS_MODELO.join(", ")}.`;
  }
  if (tarea === "complete" || tarea === "extract" || tarea === "lego") {
    const malas = pistas.filter((x) => !(PISTAS_MODELO as readonly string[]).includes(x));
    if (malas.length > 0) return `The model has no track "${malas.join('", "')}": ${PISTAS_MODELO.join(", ")}.`;
  } else if (pistas.length > 0) {
    return "`pista` only applies to extract, lego and complete.";
  }
  if (tarea === "text2music") {
    const d = p.duracion ?? 30;
    if (!(d >= 10 && d <= 600)) return `Duration ${d} s is outside 10-600 s.`;
  }
  const v = p.variantes ?? 1;
  if (!(Number.isInteger(v) && v >= 1 && v <= 8)) return `\`variantes\` must be an integer from 1 to 8 (got ${v}).`;
  if (p.bpm !== undefined && !(p.bpm >= 30 && p.bpm <= 300)) return `BPM ${p.bpm} is outside 30-300.`;
  if (p.pasos !== undefined && !(Number.isInteger(p.pasos) && p.pasos >= 1 && p.pasos <= 200)) {
    return `\`pasos\` must be an integer from 1 to 200 (got ${p.pasos}).`;
  }
  return null;
}

/** Command-line arguments for `gpu/generar_audio.py`, with the project filling the gaps. */
export function argumentosGeneracion(p: PeticionGeneracion, proyecto: Project): string[] {
  const tarea = p.tarea ?? "text2music";
  const modelo = modeloPorNombre(p.modelo ?? MODELO_POR_DEFECTO) ?? MODELOS[3]!;
  const letra = (p.letra ?? "").trim() || "[Instrumental]";
  const args = [
    "--tarea", tarea,
    "--prompt", p.prompt.trim(),
    "--letra", letra,
    "--bpm", String(p.bpm ?? proyecto.bpm),
    "--tonalidad", p.tonalidad?.trim() || tonalidadParaModelo(proyecto.key),
    "--compas", String(proyecto.timeSignature.numerator),
    "--variantes", String(p.variantes ?? 1),
    "--modelo", modelo.nombre,
    "--pasos", String(p.pasos ?? modelo.pasos),
    // The 5 Hz LM only takes part in text2music: `DIRECT_CONDITIONING_TASKS` in the handler
    // skips it for the six audio tasks, so loading it there is VRAM and ~30 s for nothing.
    "--lm", tarea === "text2music" ? LM_POR_DEFECTO : "none",
    "--nombre", p.nombre.trim(),
    "--salida", CARPETA_GENERADO,
  ];
  // The source tasks last what the source lasts (the handler ignores `duration` for them).
  if (tarea === "text2music") args.push("--duracion", String(p.duracion ?? 30));
  if (p.audio) args.push("--audio", p.audio.trim());
  if (p.fuerza !== undefined) args.push("--fuerza", String(p.fuerza));
  // repaint redoes a range of the source and lego fills one; the other tasks take the range
  // in the input file itself (the action renders only those bars).
  if ((tarea === "repaint" || tarea === "lego") && (p.desdeCompas !== undefined || p.hastaCompas !== undefined)) {
    const desde = p.desdeCompas ?? 1;
    args.push("--desde", segundosHastaCompas(desde, proyecto).toFixed(3));
    if (p.hastaCompas !== undefined) args.push("--hasta", segundosHastaCompas(p.hastaCompas + 1, proyecto).toFixed(3));
  }
  const pistas = pistasDelModelo(p.pista);
  if (pistas.length > 0) args.push("--pista", pistas.join(","));
  if (p.idioma && p.idioma.trim() !== "") args.push("--idioma", p.idioma.trim());
  if (p.semilla !== undefined && Number.isInteger(p.semilla) && p.semilla >= 0) args.push("--semilla", String(p.semilla));
  return args;
}

export interface ResultadoGeneracion {
  /** File names inside `generado/`. */
  ficheros: string[];
  /** Seconds, as the script measured them (missing keys = not reported). */
  tiempos: Partial<Record<"bootstrap_s" | "dit_init_s" | "lm_init_s" | "generate_s" | "vram_peak_gb", number>>;
}

/**
 * Reads the `RESULT {...}` line the script prints last. Returns null if the script did
 * not get that far (the caller then shows the stderr tail instead of guessing).
 */
export function leerResultadoGeneracion(salida: string): ResultadoGeneracion | null {
  const lineas = salida.split("\n").map((l) => l.trim()).filter((l) => l.includes("RESULT {"));
  const ultima = lineas.at(-1);
  if (!ultima) return null;
  try {
    const json = JSON.parse(ultima.slice(ultima.indexOf("{"))) as Record<string, unknown>;
    const ficheros = Array.isArray(json.files) ? (json.files as unknown[]).map(String) : [];
    if (ficheros.length === 0) return null;
    const tiempos: ResultadoGeneracion["tiempos"] = {};
    for (const clave of ["bootstrap_s", "dit_init_s", "lm_init_s", "generate_s", "vram_peak_gb"] as const) {
      if (typeof json[clave] === "number") tiempos[clave] = json[clave] as number;
    }
    return { ficheros, tiempos };
  } catch {
    return null;
  }
}

/** One line for the agent: what took how long, so it can tell the user why it waited. */
export function resumenTiempos(t: ResultadoGeneracion["tiempos"]): string {
  const partes: string[] = [];
  if (t.bootstrap_s) partes.push(`install ${Math.round(t.bootstrap_s)} s`);
  if (t.dit_init_s) partes.push(`model load ${Math.round(t.dit_init_s + (t.lm_init_s ?? 0))} s`);
  // Math.round first: (15.95).toFixed(1) is "15.9" in binary floating point.
  const decima = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
  if (t.generate_s !== undefined) partes.push(`generation ${decima(t.generate_s)} s`);
  if (t.vram_peak_gb !== undefined) partes.push(`VRAM peak ${decima(t.vram_peak_gb)} GB`);
  return partes.join(" · ");
}
