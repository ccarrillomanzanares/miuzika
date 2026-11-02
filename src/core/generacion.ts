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
 */

import type { Project } from "./types.ts";

export interface PeticionGeneracion {
  /** Caption for the model: style, instruments, mood (max 512 characters). */
  prompt: string;
  /** Lyrics; empty or "[Instrumental]" means no voice. */
  letra?: string;
  /** Vocal language code (en, es...) when there are lyrics. */
  idioma?: string;
  /** Seconds, 10-600. Default 30. */
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
  /** DiT variant. */
  modelo?: string;
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

/** Caps the free values to what the model accepts; the rest is rejected with a reason. */
export function validarGeneracion(p: PeticionGeneracion): string | null {
  if (p.prompt.trim() === "") return "Missing `prompt`: describe style, instruments and mood.";
  if (p.prompt.length > 512) return `The prompt has ${p.prompt.length} characters; the model takes 512 at most.`;
  if (p.nombre.trim() === "") return "Missing `nombre` for the file and the track.";
  const d = p.duracion ?? 30;
  if (!(d >= 10 && d <= 600)) return `Duration ${d} s is outside 10-600 s.`;
  const v = p.variantes ?? 1;
  if (!(Number.isInteger(v) && v >= 1 && v <= 8)) return `\`variantes\` must be an integer from 1 to 8 (got ${v}).`;
  if (p.bpm !== undefined && !(p.bpm >= 30 && p.bpm <= 300)) return `BPM ${p.bpm} is outside 30-300.`;
  return null;
}

/** Command-line arguments for `gpu/generar_audio.py`, with the project filling the gaps. */
export function argumentosGeneracion(p: PeticionGeneracion, proyecto: Project): string[] {
  const letra = (p.letra ?? "").trim() || "[Instrumental]";
  const args = [
    "--prompt", p.prompt.trim(),
    "--letra", letra,
    "--duracion", String(p.duracion ?? 30),
    "--bpm", String(p.bpm ?? proyecto.bpm),
    "--tonalidad", p.tonalidad?.trim() || tonalidadParaModelo(proyecto.key),
    "--compas", String(proyecto.timeSignature.numerator),
    "--variantes", String(p.variantes ?? 1),
    "--modelo", p.modelo ?? MODELO_POR_DEFECTO,
    "--lm", LM_POR_DEFECTO,
    "--nombre", p.nombre.trim(),
    "--salida", CARPETA_GENERADO,
  ];
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
