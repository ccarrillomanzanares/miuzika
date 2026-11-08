/**
 * The Stable Audio module's window (8-Nov-2026, Carlos: "desarrolla el módulo con todas las funcionalidades"). Four things
 * Stable Audio 3 does: text to audio (song, one instrument, sound effect), audio to audio, repaint a part, continue a clip.
 * Review shows the prompt exactly as it travels (the kind's tags included), the licence and the cost, before anything is spent.
 */

import {
  LICENCIA, MODELOS, POR_DEFECTO, SA3_COMMIT, TIPOS, componerPrompt, leerResultado, parametrosParaEnviar, validarParametros,
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
  { id: "texto", etiqueta: "From text", ayuda: "A new piece from a description: a whole instrumental song, one instrument alone, or a sound effect." },
  { id: "audio", etiqueta: "Transform audio", ayuda: "Re-plays a source with your description. The change amount says how far it may go from it." },
  { id: "repintar", etiqueta: "Repaint a part", ayuda: "Redoes the bars you choose and keeps the rest of the source." },
  { id: "continuar", etiqueta: "Continue", ayuda: "Keeps the source and adds new music after it, up to the total duration." },
];

const COSTE =
  "Experimental: results vary from take to take. Free software provided as is, without any warranty (AGPL-3.0). The GPU is rented " +
  "with your account: it bills its time whether the take is useful or not, failed and cancelled runs included, until you press Off. " +
  "A first run on a new machine also installs Stable Audio 3 and downloads its weights (~10 GB for medium).";

/** Measured 8-Nov on an A10, medium, 8 steps: ~24 s per take of 30-120 s, model loading included. */
const AYUDA_TIEMPO = "On an A10, medium took about 25 s per take, plus the machine's boot if it is off.";

/** Heard 8-Nov: these are what cfg 1 and 7 did; the defaults stay where the ear put them. */
const AYUDA_CFG = "1 = its default, what sounded right. Higher follows the text harder but saturated by ear at 7.";

export class VentanaStableAudio {
  private readonly dialogo: HTMLDialogElement;
  private vista: "form" | "review" = "form";
  private tarea: Tarea = "texto";
  private fuente: Fuente = "archivo";
  private pistas = new Set<string>();
  private archivo: File | null = null;
  private v: Record<string, string> = {
    modelo: "medium", tipo: "cancion", descripcion: "", negativo: "", duracion: String(POR_DEFECTO.duracion), tomas: "1",
    semilla: "", steps: String(POR_DEFECTO.steps), cfg: String(POR_DEFECTO.cfg), ruido: String(POR_DEFECTO.ruido), bpm: "",
  };
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

  private parametros(): Parametros {
    const compas = this.segundosPorCompas();
    const desdeCompas = numero(this.v.desdeCompas);
    const hastaCompas = numero(this.v.hastaCompas);
    return {
      nombre: this.v.nombre ?? "",
      modelo: (this.v.modelo ?? "medium") as Modelo,
      tarea: this.tarea,
      prompt: this.v.prompt ?? componerPrompt(this.v.tipo as Tipo, this.v.descripcion ?? "", numero(this.v.bpm)),
      negativo: this.v.negativo ?? "",
      duracion: numero(this.v.duracion) ?? POR_DEFECTO.duracion,
      steps: numero(this.v.steps) ?? POR_DEFECTO.steps,
      cfg: numero(this.v.cfg) ?? POR_DEFECTO.cfg,
      semilla: numero(this.v.semilla) ?? -1,
      tomas: numero(this.v.tomas) ?? 1,
      audio: this.tarea === "texto" ? null : (this.preparado?.audio ?? null),
      ruido: this.tarea === "audio" ? numero(this.v.ruido) : null,
      desde: this.tarea === "repintar" && desdeCompas !== null ? Math.round((desdeCompas - 1) * compas * 1000) / 1000 : null,
      hasta: this.tarea === "repintar" && hastaCompas !== null ? Math.round(hastaCompas * compas * 1000) / 1000 : null,
      largoFuente: this.tarea === "continuar" ? (this.preparado?.segundos ?? null) : null,
    };
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
    const modelo = MODELOS.find((m) => m.nombre === this.v.modelo) ?? MODELOS[0]!;
    const tipos = TIPOS.map((x): [string, string] => [x.id, x.etiqueta]);
    const ayudaDuracion = t === "continuar" ? "Total: the source plus what is added." : t === "texto" ? `Up to ${modelo.maxSegundos} s on ${modelo.nombre}.` : "Set to the source's length on Review.";
    return `
      <div class="dialogo-cabeza"><strong>Stable Audio 3</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Instrumental music, single instruments and sound effects from a description. Heard: an instrumental industrial song sounded right at the default settings; at high CFG it saturated. It does not sing intelligible words. Free for commercial use under US$1M a year.</p>
      <div class="ace-cuerpo">
        ${fila("What", tareas, esc(TAREAS.find((x) => x.id === t)!.ayuda))}
        ${fila("Name", this.campo("nombre", "the take's file and track"))}
        ${t !== "texto" ? this.htmlFuente() : ""}
        ${t === "repintar" ? fila("Bars", `from ${this.campo("desdeCompas", "1", "number")} to ${this.campo("hastaCompas", "8", "number")}`, "Of the source, at the project's tempo.") : ""}
        ${t === "audio" ? fila("Change amount", this.campo("ruido", String(POR_DEFECTO.ruido), "number"), "0 keeps the source, 1 ignores it. Its example uses 0.9.") : ""}
        ${fila("Kind", this.selector("tipo", tipos), "Opens the text with the tags its guide recommends. Review shows the whole text.")}
        ${fila("Description", areaDeTexto('name="descripcion"', 4, this.v.descripcion ?? ""), "Genre, instruments, mood, production. For one instrument, e.g. “Instruments: Drums. Dry industrial kit, gated snare”. Say what you want: no negations here, use the negative prompt.")}
        ${fila("BPM", this.campo("bpm", "e.g. 92", "number"), "Written into the text (“92 BPM”): the model has no tempo control of its own, and no key.")}
        ${fila("Negative prompt", this.campo("negativo", "what to avoid, e.g. vocals, lo-fi"))}
        ${fila("Duration", `${this.campo("duracion", "", "number")} s`, ayudaDuracion)}
        ${fila("Model", this.selector("modelo", MODELOS.map((m): [string, string] => [m.nombre, m.nombre])), esc(modelo.nota))}
        ${fila("Takes", this.campo("tomas", "1", "number"), "1 to 4, in one run.")}
        ${fila("Seed", this.campo("semilla", "random", "number"))}
      </div>
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones"><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const motivo = validarParametros(p);
    const n = (nombre: string): string => `<input type="number" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" step="any">`;
    const region =
      p.tarea === "repintar"
        ? fila("region (s)", `<code>${p.desde ?? "?"} – ${p.hasta ?? "?"}</code>`)
        : p.tarea === "continuar"
          ? fila("new part (s)", `<code>${p.largoFuente?.toFixed(2) ?? "?"} – ${p.duracion}</code>`)
          : "";
    return `
      <div class="dialogo-cabeza"><strong>Stable Audio 3 · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">This is exactly what will be sent. Anything you change here is what the model receives.</p>
      <div class="ace-cuerpo">
        ${fila("task", `<code>${esc(TAREAS.find((x) => x.id === p.tarea)!.etiqueta)}</code> · <code>${esc(p.modelo)}</code>`)}
        ${fila("name", `<code>${esc(p.nombre)}</code>`)}
        ${p.tarea !== "texto" ? fila("source", `<code>${esc(this.preparado?.descripcion ?? "")}</code>`) : ""}
        ${region}
        ${fila("prompt", areaDeTexto('name="prompt"', 4, p.prompt))}
        ${fila("negative", `<input type="text" name="negativo" value="${esc(p.negativo)}">`)}
        ${fila("duration (s)", n("duracion"))}
        ${p.tarea === "audio" ? fila("change amount", n("ruido")) : ""}
        ${fila("steps", n("steps"), "8 = its default for these models")}
        ${fila("cfg", n("cfg"), AYUDA_CFG)}
        ${fila("takes", n("tomas"))}
        ${fila("seed", n("semilla"), "empty or -1 = random; the one used is recorded")}
        ${fila("version", `<code>stable-audio-3 ${SA3_COMMIT}</code>`)}
      </div>
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
    if (!el.name || el.type === "radio" || el.type === "file") return;
    this.v[el.name] = el.value;
    if (this.vista === "review") {
      const motivo = validarParametros(this.parametros());
      const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
      if (boton) boton.disabled = !!motivo || this.enMarcha;
      const error = this.dialogo.querySelector<HTMLElement>(".ace-error");
      if (error) error.textContent = motivo ?? "";
    }
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
    } else if (el.name === "modelo" || el.name === "tipo") {
      this.v[el.name] = el.value;
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
      // Back to the form: the composed prompt is rebuilt from the form's fields next time.
      delete this.v.prompt;
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
      if (this.tarea === "texto") {
        const p = this.a.proyecto();
        this.preparado = { audio: null, descripcion: "", carpeta: p ? "" : await this.a.carpetaParaNuevo(this.v.nombre), segundos: null };
      } else {
        const r = await prepararAudio(this.a, { tipo: this.fuente, pistas: [...this.pistas], archivo: this.archivo, nombre: this.v.nombre, porDefecto: "stable-audio" });
        this.preparado = { audio: r.audio, descripcion: r.descripcion, carpeta: r.carpeta, segundos: r.segundos };
        // Transform and repaint give back the source's length (editable on Review); continue needs a longer total.
        if (this.tarea !== "continuar") this.v.duracion = r.segundos.toFixed(2);
        if (this.tarea === "continuar" && !(numero(this.v.duracion)! > r.segundos)) this.v.duracion = String(Math.ceil(r.segundos + 30));
      }
      this.v.prompt = componerPrompt(this.v.tipo as Tipo, this.v.descripcion ?? "", numero(this.v.bpm));
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
