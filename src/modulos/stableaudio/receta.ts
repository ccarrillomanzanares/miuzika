/**
 * What the Stable Audio module sends to `workspace/gpu/generar_stableaudio.py`. Pure, tested.
 *
 * Stable Audio 3 (Stability AI, read at 790793b on 8-Nov-2026: model.py, docs/guides/prompting.md,
 * docs/workflows/inference.md, the Gradio interface). Heard by Carlos on 8-Nov: an instrumental song at cfg 1 "es super
 * industrial... wow!!!", the first model that landed his style; drums and bass at cfg 1 are what was asked; at cfg 7 the
 * song, the drums and the bass saturated. Every task (text, transform, repaint, continue, small-music) passed by ear.
 * Instrumental only: its docs say it "doesn't output intelligible vocals".
 */

/** Pinned like ACE-Step; tied to generar_stableaudio.py by a test. */
export const SA3_COMMIT = "790793b";

/**
 * Gated on Hugging Face (checked 8-Nov: the API says `"gated": "auto"` for these three and `false` for the -base ones).
 * Settings checks the token reaches them.
 */
export const MODELOS_HF_CON_PUERTA = [
  "stabilityai/stable-audio-3-medium",
  "stabilityai/stable-audio-3-small-music",
  "stabilityai/stable-audio-3-small-sfx",
] as const;

export type Tarea = "texto" | "audio" | "repintar" | "continuar";
export type Modelo = "medium" | "small-music" | "small-sfx" | "medium-base" | "small-music-base" | "small-sfx-base";

export interface InfoModelo {
  nombre: Modelo;
  maxSegundos: number;
  /** Post-trained (rf_denoiser: 8 steps, cfg 1, one sampler) or base (rectified flow: ~50 steps, cfg 7, samplers). */
  base: boolean;
  nota: string;
}

/**
 * From the README table and docs/workflows/inference.md (790793b). The base checkpoints are meant as the start for LoRA
 * training; the docs say steps ~50 there and that cfg and the negative prompt only act on them. Not run by us.
 */
export const MODELOS: readonly InfoModelo[] = [
  { nombre: "medium", maxSegundos: 380, base: false, nota: "1.4B, the best: music, solo instruments and sound effects, up to 6 min 20 s." },
  { nombre: "small-music", maxSegundos: 120, base: false, nota: "433M: music and solo instruments only, up to 2 min. Lighter, less quality." },
  { nombre: "small-sfx", maxSegundos: 120, base: false, nota: "433M: sound effects only, up to 2 min." },
  { nombre: "medium-base", maxSegundos: 380, base: true, nota: "Base checkpoint, not post-trained: ~50 steps, slower; cfg and the negative prompt act here. Not tried yet." },
  { nombre: "small-music-base", maxSegundos: 120, base: true, nota: "Base of small-music: ~50 steps; cfg and the negative prompt act. Not tried yet." },
  { nombre: "small-sfx-base", maxSegundos: 120, base: true, nota: "Base of small-sfx: ~50 steps; cfg and the negative prompt act. Not tried yet." },
];

export function infoModelo(m: Modelo): InfoModelo {
  return MODELOS.find((x) => x.nombre === m) ?? MODELOS[0]!;
}

/** The samplers its Gradio offers for rectified-flow (base) checkpoints; post-trained ones only have "pingpong". */
export const SAMPLERS_BASE = ["euler", "rk4", "dpmpp"] as const;

/**
 * The kinds of sound, as the AudioSparx-style tags its prompting guide recommends. They open the prompt; Review shows the
 * whole text, editable, so nothing is added in hidden.
 */
export const TIPOS = [
  { id: "cancion", etiqueta: "Instrumental song", prefijo: "TrackType: Music, VocalType: Instrumental" },
  { id: "instrumento", etiqueta: "One instrument (stem)", prefijo: "TrackType: Instrument" },
  { id: "duo", etiqueta: "Two instruments (duo)", prefijo: "TrackType: Instrument, Format: Duo" },
  { id: "efecto", etiqueta: "Sound effect", prefijo: "TrackType: SFX" },
  { id: "libre", etiqueta: "Free text", prefijo: "" },
] as const;
export type Tipo = (typeof TIPOS)[number]["id"];

/** The guide's example prompts (prompting.md, 790793b), to start from. Picking one fills the description. */
export const EJEMPLOS: readonly { tipo: Tipo; titulo: string; texto: string }[] = [
  {
    tipo: "cancion",
    titulo: "Tech-house, UK bass",
    texto:
      "A triumphant and stylish UK bass-flavoured tech-house tune that evokes feelings of the last tune played in a DJ set. The pumping four-to-the-floor kick is supported by an 808 bass that is syncopated. There are gliding emotional synth leads that build sections to their climax. Playful stabs and chops support the rhythm of the drums in sections. There is a beautiful gospel house piano that plays in the drop, giving the track a euphoric feeling.",
  },
  {
    tipo: "cancion",
    titulo: "Alternative pop ballad",
    texto:
      "A quirky alternative pop ballad instrumental with the vibe of a long car journey with friends. The catchy synth bass is infectious, the tightly tuned acoustic drums add a classy flair, and the dreamy colourful synths bring a fuzzy old VHS tape atmosphere. At the same time, subtle guitars play indie rock-style motifs. The track is deeply nostalgic with a 90s internet aesthetic and a sense of something lost to time — brooding, bold, youthful, and melancholic.",
  },
  {
    tipo: "cancion",
    titulo: "70s funky hip hop",
    texto:
      "A funky hip hop instrumental with live recorded instrumentation that has the vibe of a 70's TV show theme. The rhythm guitar strums lightly in the background, the lead guitar occasionally delivers jagged flanger-effected chords and phrases, and abstract sounds punctuate the beat with character. A close-mic'd electric piano plays hard with nostalgic supporting chords, flute glides over the beat adding an exciting texture, and the drums are full of swing and old school flavour. The production has a warm, textured sound associated with analogue gear and tape.",
  },
  { tipo: "instrumento", titulo: "Solo acoustic guitar", texto: "a sombre solo acoustic guitar track with cavernous reverb and delicate finger picking." },
  { tipo: "instrumento", titulo: "Solo electric guitar", texto: "an epic solo electric guitar track, live-recorded in a vintage studio." },
  { tipo: "duo", titulo: "Latin drums and percussion", texto: "a dynamic Latin drums and percussion track." },
  {
    tipo: "efecto",
    titulo: "Drawer slam",
    texto:
      "A blunt, powerful \"thud\" made by slamming a wooden desk drawer shut. It has a pronounced low-mid body, making it feel heavy, and is given a touch of analog distortion for aggressive character.",
  },
  {
    tipo: "efecto",
    titulo: "Tape-stop sub bass",
    texto:
      "A massive sub-bass note that mimics a vinyl record or tape machine being turned off. The pitch and speed drop simultaneously, causing the high-end harmonics to \"smear\" and thicken as the sound grinds to a halt at a sub-sonic frequency.",
  },
  { tipo: "efecto", titulo: "Closed hi-hats", texto: "A classic, natural recording of 14-inch hi-hats played tightly closed. Zero ring and a very fast decay." },
];

/**
 * Change amount (init_noise_level) for Transform, from the guide: "as you increase the amount, more lower-level features
 * like melody and rhythm get filtered out, leaving higher-level features like timbre and tonality". 0.7 is what we ran
 * (heard 8-Nov: "también es muy buena"); 0.9 is its README example.
 */
export const CAMBIOS: readonly { valor: number; etiqueta: string }[] = [
  { valor: 0.1, etiqueta: "0.1 · a close variation" },
  { valor: 0.4, etiqueta: "0.4 · new timbre, same notes (its violin → metal guitar example)" },
  { valor: 0.6, etiqueta: "0.6 · new style (its trance → country example)" },
  { valor: 0.7, etiqueta: "0.7 · a new piece in its spirit" },
  { valor: 0.9, etiqueta: "0.9 · almost new (its README example)" },
];

/** cfg 1 is the post-trained default and what passed by ear; 7 saturated (8-Nov, RMS -7.3 against -16.6 dB). */
export const POR_DEFECTO = { steps: 8, cfg: 1.0, duracion: 30, ruido: 0.7, apg: 1.0 } as const;
/** Gradio's defaults for a base (rectified-flow) checkpoint: 50 steps, cfg 7. */
export const POR_DEFECTO_BASE = { steps: 50, cfg: 7.0 } as const;

export const LICENCIA =
  "Stable Audio 3's weights are under the Stability AI Community License: free for research, personal use and commercial use " +
  "while you (or your organisation) make under US$1,000,000 a year; commercial use asks you to register with Stability AI " +
  "(stability.ai/community-license). Above that threshold you need their enterprise licence. What you generate is yours. Its text " +
  "encoder comes under Google's Gemma Terms of Use. A source you upload keeps its own rights.";

export interface Region {
  desde: number;
  hasta: number;
}

export interface Parametros {
  nombre: string;
  modelo: Modelo;
  tarea: Tarea;
  /** The common prompt. Empty is allowed: the guide suggests trying an unconditional generation. */
  prompt: string;
  /** One line per take, added to the common prompt; when given, there are as many takes as lines. */
  variaciones: string[];
  negativo: string;
  /** Seconds of the result. For "continuar", the total: source + what is added. */
  duracion: number;
  steps: number;
  cfg: number;
  /** Adaptive Projected Guidance: 1 = full APG (its default), 0 = plain CFG. Only acts when cfg is not 1. */
  apg: number;
  /** Base checkpoints only; null = the model's own. */
  sampler: string | null;
  /** -1 = random; the script then draws one and records it. */
  semilla: number;
  tomas: number;
  /** A WAV in the project folder: the source of audio / repintar / continuar. */
  audio: string | null;
  /** audio-to-audio: 0 keeps the source, 1 ignores it. */
  ruido: number | null;
  /** repintar: the regions, in seconds of the source; several are repainted in one pass. */
  regiones: Region[];
  /** continuar: the source's length, where the new part starts. */
  largoFuente: number | null;
}

const NOMBRE = /^[A-Za-z0-9._-]+$/;

export function prefijoDe(tipo: Tipo): string {
  return TIPOS.find((t) => t.id === tipo)?.prefijo ?? "";
}

/** "Industrial, EBM" → "Genre: Industrial, Genre: EBM", as the guide writes several genres. */
export function etiquetas(clave: "Genre" | "Instruments", lista: string): string {
  const partes = lista.split(",").map((x) => x.trim()).filter(Boolean);
  if (partes.length === 0) return "";
  return clave === "Genre" ? partes.map((g) => `Genre: ${g}`).join(", ") : `Instruments: ${partes.join(", ")}`;
}

export interface Descripcion {
  tipo: Tipo;
  generos: string;
  instrumentos: string;
  texto: string;
  bpm: number | null;
}

/** The prompt as it travels: the kind's tags, genre and instrument tags, the description, the BPM. Shown whole on Review. */
export function componerPrompt(d: Descripcion): string {
  const cabeza = [prefijoDe(d.tipo), etiquetas("Genre", d.generos), etiquetas("Instruments", d.instrumentos)].filter(Boolean).join(", ");
  let texto = [cabeza, d.texto.trim()].filter(Boolean).join(". ");
  if (d.bpm !== null && !/\b\d+(\.\d+)?\s*BPM\b/i.test(texto)) texto += `${texto ? ", " : ""}${d.bpm} BPM`;
  return texto;
}

/** The prompt of each take: the common one, plus that take's line if there are variations. */
export function promptsPorToma(p: Parametros): string[] {
  if (p.variaciones.length === 0) return Array.from({ length: p.tomas }, () => p.prompt);
  return p.variaciones.map((v) => [p.prompt.trim(), v.trim()].filter(Boolean).join(". "));
}

/** "13-16, 29-32" → [[13,16],[29,32]] (bars, inclusive). null if it does not read. */
export function leerCompases(texto: string): [number, number][] | null {
  const trozos = texto.split(",").map((x) => x.trim()).filter(Boolean);
  if (trozos.length === 0) return null;
  const salida: [number, number][] = [];
  for (const t of trozos) {
    const m = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/.exec(t) ?? /^(\d+)$/.exec(t);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    if (!(a >= 1 && b >= a)) return null;
    salida.push([a, b]);
  }
  return salida;
}

/** Bars (1-based, inclusive) to seconds of the source. */
export function regionesDeCompases(compases: [number, number][], segundosPorCompas: number): Region[] {
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  return compases.map(([a, b]) => ({ desde: r((a - 1) * segundosPorCompas), hasta: r(b * segundosPorCompas) }));
}

export function validarParametros(p: Parametros): string | null {
  if (p.nombre.trim() === "") return "The take needs a name.";
  if (!NOMBRE.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  const modelo = MODELOS.find((m) => m.nombre === p.modelo);
  if (!modelo) return `Unknown model "${p.modelo}".`;
  if (!(p.duracion > 0 && p.duracion <= modelo.maxSegundos)) return `Duration: from 1 to ${modelo.maxSegundos} s on ${p.modelo}.`;
  if (!(Number.isInteger(p.steps) && p.steps >= 1 && p.steps <= 200)) return "Steps: a whole number from 1 to 200 (8 for these models; ~50 for -base).";
  if (!(Number.isFinite(p.cfg) && p.cfg >= 0 && p.cfg <= 15)) return "CFG: a number from 0 to 15 (1 for these models; 7 for -base).";
  if (!(Number.isFinite(p.apg) && p.apg >= 0 && p.apg <= 1)) return "APG: from 0 (plain CFG) to 1 (full APG, its default).";
  if (p.sampler !== null && !(modelo.base && (SAMPLERS_BASE as readonly string[]).includes(p.sampler))) return `Sampler "${p.sampler}" is only for -base models: ${SAMPLERS_BASE.join(", ")}.`;
  if (!(Number.isInteger(p.semilla) && p.semilla >= -1)) return "Seed: a whole number, or -1 for random.";
  if (!(Number.isInteger(p.tomas) && p.tomas >= 1 && p.tomas <= 4)) return "Takes: from 1 to 4.";
  if (p.variaciones.length > 0 && p.variaciones.length !== p.tomas) return "One variation line per take: the number of lines is the number of takes.";
  if (p.variaciones.some((v) => v.trim() === "")) return "A variation line is empty.";
  if (p.tarea !== "texto" && !p.audio) return "Choose the source audio.";
  if (p.tarea === "audio" && !(p.ruido !== null && p.ruido >= 0 && p.ruido <= 1)) return "Change amount: from 0 (keep the source) to 1 (ignore it).";
  if (p.tarea === "repintar") {
    if (p.regiones.length === 0) return "Repaint needs bars: e.g. 13-16, or several as 5-8, 13-16.";
    const ordenadas = [...p.regiones].sort((a, b) => a.desde - b.desde);
    for (const [i, r] of ordenadas.entries()) {
      if (!(r.hasta > r.desde && r.desde >= 0)) return "Each region has to end after it starts.";
      if (r.hasta > p.duracion) return "A region ends after the end of the result.";
      if (i > 0 && r.desde < ordenadas[i - 1]!.hasta) return "Two regions overlap: join them into one.";
    }
  }
  if (p.tarea === "continuar") {
    if (p.largoFuente === null || !(p.largoFuente > 0)) return "Continue needs the source's length.";
    if (!(p.duracion > p.largoFuente)) return `To continue, the total duration has to be longer than the source (${p.largoFuente.toFixed(1)} s).`;
  }
  return null;
}

/**
 * Things that let the run go but are worth knowing, from the code and the guide (790793b) and our own runs. Shown on Review.
 */
export function avisos(p: Parametros): string[] {
  const modelo = infoModelo(p.modelo);
  const salida: string[] = [];
  // dit.py: classifier-free guidance (where the negative prompt enters) only runs when cfg_scale != 1.0.
  if (p.negativo.trim() && p.cfg === 1) salida.push("With cfg 1 the negative prompt is not used at all: the model only reads it when cfg is not 1.");
  if (!modelo.base && p.cfg > 1) salida.push("On this model cfg above 1 saturated by ear (7 on song, drums and bass).");
  if (modelo.base && p.steps < 30) salida.push("Base models want ~50 steps; with few the result is rough.");
  if (!modelo.base && p.steps > 8) salida.push("More than 8 steps does not necessarily help these models (its docs), and takes longer.");
  if (p.prompt.trim() === "" && p.variaciones.length === 0) salida.push("No prompt: an unconditional generation (the guide suggests trying it; for Continue, it follows the source).");
  if (p.tarea === "repintar" && p.largoFuente) {
    const pintado = p.regiones.reduce((s, r) => s + (r.hasta - r.desde), 0);
    // The guide: "Masking only a few seconds of a song may produce output very close to the original".
    if (pintado / p.largoFuente < 0.15) salida.push("A short region may come back close to the original: the guide suggests masking more and narrowing later.");
  }
  if (p.tarea === "texto" && (p.modelo === "small-sfx" || p.modelo === "small-sfx-base") && p.duracion > 30) salida.push("Sound effects are usually short: the guide suggests a short duration.");
  if (modelo.base) salida.push("Base models have not been run here yet.");
  return salida;
}

export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  const salida: Record<string, unknown> = {
    nombre: p.nombre, modelo: p.modelo, tarea: p.tarea, prompt: p.prompt, negativo: p.negativo,
    duracion: p.duracion, steps: p.steps, cfg: p.cfg, semilla: p.semilla, tomas: p.tomas,
  };
  if (p.variaciones.length > 0) salida.prompts = promptsPorToma(p);
  if (p.apg !== POR_DEFECTO.apg) salida.apg = p.apg;
  if (p.sampler) salida.sampler = p.sampler;
  if (p.tarea !== "texto") salida.audio = p.audio;
  if (p.tarea === "audio") salida.ruido = p.ruido;
  if (p.tarea === "repintar") salida.regiones = p.regiones.map((r) => [r.desde, r.hasta]);
  // Continuation is inpainting from the source's end to the new end (its README).
  if (p.tarea === "continuar") salida.regiones = [[p.largoFuente, p.duracion]];
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
