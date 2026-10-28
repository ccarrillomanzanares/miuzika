/**
 * Idioma de la interfaz.
 *
 * La CONVERSACIÓN no pasa por aquí: el agente contesta en el idioma en que le
 * escribe cada persona, y es él quien traduce lo que dice el usuario al vocabulario
 * canónico de las herramientas (palabras de sonido, tipos de efecto, modos). Esto
 * sólo traduce los textos fijos de la página.
 *
 * El idioma BASE es el inglés: los textos que se escriben en el código y en
 * `web/index.html` van en inglés, y cada idioma es un diccionario que traduce desde
 * ahí. Lo que falte en un diccionario se queda en inglés, nunca en blanco.
 *
 * Cómo funciona la página: `index.html` lleva el texto en inglés y una clave en
 * `data-i18n` (texto), `data-i18n-title` o `data-i18n-placeholder`; si el idioma
 * elegido no es inglés, `traducirPagina` sustituye por el diccionario.
 *
 * Cómo funciona el código: `t("clave", "English text")`, con el inglés de reserva.
 * Los textos con partes variables van en plantillas: `t("x", "Added ${n} tracks")`
 * no sirve, así que se traduce el trozo fijo y se concatena el número.
 *
 * Para forzar un idioma: `?lang=es` en la URL o `localStorage.miuzika.idioma = "es"`
 * (`fijarIdioma`). Sin nada de eso manda el navegador, y gana el inglés.
 */

export type Idioma = "es" | "en";

type Diccionario = Record<string, string>;

/** Traducciones al español. Las claves son las mismas que en index.html. */
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
  proyectos: "Proyectos",
  "proyectos.title": "Abrir un proyecto guardado en workspace/proyectos/",
  "proyectos.dialogo": "Proyectos en disco",
  sonidos: "Sonidos",
  "sonidos.title": "Buscar en la biblioteca de samples (CC0) y traerlos al proyecto",
  "sonidos.placeholder": "bombo corto, tarola, china sucio…",
  "sonidos.ayuda":
    "Escribe cómo lo pedirías: entiende «tarola», «hi-hat», «platillo crash» y el carácter (corto, seco, brillante).",
  "strudel.title": "Escribir un patrón Strudel y renderizarlo a WAV",
  modelos: "Modelos",
  "modelos.title": "Proveedor y modelo del agente (claves incluidas)",
  "pad.title": "Tocar con el touchpad del portátil (teclas, pads o deslizando) y grabarlo en una pista",
  chat: "Chat",
  "chat.title": "Mostrar u ocultar el chat del agente",
  "chat.placeholder": "Pídele algo al agente, en tu idioma… (Enter envía, Shift+Enter salto de línea)",
  recargar: "↻ versión nueva",
  "recargar.title": "El servidor tiene código más nuevo que esta pestaña; cárgalo (se pierde el turno en curso)",
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
  agente: "Agente",
  "destino.title": "Dónde ejecuta Python el agente: este portátil o una GPU de Lambda",
  plantilla: "Encargo",
  "plantilla.title": "Rellenar el encargo con un formulario",
  enviar: "Enviar",
  cerrar: "Cerrar",
  "audio.dialogo": "¿Qué hago con estos audios?",
  cancelar: "Cancelar",
  "cancelar.title": "Corta el turno del agente (la GPU no se apaga sola)",
  "estado.inicial": "Doble clic en un clip = piano roll · Ctrl+rueda = zoom",
};

const DICCIONARIOS: Partial<Record<Idioma, Diccionario>> = { es: ES };

/** Clave de localStorage con el idioma forzado a mano. */
export const CLAVE_IDIOMA = "miuzika.idioma";

/** Idioma pedido explícitamente en la URL (`?lang=es`), si lo hay. */
function idiomaDeUrl(): Idioma | null {
  try {
    const pedido = new URLSearchParams(location.search).get("lang");
    if (pedido === "es" || pedido === "en") {
      fijarIdioma(pedido);
      return pedido;
    }
  } catch {
    /* sin location (pruebas) */
  }
  return null;
}

/** Idioma forzado a mano (URL o localStorage); null si manda el navegador. */
function idiomaForzado(): Idioma | null {
  const deUrl = idiomaDeUrl();
  if (deUrl) return deUrl;
  try {
    const guardado = localStorage.getItem(CLAVE_IDIOMA);
    if (guardado === "es" || guardado === "en") return guardado;
  } catch {
    /* sin localStorage */
  }
  return null;
}

/** Fuerza el idioma de la interfaz y lo recuerda. */
export function fijarIdioma(nuevo: Idioma): void {
  try {
    localStorage.setItem(CLAVE_IDIOMA, nuevo);
  } catch {
    /* sin localStorage: se queda para esta sesión */
  }
  actual = nuevo;
}

/**
 * Idioma de la interfaz. El inglés es el de partida: sólo se cambia si la persona
 * lo fuerza o si su navegador pide español.
 */
export function idiomaDe(preferidos: readonly string[]): Idioma {
  const forzado = idiomaForzado();
  if (forzado) return forzado;
  for (const etiqueta of preferidos) {
    const base = etiqueta.toLowerCase().split("-")[0];
    // El orden del navegador manda: si pide inglés antes que español, inglés.
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}

let actual: Idioma = "en";

export function idioma(): Idioma {
  return actual;
}

/** Locale para formatear números y fechas: el del idioma de la interfaz. */
export function locale(): string {
  return actual === "es" ? "es-ES" : "en-GB";
}

/** Texto de una clave en el idioma actual; si no hay traducción, el inglés. */
export function t(clave: string, reserva: string): string {
  return DICCIONARIOS[actual]?.[clave] ?? reserva;
}

/** Traduce los textos marcados de la página. Se llama una vez al arrancar. */
export function traducirPagina(raiz: Document = document): void {
  try {
    actual = idiomaDe(navigator.languages?.length ? navigator.languages : [navigator.language]);
  } catch {
    actual = "en";
  }
  raiz.documentElement.lang = actual;
  // El HTML ya está en inglés: sólo hay que tocarlo si el idioma no es inglés.
  if (actual === "en") return;
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
