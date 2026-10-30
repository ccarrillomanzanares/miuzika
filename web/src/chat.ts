/**
 * Agent chat panel (right column).
 *
 * Header, history, text box, send and button to collapse it.
 *
 * Nothing is stored HERE: the panel is painted from what is in memory and starts
 * empty. The agent's memory belongs to the project (`proyectos/<slug>/agente.json`)
 * and main.ts loads it when opening it. The only thing that persists is whether the
 * panel was collapsed and where Python runs (cpu or GPU). `onSend` is the agent hook.
 */

import { escapeHtml } from "./timeline.ts";
import { setDestino, type Destino } from "./agent/tools.ts";

export type ChatRole = "user" | "assistant" | "system" | "meta";

export interface ChatApi {
  /** Adds a message to the history and returns its bubble (so it can be rewritten). */
  add(role: ChatRole, text: string): HTMLDivElement;
  /** Replaces the content of a bubble created with add(). */
  update(element: HTMLDivElement, text: string): void;
  /** Live "working" bubble: called many times and reused. */
  mostrarProgreso(texto: string): void;
  /** Removes it (on finish, on cancel or when opening another project). */
  ocultarProgreso(): void;
  /** Blocks sending while the agent is working. */
  setBusy(busy: boolean): void;
  /** Empties the history (new song). */
  clear(): void;
  /** Is the panel visible? */
  isOpen(): boolean;
  /** Shows or hides the panel. */
  setOpen(open: boolean, focus?: boolean): void;
  /** Toggles visible/hidden. */
  toggle(): void;
  /** Registers who receives the text the user types. */
  onSend(handler: (text: string) => void): void;
  /** Notifies when the panel collapses or expands (to readjust the layout). */
  onLayout(handler: () => void): void;
}

interface Entrada {
  role: ChatRole;
  text: string;
}

const COLLAPSE_KEY = "miuzika.chat.collapsed";
/** Where the agent runs Python: "cpu" (this laptop) or "lambda" (GPU). */
const DESTINO_KEY = "miuzika.destino";
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * What the "Encargo" button does (main.ts opens the form). Without a registered
 * handler, the button does nothing instead of lying.
 */
let abrirEncargo: (() => void) | null = null;

export function setAbrirEncargo(fn: (() => void) | null): void {
  abrirEncargo = fn;
}

/** Writes `texto` into the chat composer without sending it (after whatever was there). */
export function escribirEnCompositor(texto: string): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (!input || texto.trim() === "") return;
  input.value = input.value.trim() === "" ? texto : `${input.value.replace(/\s+$/, "")}\n${texto}`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
   * "Working" bubble at the end of the chat. It updates while the turn runs and
   * disappears when it finishes: that way you can see something is going on without
   * having to look at the status bar, which is small and at the bottom.
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
      /* no persistence */
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
    // Enter sends; Shift+Enter types a line break.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Encargo: a form that writes the message into the chat (formulario-encargo.ts).
  document.getElementById("chat-plantilla")?.addEventListener("click", () => abrirEncargo?.());

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
        "The box works, but there is no agent behind it yet: the LLM still has to be connected.",
      );
    }
  });

  // Execution target: remembered across reloads and it rules in the tools.
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
      /* no persistence */
    }
    selectorDestino.value = aplicarDestino(guardado);
    selectorDestino.addEventListener("change", () => {
      const destino = aplicarDestino(selectorDestino.value);
      try {
        localStorage.setItem(DESTINO_KEY, destino);
      } catch {
        /* no persistence */
      }
    });
  }

  // Saved state: only whether the chat is collapsed. The history and the draft are
  // NOT restored: when opening the application there must be nothing from the
  // previous session. Each project's conversation lives in its agente.json and is
  // loaded when it is opened.
  let startOpen = true;
  try {
    startOpen = localStorage.getItem(COLLAPSE_KEY) !== "1";
  } catch {
    /* no persistence */
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
      // WARNING: without this, the "working" bubble is left orphaned in an empty
      // panel (it looked like the agent was still on a project that was not this one).
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
