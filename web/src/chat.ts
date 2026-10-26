/**
 * Panel de chat del agente (columna derecha).
 *
 * Cabecera, historial, caja de texto, envío y botón para plegarlo.
 *
 * Aquí NO se guarda nada: el panel se pinta con lo que hay en memoria y arranca
 * vacío. La memoria del agente es del proyecto (`proyectos/<slug>/agente.json`) y
 * la carga main.ts al abrirlo. Lo único que persiste es si el panel estaba
 * plegado y dónde ejecuta Python (cpu o GPU). `onSend` es el enganche del agente.
 */

import { CURSOR_PLANTILLA } from "./plantilla.ts";
import { escapeHtml } from "./timeline.ts";
import { setDestino, type Destino } from "./agent/tools.ts";

export type ChatRole = "user" | "assistant" | "system" | "meta";

export interface ChatApi {
  /** Añade un mensaje al historial y devuelve su burbuja (para poder reescribirla). */
  add(role: ChatRole, text: string): HTMLDivElement;
  /** Reemplaza el contenido de una burbuja creada con add(). */
  update(element: HTMLDivElement, text: string): void;
  /** Burbuja viva de «está trabajando»: se llama muchas veces y se reutiliza. */
  mostrarProgreso(texto: string): void;
  /** La quita (al terminar, al cancelar o al abrir otro proyecto). */
  ocultarProgreso(): void;
  /** Bloquea el envio mientras el agente esta trabajando. */
  setBusy(busy: boolean): void;
  /** Vacía el historial (canción nueva). */
  clear(): void;
  /** ¿Está visible el panel? */
  isOpen(): boolean;
  /** Muestra u oculta el panel. */
  setOpen(open: boolean, focus?: boolean): void;
  /** Alterna visible/oculto. */
  toggle(): void;
  /** Registra quién recibe el texto que escribe el usuario. */
  onSend(handler: (text: string) => void): void;
  /** Avisa cuando el panel se pliega o despliega (para reajustar el layout). */
  onLayout(handler: () => void): void;
}

interface Entrada {
  role: ChatRole;
  text: string;
}

const COLLAPSE_KEY = "miuzika.chat.collapsed";
/** Donde ejecuta Python el agente: "cpu" (este portatil) o "lambda" (GPU). */
const DESTINO_KEY = "miuzika.destino";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * Quién sabe generar la plantilla (main.ts, que conoce el proyecto abierto). Se
 * registra al arrancar; sin registro, el botón no hace nada en vez de mentir.
 */
let generadorPlantilla: (() => string) | null = null;

export function setGeneradorPlantilla(fn: (() => string) | null): void {
  generadorPlantilla = fn;
}

export function initChat(): ChatApi {
  const app = $("app");
  const log = $("messages");
  const form = $<HTMLFormElement>("chat-form");
  const input = $<HTMLTextAreaElement>("chat-input");
  const toggleButton = $<HTMLButtonElement>("chat-toggle");

  let handler: ((text: string) => void) | null = null;
  let layoutHandler: (() => void) | null = null;

  const autosize = (): void => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };

  const historial: Entrada[] = [];
  const dueno = new WeakMap<HTMLDivElement, Entrada>();

  const pintar = (entrada: Entrada): HTMLDivElement => {
    const div = document.createElement("div");
    div.className = `msg ${entrada.role}`;
    div.innerHTML = escapeHtml(entrada.text).replace(/\n/g, "<br>");
    log.appendChild(div);
    dueno.set(div, entrada);
    return div;
  };

  /**
   * Burbuja de «está trabajando» al final del chat. Se actualiza mientras el turno
   * corre y desaparece al terminar: así se ve que hay algo en marcha sin tener que
   * mirar la barra de estado, que es pequeña y está abajo.
   */
  let burbujaProgreso: HTMLDivElement | null = null;

  const mostrarProgreso = (texto: string): void => {
    if (!burbujaProgreso) {
      burbujaProgreso = document.createElement("div");
      burbujaProgreso.className = "msg progreso";
      burbujaProgreso.innerHTML = '<span class="punto"></span><span class="texto"></span>';
      log.appendChild(burbujaProgreso);
    }
    const hueco = burbujaProgreso.querySelector(".texto");
    if (hueco) hueco.textContent = texto;
    log.scrollTop = log.scrollHeight;
  };

  const ocultarProgreso = (): void => {
    burbujaProgreso?.remove();
    burbujaProgreso = null;
  };

  const add = (role: ChatRole, text: string): HTMLDivElement => {
    ocultarProgreso();
    const entrada: Entrada = { role, text };
    historial.push(entrada);
    const div = pintar(entrada);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  const update = (element: HTMLDivElement, text: string): void => {
    const entrada = dueno.get(element);
    if (entrada) entrada.text = text;
    element.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
    log.scrollTop = log.scrollHeight;
  };

  const setBusy = (busy: boolean): void => {
    form.classList.toggle("busy", busy);
    input.disabled = busy;
    const boton = form.querySelector("button");
    if (boton instanceof HTMLButtonElement) boton.disabled = busy;
  };

  const isOpen = (): boolean => !app.classList.contains("chat-collapsed");

  const setOpen = (open: boolean, focus = false): void => {
    const changed = isOpen() !== open;
    app.classList.toggle("chat-collapsed", !open);
    toggleButton.classList.toggle("active", open);
    try {
      localStorage.setItem(COLLAPSE_KEY, open ? "0" : "1");
    } catch {
      /* sin persistencia */
    }
    if (open && focus) {
      autosize();
      input.focus();
    }
    if (changed && layoutHandler) layoutHandler();
  };

  toggleButton.addEventListener("click", () => setOpen(!isOpen(), true));

  input.addEventListener("input", () => autosize());
  input.addEventListener("keydown", (event) => {
    // Enter envía; Shift+Enter escribe un salto de línea.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Plantilla de encargo: el esqueleto + el contexto medido del proyecto abierto.
  // El texto lo genera main.ts, que es quien conoce el proyecto.
  const botonPlantilla = document.getElementById("chat-plantilla");
  botonPlantilla?.addEventListener("click", () => {
    const plantilla = generadorPlantilla ? generadorPlantilla() : "";
    if (!plantilla) return;
    const vacio = input.value.trim() === "";
    input.value = vacio ? plantilla : `${input.value.replace(/\s+$/, "")}\n${plantilla}`;
    input.focus();
    if (vacio) input.setSelectionRange(CURSOR_PLANTILLA, CURSOR_PLANTILLA);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text === "") return;
    add("user", text);
    input.value = "";
    autosize();
    if (handler) {
      handler(text);
    } else {
      add(
        "system",
        "La caja funciona, pero todavía no hay agente detrás: queda conectar el LLM.",
      );
    }
  });

  // Destino de ejecucion: se recuerda entre recargas y manda en las herramientas.
  const selectorDestino = document.getElementById("chat-destino") as HTMLSelectElement | null;
  const aplicarDestino = (valor: string): Destino => {
    const destino: Destino = valor === "lambda" ? "lambda" : "cpu";
    setDestino(destino);
    selectorDestino?.parentElement?.classList.toggle("gpu", destino === "lambda");
    return destino;
  };
  if (selectorDestino) {
    let guardado = "cpu";
    try {
      guardado = localStorage.getItem(DESTINO_KEY) ?? "cpu";
    } catch {
      /* sin persistencia */
    }
    selectorDestino.value = aplicarDestino(guardado);
    selectorDestino.addEventListener("change", () => {
      const destino = aplicarDestino(selectorDestino.value);
      try {
        localStorage.setItem(DESTINO_KEY, destino);
      } catch {
        /* sin persistencia */
      }
    });
  }

  // Estado guardado: sólo si el chat está plegado. El historial y el borrador NO se
  // restauran: al abrir la aplicación no debe haber nada de la sesión anterior. La
  // conversación de cada proyecto vive en su agente.json y se carga al abrirlo.
  let startOpen = true;
  try {
    startOpen = localStorage.getItem(COLLAPSE_KEY) !== "1";
  } catch {
    /* sin persistencia */
  }
  log.scrollTop = log.scrollHeight;
  autosize();
  setOpen(startOpen);

  return {
    add,
    mostrarProgreso,
    ocultarProgreso,
    update,
    setBusy,
    clear: () => {
      historial.length = 0;
      // OJO: sin esto, la burbuja de «está trabajando» se queda huérfana en un
      // panel vacío (parecía que el agente seguía en un proyecto que no era).
      ocultarProgreso();
      log.innerHTML = "";
    },
    isOpen,
    setOpen,
    toggle: () => setOpen(!isOpen(), true),
    onSend: (fn) => {
      handler = fn;
    },
    onLayout: (fn) => {
      layoutHandler = fn;
    },
  };
}
