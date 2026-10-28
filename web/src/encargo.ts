/**
 * Formulario de encargo → el mensaje que recibe el agente.
 *
 * Sustituye a la plantilla de texto (plantilla.ts, 27-oct). Aquella empujaba al
 * flujo viejo: «Entrega: MIDI» por defecto y «duración real del render» llevaron a
 * Stahl a scripts de Python de 2,5 min por intento. El formulario no decide nada
 * del cómo: deja el trabajo en el proyecto, que es lo normal ahora.
 *
 * Ningún campo es obligatorio: lo que queda en blanco (o en «elige tú») no se
 * escribe y lo decide el agente. El mensaje sale en el idioma de la interfaz, y el
 * agente contesta en el idioma de la persona igualmente.
 *
 * Sin DOM: se prueba con `node --test`.
 */

export type TipoEncargo = "nueva" | "version" | "arreglo";
export type VozEncargo = "" | "melodia" | "instrumental";
export type Idioma = "es" | "en";

export interface Encargo {
  tipo: TipoEncargo;
  /** Canción de la que se hace la versión («Hurt – Nine Inch Nails»). */
  cancion: string;
  /** Versión que conserva la melodía original (si no, sólo inspirada). */
  conMelodia: boolean;
  estilo: string;
  /** null = elige tú. */
  bpm: number | null;
  /** null = elige tú. Tónica en cifrado americano (C, F#, Bb). */
  tonica: string | null;
  /** Modo canónico (minor, major, dorian…). */
  modo: string;
  /** Minutos aproximados; null = elige tú. */
  minutos: number | null;
  /** Vacío = elige tú. */
  instrumentos: string[];
  voz: VozEncargo;
  evitar: string;
  mas: string;
}

export const ENCARGO_VACIO: Encargo = {
  tipo: "nueva",
  cancion: "",
  conMelodia: true,
  estilo: "",
  bpm: null,
  tonica: null,
  modo: "minor",
  minutos: null,
  instrumentos: [],
  voz: "",
  evitar: "",
  mas: "",
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
  { es: "Guitarra eléctrica limpia", en: "Clean electric guitar" },
  { es: "Guitarra distorsionada", en: "Distortion guitar" },
  { es: "Bajo eléctrico", en: "Electric bass" },
  { es: "Bajo sintetizado", en: "Synth bass" },
  { es: "Cuerdas", en: "Strings" },
  { es: "Violonchelo", en: "Cello" },
  { es: "Coro", en: "Choir" },
  { es: "Metales", en: "Brass" },
  { es: "Flauta", en: "Flute" },
  { es: "Sinte lead", en: "Synth lead" },
  { es: "Pad de sintetizador", en: "Synth pad" },
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

function frase(texto: string): string {
  const t = limpio(texto);
  if (t === "") return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** El mensaje para el chat. Corto: sólo lo que la persona ha decidido. */
export function textoDeEncargo(e: Encargo, idioma: Idioma = "es", proyectoAbierto = ""): string {
  const es = idioma === "es";
  const lineas: string[] = [];

  const cancion = limpio(e.cancion);
  if (e.tipo === "version") {
    if (cancion) {
      lineas.push(
        es
          ? `Versión de «${cancion}»${e.conMelodia ? ", con su melodía" : ", inspirada en ella (sin copiar la melodía)"}.`
          : `A cover of “${cancion}”${e.conMelodia ? ", keeping its melody" : ", inspired by it (without copying the melody)"}.`,
      );
    } else {
      lineas.push(es ? "Una versión (dime de qué canción si no te lo he dicho)." : "A cover (ask me which song if I haven't said).");
    }
  } else if (e.tipo === "arreglo") {
    lineas.push(
      es
        ? `Trabaja sobre el proyecto abierto${proyectoAbierto ? ` («${proyectoAbierto}»)` : ""}: no crees otro.`
        : `Work on the open project${proyectoAbierto ? ` (“${proyectoAbierto}”)` : ""}: don't create a new one.`,
    );
  } else {
    lineas.push(es ? "Una canción nueva, en un proyecto nuevo." : "A new song, in a new project.");
  }

  const estilo = limpio(e.estilo);
  if (estilo) lineas.push(es ? `Estilo: ${frase(estilo)}` : `Style: ${frase(estilo)}`);

  const medidas: string[] = [];
  if (e.bpm !== null && Number.isFinite(e.bpm)) medidas.push(`${Math.round(e.bpm)} BPM`);
  if (e.tonica) medidas.push(es ? `${nombreTonica(e.tonica, "es")} ${nombreModo(e.modo, "es")}` : `${e.tonica} ${nombreModo(e.modo, "en")}`);
  if (e.minutos !== null && Number.isFinite(e.minutos)) medidas.push(es ? `unos ${e.minutos} min` : `about ${e.minutos} min`);
  if (medidas.length > 0) lineas.push(`${medidas.join(" · ")}.`);

  const instrumentos = e.instrumentos.map(limpio).filter(Boolean);
  if (instrumentos.length > 0) {
    lineas.push(`${es ? "Instrumentos" : "Instruments"}: ${instrumentos.join("; ")}.`);
  }

  if (e.voz === "melodia") {
    lineas.push(es ? "Sin voz: la melodía la lleva un instrumento." : "No vocals: an instrument carries the melody.");
  } else if (e.voz === "instrumental") {
    lineas.push(es ? "Sin voz ni melodía principal: sólo instrumental." : "No vocals and no lead melody: purely instrumental.");
  }

  const evitar = limpio(e.evitar);
  if (evitar) lineas.push(es ? `Evita: ${frase(evitar)}` : `Avoid: ${frase(evitar)}`);

  const mas = e.mas.trim();
  if (mas) lineas.push(mas);

  return lineas.join("\n");
}
