/**
 * The Stable Audio module's window (8-Nov-2026, the user: "desarrolla el módulo con todas las funcionalidades"; after every task
 * passed by ear, "ahora a programar el formulario con todos los detalles que se puedan"). What Stable Audio 3 (790793b) offers:
 * text to audio (song, instrument, duo, sound effect), audio to audio, repaint one or several parts in one pass, continue; a
 * prompt per take; the -base checkpoints with their sampler. Review shows each prompt exactly as it travels, the licence, the
 * cost and what is worth knowing before spending.
 */

import {
  CAMBIOS, EJEMPLOS, LICENCIA, MODELOS, POR_DEFECTO, POR_DEFECTO_BASE, SA3_COMMIT, SAMPLERS_BASE, TIPOS, avisos, componerPrompt,
  infoModelo, leerCompases, leerResultado, parametrosParaEnviar, promptsPorToma, regionesDeCompases, validarParametros,
  type Modelo, type Parametros, type Tarea, type Tipo,
} from "../../../../src/modulos/stableaudio/receta.ts";
import { nombreDeArchivo } from "../../../../src/modulos/ace-step/receta.ts";
import { beatsPerBar } from "../../../../src/core/types.ts";
import { carpetaDeProyecto } from "../../../../src/core/project.ts";
import { segundosPorTiempo } from "../../../../src/core/tiempo.ts";
import type { BarraGpu } from "../../gpu-barra.ts";
import type { Anfitrion } from "../anfitrion.ts";
import { areaDeTexto, causaDeFallo, ejecutarEnGpu, esc, fila, numero, prepararAudio } from "../comun.ts";

type Fuente = "pistas" | "archivo";

const TAREAS: { id: Tarea; etiqueta: string; ayuda: string }[] = [
  { id: "texto", etiqueta: "From text", ayuda: "A new piece from a description: a whole instrumental song, one or two instruments alone, or a sound effect." },
  { id: "audio", etiqueta: "Transform audio", ayuda: "Re-plays a source with your description. The change amount says how far it may go from it." },
  { id: "repintar", etiqueta: "Repaint parts", ayuda: "Redoes the bars you choose, one part or several in one pass, and keeps the rest of the source." },
  { id: "continuar", etiqueta: "Continue", ayuda: "Keeps the source and adds new music after it, up to the total duration." },
];

const COSTE =
  "Experimental: results vary from take to take. Free software provided as is, without any warranty (AGPL-3.0). The GPU is rented " +
  "with your account: it bills its time whether the take is useful or not, failed and cancelled runs included, until you press Off. " +
  "A first run on a new machine also installs Stable Audio 3 and downloads its weights (~10 GB for medium).";

/** Measured 8-Nov on an A10, medium, 8 steps: ~24 s per take of 30-120 s, model loading included. */
const AYUDA_TIEMPO = "On an A10, medium took about 25 s per take, plus the machine's boot if it is off.";

/** Heard 8-Nov: these are what cfg 1 and 7 did; the defaults stay where the ear put them. */
const AYUDA_CFG = "1 = its default, what sounded right. Higher follows the text harder but saturated by ear at 7. Base models: 7.";

/** The guide's advice for each kind (prompting.md, 790793b), shown under Description. */
const AYUDA_DESCRIPCION: Record<Tipo, string> = {
  cancion: "Genre, instruments and how each sounds, mood and energy, production. The more detail, the better (its guide).",
  instrumento: "What plays, in what style, mood; technique, recording room and effects are in its data too.",
  duo: "The two instruments, their style and mood.",
  efecto: "The source (what makes the sound), the action (how it is triggered, how long it lasts), the recording and processing. Keep the duration short.",
  libre: "Anything; nothing is added before it. English works best: it was trained on English.",
};

/** The form's values, as typed. */
const INICIAL: Record<string, string> = {
  modelo: "medium", tipo: "cancion", generos: "", instrumentos: "", descripcion: "", negativo: "",
  duracion: String(POR_DEFECTO.duracion), unidad: "s", tomas: "1", variaciones: "", semilla: "",
  steps: String(POR_DEFECTO.steps), cfg: String(POR_DEFECTO.cfg), apg: String(POR_DEFECTO.apg), sampler: "",
  ruido: String(POR_DEFECTO.ruido), bpm: "", compases: "",
};

export class VentanaStableAudio {
  private readonly dialogo: HTMLDialogElement;
  private vista: "form" | "review" = "form";
  private tarea: Tarea = "texto";
  private fuente: Fuente = "archivo";
  private pistas = new Set<string>();
  private archivo: File | null = null;
  private v: Record<string, string> = { ...INICIAL };
  private avanzado = false;
  /** Ready on Review: the source and the prompt as composed (editable there). */
  private preparado: { audio: string | null; descripcion: string; carpeta: string; segundos: number | null } | null = null;
  private mensaje = "";
  private ocupada = false;
  private enMarcha = false;
  private readonly a: Anfitrion;
  private readonly gpu: BarraGpu;

  constructor(anfitrion: Anfitrion, gpu: BarraGpu) {
    this.a = anfitrion;
    this.gpu = gpu;
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho acestep";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("input", (e) => this.alEscribir(e));
    this.dialogo.addEventListener("change", (e) => this.alCambiar(e));
    this.dialogo.addEventListener("click", (e) => void this.alPulsar(e));
    this.dialogo.addEventListener("toggle", (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLDetailsElement && el.dataset.avanzado !== undefined) this.avanzado = el.open;
    }, true);
  }

  async abrir(): Promise<void> {
    const p = this.a.proyecto();
    if (!p || p.tracks.length === 0) this.fuente = "archivo";
    // The BPM is written into the text (the model has no tempo control): the project's, if it has tracks.
    if (!this.v.bpm && p && p.tracks.length > 0) this.v.bpm = String(p.bpm);
    this.vista = "form";
    this.preparado = null;
    this.mensaje = "";
    await this.gpu.refrescar();
    this.pintar();
    this.dialogo.showModal();
  }

  private segundosPorCompas(): number {
    const p = this.a.proyecto();
    const bpm = p?.bpm ?? numero(this.v.bpm) ?? 120;
    return (p ? beatsPerBar(p) : 4) * segundosPorTiempo(bpm);
  }

  /** The duration field in seconds, whether typed in seconds or in bars. */
  private segundosDeDuracion(): number {
    const n = numero(this.v.duracion) ?? POR_DEFECTO.duracion;
    return this.v.unidad === "compases" ? Math.round(n * this.segundosPorCompas() * 1000) / 1000 : n;
  }

  private lineasDeVariacion(): string[] {
    return (this.v.variaciones ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  }

  private parametros(): Parametros {
    const variaciones = this.lineasDeVariacion();
    const compases = this.tarea === "repintar" ? leerCompases(this.v.compases ?? "") : null;
    const base = infoModelo(this.v.modelo as Modelo).base;
    return {
      nombre: this.v.nombre ?? "",
      modelo: (this.v.modelo ?? "medium") as Modelo,
      tarea: this.tarea,
      prompt: this.v.prompt ?? this.promptCompuesto(),
      variaciones,
      negativo: this.v.negativo ?? "",
      duracion: this.vista === "review" ? (numero(this.v.duracion) ?? POR_DEFECTO.duracion) : this.segundosDeDuracion(),
      steps: numero(this.v.steps) ?? POR_DEFECTO.steps,
      cfg: numero(this.v.cfg) ?? POR_DEFECTO.cfg,
      apg: numero(this.v.apg) ?? POR_DEFECTO.apg,
      sampler: base && this.v.sampler ? this.v.sampler : null,
      semilla: numero(this.v.semilla) ?? -1,
      tomas: variaciones.length > 0 ? variaciones.length : (numero(this.v.tomas) ?? 1),
      audio: this.tarea === "texto" ? null : (this.preparado?.audio ?? null),
      ruido: this.tarea === "audio" ? numero(this.v.ruido) : null,
      regiones: compases ? regionesDeCompases(compases, this.segundosPorCompas()) : [],
      largoFuente: this.tarea === "continuar" || this.tarea === "repintar" ? (this.preparado?.segundos ?? null) : null,
    };
  }

  private promptCompuesto(): string {
    return componerPrompt({
      tipo: this.v.tipo as Tipo, generos: this.v.generos ?? "", instrumentos: this.v.instrumentos ?? "",
      texto: this.v.descripcion ?? "", bpm: numero(this.v.bpm),
    });
  }

  // ---------------------------------------------------------------- painting

  private pintar(): void {
    this.dialogo.innerHTML = this.vista === "form" ? this.htmlFormulario() : this.htmlRevision();
  }

  private campo(nombre: string, placeholder = "", tipo = "text"): string {
    return `<input type="${tipo}" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" placeholder="${esc(placeholder)}" step="any">`;
  }

  private selector(nombre: string, opciones: [string, string][]): string {
    return `<select name="${nombre}">${opciones.map(([v, t]) => `<option value="${esc(v)}"${v === this.v[nombre] ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  }

  private htmlFuente(): string {
    const p = this.a.proyecto();
    const conPistas = !!p && p.tracks.length > 0;
    const opciones: [Fuente, string][] = [...(conPistas ? ([["pistas", "Tracks of this project"]] as [Fuente, string][]) : []), ["archivo", "A file"]];
    const radios = opciones.map(([v, t]) => `<label class="ace-opcion"><input type="radio" name="fuente" value="${v}"${v === this.fuente ? " checked" : ""}> ${t}</label>`).join("");
    const detalle =
      this.fuente === "pistas" && p
        ? fila("Tracks", `<div class="ace-lista">${p.tracks.map((t) => `<label class="ace-opcion"><input type="checkbox" data-pista="${esc(t.id)}"${this.pistas.has(t.id) ? " checked" : ""}> ${esc(t.name)}</label>`).join("")}</div>`, "Rendered whole, mixed into one WAV.")
        : fila("File", `<label class="file"><input type="file" data-archivo accept="audio/*,.wav,.mp3" hidden>${this.archivo ? "Change…" : "Choose a file…"}</label> ${this.archivo ? esc(this.archivo.name) : "none chosen"}`);
    return fila("Source", radios) + detalle;
  }

  private htmlFormulario(): string {
    const t = this.tarea;
    const tareas = TAREAS.map((x) => `<label class="ace-opcion"><input type="radio" name="tarea" value="${x.id}"${x.id === t ? " checked" : ""}> ${x.etiqueta}</label>`).join("");
    const modelo = infoModelo(this.v.modelo as Modelo);
    const tipo = this.v.tipo as Tipo;
    const tipos = TIPOS.map((x): [string, string] => [x.id, x.etiqueta]);
    const ejemplos: [string, string][] = [["", "— start from one of its guide's examples —"], ...EJEMPLOS.filter((e) => tipo === "libre" || e.tipo === tipo).map((e): [string, string] => [String(EJEMPLOS.indexOf(e)), e.titulo])];
    const cambios: [string, string][] = [["", "presets from its guide…"], ...CAMBIOS.map((c): [string, string] => [String(c.valor), c.etiqueta])];
    const lineas = this.lineasDeVariacion().length;
    const segundos = this.segundosDeDuracion();
    const ayudaDuracion =
      (t === "continuar" ? "Total: the source plus what is added. " : t === "texto" ? `Up to ${modelo.maxSegundos} s on ${modelo.nombre}. ` : "Set to the source's length on Review. ") +
      (this.v.unidad === "compases" ? `= ${segundos.toFixed(2)} s at the project's tempo.` : "In bars, it lands on the grid.");
    const ayudaCompases = (() => {
      const c = leerCompases(this.v.compases ?? "");
      if (!this.v.compases) return "Of the source, at the project's tempo. Several parts in one pass: 5-8, 13-16.";
      if (!c) return "Write bars as 13-16, or several as 5-8, 13-16.";
      return regionesDeCompases(c, this.segundosPorCompas()).map((r) => `${r.desde}–${r.hasta} s`).join(", ") + ". The guide: a short region may come back close to the original.";
    })();
    const base = modelo.base;
    return `
      <div class="dialogo-cabeza"><strong>Stable Audio 3</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Instrumental music, single instruments and sound effects from a description. Heard: an instrumental industrial song sounded right at the default settings; at high CFG it saturated. It does not sing intelligible words. Free for commercial use under US$1M a year.</p>
      <div class="ace-cuerpo">
        ${fila("What", tareas, esc(TAREAS.find((x) => x.id === t)!.ayuda))}
        ${fila("Name", this.campo("nombre", "the take's file and track"))}
        ${t !== "texto" ? this.htmlFuente() : ""}
        ${t === "repintar" ? fila("Bars", this.campo("compases", "13-16"), esc(ayudaCompases)) : ""}
        ${t === "audio" ? fila("Change amount", `${this.campo("ruido", String(POR_DEFECTO.ruido), "number")} ${this.selector("cambioPreset", cambios)}`, "0 keeps the source, 1 ignores it. Higher filters out melody and rhythm first, keeping timbre and tonality longest (its guide).") : ""}
        ${fila("Kind", this.selector("tipo", tipos), "Opens the text with the tags its guide recommends. Review shows the whole text.")}
        ${fila("Example", this.selector("ejemplo", ejemplos), "Fills the description; change it as you like.")}
        ${tipo !== "efecto" ? fila("Genres", this.campo("generos", "e.g. Industrial, EBM"), "Become “Genre: …” tags; several, or unrelated ones, can be combined.") : ""}
        ${tipo !== "efecto" ? fila("Instruments", this.campo("instrumentos", "e.g. Drums, Synth bass"), "Become an “Instruments: …” tag.") : ""}
        ${fila("Description", areaDeTexto('name="descripcion"', 4, this.v.descripcion ?? ""), esc(AYUDA_DESCRIPCION[tipo] + " Say what you want: no negations here, use the negative prompt." + (t !== "texto" ? " For repaint and continue, the source counts more than the text; it can even be empty." : "")))}
        ${fila("BPM", this.campo("bpm", "e.g. 92", "number"), "Written into the text (“92 BPM”): the model has no tempo control of its own, and no key.")}
        ${fila("Negative prompt", this.campo("negativo", "what to avoid, e.g. vocals, lo-fi"), "Only read when cfg is not 1 (Advanced); at the default cfg 1 it does nothing.")}
        ${fila("Duration", `${this.campo("duracion", "", "number")} ${this.selector("unidad", [["s", "seconds"], ["compases", "bars"]])}`, esc(ayudaDuracion))}
        ${fila("Model", this.selector("modelo", MODELOS.map((m): [string, string] => [m.nombre, m.nombre])), esc(modelo.nota))}
        ${fila("Takes", lineas > 0 ? `<code>${lineas}</code> (one per variation line)` : this.campo("tomas", "1", "number"), "1 to 4, in one run.")}
        ${fila("Variations", areaDeTexto('name="variaciones" placeholder="optional, one per take, e.g.\nwith a lead synth melody\nwith a memorable synth hook"', 3, this.v.variaciones ?? ""), "Each line is added to the text for one take: up to 4 different takes in one run.")}
        ${fila("Seed", this.campo("semilla", "random", "number"), "The same seed and settings give the same take.")}
      </div>
      <details class="ace-avanzado" data-avanzado${this.avanzado ? " open" : ""}>
        <summary>Advanced</summary>
        <div class="ace-cuerpo">
          ${fila("Steps", this.campo("steps", String(base ? POR_DEFECTO_BASE.steps : POR_DEFECTO.steps), "number"), base ? "~50 for base models." : "8 is its default; more does not necessarily help (its docs).")}
          ${fila("CFG", this.campo("cfg", String(base ? POR_DEFECTO_BASE.cfg : POR_DEFECTO.cfg), "number"), AYUDA_CFG)}
          ${fila("APG", this.campo("apg", String(POR_DEFECTO.apg), "number"), "How the CFG is applied: 1 = Adaptive Projected Guidance (its default), 0 = plain CFG. Only acts when CFG is not 1.")}
          ${base ? fila("Sampler", this.selector("sampler", [["", "its default"], ...SAMPLERS_BASE.map((s): [string, string] => [s, s])]), "Base models only; post-trained ones have a single sampler.") : ""}
        </div>
      </details>
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones"><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const motivo = validarParametros(p);
    const notas = motivo ? [] : avisos(p);
    const n = (nombre: string): string => `<input type="number" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" step="any">`;
    const region =
      p.tarea === "repintar"
        ? fila("regions (s)", p.regiones.length ? p.regiones.map((r) => `<code>${r.desde} – ${r.hasta}</code>`).join(" ") : "<code>?</code>", `bars ${esc(this.v.compases ?? "")}`)
        : p.tarea === "continuar"
          ? fila("new part (s)", `<code>${p.largoFuente?.toFixed(2) ?? "?"} – ${p.duracion}</code>`)
          : "";
    const porToma =
      p.variaciones.length > 0
        ? fila("each take", `<ol class="ace-lista">${promptsPorToma(p).map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ol>`, "The prompt above plus that take's line.")
        : "";
    const base = infoModelo(p.modelo).base;
    return `
      <div class="dialogo-cabeza"><strong>Stable Audio 3 · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">This is exactly what will be sent. Anything you change here is what the model receives.</p>
      <div class="ace-cuerpo">
        ${fila("task", `<code>${esc(TAREAS.find((x) => x.id === p.tarea)!.etiqueta)}</code> · <code>${esc(p.modelo)}</code>`)}
        ${fila("name", `<code>${esc(p.nombre)}</code>`)}
        ${p.tarea !== "texto" ? fila("source", `<code>${esc(this.preparado?.descripcion ?? "")}</code>`) : ""}
        ${region}
        ${fila("prompt", areaDeTexto('name="prompt"', 4, p.prompt), p.prompt.trim() ? "" : "empty: unconditional")}
        ${porToma}
        ${fila("negative", `<input type="text" name="negativo" value="${esc(p.negativo)}">`)}
        ${fila("duration (s)", n("duracion"))}
        ${p.tarea === "audio" ? fila("change amount", n("ruido")) : ""}
        ${fila("steps", n("steps"), base ? "~50 for base models" : "8 = its default for these models")}
        ${fila("cfg", n("cfg"), AYUDA_CFG)}
        ${fila("apg", n("apg"), "1 = its default; only acts when cfg is not 1")}
        ${p.sampler ? fila("sampler", `<code>${esc(p.sampler)}</code>`) : ""}
        ${fila("takes", p.variaciones.length > 0 ? `<code>${p.tomas}</code>` : n("tomas"))}
        ${fila("seed", n("semilla"), "empty or -1 = random; the one used is recorded")}
        ${fila("version", `<code>stable-audio-3 ${SA3_COMMIT}</code>`)}
      </div>
      ${notas.length ? `<ul class="ace-nota">${notas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="ace-aviso-coste"><strong>Licence.</strong> ${esc(LICENCIA)}</p>
      <p class="ace-aviso-coste"><strong>No warranty.</strong> ${esc(COSTE)}</p>
      <p class="ace-nota">${esc(AYUDA_TIEMPO)} The Hugging Face token saved in Settings is copied to the GPU, never into the recipe.</p>
      <p class="ace-error">${esc(motivo ?? this.mensaje)}</p>
      <div class="dialogo-acciones">
        <button type="button" data-accion="volver">Back</button>
        <button type="button" class="primario" data-accion="lanzar"${motivo || this.enMarcha ? " disabled" : ""}>Run</button>
      </div>`;
  }

  // ---------------------------------------------------------------- events

  private alEscribir(evento: Event): void {
    const el = evento.target as HTMLInputElement | HTMLTextAreaElement;
    if (!el.name || el.type === "radio" || el.type === "file" || el instanceof HTMLSelectElement) return;
    this.v[el.name] = el.value;
    if (this.vista === "review") {
      this.refrescarRevision();
    } else if (el.name === "variaciones" || el.name === "compases" || el.name === "duracion") {
      // Takes follow the variation lines, and the bars and durations show their seconds: repaint keeping the caret.
      const inicio = el.selectionStart;
      this.pintar();
      const nuevo = this.dialogo.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${el.name}"]`);
      if (nuevo) {
        nuevo.focus();
        try {
          if (inicio !== null) nuevo.setSelectionRange(inicio, inicio);
        } catch {
          // number inputs have no selection
        }
      }
    }
  }

  /** On Review, the Run button, the error and the notes follow what is typed, without repainting the fields. */
  private refrescarRevision(): void {
    const p = this.parametros();
    const motivo = validarParametros(p);
    const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
    if (boton) boton.disabled = !!motivo || this.enMarcha;
    const error = this.dialogo.querySelector<HTMLElement>(".ace-error");
    if (error) error.textContent = motivo ?? "";
    const lista = this.dialogo.querySelector<HTMLElement>("ul.ace-nota");
    const notas = motivo ? [] : avisos(p);
    if (lista) lista.innerHTML = notas.map((x) => `<li>${esc(x)}</li>`).join("");
  }

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLInputElement | HTMLSelectElement;
    if (el.name === "tarea") {
      this.tarea = el.value as Tarea;
      if (this.tarea !== "texto" && !(this.a.proyecto()?.tracks.length)) this.fuente = "archivo";
      this.pintar();
    } else if (el.name === "fuente") {
      this.fuente = el.value as Fuente;
      this.pintar();
    } else if (el.name === "modelo") {
      const antes = infoModelo(this.v.modelo as Modelo).base;
      this.v.modelo = el.value;
      const ahora = infoModelo(el.value as Modelo).base;
      // Steps and cfg follow the family, unless they were changed by hand.
      if (antes !== ahora) {
        const de = antes ? POR_DEFECTO_BASE : POR_DEFECTO;
        const a = ahora ? POR_DEFECTO_BASE : POR_DEFECTO;
        if (numero(this.v.steps) === de.steps) this.v.steps = String(a.steps);
        if (numero(this.v.cfg) === de.cfg) this.v.cfg = String(a.cfg);
        if (!ahora) this.v.sampler = "";
      }
      if (this.vista === "review") this.refrescarRevision();
      else this.pintar();
    } else if (el.name === "tipo" || el.name === "unidad" || el.name === "sampler") {
      if (el.name === "unidad" && el.value !== this.v.unidad) {
        // Keep the same length when switching the unit.
        const s = this.segundosDeDuracion();
        this.v.duracion = el.value === "compases" ? String(Math.max(1, Math.round(s / this.segundosPorCompas()))) : String(Math.round(s * 100) / 100);
      }
      this.v[el.name] = el.value;
      this.pintar();
    } else if (el.name === "ejemplo") {
      const e = EJEMPLOS[Number(el.value)];
      if (el.value !== "" && e) {
        this.v.descripcion = e.texto;
        if (this.v.tipo !== "libre") this.v.tipo = e.tipo;
      }
      this.pintar();
    } else if (el.name === "cambioPreset") {
      if (el.value !== "") this.v.ruido = el.value;
      this.pintar();
    } else if (el instanceof HTMLInputElement && el.dataset.pista) {
      if (el.checked) this.pistas.add(el.dataset.pista);
      else this.pistas.delete(el.dataset.pista);
    } else if (el instanceof HTMLInputElement && el.hasAttribute("data-archivo")) {
      this.archivo = el.files?.[0] ?? this.archivo;
      this.pintar();
    }
  }

  private async alPulsar(evento: Event): Promise<void> {
    const accion = (evento.target as HTMLElement).closest<HTMLElement>("[data-accion]")?.dataset.accion;
    if (accion === "cerrar") this.dialogo.close();
    else if (accion === "volver") {
      // Back to the form: the composed prompt is rebuilt from the form's fields next time; the duration in the form's unit.
      delete this.v.prompt;
      if (this.v.unidad === "compases") this.v.duracion = String(Math.max(1, Math.round((numero(this.v.duracion) ?? 0) / this.segundosPorCompas())));
      this.vista = "form";
      this.pintar();
    } else if (accion === "revisar") await this.revisar();
    else if (accion === "lanzar") await this.lanzar();
  }

  private async revisar(): Promise<void> {
    this.mensaje = "";
    this.ocupada = true;
    this.pintar();
    try {
      const base = this.tarea === "texto" ? (this.v.descripcion ?? "").slice(0, 24) : (this.archivo?.name.replace(/\.[^.]+$/, "") ?? "pistas");
      this.v.nombre = nombreDeArchivo(this.v.nombre || base) || "stable-audio";
      // Review works in seconds: the form's bars become seconds here.
      let duracion = this.segundosDeDuracion();
      if (this.tarea === "texto") {
        const p = this.a.proyecto();
        this.preparado = { audio: null, descripcion: "", carpeta: p ? "" : await this.a.carpetaParaNuevo(this.v.nombre), segundos: null };
      } else {
        const r = await prepararAudio(this.a, { tipo: this.fuente, pistas: [...this.pistas], archivo: this.archivo, nombre: this.v.nombre, porDefecto: "stable-audio" });
        this.preparado = { audio: r.audio, descripcion: r.descripcion, carpeta: r.carpeta, segundos: r.segundos };
        // Transform and repaint give back the source's length (editable on Review); continue needs a longer total.
        if (this.tarea !== "continuar") duracion = Math.round(r.segundos * 100) / 100;
        else if (!(duracion > r.segundos)) duracion = Math.ceil(r.segundos + 30);
      }
      this.v.duracion = String(duracion);
      this.v.prompt = this.promptCompuesto();
      this.vista = "review";
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : String(error);
    } finally {
      this.ocupada = false;
      this.pintar();
    }
  }

  private async lanzar(): Promise<void> {
    const p = this.parametros();
    if (validarParametros(p) || this.enMarcha || !this.preparado) return;
    const proyecto = this.a.proyecto();
    const carpeta = proyecto ? carpetaDeProyecto(proyecto) : this.preparado.carpeta || (await this.a.carpetaParaNuevo(p.nombre));
    const receta = { modulo: "stableaudio", parametros: parametrosParaEnviar(p), fuente: { descripcion: this.preparado.descripcion }, entrega: { inicioCompas: 1 } };
    const control = new AbortController();
    const etiqueta = `Stable Audio “${p.nombre}”`;
    this.enMarcha = true;
    this.dialogo.close();
    this.vista = "form";
    this.preparado = null;
    delete this.v.prompt;
    this.v.nombre = "";
    if (this.v.unidad === "compases") this.v.duracion = String(Math.max(1, Math.round(p.duracion / this.segundosPorCompas())));
    this.gpu.fijarTarea(`${etiqueta}: starting…`, () => control.abort());
    try {
      const r = await ejecutarEnGpu({ script: "generar_stableaudio.py", nombre: p.nombre, receta, entradas: p.audio ? [p.audio] : [], carpeta, etiqueta, gpu: this.gpu, senal: control.signal });
      const leido = leerResultado(r.salida);
      if (!r.ok || !leido) {
        this.a.avisos.error(`${etiqueta} failed: ${causaDeFallo(r)}`);
        return;
      }
      if (r.traida_fallo) {
        this.a.avisos.error(`${etiqueta} finished, but ${r.traida_fallo}. The files are on the instance until it is shut down.`);
        return;
      }
      // A transformation repeats its source, and takes after the first would all sound at once: they come in muted.
      const repite = p.tarea !== "texto";
      const tomas = leido.ficheros.map((f, i) => ({ ruta: `generado/${f}`, nombre: f.replace(/\.wav$/i, ""), silenciada: repite || i > 0 }));
      const nombreProyecto = this.a.proyecto()?.name ?? p.nombre;
      const hecha = await this.a.entregarAudio({ carpeta, nombreProyecto, bpm: numero(this.v.bpm), tonalidad: "", inicioCompas: 1, tomas });
      if (!hecha) return;
      this.a.avisos.info(
        `${etiqueta}: ${tomas.map((t) => t.nombre).join(", ")} in. Seed ${leido.semilla ?? "?"}. Generation ${leido.generate_s ?? "?"} s, whole run ${Math.round(r.ms / 1000)} s. ` +
          `Recipe: generado/${p.nombre}.lineage.json. Nobody has heard it yet.`,
      );
    } catch (error) {
      if (control.signal.aborted) this.a.avisos.info(`${etiqueta} cancelled: no track was added. The GPU stays on until you press Off.`);
      else this.a.avisos.error(`${etiqueta}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.enMarcha = false;
      this.gpu.fijarTarea(null);
      await this.gpu.refrescar();
    }
  }
}
