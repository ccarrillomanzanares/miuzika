/**
 * Interface language. The BASE language is English: the texts in the code and in
 * `web/index.html` are in English, and each language is a dictionary that translates from
 * there. Whatever is missing from a dictionary stays in English, never blank.
 *
 * `index.html` carries the English text and a key in `data-i18n` (text) or `data-i18n-title`;
 * in code, `t("key", "English text")`. To force a language: `?lang=es` in the URL or
 * `localStorage.miuzika.idioma = "es"` (`fijarIdioma`).
 */

export type Idioma = "es" | "en";

type Diccionario = Record<string, string>;

/** Spanish translations. The keys are the same as in index.html. */
const ES: Diccionario = {
  play: "Reproducir con el engine de openDAW",
  stop: "Detener",
  undo: "Deshacer (Ctrl+Z)",
  redo: "Rehacer (Ctrl+Shift+Z)",
  abrir: "Abrir",
  "abrir.title": "Abrir proyecto (.json/.zip), audio o MIDI",
  audio: "Audio",
  guardar: "Guardar",
  "guardar.title": "Escribir el fichero maestro en workspace/proyectos/<slug>/proyecto.json (Ctrl+S)",
  "mp3.title": "Renderizar la mezcla con el mismo motor que Play y guardarla como MP3 (320 kbps, título del proyecto en ID3) en salida/",
  "mp3.renderizando": "Renderizando la mezcla a MP3…",
  proyectos: "Proyectos",
  "proyectos.title": "Abrir un proyecto guardado en workspace/proyectos/",
  "proyectos.dialogo": "Proyectos en disco",
  recargar: "↻ versión nueva",
  nueva: "Nueva",
  "nueva.title": "Cerrar este proyecto y empezar otro",
  mute: "Mute",
  solo: "Solo",
  borrar: "Borrar",
  copiar: "Copiar",
  "copiar.title": "Copiar el clip seleccionado (Ctrl+C)",
  pegar: "Pegar",
  "pegar.title": "Pegar en el cursor (Ctrl+V)",
  duplicar: "Duplicar",
  "duplicar.title": "Duplicar a continuación (Ctrl+D)",
  todas: "Todas",
  limpiar: "Limpiar",
  cerrar: "Cerrar",
  "audio.dialogo": "¿Qué hago con estos audios?",
  cancelar: "Cancelar",
  "estado.inicial": "Espacio = reproducir/pausa · dos veces = stop · Doble clic en un clip = piano roll · Ctrl+rueda = zoom",
  "recargar.title": "El servidor tiene código más nuevo que esta pestaña; cárgalo",
};

const DICCIONARIOS: Partial<Record<Idioma, Diccionario>> = { es: ES };

/** localStorage key for the manually forced language. */
export const CLAVE_IDIOMA = "miuzika.idioma";

/**
 * Language requested in the URL (`?lang=es`). It applies to this load and is NOT
 * saved: a URL parameter that sticks around leaves the app in Spanish forever,
 * with no way back except deleting localStorage by hand.
 */
function idiomaDeUrl(): Idioma | null {
  try {
    const pedido = new URLSearchParams(location.search).get("lang");
    if (pedido === "es" || pedido === "en") return pedido;
  } catch {
    /* no location (tests) */
  }
  return null;
}

/** Language forced in this session with `fijarIdioma` (it wins over everything else). */
let forzado: Idioma | null = null;

/** Language forced by hand (URL, memory or localStorage); null if there is none. */
function idiomaForzado(): Idioma | null {
  const deUrl = idiomaDeUrl();
  if (deUrl) return deUrl;
  if (forzado) return forzado;
  try {
    const guardado = localStorage.getItem(CLAVE_IDIOMA);
    if (guardado === "es" || guardado === "en") return guardado;
  } catch {
    /* no localStorage */
  }
  return null;
}

/** Forces the interface language and remembers it. */
export function fijarIdioma(nuevo: Idioma): void {
  forzado = nuevo;
  try {
    localStorage.setItem(CLAVE_IDIOMA, nuevo);
  } catch {
    /* no localStorage: it stays for this session */
  }
  actual = nuevo;
}

/** Returns to the starting language (English). For tests and for "automatic". */
export function olvidarIdioma(): void {
  forzado = null;
  actual = "en";
  try {
    localStorage.removeItem(CLAVE_IDIOMA);
  } catch {
    /* no localStorage */
  }
}

/**
 * Interface language: **English for everyone**. The browser no longer decides
 * anything; it only changes if someone forces it (`?lang=es` or `fijarIdioma`).
 * The argument is accepted so as not to break callers, but it is not used: the
 * system being in Spanish should not make the app speak Spanish to someone who
 * did not ask for it.
 */
export function idiomaDe(_preferidos: readonly string[] = []): Idioma {
  return idiomaForzado() ?? "en";
}

let actual: Idioma = "en";

export function idioma(): Idioma {
  return actual;
}

/** Locale for formatting numbers and dates: the interface language's locale. */
export function locale(): string {
  return actual === "es" ? "es-ES" : "en-GB";
}

/** Text for a key in the current language; English if there is no translation. */
export function t(clave: string, reserva: string): string {
  return DICCIONARIOS[actual]?.[clave] ?? reserva;
}

/** Translates the marked texts on the page. Called once at startup. */
export function traducirPagina(raiz: Document = document): void {
  try {
    actual = idiomaDe(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    actual = "en";
  }
  raiz.documentElement.lang = actual;
  // The HTML is already in English: it only has to be touched if the language is not English.
  if (actual === "en") return;
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n ?? "", el.textContent ?? "");
  }
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle ?? "", el.title);
  }
}
