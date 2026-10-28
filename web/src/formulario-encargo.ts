/**
 * El formulario «Encargo» (botón junto al chat). No envía nada: escribe el
 * mensaje en el chat para que la persona lo lea, lo retoque y lo mande.
 * El texto lo arma `encargo.ts`.
 *
 * Dos niveles: lo esencial a la vista y «Más detalles» plegado, para que pedir
 * algo sencillo siga siendo un clic y un campo. Cada modo (nueva, versión,
 * arreglo) enseña sólo lo suyo (`data-modos`).
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
  type EnergiaEncargo,
  type GrooveEncargo,
  type TempoEncargo,
  type TipoEncargo,
  type TonalidadEncargo,
  type UsoEncargo,
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
    const tx = (a: string, b: string): string => this.tx(a, b);
    const project = this.deps.proyecto();
    const elige = tx("elige tú", "you choose");
    const opcionesTonica = TONICAS.map((t) => `<option value="${t.valor}">${es ? t.es : t.en}</option>`).join("");
    const opcionesModo = MODOS_ENCARGO.map((m) => `<option value="${m.valor}">${es ? m.es : m.en}</option>`).join("");
    const sugerencias = [
      ...this.biblioteca.map((n) => `<option value="${escapar(n)}">${tx("biblioteca (grabado)", "library (recorded)")}</option>`),
      ...SUGERENCIAS_GM.map((s) => `<option value="${escapar(es ? s.es : s.en)}">General MIDI</option>`),
    ].join("");
    const radio = (nombre: string, valor: string, texto: string, marcado = false): string =>
      `<label class="opcion"><input type="radio" name="${nombre}" value="${valor}"${marcado ? " checked" : ""}> ${texto}</label>`;
    const fila = (etiqueta: string, contenido: string, modos = ""): string =>
      `<div class="fila"${modos ? ` data-modos="${modos}"` : ""}><span class="etiqueta">${etiqueta}</span><div class="opciones">${contenido}</div></div>`;
    const tonalidadOtra = `<select name="tonica">${opcionesTonica}</select><select name="modo">${opcionesModo}</select>`;

    this.dialogo.innerHTML = `
      <form method="dialog" class="encargo">
        <div class="dialogo-cabeza">
          <strong>${tx("Encargo", "Brief")}</strong>
          <button type="button" class="icon" data-cerrar title="${tx("Cerrar", "Close")}">✕</button>
        </div>
        <p class="encargo-ayuda">${tx(
          "Nada es obligatorio: lo que dejes en blanco lo decide el agente. Al terminar, el encargo queda escrito en el chat para que lo revises antes de enviarlo.",
          "Nothing is required: whatever you leave blank, the agent decides. When you finish, the brief is written into the chat so you can review it before sending.",
        )}</p>

        ${fila(
          tx("Qué", "What"),
          radio("tipo", "nueva", tx("Canción nueva", "New song"), true) +
            radio("tipo", "version", tx("Versión", "Cover")) +
            (project ? radio("tipo", "arreglo", tx(`Arreglar «${escapar(project.name)}»`, `Rework “${escapar(project.name)}”`)) : ""),
        )}

        ${fila(tx("Nombre", "Name"), `<input name="nombre" placeholder="${tx("(si lo dejas en blanco, lo pone el agente)", "(leave blank and the agent names it)")}">`, "nueva")}
        ${fila(tx("Canción", "Song"), `<input name="cancion" placeholder="Hurt – Nine Inch Nails">`, "version")}
        ${fila(
          tx("Conservar", "Keep"),
          `<label class="opcion"><input type="checkbox" name="c-melodia" checked> ${tx("melodía", "melody")}</label>
           <label class="opcion"><input type="checkbox" name="c-acordes" checked> ${tx("acordes", "chords")}</label>
           <label class="opcion"><input type="checkbox" name="c-riff"> ${tx("riff o gancho", "riff or hook")}</label>
           <label class="opcion"><input type="checkbox" name="c-estructura" checked> ${tx("estructura", "structure")}</label>`,
          "version",
        )}

        <div class="fila"><span class="etiqueta" data-etiqueta-estilo></span>
          <div class="opciones"><input name="estilo"></div></div>

        ${fila(tx("Imagen", "Picture"), `<input name="imagen" placeholder="${tx("conducir de noche bajo la lluvia…", "driving at night in the rain…")}">`)}

        ${fila(
          tx("Para qué", "For"),
          radio("uso", "", tx("canción", "song"), true) +
            radio("uso", "loop", tx("loop sin costura", "seamless loop")) +
            radio("uso", "dj", tx("tema para DJ", "DJ track")) +
            radio("uso", "intro", tx("intro / cortinilla", "intro / sting")),
          "nueva",
        )}

        ${fila(
          tx("Duración", "Length"),
          radio("minutos", "", elige, true) + ["1", "2", "3", "4", "6"].map((m) => radio("minutos", m, `~${m} min`)).join(""),
        )}

        <div class="fila"><span class="etiqueta">${tx("Instrumentos", "Instruments")}</span><div class="opciones columna">
          <div class="chips" data-chips></div>
          <div class="opciones">
            <input name="instrumento" list="encargo-instrumentos" placeholder="${tx("Grand Piano, Steinway B · Violonchelo…", "Grand Piano, Steinway B · Cello…")}">
            <button type="button" data-anadir>${tx("Añadir", "Add")}</button>
          </div>
          <datalist id="encargo-instrumentos">${sugerencias}</datalist>
          <small>${tx("Vacío = elige tú. Los de la biblioteca son instrumentos grabados de verdad.", "Empty = you choose. Library instruments are real recordings.")}</small>
        </div></div>

        ${fila(
          tx("Voz", "Vocals"),
          radio("voz", "", elige, true) +
            radio("voz", "melodia", tx("sin voz, melodía instrumental", "no vocals, instrumental melody")) +
            radio("voz", "instrumental", tx("sólo instrumental, sin melodía principal", "purely instrumental, no lead")),
        )}
        ${fila(
          tx("Melodía", "Melody"),
          `<input name="lleva" list="encargo-lleva" placeholder="${tx("la lleva… (elige tú)", "played by… (you choose)")}"><datalist id="encargo-lleva"></datalist>`,
        )}

        <details class="mas-detalles">
          <summary>${tx("Más detalles", "More details")}</summary>

          ${fila(tx("Suena como", "Sounds like"), `<input name="suena" placeholder="${tx("Kavinsky, la banda sonora de Drive…", "Kavinsky, the Drive soundtrack…")}">`, "nueva arreglo")}
          ${fila(tx("Gancho", "Hook"), `<input name="gancho" placeholder="${tx("un arpegio de sinte que vuelve en cada estribillo…", "a synth arpeggio that returns every chorus…")}">`, "nueva arreglo")}

          ${fila(
            "Tempo",
            radio("tempoN", "", elige, true) +
              radio("tempoN", "lento", tx("lento", "slow")) +
              radio("tempoN", "medio", tx("medio", "mid")) +
              radio("tempoN", "rapido", tx("rápido", "fast")) +
              radio("tempoN", "bpm", "") +
              `<input name="bpmN" type="number" min="30" max="260" class="corto" placeholder="BPM">`,
            "nueva arreglo",
          )}
          ${fila(
            "Tempo",
            radio("tempoV", "", elige, true) +
              radio("tempoV", "original", tx("como el original", "as the original")) +
              radio("tempoV", "mas-lento", tx("más lento", "slower")) +
              radio("tempoV", "mas-rapido", tx("más rápido", "faster")) +
              radio("tempoV", "bpm", "") +
              `<input name="bpmV" type="number" min="30" max="260" class="corto" placeholder="BPM">`,
            "version",
          )}

          ${fila(
            "Groove",
            radio("groove", "", elige, true) +
              radio("groove", "recto", tx("recto", "straight")) +
              radio("groove", "swing", "swing") +
              radio("groove", "halftime", "half-time") +
              radio("groove", "ternario", tx("ternario (¾, 6/8)", "triple (3/4, 6/8)")),
          )}

          ${fila(tx("Tonalidad", "Key"), radio("tonN", "", elige, true) + radio("tonN", "otra", "") + tonalidadOtra.replace('name="tonica"', 'name="tonicaN"').replace('name="modo"', 'name="modoN"'), "nueva arreglo")}
          ${fila(
            tx("Tonalidad", "Key"),
            radio("tonV", "", elige, true) +
              radio("tonV", "original", tx("la original", "the original")) +
              radio("tonV", "otra", "") +
              tonalidadOtra.replace('name="tonica"', 'name="tonicaV"').replace('name="modo"', 'name="modoV"'),
            "version",
          )}

          ${fila(
            tx("Energía", "Energy"),
            radio("energia", "", elige, true) +
              `<span data-modos="version">${radio("energia", "original", tx("como el original", "as the original"))}</span>` +
              radio("energia", "crece", tx("crece hasta el final", "builds to the end")) +
              radio("energia", "intima", tx("íntima", "intimate")) +
              radio("energia", "explota", tx("de mínima a explosiva", "minimal to explosive")) +
              radio("energia", "constante", tx("constante (pista)", "steady (dance floor)")),
          )}

          ${fila(tx("Forma", "Form"), `<input name="forma" placeholder="${tx("intro, 2 estrofas, estribillo, puente, estribillo final…", "intro, 2 verses, chorus, bridge, final chorus…")}">`)}
        </details>

        ${fila(tx("Evitar", "Avoid"), `<input name="evitar" placeholder="${tx("nada alegre, sin batería hasta el estribillo…", "nothing happy, no drums until the chorus…")}">`)}
        ${fila(tx("Más", "More"), `<textarea name="mas" rows="2" placeholder="${tx("cualquier otra cosa…", "anything else…")}"></textarea>`)}
        ${fila(
          tx("Entrega", "Delivery"),
          `<span class="nota">${tx("en el proyecto, y además:", "in the project, and also:")}</span>
           <label class="opcion"><input type="checkbox" name="e-midi"> MIDI</label>
           <label class="opcion"><input type="checkbox" name="e-wav"> WAV</label>`,
        )}

        <div class="dialogo-acciones">
          <button type="button" data-cerrar>${tx("Cancelar", "Cancel")}</button>
          <button type="submit" class="primario">${tx("Escribir encargo", "Write brief")}</button>
        </div>
      </form>`;

    const form = this.dialogo.querySelector("form")!;
    const campo = <T extends Element>(nombre: string): T => form.elements.namedItem(nombre) as unknown as T;
    const valor = (nombre: string): string => String(new FormData(form).get(nombre) ?? "");
    form.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => this.dialogo.close()));

    const tipoActual = (): TipoEncargo => (valor("tipo") || "nueva") as TipoEncargo;
    const etiquetaEstilo = form.querySelector<HTMLElement>("[data-etiqueta-estilo]")!;
    const inputEstilo = campo<HTMLInputElement>("estilo");
    const alCambiarTipo = (): void => {
      const tipo = tipoActual();
      form.querySelectorAll<HTMLElement>("[data-modos]").forEach((el) => {
        el.hidden = !el.dataset.modos!.split(" ").includes(tipo);
      });
      if (tipo === "version") {
        etiquetaEstilo.textContent = tx("Llevarla a", "Take it to");
        inputEstilo.placeholder = tx("música de cine, piano y cuerdas…", "film score, piano and strings…");
      } else if (tipo === "arreglo") {
        etiquetaEstilo.textContent = tx("Qué cambiar", "What to change");
        inputEstilo.placeholder = tx("un estribillo más oscuro, otra batería…", "a darker chorus, different drums…");
      } else {
        etiquetaEstilo.textContent = tx("Estilo", "Style");
        inputEstilo.placeholder = tx("synthwave oscuro, folk íntimo, deep house…", "dark synthwave, intimate folk, deep house…");
      }
      // Arreglar: el tempo y la tonalidad del proyecto ya puestos.
      if (tipo === "arreglo" && project) {
        form.querySelector<HTMLInputElement>('[name=tempoN][value="bpm"]')!.checked = true;
        campo<HTMLInputElement>("bpmN").value = String(project.bpm);
        if (TONICAS.some((t) => t.valor === project.key.tonic)) {
          form.querySelector<HTMLInputElement>('[name=tonN][value="otra"]')!.checked = true;
          campo<HTMLSelectElement>("tonicaN").value = project.key.tonic;
          campo<HTMLSelectElement>("modoN").value = project.key.mode;
        }
      }
    };
    form.querySelectorAll("[name=tipo]").forEach((r) => r.addEventListener("change", alCambiarTipo));
    alCambiarTipo();

    // Escribir un BPM o elegir una tonalidad marca su opción.
    const marcar = (selector: string): void => {
      const r = form.querySelector<HTMLInputElement>(selector);
      if (r) r.checked = true;
    };
    campo<HTMLInputElement>("bpmN").addEventListener("input", () => marcar('[name=tempoN][value="bpm"]'));
    campo<HTMLInputElement>("bpmV").addEventListener("input", () => marcar('[name=tempoV][value="bpm"]'));
    for (const n of ["tonicaN", "modoN"]) campo<HTMLSelectElement>(n).addEventListener("change", () => marcar('[name=tonN][value="otra"]'));
    for (const n of ["tonicaV", "modoV"]) campo<HTMLSelectElement>(n).addEventListener("change", () => marcar('[name=tonV][value="otra"]'));

    // Instrumentos en etiquetas; «la melodía la lleva» sugiere los elegidos.
    const chips = form.querySelector<HTMLElement>("[data-chips]")!;
    const entrada = campo<HTMLInputElement>("instrumento");
    const listaLleva = form.querySelector<HTMLDataListElement>("#encargo-lleva")!;
    const pintarChips = (): void => {
      chips.replaceChildren(
        ...this.instrumentos.map((nombre, i) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip";
          chip.textContent = `${nombre} ×`;
          chip.title = tx("Quitar", "Remove");
          chip.addEventListener("click", () => {
            this.instrumentos.splice(i, 1);
            pintarChips();
          });
          return chip;
        }),
      );
      listaLleva.replaceChildren(...this.instrumentos.map((nombre) => new Option(nombre, nombre)));
    };
    const anadir = (): void => {
      const nombre = entrada.value.trim();
      if (nombre && !this.instrumentos.includes(nombre)) this.instrumentos.push(nombre);
      entrada.value = "";
      pintarChips();
      entrada.focus();
    };
    form.querySelector("[data-anadir]")!.addEventListener("click", anadir);
    entrada.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        evento.preventDefault();
        anadir();
      }
    });
    // Elegir de la lista desplegable también lo añade.
    entrada.addEventListener("change", () => {
      if (this.biblioteca.includes(entrada.value) || SUGERENCIAS_GM.some((s) => s.es === entrada.value || s.en === entrada.value)) anadir();
    });
    pintarChips();

    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      if (entrada.value.trim()) anadir();
      const tipo = tipoActual();
      const version = tipo === "version";
      const sufijo = version ? "V" : "N";
      const minutos = valor("minutos");
      const bpm = Number(valor(`bpm${sufijo}`));
      const encargo: Encargo = {
        ...ENCARGO_VACIO,
        tipo,
        nombre: tipo === "nueva" ? valor("nombre") : "",
        cancion: version ? valor("cancion") : "",
        conservar: {
          melodia: version && valor("c-melodia") !== "",
          acordes: version && valor("c-acordes") !== "",
          riff: version && valor("c-riff") !== "",
          estructura: version && valor("c-estructura") !== "",
        },
        estilo: valor("estilo"),
        imagen: valor("imagen"),
        uso: tipo === "nueva" ? (valor("uso") as UsoEncargo) : "",
        minutos: minutos === "" ? null : Number(minutos),
        instrumentos: [...this.instrumentos],
        melodiaLaLleva: valor("lleva"),
        voz: valor("voz") as VozEncargo,
        suenaComo: version ? "" : valor("suena"),
        gancho: version ? "" : valor("gancho"),
        tempo: valor(`tempo${sufijo}`) as TempoEncargo,
        bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
        groove: valor("groove") as GrooveEncargo,
        tonalidad: valor(`ton${sufijo}`) as TonalidadEncargo,
        tonica: valor(`tonica${sufijo}`) || "C",
        modo: valor(`modo${sufijo}`) || "minor",
        energia: (valor("energia") === "original" && !version ? "" : valor("energia")) as EnergiaEncargo,
        forma: valor("forma"),
        evitar: valor("evitar"),
        mas: valor("mas"),
        entregaMidi: valor("e-midi") !== "",
        entregaWav: valor("e-wav") !== "",
      };
      this.deps.escribir(textoDeEncargo(encargo, idioma(), project?.name ?? ""));
      this.dialogo.close();
    });
  }
}
