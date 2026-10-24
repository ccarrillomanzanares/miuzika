/**
 * Taxonomía del catálogo: las etiquetas con las que se nombra un sonido.
 *
 * Tres referencias estándar, cada una para lo suyo:
 *  - **General MIDI (canal 10)**: el mapa de percusión (notas 35-81). Es el nombre
 *    que todo el mundo reconoce para un bombo, una caja o un ride, y da una nota
 *    MIDI canónica para cada golpe.
 *  - **Freesound Broad Sound Taxonomy (BST, 2025)**: dos niveles para ordenar una
 *    colección heterogénea: Music (m), Instrument samples (is) con Percussion
 *    (is-p), Synths (is-e)…, Sound effects (fx) con Electronic/Design (fx-el)…
 *  - **AudioSet (Google)**: 632 clases jerárquicas de eventos sonoros; se usa como
 *    vocabulario de sinónimos de lo que no es un instrumento (impactos, texturas).
 *
 * Cada entrada lleva: identificador, nombre en español, nombre en inglés, nota GM
 * si es percusión, categoría BST, familia nuestra y **alias** (español e inglés,
 * incluidos los regionalismos). Los alias son lo que permite que el agente
 * reconozca «tarola», «redoblante» o «hi-hat» como la misma cosa.
 */

export type Familia = "percusión" | "tonal" | "textura" | "ruido" | "efecto";

export interface Etiqueta {
  id: string;
  es: string;
  en: string;
  /** Nota GM del mapa de percusión (35-81), si la tiene. */
  gm?: number;
  /** Categoría de la Broad Sound Taxonomy. */
  bst: string;
  familia: Familia;
  alias: string[];
}

export const ETIQUETAS: Etiqueta[] = [
  // ── Batería: bombos y cajas ───────────────────────────────────────────────
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

  // ── Charles ───────────────────────────────────────────────────────────────
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

  // ── Percusión pequeña ─────────────────────────────────────────────────────
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
    alias: ["timbal", "timbale"] },
  { id: "agogo", es: "Agogó", en: "Agogo", gm: 67, bst: "is-p", familia: "percusión",
    alias: ["agogo bells", "campanas brasileñas"] },
  { id: "vibraslap", es: "Vibraslap", en: "Vibraslap", gm: 58, bst: "is-p", familia: "percusión",
    alias: ["vibra slap", "quijada"] },

  // ── Tonales ───────────────────────────────────────────────────────────────
  { id: "bajo", es: "Bajo", en: "Bass", bst: "is-e", familia: "tonal",
    alias: ["bass", "bajo eléctrico", "bajo sintético", "sub"] },
  { id: "piano", es: "Piano", en: "Piano", bst: "is-k", familia: "tonal",
    alias: ["piano acústico", "teclado", "piano eléctrico"] },
  { id: "organo", es: "Órgano", en: "Organ", bst: "is-k", familia: "tonal",
    alias: ["organ", "órgano Hammond", "acorde de órgano"] },
  { id: "campana", es: "Campana", en: "Bell", bst: "is-p", familia: "tonal",
    alias: ["bell", "campana tubular", "campanas", "carillón"] },
  { id: "pad", es: "Pad", en: "Pad", bst: "is-e", familia: "tonal",
    alias: ["colchón", "ambiente tonal", "pad de sintetizador"] },
  { id: "cuerdas", es: "Cuerdas", en: "Strings", bst: "is-s", familia: "tonal",
    alias: ["strings", "violines", "orquesta de cuerda"] },
  { id: "guitarra", es: "Guitarra", en: "Guitar", bst: "is-s", familia: "tonal",
    alias: ["guitar", "guitarra eléctrica", "riff de guitarra"] },
  { id: "sintetizador", es: "Sintetizador", en: "Synth", bst: "is-e", familia: "tonal",
    alias: ["synth", "sintetizador analógico", "saw", "diente de sierra"] },

  // ── Texturas y efectos ────────────────────────────────────────────────────
  { id: "drone", es: "Drone", en: "Drone", bst: "is-e", familia: "textura",
    alias: ["zumbido", "drone sostenido", "textura sostenida", "bordón"] },
  { id: "textura", es: "Textura", en: "Texture", bst: "fx-ex", familia: "textura",
    alias: ["texture", "ambiente", "atmósfera", "colchón de ruido"] },
  { id: "rugido", es: "Rugido", en: "Growl", bst: "fx-ex", familia: "textura",
    alias: ["growl", "rugido metálico", "gruñido", "feedback"] },
  { id: "golpe-metalico", es: "Golpe metálico", en: "Metal hit", bst: "is-p", familia: "percusión",
    alias: ["metal", "clang", "chapa", "clangor", "golpe de metal"] },
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

/** Categorías BST usadas aquí, con su nombre legible. */
export const BST: Record<string, string> = {
  "is-p": "Instrument samples · Percusión",
  "is-e": "Instrument samples · Sintetizadores / Electrónico",
  "is-s": "Instrument samples · Cuerda",
  "is-k": "Instrument samples · Piano / Teclado",
  "fx-h": "Sound effects · Sonidos y acciones humanas",
  "fx-el": "Sound effects · Electrónico / Diseño",
  "fx-ex": "Sound effects · Experimental",
  "fx-m": "Sound effects · Máquinas",
};

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function etiquetaPorId(id: string): Etiqueta | undefined {
  return ETIQUETAS.find((e) => e.id === id);
}

/** Etiquetas que coinciden con un texto: id, nombre es/en o cualquier alias. */
export function etiquetasDeTexto(texto: string): Etiqueta[] {
  const buscado = normalizar(texto);
  if (buscado === "") return [];
  return ETIQUETAS.filter((etiqueta) => {
    const candidatos = [etiqueta.id, etiqueta.es, etiqueta.en, ...etiqueta.alias].map(normalizar);
    return candidatos.some((c) => c === buscado || c.includes(buscado) || buscado.includes(c));
  });
}

/**
 * Saca de una frase las etiquetas que aparecen: «un china sucio y corto» →
 * [china]. Ordena por longitud para que «charles abierto» gane a «charles».
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
