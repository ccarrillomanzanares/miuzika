/**
 * What the Demucs module sends to `workspace/gpu/separar_demucs.py`. Pure, tested.
 *
 * Demucs (MIT, facebookresearch/demucs 4.0.1): separates a mix into stems. Proposed on 7-Nov for drums, where
 * ACE-Step's extract failed ("pegote con restos"); Carlos, 8-Nov: "adelante con demucs".
 */

export const DEMUCS_VERSION = "4.0.1";

/** The pretrained models of 4.0.1 and their stems (demucs/pretrained.py, README). */
export const MODELOS = [
  // Notes from his ear on 8-Nov (cover of Ghosts Again): ft "más limpio" than htdemucs; 6s "guitar y bass no sirven",
  // invented from the synths. ft took 86 s against htdemucs's ~80 s there, not the 4x its README warns of.
  { nombre: "htdemucs_ft", pistas: ["drums", "bass", "other", "vocals"], nota: "Fine-tuned per stem: the cleanest of the three." },
  { nombre: "htdemucs", pistas: ["drums", "bass", "other", "vocals"], nota: "The base model: a little less clean than htdemucs_ft." },
  { nombre: "htdemucs_6s", pistas: ["drums", "bass", "other", "vocals", "guitar", "piano"], nota: "Six stems: only for songs with real guitar or piano; on synth music it invents them." },
] as const;

export type Modelo = (typeof MODELOS)[number]["nombre"];

export interface Parametros {
  nombre: string;
  modelo: Modelo;
  /** A file in the project folder ("entrada/x.wav"). */
  audio: string | null;
  /** Number of random shifts averaged: better, slower (demucs --shifts). */
  shifts: number;
}

const NOMBRE = /^[A-Za-z0-9._-]+$/;

export function pistasDe(modelo: Modelo): readonly string[] {
  return MODELOS.find((m) => m.nombre === modelo)?.pistas ?? [];
}

export function validarParametros(p: Parametros): string | null {
  if (p.nombre.trim() === "") return "The separation needs a name.";
  if (!NOMBRE.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  if (!MODELOS.some((m) => m.nombre === p.modelo)) return `Unknown model "${p.modelo}".`;
  if (!p.audio) return "Choose the mix to separate.";
  if (!(Number.isInteger(p.shifts) && p.shifts >= 1 && p.shifts <= 10)) return "Shifts: a whole number from 1 to 10.";
  return null;
}

export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  return { nombre: p.nombre, modelo: p.modelo, audio: p.audio, shifts: p.shifts };
}

/** The script's last line: `[separar_demucs] RESULT {"files": [...]}`. */
export function leerResultado(salida: string): { ficheros: string[]; separate_s: number | null } | null {
  const linea = salida.split("\n").reverse().find((l) => l.includes("RESULT {"));
  if (!linea) return null;
  try {
    const r = JSON.parse(linea.slice(linea.indexOf("{"))) as { files?: unknown; separate_s?: unknown };
    if (!Array.isArray(r.files)) return null;
    return { ficheros: r.files.filter((f): f is string => typeof f === "string"), separate_s: typeof r.separate_s === "number" ? r.separate_s : null };
  } catch {
    return null;
  }
}
