/**
 * What the MuLaCover module sends to `workspace/gpu/generar_mulacover.py`. Pure, tested.
 *
 * MuLaCover (HeartMuLa, read at e27fa7f on 8-Nov-2026): a cover from reference audio, or from melody/chord
 * MIDI, with new lyrics and a style text. Heard by the user on 8-Nov over Ghosts Again with his lyrics:
 * "el cover está bien, con la letra y todo, es más pop… la voz es más convencional". Its weights and
 * outputs are CC BY-NC 4.0 (its LICENSING.md); the user, 8-Nov: experimental project, allowed with disclaimers.
 */

/** Pinned like ACE-Step: a machine switched off reinstalls, and `main` must not change between two takes. */
export const MULACOVER_COMMIT = "e27fa7f";

/** The CLI's defaults (src/mulacover/cli.py at e27fa7f). */
export const POR_DEFECTO = { temperatura: 1.0, topk: 250, cfg: 1.5 } as const;

/** Its example (assets/tags.txt): one-line named fields. */
export const ESTILO_EJEMPLO = "topic:[Isolation]; genre:[industrial]; instrument:[synthesizer,drum machine]; mood:[dark]";

export const LETRA_EJEMPLO = "[Intro]\n\n[Verse]\nFirst line\nSecond line\n\n[Chorus]\nA line\n\n[Outro]";

export const LICENCIA =
  "MuLaCover's weights and everything they generate are licensed CC BY-NC 4.0: non-commercial use only, unless MuLa Labs grants a " +
  "separate written licence. A song used as the source keeps its own rights (composition, recording, lyrics): you need them for anything " +
  "beyond private experiments.";

export type TipoFuente = "audio" | "midi";

export interface Parametros {
  nombre: string;
  tipo: TipoFuente;
  /** audio: a file in the project folder ("entrada/x.wav"). */
  audio: string | null;
  /** audio only; null = MuLaCover estimates it. */
  bpm: number | null;
  /** midi: the melody and chords are required, the drums optional. */
  melodia: string | null;
  acordes: string | null;
  bateria: string | null;
  letra: string;
  estilo: string;
  /** -1 = random; the script then draws one and records it. */
  semilla: number;
  temperatura: number;
  topk: number;
  cfg: number;
}

const NOMBRE = /^[A-Za-z0-9._-]+$/;

/** Refuses with a reason; never corrects. Null = it can run. */
export function validarParametros(p: Parametros): string | null {
  if (p.nombre.trim() === "") return "The take needs a name.";
  if (!NOMBRE.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  if (p.tipo === "audio") {
    if (!p.audio) return "Choose the source audio.";
    if (p.bpm !== null && !(p.bpm >= 30 && p.bpm <= 300)) return "The BPM has to be between 30 and 300, or empty to estimate it.";
  } else {
    if (!p.melodia || !p.acordes) return "From MIDI, MuLaCover needs a melody .mid and a chord .mid (drums are optional).";
    // The CLI refuses it: "--bpm is only used with --ref_audio".
    if (p.bpm !== null) return "The BPM is only used with an audio source: a MIDI carries its own tempo.";
  }
  if (p.letra.trim() === "") return "MuLaCover needs lyrics (its CLI requires them).";
  if (p.estilo.trim() === "") return "Write the style, e.g. " + ESTILO_EJEMPLO;
  if (!(Number.isInteger(p.semilla) && p.semilla >= -1)) return "Seed: a whole number, or -1 for random.";
  if (!(Number.isFinite(p.temperatura) && p.temperatura > 0 && p.temperatura <= 2)) return "Temperature: a number above 0, up to 2.";
  if (!(Number.isInteger(p.topk) && p.topk >= 1 && p.topk <= 1000)) return "Top-k: a whole number from 1 to 1000.";
  if (!(Number.isFinite(p.cfg) && p.cfg >= 1 && p.cfg <= 10)) return "CFG: a number from 1 to 10.";
  return null;
}

/** The files that travel with the run. */
export function entradasDe(p: Parametros): string[] {
  return (p.tipo === "audio" ? [p.audio] : [p.melodia, p.acordes, p.bateria]).filter((x): x is string => !!x);
}

/** Only what applies to the source type travels, each value as it is. */
export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  const comun = { nombre: p.nombre, tipo: p.tipo, letra: p.letra, estilo: p.estilo, semilla: p.semilla, temperatura: p.temperatura, topk: p.topk, cfg: p.cfg };
  return p.tipo === "audio"
    ? { ...comun, audio: p.audio, bpm: p.bpm }
    : { ...comun, melodia: p.melodia, acordes: p.acordes, bateria: p.bateria };
}

/** The script's last line: `[generar_mulacover] RESULT {...}`. */
export function leerResultado(salida: string): { wav: string; midi: string[]; semilla: number | null; generate_s: number | null } | null {
  const linea = salida.split("\n").reverse().find((l) => l.includes("RESULT {"));
  if (!linea) return null;
  try {
    const r = JSON.parse(linea.slice(linea.indexOf("{"))) as { wav?: unknown; midi?: unknown; seed?: unknown; generate_s?: unknown };
    if (typeof r.wav !== "string") return null;
    return {
      wav: r.wav,
      midi: Array.isArray(r.midi) ? r.midi.filter((m): m is string => typeof m === "string") : [],
      semilla: typeof r.seed === "number" ? r.seed : null,
      generate_s: typeof r.generate_s === "number" ? r.generate_s : null,
    };
  } catch {
    return null;
  }
}
