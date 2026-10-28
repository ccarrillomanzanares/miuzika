/**
 * El formulario «Encargo» (botón junto al chat). No envía nada: escribe el
 * mensaje en el chat para que la persona lo lea, lo retoque y lo mande.
 * El texto lo arma `encargo.ts`.
 */

import type { Project } from "../../src/core/types.ts";
import { idioma } from "./i18n.ts";
import {
  ENCARGO_VACIO,
  MODOS_ENCARGO,
  SUGERENCIAS_GM,
  TONICAS,
  textoDeEncargo,
  type Encargo,
  type TipoEncargo,
  type VozEncargo,
} from "./encargo.ts";

export interface DepsEncargo {
  proyecto(): Project | null;
  /** Escribe el texto en el chat (sin enviarlo). */
  escribir(texto: string): void;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export class FormularioEncargo {
  private dialogo: HTMLDialogElement;
  private instrumentos: string[] = [];
  private biblioteca: string[] = [];
  private cargada = false;

  constructor(private deps: DepsEncargo) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho dialogo-encargo";
    document.body.append(this.dialogo);
  }

  /** Texto según el idioma de la interfaz. */
  private tx(es: string, en: string): string {
    return idioma() === "es" ? es : en;
  }

  async abrir(): Promise<void> {
    if (!this.cargada) await this.cargarBiblioteca();
    this.instrumentos = [];
    this.pintar();
    this.dialogo.showModal();
    this.dialogo.querySelector<HTMLInputElement>("[name=estilo]")?.focus();
  }

  private async cargarBiblioteca(): Promise<void> {
    try {
      const res = await fetch("/api/gm");
      const datos = (await res.json()) as { bibliotecaNombres?: string[] };
      this.biblioteca = datos.bibliotecaNombres ?? [];
    } catch {
      this.biblioteca = [];
    }
    this.cargada = true;
  }

  private pintar(): void {
    const es = idioma() === "es";
    const project = this.deps.proyecto();
    const opcionesTonica = TONICAS.map((t) => `<option value="${t.valor}">${es ? t.es : t.en}</option>`).join("");
    const opcionesModo = MODOS_ENCARGO.map((m) => `<option value="${m.valor}">${es ? m.es : m.en}</option>`).join("");
    const sugerencias = [
      ...this.biblioteca.map((n) => `<option value="${escapar(n)}">${this.tx("biblioteca (grabado)", "library (recorded)")}</option>`),
      ...SUGERENCIAS_GM.map((s) => `<option value="${escapar(es ? s.es : s.en)}">General MIDI</option>`),
    ].join("");
    const radio = (nombre: string, valor: string, texto: string, marcado = false): string =>
      `<label class="opcion"><input type="radio" name="${nombre}" value="${valor}"${marcado ? " checked" : ""}> ${texto}</label>`;

    this.dialogo.innerHTML = `
      <form method="dialog" class="encargo">
        <div class="dialogo-cabeza">
          <strong>${this.tx("Encargo", "Brief")}</strong>
          <button type="button" class="icon" data-cerrar title="${this.tx("Cerrar", "Close")}">✕</button>
        </div>
        <p class="encargo-ayuda">${this.tx(
          "Nada es obligatorio: lo que dejes en blanco lo decide el agente. Al terminar, el encargo queda escrito en el chat para que lo revises antes de enviarlo.",
          "Nothing is required: whatever you leave blank, the agent decides. When you finish, the brief is written into the chat so you can review it before sending.",
        )}</p>

        <div class="fila"><span class="etiqueta">${this.tx("Qué", "What")}</span><div class="opciones">
          ${radio("tipo", "nueva", this.tx("Canción nueva", "New song"), true)}
          ${radio("tipo", "version", this.tx("Versión", "Cover"))}
          ${project ? radio("tipo", "arreglo", this.tx(`Arreglar «${escapar(project.name)}»`, `Rework “${escapar(project.name)}”`)) : ""}
        </div></div>

        <div class="fila" data-solo="version"><span class="etiqueta">${this.tx("Canción", "Song")}</span><div class="opciones">
          <input name="cancion" placeholder="${this.tx("Hurt – Nine Inch Nails", "Hurt – Nine Inch Nails")}">
          <label class="opcion"><input type="checkbox" name="conMelodia" checked> ${this.tx("con su melodía", "keep its melody")}</label>
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Estilo", "Style")}</span>
          <input name="estilo" placeholder="${this.tx("dark synth pop, atmósfera fría…", "dark synth pop, cold atmosphere…")}">
        </div>

        <div class="fila"><span class="etiqueta">Tempo</span><div class="opciones">
          <input name="bpm" type="number" min="30" max="260" step="1" placeholder="${this.tx("elige tú", "you choose")}" class="corto"> BPM
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Tonalidad", "Key")}</span><div class="opciones">
          <select name="tonica"><option value="">${this.tx("elige tú", "you choose")}</option>${opcionesTonica}</select>
          <select name="modo">${opcionesModo}</select>
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Duración", "Length")}</span><div class="opciones">
          ${radio("minutos", "", this.tx("elige tú", "you choose"), true)}
          ${radio("minutos", "2", "~2 min")}
          ${radio("minutos", "3", "~3 min")}
          ${radio("minutos", "4", "~4 min")}
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Instrumentos", "Instruments")}</span><div class="opciones columna">
          <div class="chips" data-chips></div>
          <div class="opciones">
            <input name="instrumento" list="encargo-instrumentos" placeholder="${this.tx("Grand Piano, Steinway B · Violonchelo…", "Grand Piano, Steinway B · Cello…")}">
            <button type="button" data-anadir>${this.tx("Añadir", "Add")}</button>
          </div>
          <datalist id="encargo-instrumentos">${sugerencias}</datalist>
          <small>${this.tx("Vacío = elige tú. Los de la biblioteca son instrumentos grabados de verdad.", "Empty = you choose. Library instruments are real recordings.")}</small>
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Voz", "Vocals")}</span><div class="opciones">
          ${radio("voz", "", this.tx("elige tú", "you choose"), true)}
          ${radio("voz", "melodia", this.tx("sin voz, melodía instrumental", "no vocals, instrumental melody"))}
          ${radio("voz", "instrumental", this.tx("sólo instrumental", "purely instrumental"))}
        </div></div>

        <div class="fila"><span class="etiqueta">${this.tx("Evitar", "Avoid")}</span>
          <input name="evitar" placeholder="${this.tx("nada alegre, sin batería hasta el estribillo…", "nothing happy, no drums until the chorus…")}">
        </div>

        <div class="fila"><span class="etiqueta">${this.tx("Más", "More")}</span>
          <textarea name="mas" rows="2" placeholder="${this.tx("cualquier otra cosa…", "anything else…")}"></textarea>
        </div>

        <div class="dialogo-acciones">
          <button type="button" data-cerrar>${this.tx("Cancelar", "Cancel")}</button>
          <button type="submit" class="primario">${this.tx("Escribir encargo", "Write brief")}</button>
        </div>
      </form>`;

    const form = this.dialogo.querySelector("form")!;
    form.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => this.dialogo.close()));
    const tipoActual = (): TipoEncargo => (new FormData(form).get("tipo") as TipoEncargo) ?? "nueva";
    const alCambiarTipo = (): void => {
      const tipo = tipoActual();
      form.querySelectorAll<HTMLElement>("[data-solo]").forEach((el) => {
        el.hidden = el.dataset.solo !== tipo;
      });
      // Arreglar el proyecto abierto: lo medido del proyecto sale ya puesto.
      if (tipo === "arreglo" && project) {
        (form.elements.namedItem("bpm") as HTMLInputElement).value = String(project.bpm);
        (form.elements.namedItem("tonica") as HTMLSelectElement).value = TONICAS.some((t) => t.valor === project.key.tonic)
          ? project.key.tonic
          : "";
        (form.elements.namedItem("modo") as HTMLSelectElement).value = project.key.mode;
      }
    };
    form.querySelectorAll("[name=tipo]").forEach((r) => r.addEventListener("change", alCambiarTipo));
    alCambiarTipo();

    const chips = form.querySelector<HTMLElement>("[data-chips]")!;
    const campo = form.elements.namedItem("instrumento") as HTMLInputElement;
    const pintarChips = (): void => {
      chips.replaceChildren(
        ...this.instrumentos.map((nombre, i) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip";
          chip.textContent = `${nombre} ×`;
          chip.title = this.tx("Quitar", "Remove");
          chip.addEventListener("click", () => {
            this.instrumentos.splice(i, 1);
            pintarChips();
          });
          return chip;
        }),
      );
    };
    const anadir = (): void => {
      const nombre = campo.value.trim();
      if (nombre && !this.instrumentos.includes(nombre)) this.instrumentos.push(nombre);
      campo.value = "";
      pintarChips();
      campo.focus();
    };
    form.querySelector("[data-anadir]")!.addEventListener("click", anadir);
    campo.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        evento.preventDefault();
        anadir();
      }
    });
    // Elegir de la lista desplegable también lo añade.
    campo.addEventListener("change", () => {
      if (this.biblioteca.includes(campo.value) || SUGERENCIAS_GM.some((s) => s.es === campo.value || s.en === campo.value)) anadir();
    });
    pintarChips();

    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      if (campo.value.trim()) anadir();
      const datos = new FormData(form);
      const bpm = Number(datos.get("bpm"));
      const minutos = String(datos.get("minutos") ?? "");
      const encargo: Encargo = {
        ...ENCARGO_VACIO,
        tipo: tipoActual(),
        cancion: String(datos.get("cancion") ?? ""),
        conMelodia: datos.get("conMelodia") !== null,
        estilo: String(datos.get("estilo") ?? ""),
        bpm: String(datos.get("bpm") ?? "").trim() !== "" && Number.isFinite(bpm) && bpm > 0 ? bpm : null,
        tonica: String(datos.get("tonica") ?? "") || null,
        modo: String(datos.get("modo") ?? "minor"),
        minutos: minutos === "" ? null : Number(minutos),
        instrumentos: [...this.instrumentos],
        voz: String(datos.get("voz") ?? "") as VozEncargo,
        evitar: String(datos.get("evitar") ?? ""),
        mas: String(datos.get("mas") ?? ""),
      };
      this.deps.escribir(textoDeEncargo(encargo, idioma(), project?.name ?? ""));
      this.dialogo.close();
    });
  }
}
