/**
 * The ACE-Step module's window: three tabs by what the person wants (Song, Track, Transform),
 * a Review screen where what will be sent can be read and changed, and the run. No LLM in the path
 * (the user, 6-Nov): what Review shows is exactly what the script reads.
 */

import {
  LMS,
  PISTAS_MODELO,
  camposDe,
  estimar,
  formatoDuracion,
  instruccionDe,
  leerResultado,
  letraPropuesta,
  modelosPara,
  nombreDeArchivo,
  nombreLibre,
  parametrosParaEnviar,
  validarParametros,
  valoresDeModelo,
  type Parametros,
  type Tarea,
} from "../../../../src/modulos/ace-step/receta.ts";
import { avisoDeToma, avisoDeVersion, type Upstream } from "../../../../src/modulos/ace-step/version.ts";
import { beatsPerBar } from "../../../../src/core/types.ts";
import { carpetaDeProyecto } from "../../../../src/core/project.ts";
import { segundosPorTiempo, ultimoCompasDeClips } from "../../../../src/core/tiempo.ts";
import { metadatosWav, rutaEnProyecto } from "../../audio-store.ts";
import { cabeceraDeProyecto, subirAudio } from "../../proyecto-disco.ts";
import type { BarraGpu } from "../../gpu-barra.ts";
import type { Anfitrion } from "../anfitrion.ts";

type Pestana = "song" | "track" | "transform";

const TONICAS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MODOS = ["minor", "major", "dorian", "phrygian", "lydian", "mixolydian", "harmonic minor", "minor pentatonic"];
/** Under this a source counts as silence (the 5-Nov run that uploaded 42 MB of nothing). */
const SILENCIO_DBFS = -60;
/**
 * Bars asked from the model beyond the last one, cut off on delivery. Measured 7-Nov on lego,
 * "from 1 to 8": the sound stopped at 6.94, 7.08, 6.23 and 7.08 bars, so up to ~1.8 bars short.
 * Two covers that; whether the asked bars then sound to the end is not measured yet.
 */
const MARGEN_COMPASES = 2;
/**
 * What each task is good for and what fails, shown before anything is spent. The user, 7-Nov: "no
 * quiero quejas de usuarios de no sirve". Every sentence comes from a take he judged by ear
 * (ESTADO.md, "What ACE-Step can and cannot do"); change them when a verdict changes.
 */
const EXPECTATIVAS: Record<Tarea, string> = {
  // One instrument alone: 6 of 8 takes on xl-sft + LM 4B (8-Nov, s01-s04); with 1.7B it always completed a song.
  // Style words: dirty caption on cover, voice description, fewer layers barely moved it. Empty BPM: 125 dance, or rap.
  text2music: "Makes a whole song. Also one instrument alone if the caption describes only that instrument (“isolated… playing alone… stem”), though some takes add others. Style words move it little; give the BPM, or it picks its own. Generate several takes and keep the best.",
  // Not offered since 7-Nov evening; kept because the type lists every task the script knows.
  lego: "Removed from this window: it could not be steered.",
  // From a voice: passed (5-Nov). From an extracted drum track: "pegote descomunal" (7-Nov, p07).
  complete: "Builds a band around one track. From a voice: good result. From an extracted drum track it gave a jumble.",
  // 7-Nov: a "harsh, dirty" caption gave harsh keys, not dirt (p01/p02, 0.6 and 0.3 nearly the same take).
  cover: "Plays the source again with another sound. The caption barely changes its style. If there is a voice, paste the lyrics or the voice is lost.",
  // 7-Nov: correlation with the source 0.66-0.72 against 0.32 for cover; strengths 0.3/0.6/0.8 gave 0.97-0.99 between them. 2 of 2 passed.
  "cover-nofsq": "Like cover but stays much closer to the source. Strength changes almost nothing; change the seed for another version.",
  // 7-Nov: bars outside the range identical to the source (correlation 1.00) on 4 and 8 bars; heard as a short orchestral turn.
  repaint: "Redoes exactly the bars you choose and keeps the rest untouched. What it paints there is the model's choice.",
  // Keyboard passed (p05), percussion took the rhythmic keyboard (p06), 7-Nov.
  extract: "Pulls one instrument out of a mix. Voice, bass and keyboard: good, the bass with a little of the rest. Percussion gets confused with rhythmic keys. Drums: comes out with leftovers; for clean stems use a dedicated separator.",
};
/**
 * Before Run, where money is spent. The user, 7-Nov: a disclaimer of no guarantee and of the money a
 * rented GPU costs, "como todo el software libre": the AGPL-3.0 in LICENSE already says WITHOUT ANY
 * WARRANTY; this says what that means here. 8-Nov, the user: keep saying it is experimental and that rented
 * GPU time may not be productive (the best recipe so far kept 2 takes of 4).
 */
const SIN_GARANTIA =
  "Experimental: results vary from take to take, and many takes may be needed before one is useful. This is free software provided as is, without any warranty (AGPL-3.0). No result is guaranteed: the same request can give a good take, the wrong instrument or near silence. The GPU is rented from a provider with your account: it bills the machine's time whether the take is useful or not, failed and cancelled runs included, and keeps billing until you press Off. Every cost is yours.";
/** Only the Track tab (complete): the short ending was measured on lego, its sibling over a context. */
const conMargen = (tarea: Tarea): boolean => tarea === "complete";
/**
 * Lego is gone from the window (the user, 7-Nov evening: "lo quitamos de la app"). Of every take he
 * heard, the ones he kept were what the model chose, not what was asked ("todo lo que ha salido bien,
 * no siguió casi el caption"); bass over bateria-1 failed 5 of 5, with and without a reference.
 * Repeat does not offer its takes either. The script still runs it, so old lineages stay readable.
 * The Reference field went the same evening ("sí la quitamos"): with lego a full mix gave a mix and a
 * bass gave a sub block; with cover, "un pegote de instrumentos bastante estridente". Takes made with
 * a reference are not offered for Repeat either. The script keeps `--referencia`.
 */
const OFRECIDA = (tarea: unknown): boolean => tarea !== "lego";

interface FuentePreparada {
  clave: string;
  audio: string | null;
  silencio: number | null;
  descripcion: string;
  bytes: number;
  inicioCompas: number;
  carpeta: string;
  /** Repaint works over the whole source: its bars, in seconds. */
  desde: number | null;
  hasta: number | null;
  /** Bars the delivered clip lasts (the asked ones); null = the whole file. */
  compases: number | null;
  /** Bars of margin the source carries after them. */
  margen: number;
  /** Tracks for complete; a file is sent as it is. */
  margenEditable: boolean;
}

interface TomaGuardada {
  nombre: string;
  receta: {
    modulo?: string;
    parametros: Partial<Parametros>;
    fuente?: { descripcion?: string };
    entrega?: { inicioCompas?: number; compases?: number | null; margen?: number; bpmProyecto?: number | null; tonalidad?: string };
  };
  semillas: unknown[];
  /** The WAVs it wrote (absent from servers before 7-Nov). */
  ficheros?: string[];
}

const esc = (texto: string): string => texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/**
 * A textarea with its content. The newline right after the tag is the one the HTML parser eats;
 * without it a text starting with a line break lost it. Found 6-Nov by the path check.
 */
const areaDeTexto = (atributos: string, filas: number, valor: string): string => `<textarea ${atributos} rows="${filas}">\n${esc(valor)}</textarea>`;
const numero = (texto: string | undefined): number | null => {
  if (texto === undefined || texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
};

export class VentanaAceStep {
  private readonly dialogo: HTMLDialogElement;
  private pestana: Pestana = "song";
  private vista: "form" | "review" = "form";
  /** Every form field by name: changing tab or going back loses nothing. */
  private v: Record<string, string> = {};
  private pistas = new Set<string>();
  private acompanamiento = new Set<string>();
  private archivo: File | null = null;
  /** What was changed on the Review screen, kept when going back to the form. */
  private editados: Partial<Record<keyof Parametros, unknown>> = {};
  private fuente: FuentePreparada | null = null;
  /** The recipe of an earlier take, when Review comes from Repeat. */
  private cargada: TomaGuardada | null = null;
  private tomas: TomaGuardada[] = [];
  private upstream: Upstream | null = null;
  private mensaje = "";
  private ocupada = false;
  /** Why the server refused the last Run, shown on Review until the next one. */
  private rechazo = "";
  private enMarcha = false;
  private proyectoVisto: string | null = null;
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
    const id = p ? carpetaDeProyecto(p) : "";
    // Another project: its tempo, key and tracks are the ones that count from now on.
    if (id !== this.proyectoVisto) {
      this.proyectoVisto = id;
      this.pistas.clear();
      this.fuente = null;
      this.cargada = null;
      this.vista = "form";
      this.v.bpm = p && p.tracks.length > 0 ? String(p.bpm) : "";
      this.v.tonica = p && p.tracks.length > 0 ? p.key.tonic : "";
      this.v.modo = p && p.tracks.length > 0 ? p.key.mode : "minor";
    }
    // A repeat is one decision: closing it leaves nothing behind, the tabs come back.
    if (this.cargada) {
      this.cargada = null;
      this.editados = {};
      this.vista = "form";
    }
    await this.gpu.refrescar();
    await this.cargarTomas();
    this.pintar();
    this.dialogo.showModal();
    // Not awaited: a slow GitHub must not hold the window closed.
    void this.comprobarVersion();
  }

  private async comprobarVersion(): Promise<void> {
    try {
      const res = await fetch("/api/modulos/ace-step/version");
      this.upstream = (await res.json()) as Upstream;
    } catch (error) {
      this.upstream = { error: error instanceof Error ? error.message : String(error) };
    }
    this.pintarVersion();
  }

  /** Only its own line: repainting the window would take the focus from whoever is typing. */
  private pintarVersion(): void {
    const zona = this.dialogo.querySelector<HTMLElement>("[data-version]");
    const aviso = avisoDeVersion(this.upstream);
    if (!zona || !aviso) return;
    zona.textContent = aviso.texto;
    zona.className = aviso.cambio ? "ace-error" : "ace-nota";
  }

  private async cargarTomas(): Promise<void> {
    const p = this.a.proyecto();
    this.tomas = [];
    if (!p) return;
    try {
      const res = await fetch("/api/gpu/tomas", { headers: cabeceraDeProyecto(carpetaDeProyecto(p)) });
      const datos = (await res.json()) as { tomas?: TomaGuardada[] };
      this.tomas = datos.tomas ?? [];
    } catch {
      /* without the list only Repeat is lost */
    }
  }

  // ---------------------------------------------------------------- what is being asked for

  private get vacio(): boolean {
    const p = this.a.proyecto();
    return !p || p.tracks.length === 0;
  }

  private tareaDelFormulario(): Tarea {
    if (this.pestana === "song") return "text2music";
    if (this.pestana === "track") return "complete";
    return (this.v.transformar as Tarea | undefined) ?? "cover";
  }

  private pistaDelFormulario(tarea: Tarea): string | null {
    if (tarea === "extract") return this.v.instrumento ?? "vocals";
    if (tarea === "complete") return [...this.acompanamiento].join(", ") || null;
    return null;
  }

  private modeloDelFormulario(tarea: Tarea): string {
    const validos = modelosPara(tarea).map((m) => m.nombre);
    if (this.v.modelo && validos.includes(this.v.modelo)) return this.v.modelo;
    return validos[0]!;
  }

  private tonalidadDelFormulario(): string {
    return this.v.tonica ? `${this.v.tonica} ${this.v.modo || "minor"}` : "";
  }

  private compasSegundos(): number {
    const p = this.a.proyecto();
    const bpm = p?.bpm ?? numero(this.v.bpm) ?? 120;
    return (p ? beatsPerBar(p) : 4) * segundosPorTiempo(bpm);
  }

  /** Form, then the recipe of a repeated take if any, then what was edited on Review. */
  private parametros(): Parametros {
    const edit = this.editados;
    if (this.cargada) {
      const base = this.cargada.receta.parametros;
      const tarea = base.tarea ?? "text2music";
      const vacio: Parametros = {
        tarea,
        modelo: "",
        instruccion: "",
        prompt: "",
        letra: "",
        idioma: "unknown",
        duracion: null,
        bpm: null,
        tonalidad: "",
        compas: "",
        semilla: -1,
        variantes: 1,
        pasos: 8,
        guia: 1,
        shift: 3,
        lm: "none",
        normalizar: false,
        fuerza: null,
        desde: null,
        hasta: null,
        pista: null,
        nombre: "",
        audio: null,
        silencio: null,
        referencia: null,
      };
      return { ...vacio, ...base, ...edit } as Parametros;
    }
    const tarea = this.tareaDelFormulario();
    const modelo = (edit.modelo as string | undefined) ?? this.modeloDelFormulario(tarea);
    const pista = (edit.pista as string | null | undefined) ?? this.pistaDelFormulario(tarea);
    const letra = this.v.letra ?? "";
    const base: Parametros = {
      tarea,
      modelo,
      instruccion: instruccionDe(tarea, pista),
      prompt: this.v.prompt ?? "",
      letra: letra !== "" ? letra : letraPropuesta(tarea, pista),
      idioma: this.v.idioma || "unknown",
      duracion: tarea === "text2music" ? (numero(this.v.duracion) ?? 60) : null,
      bpm: numero(this.v.bpm),
      tonalidad: this.tonalidadDelFormulario(),
      compas: this.v.compas ?? "",
      semilla: numero(this.v.semilla) ?? -1,
      variantes: numero(this.v.variantes) ?? 1,
      ...valoresDeModelo(tarea, modelo),
      fuerza: tarea.startsWith("cover") ? (numero(this.v.fuerza) ?? 1) : null,
      desde: this.fuente?.desde ?? null,
      hasta: this.fuente?.hasta ?? null,
      pista,
      nombre: this.v.nombre ?? "",
      audio: this.fuente?.audio ?? null,
      silencio: this.fuente?.silencio ?? null,
      // The Reference field was removed (7-Nov evening): it never reaches the recipe from this window.
      referencia: null,
    };
    return { ...base, ...edit } as Parametros;
  }

  // ---------------------------------------------------------------- painting

  private pintar(): void {
    this.dialogo.innerHTML = this.vista === "form" ? this.htmlFormulario() : this.htmlRevision();
    if (this.vista === "review") this.pintarEstimacion();
    this.pintarVersion();
  }

  private fila(etiqueta: string, control: string, ayuda = ""): string {
    return `<div class="ace-fila"><label>${etiqueta}</label><div>${control}${ayuda ? `<small>${ayuda}</small>` : ""}</div></div>`;
  }

  private texto(nombre: string, placeholder = ""): string {
    return `<input name="${nombre}" value="${esc(this.v[nombre] ?? "")}" placeholder="${esc(placeholder)}">`;
  }

  private num(nombre: string, min: number, max: number, placeholder = "", paso = "any"): string {
    return `<input class="corto" name="${nombre}" type="number" min="${min}" max="${max}" step="${paso}" value="${esc(this.v[nombre] ?? "")}" placeholder="${esc(placeholder)}">`;
  }

  private selector(nombre: string, opciones: [string, string][], actual: string): string {
    return `<select name="${nombre}">${opciones.map(([v, t]) => `<option value="${esc(v)}"${v === actual ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  }

  private htmlComun(tarea: Tarea, opciones: { requiereTempo: boolean }): string {
    const modelo = this.modeloDelFormulario(tarea);
    const tonica = this.selector("tonica", [["", "—"], ...TONICAS.map((t): [string, string] => [t, t])], this.v.tonica ?? "");
    const modo = this.selector("modo", MODOS.map((m): [string, string] => [m, m]), this.v.modo ?? "minor");
    return (
      this.fila(
        "Tempo and key",
        `${this.num("bpm", 30, 300, "BPM")} ${tonica} ${modo}`,
        opciones.requiereTempo
          ? "This project has no tracks: these set its tempo and key."
          : this.vacio
            ? "Empty: nothing is sent and the model decides. The first generation sets the project's tempo and key."
            : "Sent to the model. The project keeps its own tempo.",
      ) +
      this.fila("Model", this.selector("modelo", modelosPara(tarea).map((m): [string, string] => [m.nombre, m.nombre]), modelo)) +
      this.fila("Takes", this.num("variantes", 1, 8, "1", "1")) +
      this.fila("Seed", this.num("semilla", -1, 4294967295, "random", "1"))
    );
  }

  private htmlFuente(tarea: Tarea): string {
    const p = this.a.proyecto();
    const hayPistas = Boolean(p && p.tracks.length > 0);
    const tipos: [string, string][] = [];
    if (hayPistas) tipos.push(["pistas", "Tracks"]);
    tipos.push(["archivo", "File"]);
    const tipo = this.tipoFuente(tipos.map(([v]) => v));
    let html = this.fila(
      "Source",
      tipos.map(([v, t]) => `<label class="ace-opcion"><input type="radio" name="tipoFuente" value="${v}"${v === tipo ? " checked" : ""}> ${t}</label>`).join(""),
      "Only what you choose here is sent. Mute and solo do not count.",
    );
    if (tipo === "pistas" && p) {
      html += this.fila(
        "Tracks",
        `<div class="ace-lista">${p.tracks
          .map((t) => `<label class="ace-opcion"><input type="checkbox" data-pista="${esc(t.id)}"${this.pistas.has(t.id) ? " checked" : ""}> ${esc(t.name)}${t.muted ? " <small>(muted)</small>" : ""}</label>`)
          .join("")}</div>`,
      );
    }
    if (tipo === "archivo") {
      // Bug 25, 7-Nov: every repaint empties a native file input, which then said "no file chosen"
      // beside "Chosen: …". The input is hidden; the window says what it keeps.
      html += this.fila(
        "File",
        `<label class="file"><input type="file" data-archivo accept="audio/*,.wav" hidden>${this.archivo ? "Change…" : "Choose a file…"}</label> ` +
          `<span>${this.archivo ? esc(this.archivo.name) : "none chosen"}</span>`,
      );
    }
    html += this.fila("Bars", `${this.num("desdeCompas", 1, 512, "1", "1")} to ${this.num("hastaCompas", 1, 512, "end", "1")}`, tarea === "repaint" ? "The part to redo." : "The result lands at the first of them.");
    return html;
  }

  /**
   * Until chosen: Tracks when the project has them (none ticked, so Review asks which), else the
   * first valid. 7-Nov: after a reload the form fell back to Silence and `guitarra-d` was made
   * with no context unnoticed.
   */
  private tipoFuente(validos: string[]): string {
    if (this.v.tipoFuente && validos.includes(this.v.tipoFuente)) return this.v.tipoFuente;
    return validos.includes("pistas") ? "pistas" : validos[0]!;
  }

  private htmlPestana(): string {
    const nombre = this.fila("Name", this.texto("nombre", "the take's file and track"), this.a.proyecto() ? "" : "It also names the new project.");
    const caption = this.fila(
      "Caption",
      `${areaDeTexto('name="prompt"', 3, this.v.prompt ?? "")}<small data-cuenta>${(this.v.prompt ?? "").length}/512</small>`,
      // Evidence: "no bass" primed a bass (5-Nov); English moved the timbre more than Spanish (7-Nov, one pair).
      "Sent as you write it. Write it in English and say what you want: negations tend to bring what they deny.",
    );
    const espera = (tarea: Tarea): string => `<p class="ace-nota">${esc(EXPECTATIVAS[tarea])}</p>`;
    const letra = (ayuda: string): string => this.fila("Lyrics", areaDeTexto('name="letra"', 5, this.v.letra ?? ""), ayuda);
    const idioma = this.fila("Language", this.texto("idioma", "en, es… (empty = unknown)"));
    if (this.pestana === "song") {
      return (
        espera("text2music") +
        nombre + caption +
        letra("Empty: [Instrumental] is sent. Review shows it.") +
        idioma +
        this.fila("Duration", `${this.num("duracion", 10, 600, "60")} s`) +
        this.fila("Time", this.selector("compas", [["", "—"], ["4", "4/4"], ["3", "3/4"], ["6", "6/8"], ["2", "2/4"]], this.v.compas ?? "")) +
        this.htmlComun("text2music", { requiereTempo: false })
      );
    }
    if (this.pestana === "track") {
      const tarea = this.tareaDelFormulario();
      const instrumento = this.fila(
        "Instruments",
        `<div class="ace-lista">${PISTAS_MODELO.map((p) => `<label class="ace-opcion"><input type="checkbox" data-acomp="${p}"${this.acompanamiento.has(p) ? " checked" : ""}> ${p}</label>`).join("")}</div>`,
        "The result is one track with all of them together. None: the model chooses.",
      );
      return (
        espera(tarea) +
        nombre + instrumento + caption +
        letra("Only if it sings. Empty: [Instrumental] is sent.") +
        idioma +
        this.htmlFuente(tarea) +
        this.htmlComun(tarea, { requiereTempo: this.vacio })
      );
    }
    const tarea = this.tareaDelFormulario();
    const opciones: [string, string][] = [
      ["cover", "cover: the source regenerated"],
      ["cover-nofsq", "cover-nofsq: undocumented variant"],
      ["repaint", "repaint: redo some bars"],
      ["extract", "extract: pull one instrument out"],
    ];
    return (
      nombre +
      this.fila("Task", this.selector("transformar", opciones, tarea)) +
      espera(tarea) +
      (tarea === "extract" ? this.fila("Instrument", this.selector("instrumento", PISTAS_MODELO.map((p): [string, string] => [p, p]), this.v.instrumento ?? "vocals")) : caption) +
      (tarea.startsWith("cover") ? this.fila("Strength", this.num("fuerza", 0, 1, "1"), "1 follows the source, 0.2 keeps only its style.") : "") +
      letra(tarea === "extract" ? (this.v.instrumento === "drums" ? "Empty: [Instrumental] is sent." : "Empty: Review shows what is sent for this instrument.") : "A sung cover needs its lyrics: without them the voice is usually lost. Empty: [Instrumental].") /* evidence: 5-Nov test 4 */ +
      idioma +
      this.htmlFuente(tarea) +
      this.htmlComun(tarea, { requiereTempo: false })
    );
  }

  private htmlTomas(): string {
    // Every take still counts for the names in use (nombresOcupados); only the offered tasks can be repeated.
    // Since 8-Nov other modules (MuLaCover, Demucs) leave lineages in the same generado/: only ACE-Step's are its takes.
    const repetibles = this.tomas
      .map((t, i) => [t, i] as const)
      .filter(([t]) => (t.receta.modulo ?? "ace-step") === "ace-step" && OFRECIDA(t.receta.parametros.tarea) && !t.receta.parametros.referencia);
    if (repetibles.length === 0) return "";
    const opciones = repetibles.map(([t, i]) => `<option value="${i}">${esc(t.nombre)} · ${esc(String(t.receta.parametros.tarea ?? ""))} · ${esc(String(t.receta.parametros.modelo ?? ""))}</option>`).join("");
    return `<details class="ace-tomas"><summary>Takes of this project (${repetibles.length})</summary>
      <div class="ace-fila"><label>Take</label><div><select data-toma>${opciones}</select>
      <button type="button" data-accion="repetir" title="Same recipe, same seed as its first take. On the same machine it gives the same or nearly the same audio.">Repeat</button>
      <button type="button" data-accion="nueva-semilla">New seed</button></div></div></details>`;
  }

  private htmlFormulario(): string {
    const tab = (id: Pestana, t: string): string => `<button type="button" class="ace-tab${this.pestana === id ? " active" : ""}" data-pestana="${id}">${t}</button>`;
    return `
      <div class="dialogo-cabeza"><strong>ACE-Step</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota" data-version></p>
      <div class="ace-tabs">${tab("song", "Song")}${tab("track", "Track")}${tab("transform", "Transform")}</div>
      <div class="ace-cuerpo">${this.htmlPestana()}${this.htmlTomas()}</div>
      ${this.mensaje ? `<p class="ace-error">${esc(this.mensaje)}</p>` : ""}
      <div class="dialogo-acciones"><button type="button" data-accion="cerrar">Close</button><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const c = camposDe(p.tarea);
    const t = (k: keyof Parametros, v: unknown): string => `<input data-param="${k}" value="${esc(v === null || v === undefined ? "" : String(v))}">`;
    const n = (k: keyof Parametros, v: number | null): string => `<input class="corto" data-param="${k}" data-tipo="numero" type="number" step="any" value="${v ?? ""}">`;
    const s = (k: keyof Parametros, opciones: string[], v: string): string => `<select data-param="${k}">${opciones.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    const fuente = this.cargada
      ? (this.cargada.receta.fuente?.descripcion ?? (p.silencio ? `Silence, ${p.silencio} s` : p.audio ?? ""))
      : this.fuente?.descripcion;
    return `
      <div class="dialogo-cabeza"><strong>ACE-Step · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota" data-version></p>
      <p class="ace-nota">This is exactly what will be sent. Anything you change here is what the model receives.</p>
      <div class="ace-cuerpo">
        ${this.fila("task", `<code>${esc(p.tarea)}</code>`)}
        ${this.fila("model", s("modelo", modelosPara(p.tarea).map((m) => m.nombre), p.modelo))}
        ${this.fila("name", t("nombre", p.nombre))}
        ${p.tarea === "extract" ? "" : this.fila("caption", `${areaDeTexto('data-param="prompt"', 3, p.prompt)}<small data-cuenta>${p.prompt.length}/512</small>`)}
        ${this.fila("lyrics", areaDeTexto('data-param="letra"', 4, p.letra))}
        ${this.fila("language", t("idioma", p.idioma))}
        ${c.fuente && fuente ? this.fila("source", `<code>${esc(fuente)}</code>`) : ""}
        ${this.htmlMargen(p.tarea)}
        ${c.pista ? this.fila("instrument", t("pista", p.pista)) : ""}
        ${c.duracion ? this.fila("duration (s)", n("duracion", p.duracion)) : ""}
        ${c.fuerza ? this.fila("cover strength", n("fuerza", p.fuerza)) : ""}
        ${c.rango ? this.fila("range (s)", `${n("desde", p.desde)} to ${n("hasta", p.hasta)}`) : ""}
        ${this.fila("bpm", n("bpm", p.bpm))}
        ${this.fila("key", t("tonalidad", p.tonalidad))}
        ${this.fila("time", t("compas", p.compas))}
        ${this.fila("takes", n("variantes", p.variantes))}
        ${this.fila("seed", n("semilla", p.semilla), "-1 = random")}
        ${this.fila("steps", n("pasos", p.pasos))}
        ${this.fila("guidance", n("guia", p.guia), "The handler forces 1.0 on turbo.")}
        ${this.fila("shift", n("shift", p.shift))}
        ${c.lm ? this.fila("LM", s("lm", [...LMS], p.lm), "ACE-Step's own language model: it plans the song from the caption. “none” skips it.") : ""}
        ${this.fila("normalize", `<label class="ace-opcion"><input type="checkbox" data-param="normalizar" data-tipo="booleano"${p.normalizar ? " checked" : ""}> to -1 dBFS</label>`)}
        ${this.fila("instruction", t("instruccion", p.instruccion))}
      </div>
      <p class="ace-nota">${esc(EXPECTATIVAS[p.tarea])}</p>
      <p class="ace-aviso-coste"><strong>No warranty.</strong> ${esc(SIN_GARANTIA)}</p>
      <p class="ace-estimacion" data-estimacion></p>
      <p class="ace-error" data-error></p>
      <div class="dialogo-acciones">
        <button type="button" data-accion="volver">Back</button>
        <button type="button" data-accion="restablecer">Reset edits</button>
        <button type="button" data-accion="ajustes" hidden>Settings…</button>
        <button type="button" class="primario" data-accion="lanzar">Run</button>
      </div>`;
  }

  /** Editable while the source is this window's; a repeat shows what its recipe carried. */
  private htmlMargen(tarea: Tarea): string {
    // Evidence (7-Nov): 8 asked bars stopped sounding at 6.2-7.1 without margin.
    const ayuda = "Bars of silence sent after the last asked bar so the take has room to end; without them it tends to stop early. The clip is cut to the asked bars; the WAV keeps them all.";
    if (this.cargada) {
      const e = this.cargada.receta.entrega;
      return e?.margen ? this.fila("margin (bars)", `<code>${e.margen}, clip ${e.compases ?? "?"} bars</code>`, "From the repeated take's recipe.") : "";
    }
    if (!conMargen(tarea) || !this.fuente?.margenEditable) return "";
    return this.fila("margin (bars)", `<input class="corto" data-margen type="number" min="0" max="16" step="1" value="${this.fuente.margen}">`, ayuda);
  }

  /** A new margin is a new source: silence is recomputed, tracks are rendered again. */
  private async cambiarMargen(valor: string): Promise<void> {
    this.v.margen = valor;
    const error = this.dialogo.querySelector<HTMLElement>("[data-error]");
    const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
    if (boton) boton.disabled = true;
    if (error) error.textContent = "Preparing the source again with the new margin…";
    try {
      await this.prepararFuente();
      this.pintar();
    } catch (e) {
      // The old source does not match the margin any more: without a source Run stays off.
      this.fuente = null;
      this.pintarEstimacion();
      const zona = this.dialogo.querySelector<HTMLElement>("[data-error]");
      if (zona) zona.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private pintarEstimacion(): void {
    const p = this.parametros();
    const e = this.gpu.estado;
    const zona = this.dialogo.querySelector<HTMLElement>("[data-estimacion]");
    const error = this.dialogo.querySelector<HTMLElement>("[data-error]");
    const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
    if (!zona || !error || !boton) return;
    const est = estimar(p, { encendida: e?.activo === true, precioHora: e?.precio_hora ?? null }, this.cargada ? 0 : (this.fuente?.bytes ?? 0));
    const rate = e?.configurado ? `${e.tipo} on ${e.proveedor}, ${e.precio_hora} $/h` : "no GPU configured";
    zona.textContent = `Run on: ${rate} · Estimated ~${formatoDuracion(est.segundos)}${est.coste === null ? "" : `, ~${est.coste.toFixed(2)} $`} (${est.detalle.join(", ")}). Based on runs on an A10: a guide, not a promise. The machine stays on after the run until you press Off.`;
    let motivo = validarParametros(p);
    if (!motivo && !e?.configurado) motivo = `The GPU is not configured. Missing in Settings: ${(e?.faltan ?? ["its keys"]).join(", ")}.`;
    const ajustes = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="ajustes"]');
    if (ajustes) ajustes.hidden = e?.configurado === true;
    if (!motivo && e?.ssh && !e.ssh.ok) motivo = "ssh is not on the server's PATH.";
    if (!motivo && this.enMarcha) motivo = "There is a run in progress: wait for it, or cancel it from the top bar.";
    // The server's refusal of the last Run is shown but does not lock Run: after changing the name it can be tried again.
    error.textContent = motivo ?? this.rechazo;
    boton.disabled = motivo !== null;
  }

  // ---------------------------------------------------------------- events

  private alEscribir(evento: Event): void {
    const el = evento.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const param = el.dataset?.param as keyof Parametros | undefined;
    if (param) {
      this.leerParametro(el as HTMLInputElement, param);
      if (param === "prompt") this.pintarCuenta(el.value.length);
      this.pintarEstimacion();
      return;
    }
    if (el.name) {
      this.v[el.name] = el.value;
      if (el.name === "prompt") this.pintarCuenta(el.value.length);
    }
  }

  private pintarCuenta(n: number): void {
    const cuenta = this.dialogo.querySelector<HTMLElement>("[data-cuenta]");
    if (!cuenta) return;
    cuenta.textContent = `${n}/512`;
    cuenta.classList.toggle("ace-pasado", n > 512);
  }

  private leerParametro(el: HTMLInputElement, param: keyof Parametros): void {
    const tipo = el.dataset.tipo;
    const editados = this.editados as Record<string, unknown>;
    if (tipo === "numero") editados[param] = numero(el.value);
    else if (tipo === "booleano") editados[param] = el.checked;
    else if (param === "pista") editados[param] = el.value === "" ? null : el.value;
    else editados[param] = el.value;
  }

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLInputElement;
    if ("margen" in el.dataset) {
      void this.cambiarMargen(el.value);
      return;
    }
    if (el.dataset.param) {
      this.leerParametro(el, el.dataset.param as keyof Parametros);
      this.pintarEstimacion();
      return;
    }
    if (el.dataset.pista) {
      if (el.checked) this.pistas.add(el.dataset.pista);
      else this.pistas.delete(el.dataset.pista);
      return;
    }
    if (el.dataset.acomp) {
      if (el.checked) this.acompanamiento.add(el.dataset.acomp);
      else this.acompanamiento.delete(el.dataset.acomp);
      return;
    }
    if ("archivo" in el.dataset) {
      this.archivo = el.files?.[0] ?? null;
      this.pintar();
      return;
    }
    if (!el.name) return;
    this.v[el.name] = el.value;
    // These change which fields apply. The rest repaint nothing, so typing keeps its focus.
    if (["tipoFuente", "modoPista", "transformar", "instrumento"].includes(el.name)) {
      this.editados = {};
      this.pintar();
    }
  }

  private async alPulsar(evento: Event): Promise<void> {
    const el = evento.target as HTMLElement;
    if (el.dataset.pestana) {
      this.pestana = el.dataset.pestana as Pestana;
      this.editados = {};
      this.mensaje = "";
      this.pintar();
      return;
    }
    switch (el.dataset.accion) {
      case "cerrar":
        this.dialogo.close();
        return;
      case "volver":
        this.vista = "form";
        this.cargada = null;
        this.pintar();
        return;
      case "restablecer":
        this.editados = {};
        this.pintar();
        return;
      case "ajustes":
        await this.a.abrirAjustes();
        this.pintarEstimacion();
        return;
      case "revisar":
        await this.revisar();
        return;
      case "repetir":
      case "nueva-semilla":
        this.cargarToma(el.dataset.accion === "nueva-semilla");
        return;
      case "lanzar":
        void this.lanzar();
        return;
    }
  }

  /**
   * Names a new take cannot use: every lineage and every WAV a take wrote. Bug 22, 7-Nov: Repeat of
   * `guitarra-c` (3 takes) proposed `guitarra-c-2`, refused because `guitarra-c-2.wav` existed.
   */
  private nombresOcupados(): Set<string> {
    return new Set(this.tomas.flatMap((t) => [t.nombre, ...(t.ficheros ?? []).map((f) => f.replace(/\.wav$/i, ""))]));
  }

  private cargarToma(nuevaSemilla: boolean): void {
    const i = Number(this.dialogo.querySelector<HTMLSelectElement>("[data-toma]")?.value ?? 0);
    const toma = this.tomas[i];
    if (!toma) return;
    const semilla = typeof toma.semillas[0] === "number" ? toma.semillas[0] : -1;
    const ocupados = this.nombresOcupados();
    this.cargada = {
      ...toma,
      receta: {
        ...toma.receta,
        parametros: { ...toma.receta.parametros, semilla: nuevaSemilla ? -1 : semilla, nombre: nombreLibre(toma.nombre, ocupados) },
      },
    };
    this.editados = {};
    this.vista = "review";
    this.pintar();
  }

  // ---------------------------------------------------------------- preparing the source

  private async revisar(): Promise<void> {
    this.mensaje = "";
    this.rechazo = "";
    this.ocupada = true;
    this.pintar();
    try {
      // The name first: a new project's folder is chosen from it (bug 23, 7-Nov: with Name empty the
      // folder became the default "ace-step" while the project took the proposed "toma").
      if (!this.v.nombre && !this.editados.nombre) {
        const propuesto = nombreDeArchivo(this.v.prompt?.slice(0, 24) ?? "");
        this.v.nombre = nombreLibre(propuesto || "toma", this.nombresOcupados());
      }
      await this.prepararFuente();
      this.vista = "review";
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : String(error);
    } finally {
      this.ocupada = false;
      this.pintar();
    }
  }

  private async carpetaDestino(nombre: string): Promise<string> {
    const p = this.a.proyecto();
    if (p) return carpetaDeProyecto(p);
    return this.a.carpetaParaNuevo(nombre || "ace-step");
  }

  /** What travels: rendered only when something about the source changed, because it freezes the tab. */
  private async prepararFuente(): Promise<void> {
    const tarea = this.tareaDelFormulario();
    const nombre = nombreDeArchivo(this.v.nombre ?? "");
    if (tarea === "text2music") {
      const carpeta = this.fuente?.clave === `song:${nombre}` ? this.fuente.carpeta : await this.carpetaDestino(nombre);
      this.fuente = { clave: `song:${nombre}`, audio: null, silencio: null, descripcion: "", bytes: 0, inicioCompas: 1, carpeta, desde: null, hasta: null, compases: null, margen: 0, margenEditable: false };
      return;
    }
    const p = this.a.proyecto();
    // Silence was lego's context only; it went with lego (7-Nov evening).
    const validos = [...(p && p.tracks.length > 0 ? ["pistas"] : []), "archivo"];
    const tipo = this.tipoFuente(validos);
    const desdeCompas = numero(this.v.desdeCompas) ?? 1;
    const hastaCompas = numero(this.v.hastaCompas);
    if (hastaCompas !== null && hastaCompas < desdeCompas) throw new Error("The last bar comes before the first.");
    const repaint = tarea === "repaint";
    if (repaint && hastaCompas === null) throw new Error("Repaint needs the last bar of the part to redo.");
    // A file is sent as it is: no margin is added to it.
    const margen = conMargen(tarea) && tipo !== "archivo" ? (numero(this.v.margen) ?? MARGEN_COMPASES) : 0;
    if (!(Number.isInteger(margen) && margen >= 0 && margen <= 16)) throw new Error("The margin: a whole number of bars from 0 to 16.");
    const clave = JSON.stringify({ tarea, tipo, desdeCompas, hastaCompas, nombre, margen, compases: this.v.compases, bpm: this.v.bpm, pistas: [...this.pistas], archivo: this.archivo?.name });
    if (this.fuente?.clave === clave) return;
    const compas = this.compasSegundos();
    const rango = repaint
      ? { desde: (desdeCompas - 1) * compas, hasta: (hastaCompas ?? desdeCompas) * compas }
      : { desde: null, hasta: null };
    const inicioCompas = repaint ? 1 : desdeCompas;
    const textoMargen = margen > 0 ? ` + ${margen} bars of margin, cut on delivery` : "";

    if (tipo === "pistas") {
      if (this.pistas.size === 0) throw new Error("Choose the tracks to send.");
      // "To the end" = the last bar the chosen tracks' clips reach, not the render's length (bug 24).
      const elegidas = p!.tracks.filter((t) => this.pistas.has(t.id));
      const hasta = hastaCompas ?? ultimoCompasDeClips(elegidas.flatMap((t) => t.clips), beatsPerBar(p!));
      if (!repaint && hasta === null) throw new Error("The chosen tracks have no clips: nothing to send.");
      if (!repaint && hasta !== null && hasta < desdeCompas) throw new Error(`The chosen tracks end at bar ${hasta}, before bar ${desdeCompas}.`);
      const r = await this.a.renderizarPistas({
        pistas: [...this.pistas],
        nombre: `${nombre || "fuente"}-fuente`,
        ...(repaint ? {} : { desdeCompas, hastaCompas: hasta! }),
        margenCompases: margen,
      });
      const compases = repaint ? Math.ceil(r.segundosPedidos / compas - 1e-6) : hasta! - desdeCompas + 1;
      if (r.picoDb < SILENCIO_DBFS) {
        throw new Error(`The chosen tracks sound silent in that range (peak ${r.picoDb.toFixed(1)} dBFS). Nothing was sent. If you want silence as the context, choose Silence.`);
      }
      for (const aviso of r.avisos) this.a.avisos.error(aviso);
      const nombres = elegidas.map((t) => t.name).join(", ");
      this.fuente = {
        clave,
        audio: r.ruta,
        silencio: null,
        descripcion: `${nombres}: bars ${repaint ? "all" : `${desdeCompas}-${hasta}${hastaCompas === null ? " (end)" : ""}`}${textoMargen}, ${r.segundos.toFixed(1)} s, ${r.nivel}, ${(r.bytes / 1048576).toFixed(1)} MB`,
        bytes: r.bytes,
        inicioCompas,
        carpeta: carpetaDeProyecto(p!),
        ...rango,
        compases: margen > 0 ? compases : null,
        margen,
        margenEditable: conMargen(tarea),
      };
      return;
    }
    if (!this.archivo) throw new Error("Choose the file to send.");
    const carpeta = await this.carpetaDestino(nombre);
    const { path, bytes } = await subirAudio(this.archivo, carpeta);
    const { picos, duracionSeg } = await metadatosWav(rutaEnProyecto(path, carpeta));
    const pico = picos.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    const picoDb = pico > 0 ? 20 * Math.log10(pico) : -Infinity;
    if (picoDb < SILENCIO_DBFS) throw new Error(`“${this.archivo.name}” is silent (peak ${picoDb.toFixed(1)} dBFS). Nothing was sent.`);
    this.fuente = {
      clave,
      audio: path,
      silencio: null,
      descripcion: `${this.archivo.name}: ${duracionSeg.toFixed(1)} s, peak ${picoDb.toFixed(1)} dBFS, ${(bytes / 1048576).toFixed(1)} MB`,
      bytes,
      inicioCompas,
      carpeta,
      ...rango,
      compases: null,
      margen: 0,
      margenEditable: false,
    };
  }

  // ---------------------------------------------------------------- the run

  private async lanzar(): Promise<void> {
    const p = this.parametros();
    const motivo = validarParametros(p);
    if (motivo || this.enMarcha) return;
    // Marked at once: a second click on Run while the server answers does nothing (a double click could pay two runs).
    this.enMarcha = true;
    this.rechazo = "";
    const proyecto = this.a.proyecto();
    // A new project follows the name as it leaves Review (bug 23), unless a file was already
    // uploaded into the folder chosen earlier: then that folder holds the source and stays.
    const carpeta = proyecto
      ? carpetaDeProyecto(proyecto)
      : this.fuente?.audio
        ? this.fuente.carpeta
        : await this.a.carpetaParaNuevo(p.nombre);
    const inicioCompas = this.cargada?.receta.entrega?.inicioCompas ?? this.fuente?.inicioCompas ?? 1;
    const descripcion = this.cargada?.receta.fuente?.descripcion ?? this.fuente?.descripcion ?? "";
    // A repeat keeps its recipe's cut: its source already carries that margin.
    const compases = this.cargada ? (this.cargada.receta.entrega?.compases ?? null) : (this.fuente?.compases ?? null);
    const margen = this.cargada ? (this.cargada.receta.entrega?.margen ?? 0) : (this.fuente?.margen ?? 0);
    const receta = {
      modulo: "ace-step",
      parametros: parametrosParaEnviar(p),
      fuente: { descripcion },
      entrega: { inicioCompas, compases, margen },
    };
    const control = new AbortController();
    // The window waits for the server's answer, which comes before the machine boots, and closes only if it accepts: a
    // refusal (a taken name…) is said on Review with the form kept. Noted 7-Nov: Run closed the window first, the 409 only
    // reached the Log and the form's edits were gone.
    let cuerpo: ReadableStream<Uint8Array>;
    try {
      const res = await fetch("/api/gpu/ejecutar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(carpeta) },
        body: JSON.stringify({
          script: "generar_audio.py",
          nombre: p.nombre,
          receta,
          entradas: p.audio && !p.silencio ? [p.audio] : [],
        }),
        signal: control.signal,
      });
      if (!res.ok || !res.body) {
        const datos = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(datos.error ?? `HTTP ${res.status}`);
      }
      cuerpo = res.body;
    } catch (error) {
      this.enMarcha = false;
      this.rechazo = `The server did not start the run: ${error instanceof Error ? error.message : String(error)}`;
      this.pintarEstimacion();
      return;
    }
    this.dialogo.close();
    // The form stays for the next idea; the name does not, because a take is never overwritten.
    this.vista = "form";
    this.cargada = null;
    this.editados = {};
    this.fuente = null;
    this.v.nombre = "";
    this.a.avisos.info(`ACE-Step: ${p.tarea} with ${p.modelo}, “${p.nombre}”${descripcion ? ` · ${descripcion}` : ""}.`);
    this.gpu.fijarTarea(`ACE-Step “${p.nombre}”: starting…`, () => control.abort());
    try {
      const resultado = await this.leerFlujo(cuerpo, p.nombre);
      if (resultado) await this.entregar(resultado, p, carpeta, inicioCompas, compases);
    } catch (error) {
      if (control.signal.aborted) {
        this.a.avisos.info(`ACE-Step “${p.nombre}” cancelled: no track was added. The GPU stays on until you press Off.`);
      } else {
        this.a.avisos.error(`ACE-Step “${p.nombre}”: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.enMarcha = false;
      this.gpu.fijarTarea(null);
      await this.gpu.refrescar();
    }
  }

  private async leerFlujo(cuerpo: ReadableStream<Uint8Array>, nombre: string): Promise<ResultadoRun | null> {
    const lector = cuerpo.getReader();
    const decodificador = new TextDecoder();
    let resto = "";
    let resultado: ResultadoRun | null = null;
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      resto += decodificador.decode(value, { stream: true });
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const linea of lineas.filter(Boolean)) {
        const dato = JSON.parse(linea) as { aviso?: string; error?: string; resultado?: ResultadoRun };
        if (dato.aviso) {
          this.gpu.fijarTarea(`ACE-Step “${nombre}”: ${dato.aviso}`);
          void this.gpu.refrescar();
        }
        if (dato.error) throw new Error(dato.error);
        if (dato.resultado) resultado = dato.resultado;
      }
    }
    if (!resultado) throw new Error("the server closed the connection without a result");
    return resultado;
  }

  private async entregar(r: ResultadoRun, p: Parametros, carpeta: string, inicioCompas: number, compases: number | null): Promise<void> {
    const leido = leerResultado(r.salida);
    if (!r.ok || !leido) {
      const causa = r.por_timeout ? "the time limit cut the run off" : (r.errores.trim().split("\n").slice(-4).join(" ") || `exit ${r.codigo}`);
      this.a.avisos.error(`ACE-Step “${p.nombre}” failed: ${causa}`);
      return;
    }
    if (r.traida_fallo) {
      this.a.avisos.error(`ACE-Step “${p.nombre}” finished, but ${r.traida_fallo}. Nothing to regenerate: the files are on the instance until it is shut down.`);
      return;
    }
    // A cover or a repaint repeats its source, so it comes in muted, like the takes after the first.
    const repite = p.tarea.startsWith("cover") || p.tarea === "repaint";
    const tomas = leido.ficheros.map((f, i) => ({ ruta: `generado/${f}`, nombre: f.replace(/\.wav$/i, ""), silenciada: repite || i > 0 }));
    const linaje = await this.leerLinaje(p.nombre, carpeta);
    // Without a BPM the model decided: a new project takes the one the LM reported, when it did.
    const bpm = p.bpm ?? (typeof linaje?.lm_metadata?.bpm === "number" ? linaje.lm_metadata.bpm : null);
    const nombreProyecto = this.a.proyecto()?.name ?? p.nombre;
    const hecha = await this.a.entregarAudio({ carpeta, nombreProyecto, bpm, tonalidad: p.tonalidad, inicioCompas, compases, tomas });
    if (!hecha) return;
    const semillas = (linaje?.outputs ?? []).map((o) => o.seed).join(", ");
    const tiempos = leido.tiempos;
    this.a.avisos.info(
      `ACE-Step: ${tomas.map((t) => t.nombre).join(", ")} in. ${semillas ? `Seed ${semillas}. ` : ""}` +
        `Generation ${tiempos.generate_s ?? "?"} s, VRAM peak ${tiempos.vram_peak_gb ?? "?"} GB, whole run ${Math.round(r.ms / 1000)} s (${r.nota}). ` +
        `Recipe: generado/${p.nombre}.lineage.json. Nobody has heard it yet.`,
    );
    const version = avisoDeToma(p.nombre, linaje?.generator?.commit);
    if (version) this.a.avisos.error(version);
  }

  private async leerLinaje(nombre: string, carpeta: string): Promise<Linaje | null> {
    try {
      const res = await fetch(`/api/audio?path=${encodeURIComponent(rutaEnProyecto(`generado/${nombre}.lineage.json`, carpeta))}`);
      return res.ok ? ((await res.json()) as Linaje) : null;
    } catch {
      return null;
    }
  }
}

interface ResultadoRun {
  ok: boolean;
  codigo: number | null;
  ms: number;
  por_timeout: boolean;
  salida: string;
  errores: string;
  nota: string;
  traidos: string[];
  traida_fallo: string;
}

interface Linaje {
  generator?: { commit?: unknown };
  lm_metadata?: { bpm?: unknown };
  outputs?: { seed?: unknown }[];
}
