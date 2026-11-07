/**
 * The ACE-Step module, pure part: which models and tasks exist, what the form proposes, and
 * what the Review screen checks before spending GPU.
 *
 * The rule (Carlos, 6-Nov): no LLM touches what is sent, and nothing retouches it. `Parametros`
 * is the literal content sent to `workspace/gpu/generar_audio.py`: text is never trimmed,
 * truncated or filled in behind the person's back. A value the model needs is proposed here, in
 * sight on the Review screen, where it can be changed. An invalid value is refused with a
 * reason, never corrected.
 *
 * The tables come from `acestep/constants.py` and the README (read 4-Nov), not from a run: by
 * 6-Nov only 8 of these 30 model-task pairs had been heard (docs/PRUEBAS-ACESTEP-2026-11-04.md
 * in miuzika).
 */

export const TAREAS = ["text2music", "cover", "cover-nofsq", "repaint", "extract", "lego", "complete"] as const;
export type Tarea = (typeof TAREAS)[number];

const TAREAS_TURBO: readonly Tarea[] = ["text2music", "cover", "cover-nofsq", "repaint"];

export const PISTAS_MODELO = [
  "vocals", "backing_vocals", "drums", "percussion", "bass", "guitar",
  "keyboard", "synth", "strings", "brass", "woodwinds", "fx",
] as const;

export const LMS = ["none", "acestep-5Hz-lm-0.6B", "acestep-5Hz-lm-1.7B", "acestep-5Hz-lm-4B"] as const;

type Familia = "base" | "sft" | "turbo";

export interface Checkpoint {
  nombre: string;
  familia: Familia;
  tareas: readonly Tarea[];
}

export const MODELOS: readonly Checkpoint[] = [
  { nombre: "acestep-v15-xl-turbo", familia: "turbo", tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-xl-sft", familia: "sft", tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-xl-base", familia: "base", tareas: TAREAS },
  { nombre: "acestep-v15-turbo", familia: "turbo", tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-sft", familia: "sft", tareas: TAREAS_TURBO },
  { nombre: "acestep-v15-base", familia: "base", tareas: TAREAS },
];

export function modelosPara(tarea: Tarea): Checkpoint[] {
  return MODELOS.filter((m) => m.tareas.includes(tarea));
}

/** What the script receives, name by name. `null` = not sent as a value. */
export interface Parametros {
  tarea: Tarea;
  modelo: string;
  instruccion: string;
  prompt: string;
  letra: string;
  idioma: string;
  /** Seconds; only text2music, the other tasks last what their source lasts. */
  duracion: number | null;
  bpm: number | null;
  tonalidad: string;
  compas: string;
  /** -1 = random. */
  semilla: number;
  variantes: number;
  pasos: number;
  guia: number;
  shift: number;
  lm: string;
  normalizar: boolean;
  fuerza: number | null;
  desde: number | null;
  hasta: number | null;
  pista: string | null;
  nombre: string;
  /** Source: a WAV in the project folder... */
  audio: string | null;
  /** ...or this many seconds of silence, created on the instance. */
  silencio: number | null;
}

/** The instruction ACE-Step uses for each task (TASK_INSTRUCTIONS in constants.py, verbatim). */
export function instruccionDe(tarea: Tarea, pista: string | null): string {
  const pistas = (pista ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  switch (tarea) {
    case "text2music":
      return "Fill the audio semantic mask based on the given conditions:";
    case "repaint":
      return "Repaint the mask area based on the given conditions:";
    case "cover":
    case "cover-nofsq":
      return "Generate audio semantic tokens based on the given conditions:";
    case "extract":
      return pistas[0] ? `Extract the ${pistas[0]} track from the audio:` : "Extract the track from the audio:";
    case "lego":
      return pistas[0] ? `Generate the ${pistas[0]} track based on the audio context:` : "Generate the track based on the audio context:";
    case "complete":
      return pistas.length > 0 ? `Complete the input track with ${pistas.join(", ")}:` : "Complete the input track:";
  }
}

/**
 * Lyrics proposed when the field is left empty. Measured and heard 5-Nov: a vocal extract with
 * "[Instrumental]" rebuilt the source and with "" came out voice-only; other stems keep
 * "[Instrumental]", which describes their target.
 */
export function letraPropuesta(tarea: Tarea, pista: string | null): string {
  const vocal = pista === "vocals" || pista === "backing_vocals";
  return tarea === "extract" && vocal ? "" : "[Instrumental]";
}

/** The values each family was run with on 5-Nov, shown and editable on the Review screen. */
export function valoresDeModelo(tarea: Tarea, modelo: string): Pick<Parametros, "pasos" | "guia" | "shift" | "lm" | "normalizar"> {
  const familia = MODELOS.find((m) => m.nombre === modelo)?.familia ?? "turbo";
  return {
    pasos: familia === "turbo" ? 8 : 50,
    guia: familia === "turbo" ? 1 : 7,
    shift: familia === "turbo" ? 3 : 1,
    lm: tarea === "text2music" ? "acestep-5Hz-lm-1.7B" : "none",
    // Measured 5-Nov: normalised stems and covers all peaked at -1 dBFS whatever their source.
    normalizar: tarea === "text2music",
  };
}

/** Which Review fields apply to a task: the others are not shown and not sent. */
export function camposDe(tarea: Tarea): { duracion: boolean; fuerza: boolean; rango: boolean; pista: boolean; fuente: boolean; lm: boolean } {
  return {
    duracion: tarea === "text2music",
    fuerza: tarea === "cover" || tarea === "cover-nofsq",
    rango: tarea === "repaint" || tarea === "lego",
    pista: tarea === "extract" || tarea === "lego" || tarea === "complete",
    fuente: tarea !== "text2music",
    lm: tarea === "text2music",
  };
}

/** Refuses with a reason; never corrects. Null = it can run. */
export function validarParametros(p: Parametros): string | null {
  if (!TAREAS.includes(p.tarea)) return `Unknown task "${String(p.tarea)}".`;
  const modelo = MODELOS.find((m) => m.nombre === p.modelo);
  if (!modelo) return `Unknown model "${p.modelo}".`;
  if (!modelo.tareas.includes(p.tarea)) {
    return `${p.modelo} cannot do ${p.tarea}: use ${modelosPara(p.tarea).map((m) => m.nombre).join(" or ")}.`;
  }
  if (p.nombre.trim() === "") return "The take needs a name.";
  if (!/^[A-Za-z0-9._-]+$/.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  if (p.prompt.length > 512) return `The caption has ${p.prompt.length} characters; the model takes 512 at most.`;
  if (p.tarea !== "extract" && p.prompt.trim() === "") return `${p.tarea} needs a caption.`;
  const campos = camposDe(p.tarea);
  if (campos.duracion && !(p.duracion !== null && p.duracion >= 10 && p.duracion <= 600)) return "The duration has to be between 10 and 600 s.";
  if (campos.fuente && !p.audio && !p.silencio) return `${p.tarea} needs a source.`;
  if (p.silencio !== null && !(p.silencio > 0 && p.silencio <= 600)) return "The silence has to be between 0 and 600 s.";
  if (campos.fuerza && !(p.fuerza !== null && p.fuerza >= 0 && p.fuerza <= 1)) return "The cover strength has to be between 0 and 1.";
  if (p.tarea === "repaint" && !(p.desde !== null && p.hasta !== null && p.hasta > p.desde && p.desde >= 0)) return "Repaint needs a range: from and to, in seconds.";
  if (campos.pista) {
    const pistas = (p.pista ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (p.tarea !== "complete" && pistas.length !== 1) return `${p.tarea} needs one instrument.`;
    const malas = pistas.filter((x) => !(PISTAS_MODELO as readonly string[]).includes(x));
    if (malas.length > 0) return `The model has no track "${malas.join('", "')}": ${PISTAS_MODELO.join(", ")}.`;
  }
  if (p.bpm !== null && !(p.bpm >= 30 && p.bpm <= 300)) return "The BPM has to be between 30 and 300.";
  if (!(Number.isInteger(p.variantes) && p.variantes >= 1 && p.variantes <= 8)) return "Takes: an integer from 1 to 8.";
  if (!(Number.isInteger(p.semilla) && p.semilla >= -1)) return "Seed: a whole number, or -1 for random.";
  if (!(Number.isInteger(p.pasos) && p.pasos >= 1 && p.pasos <= 200)) return "Steps: an integer from 1 to 200.";
  if (!(Number.isFinite(p.guia) && p.guia >= 0 && p.guia <= 30)) return "Guidance: a number from 0 to 30.";
  if (!(Number.isFinite(p.shift) && p.shift >= 0 && p.shift <= 10)) return "Shift: a number from 0 to 10.";
  if (!(LMS as readonly string[]).includes(p.lm)) return `Unknown LM "${p.lm}".`;
  return null;
}

/** The file the script reads. Only what applies to the task travels, each value as it is. */
export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  const campos = camposDe(p.tarea);
  const salida: Record<string, unknown> = {
    tarea: p.tarea,
    modelo: p.modelo,
    instruccion: p.instruccion,
    prompt: p.prompt,
    letra: p.letra,
    idioma: p.idioma,
    bpm: p.bpm,
    tonalidad: p.tonalidad,
    compas: p.compas,
    semilla: p.semilla,
    variantes: p.variantes,
    pasos: p.pasos,
    guia: p.guia,
    shift: p.shift,
    lm: campos.lm ? p.lm : "none",
    normalizar: p.normalizar,
    nombre: p.nombre,
  };
  if (campos.duracion) salida.duracion = p.duracion;
  if (campos.fuerza) salida.fuerza = p.fuerza;
  if (campos.rango && p.desde !== null) salida.desde = p.desde;
  if (campos.rango && p.hasta !== null) salida.hasta = p.hasta;
  if (campos.pista && p.pista) salida.pista = p.pista;
  if (campos.fuente && p.silencio) salida.silencio = p.silencio;
  else if (campos.fuente && p.audio) salida.audio = p.audio;
  return salida;
}

/** A free name for a repeated take: the name it had if free, or with -2, -3... */
export function nombreLibre(base: string, ocupados: ReadonlySet<string>): string {
  let nombre = base;
  for (let n = 2; ocupados.has(nombre); n += 1) nombre = `${base}-${n}`;
  return nombre;
}

/** A name that passes `validarParametros`, proposed from what the person wrote. */
export function nombreDeArchivo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface Estimacion {
  segundos: number;
  coste: number | null;
  detalle: string[];
}

/**
 * What a run should cost, from what was measured on an A10 on 4 and 5-Nov: a guide, not a promise.
 * Boot 231-284 s, install 19 s, ~110 kB/s up, model load 4-39 s, LM load + run 26-85 s; generation
 * per second of audio: turbo 12.5 s / 210 s, base and sft 70 s / 210 s, per batch.
 */
export function estimar(p: Parametros, gpu: { encendida: boolean; precioHora: number | null }, bytesFuente: number): Estimacion {
  const detalle: string[] = [];
  let segundos = 0;
  const suma = (s: number, texto: string): void => {
    segundos += s;
    detalle.push(`${texto} ~${formatoDuracion(s)}`);
  };
  if (!gpu.encendida) suma(280, "boot + install");
  if (bytesFuente > 0) suma(bytesFuente / 110_000, `upload ${(bytesFuente / 1048576).toFixed(0)} MB`);
  suma(60, "sync");
  suma(30, "model load");
  if (camposDe(p.tarea).lm && p.lm !== "none") suma(70, "LM");
  const familia = MODELOS.find((m) => m.nombre === p.modelo)?.familia ?? "turbo";
  const porSegundo = (familia === "turbo" ? 12.5 / 210 : 70 / 210) * (p.pasos / (familia === "turbo" ? 8 : 50));
  const audio = p.duracion ?? p.silencio ?? 60;
  suma(porSegundo * audio * p.variantes, "generation");
  return {
    segundos,
    coste: gpu.precioHora === null ? null : (segundos / 3600) * gpu.precioHora,
    detalle,
  };
}

export function formatoDuracion(segundos: number): string {
  const s = Math.max(1, Math.round(segundos));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Reads the `RESULT {...}` line the script prints last; null if it did not get that far. */
export function leerResultado(salida: string): { ficheros: string[]; tiempos: Record<string, number> } | null {
  const ultima = salida.split("\n").filter((l) => l.includes("RESULT {")).at(-1);
  if (!ultima) return null;
  try {
    const json = JSON.parse(ultima.slice(ultima.indexOf("{"))) as Record<string, unknown>;
    const ficheros = Array.isArray(json.files) ? json.files.map(String) : [];
    if (ficheros.length === 0) return null;
    const tiempos: Record<string, number> = {};
    for (const [clave, valor] of Object.entries(json)) if (typeof valor === "number") tiempos[clave] = valor;
    return { ficheros, tiempos };
  } catch {
    return null;
  }
}
