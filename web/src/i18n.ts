/**
 * Idioma de la interfaz.
 *
 * La CONVERSACIÓN no pasa por aquí: el agente contesta en el idioma en que le
 * escribe cada persona, y es él quien traduce lo que dice el usuario al vocabulario
 * canónico de las herramientas (palabras de sonido, tipos de efecto, modos). Esto
 * sólo traduce los textos fijos de la página.
 *
 * Cómo funciona: `web/index.html` lleva el texto en español (el idioma de origen)
 * y una clave en `data-i18n` (texto), `data-i18n-title` o `data-i18n-placeholder`.
 * Si el navegador no está en español se sustituye por el diccionario que toque.
 * Añadir un idioma es añadir un diccionario: lo que falte en él se queda en español.
 *
 * PENDIENTE: los avisos que escribe main.ts en el chat siguen en español.
 */

export type Idioma = "es" | "en";

type Diccionario = Record<string, string>;

const EN: Diccionario = {
  play: "Play (openDAW engine)",
  stop: "Stop",
  undo: "Undo (Ctrl+Z)",
  redo: "Redo (Ctrl+Shift+Z)",
  abrir: "Open",
  "abrir.title": "Open a project (.json/.zip), audio or MIDI",
  audio: "Audio",
  guardar: "Save",
  "guardar.title": "Write the project file workspace/proyectos/<folder>/proyecto.json (Ctrl+S)",
  proyectos: "Projects",
  "proyectos.title": "Open a project saved in workspace/proyectos/",
  "proyectos.dialogo": "Projects on disk",
  sonidos: "Sounds",
  "sonidos.title": "Search the CC0 sample library and bring sounds into the project",
  "sonidos.placeholder": "short kick, snare, dirty china…",
  "sonidos.ayuda": "Search in English or Spanish: «snare», «hi-hat», «crash cymbal» and character (short, dry, bright).",
  "strudel.title": "Write a Strudel pattern and render it to WAV",
  modelos: "Models",
  "modelos.title": "The agent's provider and model (keys included)",
  "pad.title": "Play the laptop touchpad (keys, pads or sliding) and record it to a track",
  chat: "Chat",
  "chat.title": "Show or hide the agent chat",
  "chat.placeholder": "Ask the agent anything, in your own language… (Enter sends, Shift+Enter new line)",
  recargar: "↻ new version",
  "recargar.title": "The server has newer code than this tab; reload it (the running turn is lost)",
  nueva: "New",
  "nueva.title": "Close this project and start another one",
  mute: "Mute",
  solo: "Solo",
  borrar: "Delete",
  copiar: "Copy",
  "copiar.title": "Copy the selected clip (Ctrl+C)",
  pegar: "Paste",
  "pegar.title": "Paste at the cursor (Ctrl+V)",
  duplicar: "Duplicate",
  "duplicar.title": "Duplicate right after (Ctrl+D)",
  todas: "All",
  limpiar: "Clear",
  agente: "Agent",
  "destino.title": "Where the agent runs Python: this computer or a Lambda GPU",
  plantilla: "Brief",
  "plantilla.title": "Fill in the brief with a form",
  enviar: "Send",
  cerrar: "Close",
  "audio.dialogo": "What should I do with these audio files?",
  cancelar: "Cancel",
  "cancelar.title": "Stop the agent's turn (a running GPU does not switch off by itself)",
  "estado.inicial": "Double-click a clip = piano roll · Ctrl+wheel = zoom",
};

const DICCIONARIOS: Partial<Record<Idioma, Diccionario>> = { en: EN };

/** Idioma de la interfaz a partir de las preferencias del navegador. */
export function idiomaDe(preferidos: readonly string[]): Idioma {
  for (const etiqueta of preferidos) {
    const base = etiqueta.toLowerCase().split("-")[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  // Sin español ni inglés entre los preferidos, inglés: es el que más gente lee.
  return "en";
}

let actual: Idioma = "es";

export function idioma(): Idioma {
  return actual;
}

/** Locale para formatear números y fechas: el del navegador, no uno fijo. */
export function locale(): string {
  try {
    return navigator.language || "es-ES";
  } catch {
    return "es-ES";
  }
}

/** Texto de una clave en el idioma actual; si no hay traducción, el de reserva. */
export function t(clave: string, reserva: string): string {
  return DICCIONARIOS[actual]?.[clave] ?? reserva;
}

/** Traduce los textos marcados de la página. Se llama una vez al arrancar. */
export function traducirPagina(raiz: Document = document): void {
  try {
    actual = idiomaDe(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    actual = "es";
  }
  raiz.documentElement.lang = actual;
  if (actual === "es") return;
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n ?? "", el.textContent ?? "");
  }
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle ?? "", el.title);
  }
  for (const el of raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder ?? "", el.placeholder);
  }
}
