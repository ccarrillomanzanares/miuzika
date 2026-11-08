/**
 * What the MIDI-LLM module sends to `workspace/gpu/generar_midillm.py`. Pure, tested.
 *
 * MIDI-LLM (Wu et al., ISMIR 2026; read at 93c660c on 8-Nov-2026): Llama 3.2 1B with the Anticipatory Music Transformer's
 * MIDI vocabulary added; multitrack text-to-MIDI. Brought from miuzika's proponer_midi (2-Nov: 4 proposals in 38 s on the
 * A10, 92-100 % of the notes in the asked key, kit on channel 10; never heard as music). Carlos, 8-Nov: "vamos primero con
 * proponer_midi", named MIDI-LLM like the other modules (by their model).
 */

/** Pinned; tied to generar_midillm.py by a test. */
export const MIDILLM_COMMIT = "93c660c";
export const MIDILLM_PESOS = "8b82ab9ec144348900e9ea4623b123e0b12f60b3";

/** Its generate_transformers.py defaults. 3 tokens per note (time, duration, note): 2046 ≈ 680 notes. */
export const POR_DEFECTO = { temperatura: 1.0, top_p: 0.98, max_tokens: 2046, propuestas: 4 } as const;

export const LICENCIA =
  "MIDI-LLM's weights are a fine-tune of Llama 3.2 and come under the Llama 3.2 Community License: commercial use is allowed " +
  "(a separate licence from Meta is needed only above 700 million monthly users), with the notice “Built with Llama”. What you " +
  "generate is yours to use; if you use it to train an AI model that you distribute, that model's name has to start with “Llama”.";

/**
 * The training captions' shape (its README's in-domain examples): genre and mood, the instruments, "Set in the key of A minor
 * with a 4/4 time signature", tempo in words ("this fast-paced track"), "a chord progression of Bm, Cmaj7, and Gmaj7".
 * The form's fields fill that shape; free prompts work too ("creative free-form prompts", its README).
 */
export const TEMPOS = [
  { id: "", etiqueta: "—" },
  { id: "slow", etiqueta: "slow" },
  { id: "moderate", etiqueta: "moderate" },
  { id: "fast-paced", etiqueta: "fast" },
] as const;
export type Tempo = (typeof TEMPOS)[number]["id"];

export interface Descripcion {
  texto: string;
  instrumentos: string;
  tonalidad: string;
  compas: string;
  tempo: Tempo;
  acordes: string;
}

/** "Bm, Cmaj7, Gmaj7" → "Bm, Cmaj7, and Gmaj7", as the captions write it. */
function lista(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`;
}

const partes = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

export function componerPrompt(d: Descripcion): string {
  const frases: string[] = [];
  const texto = d.texto.trim().replace(/[.\s]+$/, "");
  if (texto) frases.push(texto);
  const inst = partes(d.instrumentos);
  if (inst.length) frases.push(`Featuring ${lista(inst)}`);
  const tono = d.tonalidad.trim();
  const compas = d.compas.trim();
  if (tono && compas) frases.push(`Set in the key of ${tono} with a ${compas} time signature`);
  else if (tono) frases.push(`Set in the key of ${tono}`);
  else if (compas) frases.push(`Written in ${compas} time`);
  if (d.tempo) frases.push(`The track is ${d.tempo}`);
  const acordes = partes(d.acordes);
  if (acordes.length) frases.push(`It follows a chord progression of ${lista(acordes)}`);
  return frases.length ? `${frases.join(". ")}.` : "";
}

/** Its README's prompts, to start from. */
export const EJEMPLOS: readonly { titulo: string; texto: string }[] = [
  {
    titulo: "Rock with pop influence (in-domain)",
    texto:
      "A melodic and energetic rock song with a touch of pop influence, featuring synth strings, piano, distortion guitar, synth voice, and drums, all contributing to a blend of happy and dark moods. Set in the key of A minor with a 4/4 time signature, this fast-paced track showcases a chord progression of Bm, Cmaj7, and Gmaj7.",
  },
  {
    titulo: "Classical soundtrack (in-domain)",
    texto:
      "A slow and relaxing classical piece featuring a church organ and French horn, likely to be used as a soundtrack in a dramatic or emotional film. Written in A minor and 4/4 time. The chord progression of E7, Am, and E contributes to the piece's sentimental atmosphere.",
  },
  { titulo: "Road trip (free-form)", texto: "An energetic and motivating pop song you love to hear on a long road trip." },
];

export interface Parametros {
  nombre: string;
  prompt: string;
  propuestas: number;
  temperatura: number;
  top_p: number;
  max_tokens: number;
  /** -1 = random; the script draws one and records it. */
  semilla: number;
  /** The project's tempo, stamped on each .mid (MIDI-LLM writes none). */
  bpm: number | null;
}

const NOMBRE = /^[A-Za-z0-9._-]+$/;

export function validarParametros(p: Parametros): string | null {
  if (p.nombre.trim() === "") return "The proposal needs a name.";
  if (!NOMBRE.test(p.nombre)) return `The name "${p.nombre}" becomes a file: use only letters, digits, dot, dash and underscore.`;
  if (p.prompt.trim() === "") return "Describe the music: the prompt is empty.";
  if (!(Number.isInteger(p.propuestas) && p.propuestas >= 1 && p.propuestas <= 8)) return "Proposals: from 1 to 8.";
  if (!(Number.isFinite(p.temperatura) && p.temperatura > 0 && p.temperatura <= 2)) return "Temperature: above 0 and up to 2 (1.0 is its default).";
  if (!(Number.isFinite(p.top_p) && p.top_p > 0 && p.top_p <= 1)) return "Top-p: above 0 and up to 1 (0.98 is its default).";
  if (!(Number.isInteger(p.max_tokens) && p.max_tokens >= 90 && p.max_tokens <= 2046)) return "Length: from 90 to 2046 tokens (3 per note; 2046 is its default and its maximum here).";
  if (!(Number.isInteger(p.semilla) && p.semilla >= -1)) return "Seed: a whole number, or -1 for random.";
  if (p.bpm !== null && !(p.bpm >= 20 && p.bpm <= 300)) return "BPM: from 20 to 300.";
  return null;
}

export function parametrosParaEnviar(p: Parametros): Record<string, unknown> {
  return { nombre: p.nombre, prompt: p.prompt, propuestas: p.propuestas, temperatura: p.temperatura, top_p: p.top_p, max_tokens: p.max_tokens, semilla: p.semilla, bpm: p.bpm };
}

export interface Resultado {
  ficheros: string[];
  semilla: number | null;
  descartadas: number;
  detalle: { file: string; tracks: number; notes: number; seconds: number }[];
  generate_s: number | null;
}

/** The script's last line: `[generar_midillm] RESULT {...}`. */
export function leerResultado(salida: string): Resultado | null {
  const linea = salida.split("\n").reverse().find((l) => l.includes("RESULT {"));
  if (!linea) return null;
  try {
    const r = JSON.parse(linea.slice(linea.indexOf("{"))) as Record<string, unknown>;
    if (!Array.isArray(r.files)) return null;
    const detalle = Array.isArray(r.outputs)
      ? (r.outputs as Record<string, unknown>[]).map((o) => ({ file: String(o.file), tracks: Number(o.tracks) || 0, notes: Number(o.notes) || 0, seconds: Number(o.seconds) || 0 }))
      : [];
    return {
      ficheros: r.files.filter((f): f is string => typeof f === "string"),
      semilla: typeof r.seed === "number" ? r.seed : null,
      descartadas: typeof r.dropped === "number" ? r.dropped : 0,
      detalle,
      generate_s: typeof r.generate_s === "number" ? r.generate_s : null,
    };
  } catch {
    return null;
  }
}
