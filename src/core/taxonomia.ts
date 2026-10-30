/**
 * Catalog taxonomy: the tags with which a sound is named.
 *
 * Three standard references, each for its own purpose:
 *  - **General MIDI (channel 10)**: the percussion map (notes 35-81). It is the name
 *    everyone recognizes for a kick, a snare, or a ride, and it gives a canonical
 *    MIDI note for each hit.
 *  - **Freesound Broad Sound Taxonomy (BST, 2025)**: two levels to organize a
 *    heterogeneous collection: Music (m), Instrument samples (is) with Percussion
 *    (is-p), Synths (is-e)…, Sound effects (fx) with Electronic/Design (fx-el)…
 *  - **AudioSet (Google)**: 632 hierarchical classes of sound events; it is used as
 *    a synonym vocabulary for what is not an instrument (impacts, textures).
 *
 * Each entry has: identifier, Spanish name, English name, GM note if it is
 * percussion, BST category, our family, and **aliases** (Spanish and English,
 * including regionalisms). The aliases are what let the agent recognize "tarola",
 * "redoblante", or "hi-hat" as the same thing.
 */

import { normalizarTexto } from "./nombres.ts";

export type Familia = "percusión" | "tonal" | "textura" | "ruido" | "efecto";

export interface Etiqueta {
  id: string;
  es: string;
  en: string;
  /** GM note from the percussion map (35-81), if it has one. */
  gm?: number;
  /** Broad Sound Taxonomy category. */
  bst: string;
  familia: Familia;
  alias: string[];
}

export const ETIQUETAS: Etiqueta[] = [
  // ── Drums: kicks and snares ───────────────────────────────────────────────
  { id: "bombo", es: "Bombo", en: "Kick / Bass drum", gm: 36, bst: "is-p", familia: "percusión",
    alias: ["kick", "bombo de batería", "bass drum", "acoustic bass drum", "golpe de bombo", "patada"] },
  { id: "bombo-acustico", es: "Bombo acústico", en: "Acoustic bass drum", gm: 35, bst: "is-p", familia: "percusión",
    alias: ["bombo orquesta", "gran cassa"] },
  { id: "caja", es: "Caja", en: "Snare", gm: 38, bst: "is-p", familia: "percusión",
    alias: ["tarola", "redoblante", "snare drum", "caja acústica", "caja de batería"] },
  { id: "caja-electrica", es: "Caja electrónica", en: "Electric snare", gm: 40, bst: "is-p", familia: "percusión",
    alias: ["snare electrónico", "caja 808", "rimshot electrónico"] },
  { id: "rimshot", es: "Rimshot", en: "Side stick", gm: 37, bst: "is-p", familia: "percusión",
    alias: ["aro", "golpe en el aro", "side stick", "rim"] },
  { id: "palmada", es: "Palmada", en: "Hand clap", gm: 39, bst: "fx-h", familia: "percusión",
    alias: ["clap", "aplauso", "palmas", "handclap"] },

  // ── Hi-hats ───────────────────────────────────────────────────────────────
  { id: "charles", es: "Charles cerrado", en: "Closed hi-hat", gm: 42, bst: "is-p", familia: "percusión",
    alias: ["hi-hat", "hihat", "hat", "charles cerrado", "contratiempo"] },
  { id: "charles-pedal", es: "Charles a pedal", en: "Pedal hi-hat", gm: 44, bst: "is-p", familia: "percusión",
    alias: ["pedal hat", "charles pisado", "chick"] },
  { id: "charles-abierto", es: "Charles abierto", en: "Open hi-hat", gm: 46, bst: "is-p", familia: "percusión",
    alias: ["open hat", "charles abierto", "hat abierto"] },

  // ── Toms ──────────────────────────────────────────────────────────────────
  { id: "tom-suelo", es: "Tom de suelo", en: "Floor tom", gm: 41, bst: "is-p", familia: "percusión",
    alias: ["floor tom", "tom de pie", "timbal de suelo"] },
  { id: "tom-bajo", es: "Tom bajo", en: "Low tom", gm: 45, bst: "is-p", familia: "percusión",
    alias: ["low tom", "tom 1", "tom grave"] },
  { id: "tom-medio", es: "Tom medio", en: "Mid tom", gm: 47, bst: "is-p", familia: "percusión",
    alias: ["mid tom", "tom 2", "tom medio-bajo"] },
  { id: "tom-alto", es: "Tom alto", en: "High tom", gm: 50, bst: "is-p", familia: "percusión",
    alias: ["high tom", "tom 3", "tom agudo", "tom-tom"] },

  // ── Platos ────────────────────────────────────────────────────────────────
  { id: "crash", es: "Crash", en: "Crash cymbal", gm: 49, bst: "is-p", familia: "percusión",
    alias: ["plato crash", "crash cymbal", "plato de choque", "platillo crash"] },
  { id: "splash", es: "Splash", en: "Splash cymbal", gm: 55, bst: "is-p", familia: "percusión",
    alias: ["plato splash", "splash cymbal", "plato pequeño"] },
  { id: "china", es: "China", en: "Chinese cymbal", gm: 52, bst: "is-p", familia: "percusión",
    alias: ["plato china", "chinese cymbal", "swish", "trash cymbal"] },
  { id: "ride", es: "Ride", en: "Ride cymbal", gm: 51, bst: "is-p", familia: "percusión",
    alias: ["plato ride", "ride cymbal", "plato de ritmo", "platillo ride"] },
  { id: "campana-ride", es: "Campana de ride", en: "Ride bell", gm: 53, bst: "is-p", familia: "percusión",
    alias: ["bell", "cúpula", "campana del ride", "ping"] },

  // ── Small percussion ─────────────────────────────────────────────────────
  { id: "cencerro", es: "Cencerro", en: "Cowbell", gm: 56, bst: "is-p", familia: "percusión",
    alias: ["cowbell", "cencerro metálico", "esquila"] },
  { id: "pandereta", es: "Pandereta", en: "Tambourine", gm: 54, bst: "is-p", familia: "percusión",
    alias: ["tambourine", "pandero", "sonajas"] },
  { id: "claves", es: "Claves", en: "Claves", gm: 75, bst: "is-p", familia: "percusión",
    alias: ["clave", "palillos", "claves de madera"] },
  { id: "woodblock", es: "Caja china", en: "Wood block", gm: 76, bst: "is-p", familia: "percusión",
    alias: ["woodblock", "caja china", "block", "madera"] },
  { id: "triangulo", es: "Triángulo", en: "Triangle", gm: 81, bst: "is-p", familia: "percusión",
    alias: ["triangle", "triángulo metálico"] },
  { id: "cabasa", es: "Cabasa", en: "Cabasa", gm: 69, bst: "is-p", familia: "percusión",
    alias: ["afuche", "cabaza"] },
  { id: "maracas", es: "Maracas", en: "Maracas", gm: 70, bst: "is-p", familia: "percusión",
    alias: ["shaker", "cascabel", "güiro de semillas"] },
  { id: "clap-shaker", es: "Shaker", en: "Shaker", bst: "is-p", familia: "percusión",
    alias: ["egg shaker", "cascabeles", "sonajero"] },
  { id: "bongos", es: "Bongos", en: "Bongos", gm: 60, bst: "is-p", familia: "percusión",
    alias: ["bongo", "bongó"] },
  { id: "congas", es: "Congas", en: "Congas", gm: 63, bst: "is-p", familia: "percusión",
    alias: ["conga", "tumbadora"] },
  { id: "timbales", es: "Timbales", en: "Timbales", gm: 65, bst: "is-p", familia: "percusión",
    alias: ["timbal", "timbale", "timpani", "tímpano", "tímpanos"] },
  { id: "agogo", es: "Agogó", en: "Agogo", gm: 67, bst: "is-p", familia: "percusión",
    alias: ["agogo bells", "campanas brasileñas"] },
  { id: "cajon", es: "Cajón", en: "Cajon", bst: "is-p", familia: "percusión",
    alias: ["cajón flamenco", "cajon flamenco"] },
  { id: "darbuka", es: "Darbuka", en: "Darbuka", bst: "is-p", familia: "percusión",
    alias: ["doumbek", "derbake", "tabla árabe"] },
  { id: "pandero", es: "Pandero", en: "Frame drum", bst: "is-p", familia: "percusión",
    alias: ["frame drum", "pandereta redonda", "bodhran", "tambor de marco"] },
  { id: "vibraslap", es: "Vibraslap", en: "Vibraslap", gm: 58, bst: "is-p", familia: "percusión",
    alias: ["vibra slap", "quijada"] },

  // ── Tonal ─────────────────────────────────────────────────────────────────
  { id: "bajo", es: "Bajo", en: "Bass guitar", bst: "is-e", familia: "tonal",
    alias: ["bass guitar", "bajo eléctrico", "bajo sintético", "sub"] },
  { id: "piano", es: "Piano", en: "Piano", bst: "is-k", familia: "tonal",
    alias: ["piano acústico", "teclado", "piano eléctrico", "grand piano", "upright piano", "steinway", "kawai", "yamaha"] },
  { id: "organo", es: "Órgano", en: "Organ", bst: "is-k", familia: "tonal",
    alias: ["organ", "órgano Hammond", "acorde de órgano"] },
  { id: "campana", es: "Campana", en: "Bell", bst: "is-p", familia: "tonal",
    alias: ["bell", "campana tubular", "campanas", "carillón", "balafon", "balafón", "glockenspiel", "xilófono", "xylophone", "vibraphone"] },
  { id: "pad", es: "Pad", en: "Pad", bst: "is-e", familia: "tonal",
    alias: ["colchón", "ambiente tonal", "pad de sintetizador"] },
  { id: "cuerdas", es: "Cuerdas", en: "Strings", bst: "is-s", familia: "tonal",
    alias: ["strings", "violines", "orquesta de cuerda", "harp", "arpa", "cello", "viola", "violin", "contrabajo", "double bass", "dan tranh", "zither", "cítara", "strumstick"] },
  { id: "guitarra", es: "Guitarra", en: "Guitar", bst: "is-s", familia: "tonal",
    alias: ["guitar", "guitarra eléctrica", "riff de guitarra"] },
  { id: "vientos", es: "Vientos", en: "Winds", bst: "is-w", familia: "tonal",
    alias: ["saxo", "saxofón", "saxophone", "saxello", "tenor saxophone", "flauta", "flute",
            "clarinete", "clarinet", "trompeta", "trumpet", "trombón", "trombone", "recorder",
            "didgeridoo", "cuerno", "horn", "oboe"] },
  { id: "sintetizador", es: "Sintetizador", en: "Synth", bst: "is-e", familia: "tonal",
    alias: ["synth", "sintetizador analógico", "saw", "diente de sierra", "tx81z", "fm piano", "fm"] },

  // ── Textures and effects ──────────────────────────────────────────────────
  { id: "drone", es: "Drone", en: "Drone", bst: "is-e", familia: "textura",
    alias: ["zumbido", "drone sostenido", "textura sostenida", "bordón"] },
  { id: "textura", es: "Textura", en: "Texture", bst: "fx-ex", familia: "textura",
    alias: ["texture", "ambiente", "atmósfera", "colchón de ruido"] },
  { id: "rugido", es: "Rugido", en: "Growl", bst: "fx-ex", familia: "textura",
    alias: ["growl", "rugido metálico", "gruñido", "feedback"] },
  { id: "golpe-metalico", es: "Golpe metálico", en: "Metal hit", bst: "is-p", familia: "percusión",
    alias: ["metal", "clang", "chapa", "clangor", "golpe de metal", "anvil", "yunque", "brake drum", "bell tree"] },
  { id: "ruido", es: "Ruido", en: "Noise", bst: "fx-ex", familia: "ruido",
    alias: ["noise", "ruido blanco", "siseo", "hiss"] },
  { id: "vinilo", es: "Vinilo", en: "Vinyl noise", bst: "fx-ex", familia: "ruido",
    alias: ["vinyl", "crujido", "estática", "crackle"] },
  { id: "riser", es: "Riser", en: "Riser", bst: "fx-el", familia: "efecto",
    alias: ["subida", "sweep", "uplifter", "efecto de subida"] },
  { id: "impacto", es: "Impacto", en: "Impact", bst: "fx-el", familia: "efecto",
    alias: ["hit", "impact", "golpe cinematográfico", "boom"] },
  { id: "whoosh", es: "Whoosh", en: "Whoosh", bst: "fx-el", familia: "efecto",
    alias: ["pase", "swoosh", "aire", "transición"] },
  { id: "sub-drop", es: "Sub drop", en: "Sub drop", bst: "fx-el", familia: "efecto",
    alias: ["drop", "caída de graves", "bajón"] },
  { id: "laser", es: "Láser", en: "Laser", bst: "fx-el", familia: "efecto",
    alias: ["zap", "rayo", "blaster", "sci-fi"] },
  { id: "sirena", es: "Sirena", en: "Siren", bst: "fx-m", familia: "efecto",
    alias: ["alarma", "siren", "aviso sonoro"] },
  { id: "glitch", es: "Glitch", en: "Glitch", bst: "fx-ex", familia: "efecto",
    alias: ["error digital", "stutter", "corte", "fallo"] },
];

/** BST categories used here, with their readable name. */
export const BST: Record<string, string> = {
  "is-p": "Instrument samples · Percussion",
  "is-e": "Instrument samples · Synths / Electronic",
  "is-s": "Instrument samples · Strings",
  "is-k": "Instrument samples · Piano / Keyboard",
  "is-w": "Instrument samples · Winds",
  "fx-h": "Sound effects · Human sounds and actions",
  "fx-el": "Sound effects · Electronic / Design",
  "fx-ex": "Sound effects · Experimental",
  "fx-m": "Sound effects · Machines",
};

/** Comparable text: no Latin accents and no punctuation, in any alphabet. */
export function normalizar(texto: string): string {
  return normalizarTexto(texto.replace(/[^\p{L}\p{N}\p{M}\s-]/gu, " "));
}

export function etiquetaPorId(id: string): Etiqueta | undefined {
  return ETIQUETAS.find((e) => e.id === id);
}

/** Does `aguja` appear in `pajar` as a whole word (or as a whole phrase)? */
function contienePalabra(pajar: string, aguja: string): boolean {
  if (aguja.length < 4) return pajar === aguja;
  const esc = aguja.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`(^|\\s)${esc}($|\\s)`).test(pajar);
}

/**
 * Tags that match a text: id, es/en name, or any alias.
 *
 * Compared by whole word: with plain `includes`, "Baroque Alto Recorder" gave
 * "rimshot" because it contains "aro", and "Bell Tree" came out as "ride bell".
 * Words under 4 letters only match exactly.
 */
export function etiquetasDeTexto(texto: string): Etiqueta[] {
  const buscado = normalizar(texto);
  if (buscado === "") return [];
  return ETIQUETAS.filter((etiqueta) => {
    const candidatos = [etiqueta.id, etiqueta.es, etiqueta.en, ...etiqueta.alias].map(normalizar);
    return candidatos.some((c) => c === buscado || contienePalabra(buscado, c) || contienePalabra(c, buscado));
  });
}

/**
 * Extracts the tags that appear in a phrase: "a dirty, short china" →
 * [china]. It sorts by length so "charles abierto" beats "charles".
 */
export function etiquetasEnFrase(frase: string): Etiqueta[] {
  const encontradas: Etiqueta[] = [];
  const texto = normalizar(frase);
  const ordenadas = [...ETIQUETAS].sort((a, b) => b.es.length - a.es.length);
  for (const etiqueta of ordenadas) {
    const nombres = [etiqueta.es, etiqueta.en, ...etiqueta.alias].map(normalizar);
    if (nombres.some((n) => n.length >= 3 && new RegExp(`\\b${n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(texto))) {
      if (!encontradas.some((e) => e.id === etiqueta.id)) encontradas.push(etiqueta);
    }
  }
  return encontradas;
}
