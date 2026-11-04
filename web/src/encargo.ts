/**
 * Commission form → the message the agent receives.
 *
 * Replaces the text template (plantilla.ts, Oct 27). That one pushed towards the old
 * flow: "Delivery: MIDI" by default and "real render duration" led Stahl to 2.5-min
 * Python scripts per attempt. The form does not decide anything about the how: it
 * leaves the work in the project, which is the normal thing now.
 *
 * What it asks for (Oct 28, comparing with hand-written commissions): in a COVER, where
 * it is taken and what is kept from the original; in a NEW song, what it is for, what
 * image or emotion it has and what the hook is; in both, who carries the melody and the
 * energy arc.
 *
 * No field is required: whatever is left blank (or set to "you choose") is not written
 * and the agent decides. The message comes out in the interface language.
 *
 * No DOM: tested with `node --test`.
 */

export type TipoEncargo = "nueva" | "version" | "arreglo";
export type VozEncargo = "" | "melodia" | "instrumental";
export type UsoEncargo = "" | "cancion" | "loop" | "dj" | "intro";
export type TempoEncargo = "" | "lento" | "medio" | "rapido" | "bpm" | "original" | "mas-lento" | "mas-rapido";
export type GrooveEncargo = "" | "recto" | "swing" | "halftime" | "ternario";
export type EnergiaEncargo = "" | "original" | "crece" | "intima" | "explota" | "constante";
export type TonalidadEncargo = "" | "original" | "otra";
export type Idioma = "es" | "en";

export interface Conservar {
  melodia: boolean;
  acordes: boolean;
  riff: boolean;
  estructura: boolean;
}

export interface Encargo {
  tipo: TipoEncargo;
  /** New: project name. Empty = the agent sets it (without asking). */
  nombre: string;
  /** Cover: song and artist ("Hurt – Nine Inch Nails"). */
  cancion: string;
  /** Cover: what is kept from the original. */
  conservar: Conservar;
  /** New: the style. Cover: where it is taken. Arrangement: what to change. */
  estilo: string;
  /** Image or emotion ("driving at night in the rain"). */
  imagen: string;
  /** New: what it is for. */
  uso: UsoEncargo;
  /** Approximate minutes; null = you choose. */
  minutos: number | null;
  /** Empty = you choose. */
  instrumentos: string[];
  /** Which instrument carries the melody; empty = you choose. */
  melodiaLaLleva: string;
  voz: VozEncargo;
  /** Sound references ("Kavinsky, the Drive soundtrack"). */
  suenaComo: string;
  gancho: string;
  tempo: TempoEncargo;
  /** Only with tempo = "bpm". */
  bpm: number | null;
  groove: GrooveEncargo;
  tonalidad: TonalidadEncargo;
  /** Only with tonalidad = "otra". American notation (C, F#, Bb). */
  tonica: string;
  /** Canonical mode (minor, major, dorian…). */
  modo: string;
  energia: EnergiaEncargo;
  forma: string;
  evitar: string;
  mas: string;
  /** Besides leaving it in the project, exporting it (both can be requested). */
  entregaMidi: boolean;
  entregaWav: boolean;
}

export const ENCARGO_VACIO: Encargo = {
  tipo: "nueva",
  nombre: "",
  cancion: "",
  conservar: { melodia: true, acordes: true, riff: false, estructura: true },
  estilo: "",
  imagen: "",
  uso: "",
  minutos: null,
  instrumentos: [],
  melodiaLaLleva: "",
  voz: "",
  suenaComo: "",
  gancho: "",
  tempo: "",
  bpm: null,
  groove: "",
  tonalidad: "",
  tonica: "C",
  modo: "minor",
  energia: "",
  forma: "",
  evitar: "",
  mas: "",
  entregaMidi: false,
  entregaWav: false,
};

/** Tonics offered by the form, with their name in each language. */
export const TONICAS: readonly { valor: string; es: string; en: string }[] = [
  { valor: "C", es: "Do", en: "C" },
  { valor: "C#", es: "Do#", en: "C#" },
  { valor: "D", es: "Re", en: "D" },
  { valor: "Eb", es: "Mib", en: "Eb" },
  { valor: "E", es: "Mi", en: "E" },
  { valor: "F", es: "Fa", en: "F" },
  { valor: "F#", es: "Fa#", en: "F#" },
  { valor: "G", es: "Sol", en: "G" },
  { valor: "Ab", es: "Lab", en: "Ab" },
  { valor: "A", es: "La", en: "A" },
  { valor: "Bb", es: "Sib", en: "Bb" },
  { valor: "B", es: "Si", en: "B" },
];

/** Modes offered by the form (the same names the project uses). */
export const MODOS_ENCARGO: readonly { valor: string; es: string; en: string }[] = [
  { valor: "minor", es: "menor", en: "minor" },
  { valor: "major", es: "mayor", en: "major" },
  { valor: "dorian", es: "dórico", en: "dorian" },
  { valor: "phrygian", es: "frigio", en: "phrygian" },
  { valor: "mixolydian", es: "mixolidio", en: "mixolydian" },
  { valor: "lydian", es: "lidio", en: "lydian" },
  { valor: "harmonicMinor", es: "menor armónica", en: "harmonic minor" },
];

/**
 * General MIDI instruments offered as suggestions (the agent translates them to a
 * program with listar_instrumentos). Library ones come from the server.
 */
export const SUGERENCIAS_GM: readonly { es: string; en: string }[] = [
  { es: "Piano eléctrico", en: "Electric piano" },
  { es: "Órgano", en: "Organ" },
  { es: "Guitarra acústica", en: "Acoustic guitar" },
  { es: "Guitarra de nylon", en: "Nylon guitar" },
  { es: "Guitarra eléctrica limpia", en: "Clean electric guitar" },
  { es: "Guitarra distorsionada", en: "Distortion guitar" },
  { es: "Bajo eléctrico", en: "Electric bass" },
  { es: "Contrabajo", en: "Upright bass" },
  { es: "Bajo sintetizado", en: "Synth bass" },
  { es: "Cuerdas", en: "Strings" },
  { es: "Violonchelo", en: "Cello" },
  { es: "Violín", en: "Violin" },
  { es: "Coro", en: "Choir" },
  { es: "Metales", en: "Brass" },
  { es: "Flauta", en: "Flute" },
  { es: "Sinte lead", en: "Synth lead" },
  { es: "Pad de sintetizador", en: "Synth pad" },
  { es: "Arpegio de sinte", en: "Synth arpeggio" },
  { es: "Batería", en: "Drums" },
  { es: "Batería electrónica", en: "Electronic drums" },
];

function nombreTonica(valor: string, idioma: Idioma): string {
  return TONICAS.find((t) => t.valor === valor)?.[idioma] ?? valor;
}

function nombreModo(valor: string, idioma: Idioma): string {
  return MODOS_ENCARGO.find((m) => m.valor === valor)?.[idioma] ?? valor;
}

function limpio(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Without the trailing period it may already have: one is added. */
function frase(texto: string): string {
  const t = limpio(texto).replace(/[.;,:]+$/, "");
  return t === "" ? "" : /[!?…]$/.test(t) ? t : `${t}.`;
}

/** "a, b and c" / "a, b y c". */
function lista(partes: readonly string[], idioma: Idioma): string {
  if (partes.length <= 1) return partes.join("");
  const y = idioma === "es" ? " y " : " and ";
  return `${partes.slice(0, -1).join(", ")}${y}${partes.at(-1)}`;
}

/** The message for the chat. Short: only what the person has decided. */
// English is the base language: without an explicit language, the commission comes out in English.
export function textoDeEncargo(e: Encargo, idioma: Idioma = "en", proyectoAbierto = ""): string {
  const es = idioma === "es";
  const tx = (a: string, b: string): string => (es ? a : b);
  const lineas: string[] = [];
  const estilo = limpio(e.estilo).replace(/[.;,:]+$/, "");

  // 1. What it is.
  if (e.tipo === "version") {
    const cancion = limpio(e.cancion);
    const titulo = cancion ? tx(`«${cancion}»`, `“${cancion}”`) : tx("la canción que te diga", "the song I tell you");
    lineas.push(
      estilo
        ? tx(`Versión de ${titulo}, llevada a ${estilo}.`, `A cover of ${titulo}, taken to ${estilo}.`)
        : tx(`Versión de ${titulo}.`, `A cover of ${titulo}.`),
    );
    const c = e.conservar;
    const conserva = [
      c.melodia ? tx("la melodía", "the melody") : "",
      c.acordes ? tx("los acordes", "the chords") : "",
      c.riff ? tx("el riff o gancho", "the riff or hook") : "",
      c.estructura ? tx("la estructura", "the structure") : "",
    ].filter(Boolean);
    lineas.push(
      conserva.length > 0
        ? tx(`Conserva ${lista(conserva, idioma)}; lo demás puedes cambiarlo.`, `Keep ${lista(conserva, idioma)}; the rest can change.`)
        : tx("Sólo inspirada en ella: no copies su melodía ni sus acordes.", "Only inspired by it: don't copy its melody or chords."),
    );
  } else if (e.tipo === "arreglo") {
    lineas.push(
      tx(
        `Trabaja sobre el proyecto abierto${proyectoAbierto ? ` («${proyectoAbierto}»)` : ""}: no crees otro.`,
        `Work on the open project${proyectoAbierto ? ` (“${proyectoAbierto}”)` : ""}: don't create a new one.`,
      ),
    );
    if (estilo) lineas.push(tx(`Qué cambiar: ${frase(estilo)}`, `What to change: ${frase(estilo)}`));
  } else {
    // Without a name, the agent stopped to ask for it (Oct 28, with the plan already
    // made): it is told to set it itself.
    const nombre = limpio(e.nombre);
    lineas.push(
      nombre
        ? tx(`Una canción nueva, en un proyecto nuevo llamado «${nombre}».`, `A new song, in a new project called “${nombre}”.`)
        : tx("Una canción nueva, en un proyecto nuevo: ponle tú el nombre.", "A new song, in a new project: you name it."),
    );
    if (estilo) lineas.push(tx(`Estilo: ${frase(estilo)}`, `Style: ${frase(estilo)}`));
    if (e.uso === "loop") {
      lineas.push(
        tx(
          "Es un loop que tiene que cerrar sin costura: sin principio ni final marcados, que pueda sonar mucho rato sin cansar.",
          "It's a loop that must close seamlessly: no marked start or ending, able to play for a long time without tiring.",
        ),
      );
    } else if (e.uso === "dj") {
      lineas.push(
        tx(
          "Es un tema para pinchar: intro y outro de 16 compases sólo con ritmo, para mezclar.",
          "It's a DJ track: 16-bar intro and outro with rhythm only, for mixing.",
        ),
      );
    } else if (e.uso === "intro") {
      lineas.push(tx("Es una intro o cortinilla corta, con un final claro.", "It's a short intro or sting with a clear ending."));
    }
  }

  // 2. What guides the character.
  const imagen = limpio(e.imagen);
  if (imagen) lineas.push(tx(`Imagen: ${frase(imagen)}`, `Picture: ${frase(imagen)}`));
  const suena = limpio(e.suenaComo);
  if (suena) lineas.push(tx(`Que suene como ${frase(suena)}`, `It should sound like ${frase(suena)}`));
  const gancho = limpio(e.gancho);
  if (gancho) lineas.push(tx(`El gancho: ${frase(gancho)}`, `The hook: ${frase(gancho)}`));

  // 3. Measurements.
  const medidas: string[] = [];
  const bpm = e.bpm !== null && Number.isFinite(e.bpm) && e.bpm > 0 ? `${Math.round(e.bpm)} BPM` : "";
  switch (e.tempo) {
    case "lento":
      medidas.push(tx("tempo lento", "slow tempo"));
      break;
    case "medio":
      medidas.push(tx("tempo medio", "mid tempo"));
      break;
    case "rapido":
      medidas.push(tx("tempo rápido", "fast tempo"));
      break;
    case "original":
      medidas.push(tx("mismo tempo que el original", "same tempo as the original"));
      break;
    case "mas-lento":
      medidas.push(tx("más lenta que el original", "slower than the original"));
      break;
    case "mas-rapido":
      medidas.push(tx("más rápida que el original", "faster than the original"));
      break;
    case "bpm":
      if (bpm) medidas.push(bpm);
      break;
  }
  const grooves: Record<Exclude<GrooveEncargo, "">, [string, string]> = {
    recto: ["groove recto", "straight groove"],
    swing: ["con swing", "swung"],
    halftime: ["en half-time", "half-time feel"],
    ternario: ["en ternario (¾ o 6/8)", "in triple meter (3/4 or 6/8)"],
  };
  if (e.groove) medidas.push(tx(...grooves[e.groove]));
  if (e.tonalidad === "original") medidas.push(tx("en su tonalidad original", "in its original key"));
  if (e.tonalidad === "otra" && e.tonica) {
    medidas.push(es ? `${nombreTonica(e.tonica, "es")} ${nombreModo(e.modo, "es")}` : `${e.tonica} ${nombreModo(e.modo, "en")}`);
  }
  if (e.minutos !== null && Number.isFinite(e.minutos)) medidas.push(tx(`unos ${e.minutos} min`, `about ${e.minutos} min`));
  if (medidas.length > 0) {
    const texto = medidas.join(" · ");
    lineas.push(`${texto.charAt(0).toUpperCase()}${texto.slice(1)}.`);
  }
  const forma = limpio(e.forma);
  if (forma) lineas.push(tx(`Forma: ${frase(forma)}`, `Form: ${frase(forma)}`));

  // 4. Who plays what.
  const instrumentos = e.instrumentos.map(limpio).filter(Boolean);
  if (instrumentos.length > 0) lineas.push(`${tx("Instrumentos", "Instruments")}: ${instrumentos.join("; ")}.`);
  const lleva = limpio(e.melodiaLaLleva);
  if (e.voz === "instrumental") {
    lineas.push(tx("Sin voz ni melodía principal: sólo instrumental.", "No vocals and no lead melody: purely instrumental."));
  } else if (lleva) {
    lineas.push(
      e.voz === "melodia"
        ? tx(`Sin voz: la melodía la lleva ${lleva}.`, `No vocals: ${lleva} carries the melody.`)
        : tx(`La melodía la lleva ${lleva}.`, `${lleva} carries the melody.`),
    );
  } else if (e.voz === "melodia") {
    lineas.push(tx("Sin voz: la melodía la lleva un instrumento.", "No vocals: an instrument carries the melody."));
  }

  // 5. Arc.
  const energias: Record<Exclude<EnergiaEncargo, "">, [string, string]> = {
    original: ["la del original", "as in the original"],
    crece: ["que crezca hasta el final", "building up to the end"],
    intima: ["íntima de principio a fin, sin explotar", "intimate from start to finish, never exploding"],
    explota: ["empieza mínima y acaba explotando", "starts minimal and ends exploding"],
    constante: ["constante, para pista", "steady, for the dance floor"],
  };
  if (e.energia) lineas.push(tx(`Energía: ${energias[e.energia][0]}.`, `Energy: ${energias[e.energia][1]}.`));

  const evitar = limpio(e.evitar);
  if (evitar) lineas.push(tx(`Evita: ${frase(evitar)}`, `Avoid: ${frase(evitar)}`));
  const mas = e.mas.trim();
  if (mas) lineas.push(mas);

  const formatos = [e.entregaMidi ? "MIDI" : "", e.entregaWav ? "WAV" : ""].filter(Boolean);
  if (formatos.length > 0) {
    lineas.push(
      tx(
        `Entrega: cuando esté terminada, expórtala en ${lista(formatos, "es")}.`,
        `Delivery: when it's finished, export it as ${lista(formatos, "en")}.`,
      ),
    );
  }

  return lineas.join("\n");
}
