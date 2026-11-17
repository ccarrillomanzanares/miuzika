/**
 * The Note box: a line about what is being used or heard right now, saved with what the app was showing at that
 * moment (`/api/nota` → `.miuzika/notas.log`, outside git). F2 from anywhere, or "Note" in the status bar.
 *
 * It never stops the music and never blocks what is underneath: it is not modal, so Play, mute, the sliders and the
 * window the note is about stay in reach. Over a modal window (everything outside a modal is inert) the box moves
 * INSIDE that window while it is open, and is put back if the window repaints itself; opened as a second modal it
 * could be typed in, but the form under it could not be scrolled or touched (bug 52). The context is taken when the box OPENS, not when it is sent: that is the
 * moment the note is about, and by Enter a slider may have moved.
 *
 * What a window shows is read from the page (its heading and its named fields), so a new window needs no code here.
 * Password fields are never read: the keys of Settings must not reach a log.
 */

import type { Avisos } from "./avisos.ts";

const corto = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}…` : t);

export interface VentanaAbierta {
  titulo: string;
  campos: Record<string, string | boolean>;
}

const MAX_CAMPOS = 80;

/** The open windows (dialogs and the piano roll), each with its heading and the values of its named fields. */
export function ventanasAbiertas(propia?: Element): VentanaAbierta[] {
  const ventanas: VentanaAbierta[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("dialog[open], .modal")) {
    if (el === propia) continue;
    const titulo = corto((el.querySelector("strong, h2, h3")?.textContent ?? el.className).trim().replace(/\s+/g, " "), 120);
    const campos: Record<string, string | boolean> = {};
    let cuantos = 0;
    for (const campo of el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")) {
      if (cuantos >= MAX_CAMPOS) break;
      const tipo = campo instanceof HTMLInputElement ? campo.type : "";
      if (tipo === "password" || tipo === "file" || tipo === "hidden") continue;
      if (tipo === "radio") {
        if ((campo as HTMLInputElement).checked) campos[campo.name] = campo.value;
      } else if (tipo === "checkbox") {
        campos[campo.name] = (campo as HTMLInputElement).checked;
      } else {
        campos[campo.name] = corto(campo.value, 600);
      }
      cuantos += 1;
    }
    ventanas.push({ titulo, campos });
  }
  return ventanas;
}

const VEREDICTOS = [
  ["pass", "PASS"],
  ["so-so", "So-so"],
  ["fail", "FAIL"],
] as const;

export function crearNota(d: {
  boton: HTMLButtonElement;
  /** What the app knows of this moment: a short line shown in the box, and the data saved with the note. */
  contexto(): { resumen: string; datos: Record<string, unknown> };
  avisos: Avisos;
}): void {
  const dialogo = document.createElement("dialog");
  dialogo.className = "dialogo nota";
  dialogo.innerHTML = `
    <div class="dialogo-cabeza"><strong>Note</strong><button type="button" class="icon" data-cerrar title="Close (Esc)">✕</button></div>
    <small data-resumen class="nota-resumen"></small>
    <textarea rows="2" maxlength="2000" placeholder="What do you think of this, right now? Enter saves it"></textarea>
    <div class="dialogo-acciones nota-acciones">
      ${VEREDICTOS.map(([id, texto]) => `<button type="button" data-veredicto="${id}">${texto}</button>`).join("")}
      <span class="spacer"></span>
      <button type="button" class="primario" data-guardar>Save</button>
    </div>`;
  document.body.append(dialogo);
  const texto = dialogo.querySelector("textarea")!;
  const resumen = dialogo.querySelector<HTMLElement>("[data-resumen]")!;
  const guardarBoton = dialogo.querySelector<HTMLButtonElement>("[data-guardar]")!;

  /** The modal window the box sits in while open, and the watch that puts it back when that window repaints. */
  let anfitrion: HTMLElement | null = null;
  let vigia: MutationObserver | null = null;
  const alCerrarAnfitrion = (): void => dialogo.close();
  dialogo.addEventListener("close", () => {
    vigia?.disconnect();
    vigia = null;
    anfitrion?.removeEventListener("close", alCerrarAnfitrion);
    anfitrion = null;
    if (dialogo.parentElement !== document.body) document.body.append(dialogo);
  });

  let veredicto: string | null = null;
  let contexto: Record<string, unknown> = {};
  let enviando = false;

  const pintarVeredicto = (): void => {
    for (const b of dialogo.querySelectorAll<HTMLButtonElement>("[data-veredicto]")) b.classList.toggle("active", b.dataset.veredicto === veredicto);
  };

  const abrir = (): void => {
    if (dialogo.open) {
      texto.focus();
      return;
    }
    const ventanas = ventanasAbiertas(dialogo);
    const app = d.contexto();
    contexto = { ...app.datos, ventanas };
    resumen.textContent = [app.resumen, ...ventanas.map((v) => v.titulo)].filter(Boolean).join(" · ");
    // Text left from a note that failed to save stays; a saved one cleared it.
    const modales = document.querySelectorAll<HTMLElement>("dialog:modal");
    anfitrion = modales.length > 0 ? modales[modales.length - 1]! : null;
    if (anfitrion) {
      const casa = anfitrion;
      casa.append(dialogo);
      casa.addEventListener("close", alCerrarAnfitrion);
      // These windows repaint with innerHTML, which throws the box out: it goes back in, with its text and its focus.
      vigia = new MutationObserver(() => {
        if (dialogo.open && dialogo.parentElement !== casa) {
          casa.append(dialogo);
          texto.focus();
        }
      });
      vigia.observe(casa, { childList: true });
    }
    dialogo.show();
    texto.focus();
  };

  const guardar = async (): Promise<void> => {
    if (enviando) return;
    const escrito = texto.value.trim();
    if (escrito === "" && !veredicto) {
      texto.focus();
      return;
    }
    enviando = true;
    guardarBoton.disabled = true;
    try {
      const r = await fetch("/api/nota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: escrito, veredicto, contexto }),
      });
      const datos = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !datos.ok) throw new Error(datos.error ?? `HTTP ${r.status}`);
      const marca = veredicto ? `${VEREDICTOS.find(([id]) => id === veredicto)![1]}: ` : "";
      d.avisos.info(`Note saved — ${marca}${corto(escrito, 200) || "(no text)"}`);
      texto.value = "";
      veredicto = null;
      pintarVeredicto();
      dialogo.close();
    } catch (error) {
      // The box stays open with the text: a note that vanished unsaved would be worse than a box in the way.
      d.avisos.error(`The note was NOT saved: ${error instanceof Error ? error.message : String(error)}. It is still in the Note box.`);
    } finally {
      enviando = false;
      guardarBoton.disabled = false;
    }
  };

  d.boton.addEventListener("click", abrir);
  dialogo.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    if (el.dataset.cerrar !== undefined) dialogo.close();
    else if (el.dataset.guardar !== undefined) void guardar();
    else if (el.dataset.veredicto) {
      veredicto = veredicto === el.dataset.veredicto ? null : el.dataset.veredicto;
      pintarVeredicto();
      texto.focus();
    }
  });

  // On the window, in capture, and wired before the Pad and the piano roll add theirs: both take Esc and other keys
  // in capture too, and listeners of one phase run in the order they were added.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (dialogo.open) dialogo.close();
        else abrir();
        return;
      }
      if (!dialogo.open || !dialogo.contains(e.target as Node)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        dialogo.close();
      } else if (e.key === "Enter" && !e.shiftKey && e.target === texto) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void guardar();
      }
    },
    true,
  );
}
