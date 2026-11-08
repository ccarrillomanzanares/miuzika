/**
 * What the Stable Audio module sends to `workspace/gpu/generar_stableaudio.py`. Pure, tested.
 *
 * Stable Audio 3 (Stability AI, read at 790793b on 8-Nov-2026). Heard by Carlos on 8-Nov: an instrumental song at cfg 1
 * "es super industrial... wow!!!", the first model that landed his style; a solo bass "suena a bajo"; at cfg 7 the song
 * "está super saturada" and the bass mixed in other instruments. Instrumental only: its docs say it "doesn't output
 * intelligible vocals".
 */

/** Pinned like ACE-Step; tied to generar_stableaudio.py by a test. */
export const SA3_COMMIT = "790793b";

/** Gated on Hugging Face: Settings checks the token reaches them. */
export const MODELOS_HF_CON_PUERTA = ["stabilityai/stable-audio-3-medium", "stabilityai/stable-audio-3-small-music"] as const;

export type Tarea = "texto" | "audio" | "repintar" | "continuar";
export type Modelo = "medium" | "small-music" | "small-sfx";

/** From the repo's README table and prompting guide (790793b). */
export const MODELOS: readonly { nombre: Modelo; maxSegundos: number; nota: string }[] = [
  { nombre: "medium", maxSegundos: 380, nota: "1.4B, the best: music, solo instruments and sound effects, up to 6 min 20 s." },
  { nombre: "small-music", maxSegundos: 120, nota: "433M: music and solo instruments only, up to 2 min. Lighter, less quality." },
  { nombre: "small-sfx", maxSegundos: 120, nota: "433M: sound effects only, up to 2 min." },
];

/**
 * The kinds of sound, as the AudioSparx-style tags its prompting guide recommends. They open the prompt; Review shows the
 * whole text, editable, so nothing is added in hidden.
 */
export const TIPOS = [
  { id: "cancion", etiqueta: "Instrumental song", prefijo: "TrackType: Music, VocalType: Instrumental" },
  { id: "instrumento", etiqueta: "One instrument (stem)", prefijo: "TrackType: Instrument" },
  { id: "efecto", etiqueta: "Sound effect", prefijo: "TrackType: SFX" },
  { id: "libre", etiqueta: "Free text", prefijo: "" },
] as const;
export type Tipo = (typeof TIPOS)[number]["id"];

/** cfg 1 is the model's default and what passed by ear; 7 saturated (8-Nov, RMS -7.3 against -16.6 dB). */
export const POR_DEFECTO = { steps: 8, cfg: 1.0, duracion: 30, ruido: 0.9 } as const;

export const LICENCIA =
  "Stable Audio 3's weights are under the Stability AI Community License: free for research, personal use and commercial use " +
  "while you (or your organisation) make under US$1,000,000 a year; commercial use asks you to register with Stability AI " +
  "(stability.ai/community-license). Above that threshold you need their enterprise licence. What you generate is yours. Its text " +
  "encoder comes under Google's Gemma Terms of Use. A source you upload keeps its own rights.";

export interface Parametros {
  nombre: string;
  modelo: Modelo;
  tarea: Tarea;
  prompt: string;
  negativo: string;
  /** Seconds of the result. For "continuar", the total: source + what is added. */
  duracion: number;
  steps: number;
  cfg: number;
  /** -1 = random; the script then draws one and records it. */
  semilla: number;
  tomas: number;
  /** A WAV in the project folder: the source of audio / repintar / continuar. */
  audio: string | null;
  /** audio-to-audio: 0 keeps the source, 1 ignores it. */
  ruido: number | null;
  /** repintar: the region, in seconds of the source. */
  desde: number | null;
  hasta: number | null;
  /** continuar: the source's length, where the new part starts. */
  largoFuente: number | null;
}

const NOMBRE = /^[A-Za-z0-9._-]+$/;

export function prefijoDe(tipo: Tipo): string {
  return TIPOS.find((t) => t.id === tipo)?.prefijo ?? "";
}

/** The prompt as it travels: the kind's tags, the description, the BPM if given. Shown whole on Review. */
export function componerPrompt(tipo: Tipo, descripcion: string, bpm: number | null): string {
  const partes = [prefijoDe(tipo), descripcion.trim()].filter(Boolean);
  let texto = partes.join(". ");
  if (bpm !== null && !/\b\d+(\.\d+)?\s*BPM\b/i.test(texto)) texto += `${texto ? ", " : ""}${bpm} BPM`;
  return texto;
}

export function validarParametros(p: Parametros): string | null {
  if (p.nombre.trim() === "") return "The take needs a name.";
  if (!NOMBRE.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  const modelo = MODELOS.find((m) => m.nombre === p.modelo);
  if (!modelo) return `Unknown model "${p.modelo}".`;
  if (p.prompt.trim() === "") return "Describe the sound: the prompt is empty.";
  if (!(p.duracion > 0 && p.duracion <= modelo.maxSegundos)) return `Duration: from 1 to ${modelo.maxSegundos} s on ${p.modelo}.`;
  if (!(Number.isInteger(p.steps) && p.steps >= 1 && p.steps <= 200)) return "Steps: a whole number from 1 to 200 (8 is its default; base models ~50).";
  if (!(Number.isFinite(p.cfg) && p.cfg >= 0 && p.cfg <= 15)) return "CFG: a number from 0 to 15 (1 is its default; 7 saturated by ear).";
  if (!(Number.isInteger(p.semilla) && p.semilla >= -1)) return "Seed: a whole number, or -1 for random.";
  if (!(Number.isInteger(p.tomas) && p.tomas >= 1 && p.tomas <= 4)) return "Takes: from 1 to 4.";
  if (p.tarea !== "texto" && !p.audio) return "Choose the source audio.";
  if (p.tarea === "audio" && !(p.ruido !== null && p.ruido >= 0 && p.ruido <= 1)) return "Change amount: from 0 (keep the source) to 1 (ignore it).";
  if (p.tarea === "repintar") {
    if (p.desde === null || p.hasta === null || !(p.hasta > p.desde && p.desde >= 0)) return "Repaint needs a region: from and to, the end after the start.";
    if (p.hasta > p.duracion) return "The region ends after the end of the result.";
  }
  if (p.tarea === "continuar") {
    if (p.largoFuente === null || !(p.largoFuente > 0)) return "Continue needs the source's length.";
    if (!(p.duracion > p.largoFuente)) return `To continue, the total duration has to be longer than the source (${p.largoFuente.toFixed(1)} s).`;
  }
  return null;
}

export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  const salida: Record<string, unknown> = {
    nombre: p.nombre, modelo: p.modelo, tarea: p.tarea, prompt: p.prompt, negativo: p.negativo,
    duracion: p.duracion, steps: p.steps, cfg: p.cfg, semilla: p.semilla, tomas: p.tomas,
  };
  if (p.tarea !== "texto") salida.audio = p.audio;
  if (p.tarea === "audio") salida.ruido = p.ruido;
  if (p.tarea === "repintar") {
    salida.desde = p.desde;
    salida.hasta = p.hasta;
  }
  // Continuation is inpainting from the source's end to the new end (its README).
  if (p.tarea === "continuar") {
    salida.desde = p.largoFuente;
    salida.hasta = p.duracion;
  }
  return salida;
}

/** The script's last line: `[generar_stableaudio] RESULT {...}`. */
export function leerResultado(salida: string): { ficheros: string[]; semilla: number | null; generate_s: number | null } | null {
  const linea = salida.split("\n").reverse().find((l) => l.includes("RESULT {"));
  if (!linea) return null;
  try {
    const r = JSON.parse(linea.slice(linea.indexOf("{"))) as { files?: unknown; seed?: unknown; generate_s?: unknown };
    if (!Array.isArray(r.files)) return null;
    return {
      ficheros: r.files.filter((f): f is string => typeof f === "string"),
      semilla: typeof r.seed === "number" ? r.seed : null,
      generate_s: typeof r.generate_s === "number" ? r.generate_s : null,
    };
  } catch {
    return null;
  }
}
