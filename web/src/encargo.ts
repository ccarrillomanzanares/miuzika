/**
 * Formulario de encargo → el mensaje que recibe el agente.
 *
 * Sustituye a la plantilla de texto (plantilla.ts, 27-oct). Aquella empujaba al
 * flujo viejo: «Entrega: MIDI» por defecto y «duración real del render» llevaron a
 * Stahl a scripts de Python de 2,5 min por intento. El formulario no decide nada
 * del cómo: deja el trabajo en el proyecto, que es lo normal ahora.
 *
 * Qué pide (28-oct, comparando con encargos escritos a mano): en una VERSIÓN, a
 * dónde se lleva y qué se conserva del original; en una canción NUEVA, para qué es,
 * qué imagen o emoción tiene y cuál es el gancho; en las dos, quién lleva la
 * melodía y el arco de energía.
 *
 * Ningún campo es obligatorio: lo que queda en blanco (o en «elige tú») no se
 * escribe y lo decide el agente. El mensaje sale en el idioma de la interfaz.
 *
 * Sin DOM: se prueba con `node --test`.
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
  /** Nueva: nombre del proyecto. Vacío = que lo ponga el agente (sin preguntar). */
  nombre: string;
  /** Versión: canción y artista («Hurt – Nine Inch Nails»). */
  cancion: string;
  /** Versión: qué se mantiene del original. */
  conservar: Conservar;
  /** Nueva: el estilo. Versión: a dónde se lleva. Arreglo: qué cambiar. */
  estilo: string;
  /** Imagen o emoción («conducir de noche bajo la lluvia»). */
  imagen: string;
  /** Nueva: para qué es. */
  uso: UsoEncargo;
  /** Minutos aproximados; null = elige tú. */
  minutos: number | null;
  /** Vacío = elige tú. */
  instrumentos: string[];
  /** Qué instrumento lleva la melodía; vacío = elige tú. */
  melodiaLaLleva: string;
  voz: VozEncargo;
  /** Referencias de sonido («Kavinsky, la banda sonora de Drive»). */
  suenaComo: string;
  gancho: string;
  tempo: TempoEncargo;
  /** Sólo con tempo = "bpm". */
  bpm: number | null;
  groove: GrooveEncargo;
  tonalidad: TonalidadEncargo;
  /** Sólo con tonalidad = "otra". Cifrado americano (C, F#, Bb). */
  tonica: string;
  /** Modo canónico (minor, major, dorian…). */
  modo: string;
  energia: EnergiaEncargo;
  forma: string;
  evitar: string;
  mas: string;
  /** Además de dejarlo en el proyecto, exportarlo (se pueden pedir los dos). */
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

/** Tónicas que ofrece el formulario, con su nombre en cada idioma. */
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

/** Modos que ofrece el formulario (los mismos nombres que usa el proyecto). */
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
 * Instrumentos General MIDI que se ofrecen como sugerencia (el agente los traduce
 * a programa con listar_instrumentos). Los de la biblioteca llegan del servidor.
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

/** Sin el punto final que ya traiga: se añade uno. */
function frase(texto: string): string {
  const t = limpio(texto).replace(/[.;,:]+$/, "");
  return t === "" ? "" : /[!?…]$/.test(t) ? t : `${t}.`;
}

/** «a, b y c» / «a, b and c». */
function lista(partes: readonly string[], idioma: Idioma): string {
  if (partes.length <= 1) return partes.join("");
  const y = idioma === "es" ? " y " : " and ";
  return `${partes.slice(0, -1).join(", ")}${y}${partes.at(-1)}`;
}

/** El mensaje para el chat. Corto: sólo lo que la persona ha decidido. */
// El inglés es el idioma base: sin idioma explícito, el encargo sale en inglés.
export function textoDeEncargo(e: Encargo, idioma: Idioma = "en", proyectoAbierto = ""): string {
  const es = idioma === "es";
  const tx = (a: string, b: string): string => (es ? a : b);
  const lineas: string[] = [];
  const estilo = limpio(e.estilo).replace(/[.;,:]+$/, "");

  // 1. Qué es.
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
    // Sin nombre, el agente paraba a preguntarlo (28-oct, con el plan ya hecho):
    // se le dice que lo ponga él.
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

  // 2. Lo que orienta el carácter.
  const imagen = limpio(e.imagen);
  if (imagen) lineas.push(tx(`Imagen: ${frase(imagen)}`, `Picture: ${frase(imagen)}`));
  const suena = limpio(e.suenaComo);
  if (suena) lineas.push(tx(`Que suene como ${frase(suena)}`, `It should sound like ${frase(suena)}`));
  const gancho = limpio(e.gancho);
  if (gancho) lineas.push(tx(`El gancho: ${frase(gancho)}`, `The hook: ${frase(gancho)}`));

  // 3. Medidas.
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

  // 4. Quién toca qué.
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

  // 5. Arco.
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
