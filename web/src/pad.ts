/**
 * "Pad" panel: play the laptop touchpad AND the computer keyboard as instruments, and record them in a loop.
 *
 * Redesigned 8-Nov-2026 at the user's request ("quiero hacerlo con pad y el teclado numérico… hay que darle una vuelta a
 * la interfaz"), after the MIDI keyboards with pads that record rhythms in a loop, layer over layer, on tempo:
 * - Two sources, each with its own track and instrument: the touchpad and nine keys (numpad, or letters if there is no
 *   numpad; every key can be changed). On a drum track the nine keys are nine pieces; on any other, nine steps of the
 *   project scale.
 * - Everything is reachable from the keyboard, because with the touchpad armed the mouse pointer is frozen.
 * - The loop: N bars repeat (the engine's loop area, so the rest of the project plays along); each pass adds a layer
 *   that sounds from the next pass on; "." undoes the last pass; hold erase + a note removes it as the loop goes by;
 *   hold repeat + a note retriggers it on the grid. On stop, ONE clip per track with every layer (his choice "A").
 *
 * The capture of the touchpad is started by the server (server/api/pad.ts) and arrives over SSE; the mapping to notes
 * is `src/core/pad.ts`; the loop, the keyboard notes and the keys are `src/core/bucle.ts`; the sound is each track's
 * instrument in the openDAW engine (noteSignal).
 *
 * Arm and release: with the pad armed, the cursor freezes while a finger is resting (otherwise touching drags the
 * pointer away). It is armed by pressing on the pad drawing and released with Esc (or Ctrl+Alt+T if the page does not
 * respond). The keys work armed or not.
 */

import type { Note, Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { MapeoPad, MODOS_PAD, type ModoPad, type NotaPad } from "../../src/core/pad.ts";
import {
  ACCIONES,
  CapasBucle,
  ESQUEMAS,
  NOMBRE_ACCION,
  NOMBRE_ESQUEMA,
  accionDeTecla,
  asignarTecla,
  esquemaDe,
  leerMapa,
  nombreTecla,
  notasDelTeclado,
  pasosDeRepeticion,
  type Accion,
  type MapaTeclas,
} from "../../src/core/bucle.ts";
import { etiquetaInstrumento } from "../../src/core/instrumentos.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";
import { segundosPorTiempo } from "../../src/core/tiempo.ts";

export interface DepsPad {
  proyecto(): Project | null;
  /** The engine loaded right now (or null): it changes when Play is pressed or the project changes. */
  motorActual(): OpenDawPlaybackHandle | null;
  /** The engine with the project loaded; if not loaded, it starts it WITHOUT playing. */
  motor(): Promise<OpenDawPlaybackHandle | null>;
  /** Stops the transport and unloads the engine. */
  parar(): void;
  /** Where the timeline cursor is, in quarter notes. */
  cursor(): number;
  /**
   * What the loop recorded, into the project in one undoable step: a clip per track from `inicioBeat`, `longitud`
   * beats long (null: as long as its notes, a free take).
   */
  guardarBucle(inicioBeat: number, longitud: number | null, porPista: { trackId: string; notas: Note[] }[]): void;
  /** Creates a MIDI track for the Pad and returns its id. */
  nuevaPista(bateria: boolean): string | null;
  /** Opens the instrument picker of a track. */
  elegirInstrumento(trackId: string): void;
  /** Makes a silent track heard: `quitarMute` unmutes it, `solo` adds it to the tracks on Solo. */
  hacerOir(trackId: string, como: "quitarMute" | "solo"): void;
  /** With no project open: New and Projects, from inside the panel. */
  nuevoProyecto(): void;
  abrirProyectos(): void;
  avisar(texto: string): void;
  /** Moves the timeline playhead during recording. */
  dibujar(beat: number): void;
}

type Fuente = "pad" | "teclas";

const ETIQUETAS_MODO: Record<ModoPad, string> = { teclas: "Keys", pads: "Pads", deslizar: "Slide" };
/** ELAN0712 ratio (3520 × 1784). */
const PROPORCION = 1784 / 3520;
const NUEVA = "__nueva";
const NUEVA_BATERIA = "__bateria";
const CLAVE_TECLAS = "miuzika.pad.teclas";
/** How far ahead the loop schedules its notes and clicks, in seconds; the scheduler runs every 10 ms. */
const ANTICIPO_S = 0.03;
/** Velocity of a key (the keyboard has no pressure). */
const VELOCIDAD_TECLA = 100;
/** Numpad layout: rows from the top, key numbers 1-9. */
const FILAS_TECLADO = [[7, 8, 9], [4, 5, 6], [1, 2, 3]];

interface Dedo {
  x: number;
  y: number;
}

interface Sonando {
  pista: string;
  pitch: number;
}

interface Bucle {
  capas: CapasBucle;
  motor: OpenDawPlaybackHandle;
  ctx: AudioContext;
  inicioBeat: number;
  porCompas: number;
  spb: number;
  /** Context time of the loop's first downbeat (after the count-in). */
  t0: number;
  grabando: boolean;
  siguienteClic: number;
  ultimoSonado: number;
  ultimoBorrado: number;
  ultimoRepetido: number;
  intervalo: number;
  marco: number;
  temporizadores: Set<number>;
  /** Notes the loop itself started and has not released. */
  sonandoBucle: Map<string, Sonando>;
}

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class PanelPad {
  private dialogo: HTMLDialogElement;
  private lienzo: HTMLCanvasElement;
  private selPista: Record<Fuente, HTMLSelectElement>;
  private selModo: HTMLSelectElement;
  private selLongitud: HTMLSelectElement;
  private selCuantizar: HTMLSelectElement;
  private selRepeticion: HTMLSelectElement;
  private chkMetronomo: HTMLInputElement;
  private botonGrabar: HTMLButtonElement;
  private botonReproducir: HTMLButtonElement;
  private estadoEl: HTMLSpanElement;
  private faseEl: HTMLElement;
  private posicionEl: HTMLElement;
  private progresoEl: HTMLElement;
  private rejillaEl: HTMLElement;
  private chuletaEl: HTMLElement;
  private atajosEl: HTMLElement;
  private eventos: EventSource | null = null;
  private listo = false;
  private armado = false;
  private octava: Record<Fuente, number> = { pad: 4, teclas: 4 };
  private pista: Record<Fuente, string> = { pad: "", teclas: "" };
  private mapeo: MapeoPad | null = null;
  private dedos = new Map<number, Dedo>();
  /** Live notes, by key ("pad:<finger>:<note>", "tec:<n>"). */
  private vivas = new Map<string, Sonando>();
  private teclasPulsadas = new Set<number>();
  private repitiendo = new Map<number, Sonando>();
  private mantener = { repetir: false, borrar: false };
  private mapa: MapaTeclas;
  private capturando: Accion | null = null;
  private pidiendoMotor: Promise<OpenDawPlaybackHandle | null> | null = null;
  private bucle: Bucle | null = null;
  private arrancando = false;
  /** `firmaDe` of the project the selects were filled from. */
  private firma = "";

  constructor(private deps: DepsPad) {
    this.mapa = leerMapa(leer(CLAVE_TECLAS));
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho dialogo-pad";
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza">
        <strong>Pad</strong>
        <button class="icon" data-cerrar title="Close">✕</button>
      </div>
      <div class="pad-sin-proyecto" data-sin-proyecto hidden>
        <p>Open or create a project to play with the Pad.</p>
        <div class="dialogo-acciones"><button data-nuevo>New…</button><button data-proyectos>Projects…</button></div>
      </div>
      <div data-contenido>
      <div class="pad-transporte">
        <span class="pad-fase" data-fase>Stopped</span>
        <div class="pad-barra"><div class="pad-progreso" data-progreso></div></div>
        <span class="pad-posicion" data-posicion></span>
      </div>
      <div class="pad-bucle">
        <label>Loop <select data-longitud>
          <option value="1">1 bar</option><option value="2" selected>2 bars</option><option value="4">4 bars</option>
          <option value="8">8 bars</option><option value="16">16 bars</option><option value="0">No loop (one take)</option>
        </select></label>
        <label title="Moves each note to the nearest step as it is recorded">Quantize <select data-cuantizar>
          <option value="0" selected>Off</option><option value="0.5">1/8</option><option value="0.25">1/16</option>
        </select></label>
        <label title="Hold the repeat key and a note: it plays again on every step">Repeat <select data-repeticion>
          <option value="0.5">1/8</option><option value="0.25" selected>1/16</option><option value="0.125">1/32</option>
        </select></label>
        <label><input type="checkbox" data-metronomo checked> Metronome</label>
        <span class="pad-botones">
          <button data-grabar class="pad-grabar">● Record</button>
          <button data-reproducir>▶ Loop</button>
          <button data-deshacer title="Undo the last pass">Undo pass</button>
        </span>
      </div>
      <div class="pad-chuleta" data-chuleta></div>
      <div class="pad-fuentes">
        <section class="pad-fuente">
          <div class="pad-fuente-cabeza">
            <strong>Touchpad</strong>
            <select data-pista="pad"></select>
            <button data-instrumento="pad" class="pad-instrumento"></button>
          </div>
          <p class="pad-aviso" data-aviso="pad" hidden><span></span> <button></button></p>
          <div class="pad-fuente-mandos">
            <label>Mode <select data-modo></select></label>
            <span class="pad-octava">Octave <button data-oct="pad:-1">−</button><span data-octava="pad">4</span><button data-oct="pad:1">+</button></span>
          </div>
          <canvas class="pad-lienzo"></canvas>
        </section>
        <section class="pad-fuente">
          <div class="pad-fuente-cabeza">
            <strong>Keys</strong>
            <select data-pista="teclas"></select>
            <button data-instrumento="teclas" class="pad-instrumento"></button>
          </div>
          <p class="pad-aviso" data-aviso="teclas" hidden><span></span> <button></button></p>
          <div class="pad-fuente-mandos">
            <span class="pad-octava">Octave <button data-oct="teclas:-1">−</button><span data-octava="teclas">4</span><button data-oct="teclas:1">+</button></span>
          </div>
          <div class="pad-rejilla" data-rejilla></div>
        </section>
      </div>
      <details class="pad-atajos">
        <summary>Keys…</summary>
        <div data-atajos></div>
      </details>
      <span class="pad-estado" data-estado>Starting touchpad capture…</span>
      </div>`;
    document.body.append(this.dialogo);
    const q = <T extends Element>(sel: string): T => this.dialogo.querySelector(sel) as T;
    this.lienzo = q("canvas");
    this.selPista = { pad: q('[data-pista="pad"]'), teclas: q('[data-pista="teclas"]') };
    this.selModo = q("[data-modo]");
    this.selLongitud = q("[data-longitud]");
    this.selCuantizar = q("[data-cuantizar]");
    this.selRepeticion = q("[data-repeticion]");
    this.chkMetronomo = q("[data-metronomo]");
    this.botonGrabar = q("[data-grabar]");
    this.botonReproducir = q("[data-reproducir]");
    this.estadoEl = q("[data-estado]");
    this.faseEl = q("[data-fase]");
    this.posicionEl = q("[data-posicion]");
    this.progresoEl = q("[data-progreso]");
    this.rejillaEl = q("[data-rejilla]");
    this.chuletaEl = q("[data-chuleta]");
    this.atajosEl = q("[data-atajos]");
    for (const modo of MODOS_PAD) this.selModo.add(new Option(ETIQUETAS_MODO[modo], modo));

    q<HTMLButtonElement>("[data-cerrar]").addEventListener("click", () => this.cerrar());
    this.dialogo.addEventListener("close", () => this.alCerrar());
    // The panel is not modal (the timeline remains visible), so Esc does not arrive as the dialog's "cancel": it is
    // listened for on the page. With the pad armed it releases it; while the loop runs, it stops it; else it closes.
    document.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape" || !this.dialogo.open) return;
      // A modal opened from the Pad (New, Projects, the instrument picker) takes its own Esc: code review of 9-Nov,
      // Esc in New's name field closed the Pad underneath.
      if (document.querySelector("dialog:modal")) return;
      evento.preventDefault();
      if (this.capturando) {
        this.capturando = null;
        this.pintarAtajos();
      } else if (this.armado) void this.armar(false);
      else if (this.bucle) this.pararBucle();
      else this.cerrar();
    });
    // The keys, before the page's own shortcuts (Delete would remove the selected clip, Space plays).
    window.addEventListener("keydown", (e) => this.alTeclado(e, true), true);
    window.addEventListener("keyup", (e) => this.alTeclado(e, false), true);
    window.addEventListener("blur", () => this.soltarTeclas());

    this.lienzo.addEventListener("pointerdown", () => {
      if (!this.armado) void this.armar(true);
    });
    for (const fuente of ["pad", "teclas"] as const) {
      this.selPista[fuente].addEventListener("change", () => void this.alElegirPista(fuente));
    }
    this.selModo.addEventListener("change", () => {
      this.configurar({ modo: this.selModo.value as ModoPad });
      this.selModo.blur();
    });
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-oct]").forEach((boton) =>
      boton.addEventListener("click", () => {
        const [fuente, paso] = boton.dataset.oct!.split(":") as [Fuente, string];
        this.cambiarOctava(fuente, Number(paso));
      }),
    );
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-instrumento]").forEach((boton) =>
      boton.addEventListener("click", () => {
        const id = this.pista[boton.dataset.instrumento as Fuente];
        if (id) this.deps.elegirInstrumento(id);
      }),
    );
    for (const sel of [this.selLongitud, this.selCuantizar, this.selRepeticion]) sel.addEventListener("change", () => sel.blur());
    q<HTMLButtonElement>("[data-nuevo]").addEventListener("click", () => this.deps.nuevoProyecto());
    q<HTMLButtonElement>("[data-proyectos]").addEventListener("click", () => this.deps.abrirProyectos());
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-aviso] button").forEach((boton) =>
      boton.addEventListener("click", () => {
        const fuente = boton.closest<HTMLElement>("[data-aviso]")!.dataset.aviso as Fuente;
        const como = boton.dataset.como as "quitarMute" | "solo" | undefined;
        if (this.pista[fuente] && como) this.deps.hacerOir(this.pista[fuente], como);
        boton.blur();
      }),
    );
    this.botonGrabar.addEventListener("click", () => this.accion("grabar", true));
    this.botonReproducir.addEventListener("click", () => this.accion("reproducir", true));
    q<HTMLButtonElement>("[data-deshacer]").addEventListener("click", () => this.accion("deshacer", true));
    this.atajosEl.addEventListener("click", (e) => this.alClicAtajos(e));
    this.atajosEl.addEventListener("change", (e) => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-esquema]");
      if (!sel || !(sel.value in ESQUEMAS)) return;
      this.guardarMapa({ ...ESQUEMAS[sel.value as keyof typeof ESQUEMAS] });
      sel.blur();
    });
    this.pintarAtajos();
    this.pintarFase();
  }

  /**
   * With no project the panel still opens, saying so, with New and Projects: before, Pad only wrote a line in the Log
   * and seemed to do nothing.
   */
  abrir(): void {
    this.dialogo.show();
    this.prepararParaProyecto();
  }

  /** Shows what fits: the empty state with no project; with one, the tracks, the touchpad capture and the engine. */
  private prepararParaProyecto(): void {
    const project = this.deps.proyecto();
    this.dialogo.querySelector<HTMLElement>("[data-sin-proyecto]")!.hidden = Boolean(project);
    this.dialogo.querySelector<HTMLElement>("[data-contenido]")!.hidden = !project;
    if (!project) return;
    this.rellenarPistas(project);
    this.ajustarLienzo();
    if (!this.eventos) void this.conectar();
    // The keys sound at once, without waiting for the first note to load the instruments.
    void this.asegurarMotor();
  }

  /**
   * The project has changed. A mute, solo, volume or pan change only repaints the warnings; the tracks, instruments or
   * key are redone only when they changed (code review of 9-Nov: every mix change rebuilt the selects, resized the
   * drawing and released the notes being held). Coming from the empty state, the panel is set up.
   */
  proyectoCambiado(): void {
    if (!this.dialogo.open) return;
    const project = this.deps.proyecto();
    if (!project) return; // the session only has no project at start-up, before any panel can be open
    if (this.dialogo.querySelector<HTMLElement>("[data-contenido]")!.hidden) {
      this.prepararParaProyecto();
      return;
    }
    this.pintarAvisos();
    if (this.bucle) return;
    const firma = this.firmaDe(project);
    if (firma !== this.firma) this.rellenarPistas(project);
    // A change of tracks or instruments unloads the engine: loaded again now, so the next key sounds at once.
    if (!this.deps.motorActual()) void this.asegurarMotor();
  }

  /** What the panel draws from the project: the MIDI tracks with their names and instruments, and the key. */
  private firmaDe(project: Project): string {
    return JSON.stringify([project.key, this.pistasMidi(project).map((t) => [t.id, t.name, t.instrument])]);
  }

  private cerrar(): void {
    if (this.dialogo.open) this.dialogo.close();
  }

  private alCerrar(): void {
    if (this.bucle) this.pararBucle();
    void this.armar(false);
    this.soltarTodo();
    this.eventos?.close();
    this.eventos = null;
    this.listo = false;
    void fetch("/api/pad/orden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden: "parar" }),
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ tracks

  private pistasMidi(project: Project): Track[] {
    return project.tracks.filter((track) => track.kind === "midi");
  }

  private pistaDe(fuente: Fuente): Track | null {
    return this.deps.proyecto()?.tracks.find((t) => t.id === this.pista[fuente]) ?? null;
  }

  private esBateria(track: Track | null): boolean {
    return track?.instrument.type === "drumkit";
  }

  private rellenarPistas(project: Project): void {
    this.firma = this.firmaDe(project);
    const midi = this.pistasMidi(project);
    for (const fuente of ["pad", "teclas"] as const) {
      const sel = this.selPista[fuente];
      sel.replaceChildren();
      for (const track of midi) sel.add(new Option(track.name, track.id));
      sel.add(new Option("+ New track", NUEVA));
      sel.add(new Option("+ New drum track", NUEVA_BATERIA));
      // Kept if it still exists; else, a first guess: the keys on a drum track, the touchpad on another.
      if (!midi.some((t) => t.id === this.pista[fuente])) {
        const bateria = midi.find((t) => this.esBateria(t));
        const otra = midi.find((t) => !this.esBateria(t));
        this.pista[fuente] = (fuente === "teclas" ? (bateria ?? otra) : (otra ?? bateria))?.id ?? "";
      }
      // With no track yet (a new project), a placeholder: else "+ New track" would show as chosen and picking it
      // would not fire a change.
      if (!this.pista[fuente]) {
        const ninguna = new Option("Choose a track…", "");
        ninguna.disabled = true;
        sel.prepend(ninguna);
      }
      sel.value = this.pista[fuente];
      const track = this.pistaDe(fuente);
      const boton = this.dialogo.querySelector<HTMLButtonElement>(`[data-instrumento="${fuente}"]`)!;
      boton.textContent = track ? `${etiquetaInstrumento(track.instrument)} ▾` : "";
      boton.hidden = !track;
      boton.title = "Change the instrument of this track";
    }
    this.alCambiarPistaPad();
    this.pintarRejilla();
    this.pintarAvisos();
  }

  /**
   * A track that cannot be heard says so, with the way out. Seen 8-Nov: every MIDI track muted and an audio track on
   * Solo, and both sources played into silence without a word (BUGS 29). Adding the track to Solo, instead of clearing
   * it, keeps whatever was being listened to.
   */
  private pintarAvisos(): void {
    const project = this.deps.proyecto();
    for (const fuente of ["pad", "teclas"] as const) {
      const aviso = this.dialogo.querySelector<HTMLElement>(`[data-aviso="${fuente}"]`)!;
      const texto = aviso.querySelector("span")!;
      const boton = aviso.querySelector("button")!;
      const track = this.pistaDe(fuente);
      const enSolo = project?.tracks.filter((t) => t.solo) ?? [];
      boton.hidden = false;
      // Bug 37 (10-Nov): with no track chosen both sources played into silence; only the keys said so, in the
      // status line, and it went unseen.
      if (!track) {
        texto.textContent = `No track chosen: pick one to hear the ${fuente === "pad" ? "touchpad" : "keys"}.`;
        boton.hidden = true;
      } else if (track.muted) {
        texto.textContent = "This track is muted: you will not hear it.";
        boton.textContent = "Unmute";
        boton.dataset.como = "quitarMute";
      } else if (track && enSolo.length > 0 && !track.solo) {
        const nombres = enSolo.map((t) => `“${t.name}”`).join(", ");
        texto.textContent = `${nombres} ${enSolo.length > 1 ? "are" : "is"} on Solo: you will not hear this track.`;
        boton.textContent = "Solo this track too";
        boton.dataset.como = "solo";
      } else {
        aviso.hidden = true;
        continue;
      }
      aviso.hidden = false;
    }
  }

  private async alElegirPista(fuente: Fuente): Promise<void> {
    const sel = this.selPista[fuente];
    sel.blur();
    if (this.bucle) {
      // A track changed in the middle of a loop would split what is being recorded: not while it runs.
      sel.value = this.pista[fuente];
      this.estado("Stop the loop to change tracks.");
      return;
    }
    if (sel.value === NUEVA || sel.value === NUEVA_BATERIA) {
      const bateria = sel.value === NUEVA_BATERIA;
      // Opening the panel starts loading the engine, and the app takes no changes while it loads: seen headless on a
      // new project, the track was not created. So it waits for the load first.
      if (this.pidiendoMotor) {
        this.estado("Getting the instruments ready…");
        await this.pidiendoMotor.catch(() => null);
      }
      const id = this.deps.nuevaPista(bateria);
      if (id) this.pista[fuente] = id;
      else this.estado("The track could not be created now; try again.");
    } else this.pista[fuente] = sel.value;
    this.soltarTodo();
    const project = this.deps.proyecto();
    if (project) this.rellenarPistas(project);
  }

  private alCambiarPistaPad(): void {
    const project = this.deps.proyecto();
    if (!project) return;
    const track = this.pistaDe("pad");
    // A drumkit is played with pads; everything else, with keys or sliding.
    if (this.esBateria(track)) this.selModo.value = "pads";
    else if (this.selModo.value === "pads" || this.selModo.value === "") this.selModo.value = "teclas";
    this.soltarPad();
    this.mapeo = new MapeoPad({ modo: this.selModo.value as ModoPad, key: project.key, octava: this.octava.pad });
    this.dibujar();
  }

  private configurar(cambios: { modo?: ModoPad; octava?: number }): void {
    if (!this.mapeo) return;
    for (const nota of this.mapeo.configurar(cambios)) this.alNotaPad(nota);
    this.dibujar();
  }

  private cambiarOctava(fuente: Fuente, paso: number): void {
    this.octava[fuente] = Math.min(7, Math.max(1, this.octava[fuente] + paso));
    this.dialogo.querySelector(`[data-octava="${fuente}"]`)!.textContent = String(this.octava[fuente]);
    if (fuente === "pad") this.configurar({ octava: this.octava.pad });
    else this.pintarRejilla();
  }

  // ------------------------------------------------------------ touchpad capture

  private async conectar(): Promise<void> {
    this.eventos?.close();
    this.eventos = new EventSource("/api/pad/eventos");
    this.eventos.onmessage = (mensaje) => this.alEvento(mensaje.data as string);
    try {
      const res = await fetch("/api/pad/orden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: "arrancar" }),
      });
      const datos = (await res.json()) as { error?: string; enMarcha?: boolean };
      if (!res.ok) {
        this.estado(`The touchpad cannot be used (${datos.error ?? res.status}); the keys still play.`);
        return;
      }
      if (datos.enMarcha) this.estado("Tap the touchpad drawing to play it · Esc releases the mouse");
    } catch (error) {
      this.estado(`The touchpad cannot be used (${error instanceof Error ? error.message : String(error)}); the keys still play.`);
    }
  }

  private alEvento(linea: string): void {
    let datos: { e?: "down" | "move" | "up"; id?: number; x?: number; y?: number; listo?: boolean; error?: string; fin?: number; desarmado?: boolean };
    try {
      datos = JSON.parse(linea) as typeof datos;
    } catch {
      return;
    }
    if (datos.listo) {
      this.listo = true;
      this.estado("Tap the touchpad drawing to play it · Esc releases the mouse");
      this.dibujar();
      return;
    }
    if (datos.error) {
      this.estado(`Touchpad: ${datos.error}`);
      return;
    }
    if (datos.fin !== undefined) {
      this.listo = false;
      this.armado = false;
      this.soltarPad();
      if (this.dialogo.open && !datos.error) this.estado("The touchpad capture has stopped; the keys still play.");
      return;
    }
    if (datos.desarmado) {
      this.armado = false;
      this.soltarPad();
      this.estado("Touchpad released (Ctrl+Alt+T). Tap its drawing to play again.");
      return;
    }
    if (!datos.e || datos.id === undefined || !this.mapeo || !this.armado) return;
    const x = datos.x ?? 0;
    const y = datos.y ?? 0;
    if (datos.e === "up") this.dedos.delete(datos.id);
    else this.dedos.set(datos.id, { x, y });
    for (const nota of this.mapeo.dedo(datos.e, datos.id, x, y)) this.alNotaPad(nota);
    this.dibujar();
  }

  private async armar(activo: boolean): Promise<void> {
    if (activo && !this.listo) return;
    this.armado = activo;
    if (!activo) this.soltarPad();
    this.dialogo.classList.toggle("armado", activo);
    this.estado(
      activo
        ? `Touchpad playing ${this.pistaDe("pad")?.name ?? ""} · Esc releases the mouse`
        : "Tap the touchpad drawing to play it · Esc releases the mouse",
    );
    this.dibujar();
    if (activo) void this.asegurarMotor();
    await fetch("/api/pad/orden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden: activo ? "armar" : "desarmar" }),
    }).catch(() => {});
  }

  private alNotaPad(nota: NotaPad): void {
    const clave = `pad:${nota.dedo}:${nota.nota}`;
    if (nota.accion === "on") this.tocar(clave, this.pista.pad, nota.nota, nota.velocidad);
    else this.callar(clave);
  }

  // ------------------------------------------------------------------- keys

  private alTeclado(e: KeyboardEvent, abajo: boolean): void {
    if (!this.dialogo.open) return;
    if (this.capturando) {
      if (!abajo || e.key === "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.guardarMapa(asignarTecla(this.mapa, this.capturando, e.code));
      this.capturando = null;
      this.pintarAtajos();
      return;
    }
    const destino = e.target as HTMLElement | null;
    if (destino && (destino.tagName === "TEXTAREA" || (destino.tagName === "INPUT" && (destino as HTMLInputElement).type !== "checkbox"))) return;
    if (destino?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // With no project nothing can play: the page keeps its own shortcuts.
    if (!this.deps.proyecto()) return;
    const accion = accionDeTecla(this.mapa, e.code);
    if (!accion) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (abajo && e.repeat) return;
    this.accion(accion, abajo);
  }

  private accion(accion: Accion, abajo: boolean): void {
    if (accion.startsWith("nota")) {
      const n = Number(accion.slice(4));
      if (abajo) this.pulsarTecla(n);
      else this.soltarTecla(n);
      return;
    }
    if (accion === "repetir" || accion === "borrar") {
      this.mantener[accion] = abajo;
      if (accion === "borrar" && this.bucle) this.bucle.ultimoBorrado = this.beatAhora();
      this.pintarFase();
      return;
    }
    if (!abajo) return;
    if (accion === "grabar") void this.grabar();
    else if (accion === "reproducir") {
      if (this.bucle) this.pararBucle();
      else void this.empezarBucle(false);
    } else if (accion === "deshacer") this.deshacerPasada();
    else if (accion === "octavaMenos") this.cambiarOctava("teclas", -1);
    else if (accion === "octavaMas") this.cambiarOctava("teclas", 1);
    else if (accion === "metronomo") {
      this.chkMetronomo.checked = !this.chkMetronomo.checked;
      this.estado(`Metronome ${this.chkMetronomo.checked ? "on" : "off"}.`);
    }
  }

  private notasTeclas(): { nota: number; etiqueta: string }[] {
    const project = this.deps.proyecto();
    if (!project) return [];
    return notasDelTeclado(this.esBateria(this.pistaDe("teclas")), project.key, this.octava.teclas);
  }

  private pulsarTecla(n: number): void {
    const destino = this.notasTeclas()[n - 1];
    const pista = this.pista.teclas;
    if (!destino || !pista) {
      if (!pista) this.estado("Pick a track for the keys.");
      return;
    }
    this.teclasPulsadas.add(n);
    if (this.mantener.repetir && this.bucle) {
      // Note repeat: the loop's scheduler plays it on every step while it is held.
      this.repitiendo.set(n, { pista, pitch: destino.nota });
      this.bucle.ultimoRepetido = Math.max(this.bucle.ultimoRepetido, this.beatAhora());
    } else this.tocar(`tec:${n}`, pista, destino.nota, VELOCIDAD_TECLA);
    this.pintarRejilla();
  }

  private soltarTecla(n: number): void {
    this.teclasPulsadas.delete(n);
    this.repitiendo.delete(n);
    this.callar(`tec:${n}`);
    this.pintarRejilla();
  }

  private soltarTeclas(): void {
    for (const n of [...this.teclasPulsadas]) this.soltarTecla(n);
    this.mantener = { repetir: false, borrar: false };
  }

  // ------------------------------------------------------------- live notes

  private tocar(clave: string, pista: string, pitch: number, velocidad: number): void {
    this.callar(clave);
    this.vivas.set(clave, { pista, pitch });
    // Erase held: the note is not heard; it marks what the loop removes as it goes by.
    if (this.mantener.borrar && this.bucle) return;
    this.enviar(pista, pitch, velocidad);
    const b = this.bucle;
    if (b?.grabando) b.capas.pulsar(pista, clave, pitch, velocidad, this.beatAhora());
  }

  private callar(clave: string): void {
    const viva = this.vivas.get(clave);
    if (!viva) return;
    this.vivas.delete(clave);
    this.enviar(viva.pista, viva.pitch, 0);
    this.bucle?.capas.soltar(clave, this.beatAhora());
  }

  private enviar(pista: string, pitch: number, velocidad: number): void {
    const motor = this.deps.motorActual();
    try {
      if (motor) motor.nota(pista, pitch, velocidad);
      else if (velocidad > 0) void this.asegurarMotor();
    } catch {
      /* the engine was unloading: the next note requests it again */
    }
  }

  private soltarPad(): void {
    if (this.mapeo) for (const nota of this.mapeo.soltarTodo()) this.alNotaPad(nota);
    this.dedos.clear();
    this.dibujar();
  }

  private soltarTodo(): void {
    this.soltarPad();
    this.soltarTeclas();
    for (const clave of [...this.vivas.keys()]) this.callar(clave);
    this.pintarRejilla();
  }

  private asegurarMotor(): Promise<OpenDawPlaybackHandle | null> {
    const actual = this.deps.motorActual();
    if (actual) return Promise.resolve(actual);
    this.pidiendoMotor ??= this.deps.motor().finally(() => {
      this.pidiendoMotor = null;
    });
    return this.pidiendoMotor;
  }

  // ------------------------------------------------------------------ the loop

  /** Beats since the loop's first downbeat (negative during the count-in); 0 with no loop. */
  private beatAhora(): number {
    const b = this.bucle;
    if (!b) return 0;
    return (b.ctx.currentTime - b.t0) / b.spb;
  }

  /** Record: from stopped, count-in and record; while the loop plays, punch in or out. */
  private async grabar(): Promise<void> {
    const b = this.bucle;
    if (!b) {
      await this.empezarBucle(true);
      return;
    }
    const ahora = this.beatAhora();
    if (b.grabando) {
      b.capas.soltarTodo(ahora);
      b.grabando = false;
    } else {
      b.grabando = true;
      // Notes already held start counting from here.
      for (const [clave, viva] of this.vivas) b.capas.pulsar(viva.pista, clave, viva.pitch, VELOCIDAD_TECLA, ahora);
    }
    this.pintarFase();
  }

  private async empezarBucle(grabando: boolean): Promise<void> {
    if (this.bucle || this.arrancando) return;
    const project = this.deps.proyecto();
    if (!project) return;
    if (!this.pista.pad && !this.pista.teclas) {
      this.estado("Pick a track for the touchpad or the keys.");
      return;
    }
    this.arrancando = true;
    this.pintarFase();
    try {
      const motor = await this.asegurarMotor();
      if (!motor) {
        this.estado("Could not start the sound engine.");
        return;
      }
      const porCompas = beatsPerBar(project);
      const compases = Number(this.selLongitud.value);
      const longitud = compases > 0 ? compases * porCompas : Infinity;
      // From the start of the bar where the cursor is.
      const inicioBeat = Math.floor(this.deps.cursor() / porCompas) * porCompas;
      const spb = segundosPorTiempo(project.bpm);
      const ahora = motor.context.currentTime + 0.1;
      // Recording: one bar of count-in. Only listening: straight in.
      const cuenta = grabando ? porCompas : 0;
      const t0 = ahora + cuenta * spb;
      this.bucle = {
        capas: new CapasBucle(longitud, Number(this.selCuantizar.value)),
        motor,
        ctx: motor.context,
        inicioBeat,
        porCompas,
        spb,
        t0,
        grabando,
        siguienteClic: -cuenta,
        ultimoSonado: -cuenta,
        ultimoBorrado: 0,
        ultimoRepetido: 0,
        intervalo: 0,
        marco: 0,
        temporizadores: new Set(),
        sonandoBucle: new Map(),
      };
      motor.bucle(Number.isFinite(longitud) ? inicioBeat : null, inicioBeat + longitud);
      motor.seek(inicioBeat);
      this.programar(0, () => {
        if (this.bucle && this.deps.motorActual() === motor) void motor.play();
      }, 20);
      this.bucle.intervalo = window.setInterval(() => this.tic(), 10);
      this.tic();
      const seguir = (): void => {
        if (!this.bucle) return;
        this.pintarPosicion();
        this.bucle.marco = requestAnimationFrame(seguir);
      };
      this.bucle.marco = requestAnimationFrame(seguir);
      this.selLongitud.disabled = this.selCuantizar.disabled = true;
      this.pintarFase();
    } finally {
      this.arrancando = false;
      this.pintarFase();
    }
  }

  /** Runs `fn` when the loop reaches `beat` (`antes` ms early: the engine's own start is not immediate). */
  private programar(beat: number, fn: () => void, antes = 0): void {
    const b = this.bucle;
    if (!b) return;
    const espera = Math.max(0, (b.t0 + beat * b.spb - b.ctx.currentTime) * 1000 - antes);
    const id = window.setTimeout(() => {
      b.temporizadores.delete(id);
      fn();
    }, espera);
    b.temporizadores.add(id);
  }

  /** The loop's scheduler: metronome, the layers, erase and note repeat, a little ahead of time. */
  private tic(): void {
    const b = this.bucle;
    if (!b) return;
    if (this.deps.motorActual() !== b.motor) {
      // The engine was reloaded under the loop (a change to the project): what was recorded is kept.
      this.pararBucle("The engine was reloaded, so the loop stopped.");
      return;
    }
    const ahora = this.beatAhora();
    const delante = ahora + ANTICIPO_S / b.spb;
    while (b.siguienteClic <= delante) {
      const k = b.siguienteClic;
      if (k < 0 || this.chkMetronomo.checked) {
        const cuando = b.t0 + k * b.spb;
        if (cuando >= b.ctx.currentTime - 0.01) clic(b.ctx, cuando, ((k % b.porCompas) + b.porCompas) % b.porCompas === 0);
      }
      b.siguienteClic += 1;
    }
    if (delante > b.ultimoSonado) {
      for (const ev of b.capas.sonarEntre(b.ultimoSonado, delante)) {
        this.programar(ev.beat, () => {
          const clave = `${ev.pista}:${ev.pitch}`;
          if (ev.velocidad > 0) b.sonandoBucle.set(clave, { pista: ev.pista, pitch: ev.pitch });
          else b.sonandoBucle.delete(clave);
          this.enviar(ev.pista, ev.pitch, ev.velocidad);
        });
      }
      b.ultimoSonado = delante;
    }
    if (this.mantener.borrar && ahora > b.ultimoBorrado) {
      let borradas = 0;
      for (const viva of this.vivas.values()) borradas += b.capas.borrar(viva.pista, viva.pitch, b.ultimoBorrado, ahora);
      b.ultimoBorrado = ahora;
      if (borradas > 0) this.pintarPosicion();
    }
    if (this.repitiendo.size > 0 && ahora >= 0) {
      const paso = Number(this.selRepeticion.value);
      const desde = Math.max(b.ultimoRepetido, ahora - paso / 2);
      for (const beat of pasosDeRepeticion(desde, delante, paso)) {
        for (const { pista, pitch } of this.repitiendo.values()) {
          this.programar(beat, () => this.enviar(pista, pitch, VELOCIDAD_TECLA));
          this.programar(beat + paso / 2, () => this.enviar(pista, pitch, 0));
          if (b.grabando) b.capas.anotar(pista, pitch, VELOCIDAD_TECLA, beat, beat + paso / 2);
        }
      }
      b.ultimoRepetido = Math.max(b.ultimoRepetido, delante);
    }
  }

  private deshacerPasada(): void {
    const b = this.bucle;
    if (!b) {
      this.estado("Undo pass works while the loop plays; after it, Ctrl+Z removes the whole clip.");
      return;
    }
    const n = b.capas.deshacer();
    // What the loop had started of that layer is released.
    for (const s of b.sonandoBucle.values()) this.enviar(s.pista, s.pitch, 0);
    b.sonandoBucle.clear();
    this.estado(n > 0 ? `Undid the last pass (${n} notes).` : "Nothing to undo.");
    this.pintarPosicion();
  }

  private pararBucle(motivo?: string): void {
    const b = this.bucle;
    if (!b) return;
    const fin = this.beatAhora();
    for (const clave of [...this.vivas.keys()]) this.callar(clave);
    b.capas.soltarTodo(fin);
    this.bucle = null;
    window.clearInterval(b.intervalo);
    cancelAnimationFrame(b.marco);
    for (const id of b.temporizadores) window.clearTimeout(id);
    for (const s of b.sonandoBucle.values()) this.enviar(s.pista, s.pitch, 0);
    this.repitiendo.clear();
    try {
      b.motor.bucle(null);
    } catch {
      /* the engine was already gone */
    }
    this.deps.parar();
    this.selLongitud.disabled = this.selCuantizar.disabled = false;
    this.pintarFase();
    this.pintarPosicion();
    if (b.capas.vacia) {
      this.estado(motivo ?? "Stopped. Nothing was recorded.");
      return;
    }
    const porPista = b.capas.pistas().map((trackId) => ({ trackId, notas: b.capas.notasDe(trackId) }));
    this.deps.guardarBucle(b.inicioBeat, Number.isFinite(b.capas.longitud) ? b.capas.longitud : null, porPista);
    const nombres = porPista.map((p) => this.deps.proyecto()?.tracks.find((t) => t.id === p.trackId)?.name ?? p.trackId);
    this.estado(`${motivo ? `${motivo} ` : ""}Saved ${b.capas.total} notes in ${b.capas.capas} pass(es) into ${nombres.join(" and ")}. Ctrl+Z removes them.`);
  }

  // ----------------------------------------------------------------- drawing

  private estado(texto: string): void {
    this.estadoEl.textContent = texto;
  }

  private pintarFase(): void {
    const b = this.bucle;
    let fase = "Stopped";
    let clase = "";
    if (this.arrancando) fase = "Starting…";
    else if (b) {
      const ahora = this.beatAhora();
      if (ahora < 0) {
        fase = "Count-in";
        clase = "cuenta";
      } else if (b.grabando) {
        fase = "Recording";
        clase = "grabando";
      } else {
        fase = "Loop · listening";
        clase = "sonando";
      }
      if (this.mantener.borrar) fase += " · ERASE";
      else if (this.mantener.repetir) fase += " · repeat";
    }
    this.faseEl.textContent = fase;
    this.faseEl.className = `pad-fase ${clase}`;
    this.botonGrabar.textContent = b?.grabando ? "■ Stop recording" : "● Record";
    this.botonGrabar.classList.toggle("grabando", Boolean(b?.grabando));
    this.botonReproducir.textContent = b ? "■ Stop loop" : "▶ Loop";
  }

  private pintarPosicion(): void {
    const b = this.bucle;
    if (!b) {
      this.progresoEl.style.width = "0%";
      this.posicionEl.textContent = "";
      return;
    }
    const ahora = this.beatAhora();
    this.pintarFase();
    if (ahora < 0) {
      const falta = Math.ceil(-ahora);
      this.posicionEl.textContent = `in ${falta}…`;
      this.progresoEl.style.width = "0%";
      return;
    }
    const longitud = b.capas.longitud;
    const pos = b.capas.posicionEn(ahora);
    const compas = Math.floor(pos / b.porCompas) + 1;
    const tiempo = Math.floor(pos % b.porCompas) + 1;
    const total = Number.isFinite(longitud) ? `/${longitud / b.porCompas}` : "";
    const pasada = Number.isFinite(longitud) ? ` · pass ${b.capas.pasadaEn(ahora) + 1}` : "";
    this.posicionEl.textContent = `bar ${compas}${total}.${tiempo}${pasada} · ${b.capas.capas} layer(s), ${b.capas.total} notes`;
    this.progresoEl.style.width = Number.isFinite(longitud) ? `${(pos / longitud) * 100}%` : "100%";
    this.deps.dibujar(b.inicioBeat + pos);
  }

  private pintarRejilla(): void {
    const notas = this.notasTeclas();
    const track = this.pistaDe("teclas");
    this.rejillaEl.innerHTML = FILAS_TECLADO.flat()
      .map((n) => {
        const nota = notas[n - 1];
        const tecla = nombreTecla(this.mapa[`nota${n}` as Accion]);
        const activa = this.teclasPulsadas.has(n) ? " activa" : "";
        return `<div class="pad-tecla${activa}"><span class="pad-tecla-nota">${esc(nota?.etiqueta ?? "")}</span><kbd>${esc(tecla)}</kbd></div>`;
      })
      .join("");
    this.rejillaEl.classList.toggle("sin-pista", !track);
  }

  private pintarAtajos(): void {
    const esquema = esquemaDe(this.mapa);
    const opciones = (Object.keys(ESQUEMAS) as (keyof typeof ESQUEMAS)[])
      .map((n) => `<option value="${n}"${esquema === n ? " selected" : ""}>${NOMBRE_ESQUEMA[n]}</option>`)
      .join("");
    const filas = ACCIONES.map((a) => {
      const texto = this.capturando === a ? "press a key…" : nombreTecla(this.mapa[a]);
      return `<tr><td>${esc(NOMBRE_ACCION[a])}</td><td><button data-tecla="${a}" class="${this.capturando === a ? "capturando" : ""}">${esc(texto)}</button></td></tr>`;
    }).join("");
    this.atajosEl.innerHTML = `
      <p class="ace-nota">Click a key, then press the one you want (Esc cancels). Saved in this browser.</p>
      <label>Preset <select data-esquema>${esquema ? "" : '<option value="">Custom</option>'}${opciones}</select></label>
      <table class="pad-tabla-teclas">${filas}</table>`;
    const k = (a: Accion): string => `<kbd>${esc(nombreTecla(this.mapa[a]))}</kbd>`;
    this.chuletaEl.innerHTML = [
      `${k("grabar")} record`,
      `${k("reproducir")} loop on/off`,
      `${k("deshacer")} undo pass`,
      `${k("octavaMenos")} ${k("octavaMas")} octave`,
      `${k("metronomo")} metronome`,
      `hold ${k("repetir")} repeat`,
      `hold ${k("borrar")} erase`,
      "<kbd>Esc</kbd> release / stop",
    ].join(" · ");
    this.pintarRejilla();
  }

  private alClicAtajos(e: Event): void {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tecla]");
    if (!boton) return;
    this.capturando = boton.dataset.tecla as Accion;
    boton.blur();
    this.pintarAtajos();
  }

  private guardarMapa(mapa: MapaTeclas): void {
    this.mapa = mapa;
    try {
      localStorage.setItem(CLAVE_TECLAS, JSON.stringify(mapa));
    } catch {
      /* no storage: the keys last until the page reloads */
    }
    this.pintarAtajos();
  }

  private ajustarLienzo(): void {
    const ancho = Math.max(260, this.lienzo.clientWidth || 420);
    const escala = window.devicePixelRatio || 1;
    this.lienzo.width = Math.round(ancho * escala);
    this.lienzo.height = Math.round(ancho * PROPORCION * escala);
    this.lienzo.style.height = `${Math.round(ancho * PROPORCION)}px`;
    this.dibujar();
  }

  private dibujar(): void {
    const ctx = this.lienzo.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.lienzo;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.armado ? "#161a24" : "#111319";
    ctx.fillRect(0, 0, w, h);
    const zonas = this.mapeo?.zonas() ?? [];
    const escala = window.devicePixelRatio || 1;
    const sonando = new Set([...this.vivas.entries()].filter(([c]) => c.startsWith("pad:")).map(([, v]) => v.pitch));
    ctx.font = `${11 * escala}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const zona of zonas) {
      const x = zona.x0 * w;
      const y = zona.y0 * h;
      const zw = (zona.x1 - zona.x0) * w;
      const zh = (zona.y1 - zona.y0) * h;
      ctx.fillStyle = sonando.has(zona.nota) ? "#ff5f6d55" : "transparent";
      ctx.fillRect(x, y, zw, zh);
      ctx.strokeStyle = "#232733";
      ctx.strokeRect(x + 0.5, y + 0.5, zw - 1, zh - 1);
      ctx.fillStyle = "#7d8394";
      ctx.fillText(zona.etiqueta, x + zw / 2, y + zh - 8 * escala);
    }
    for (const dedo of this.dedos.values()) {
      ctx.beginPath();
      ctx.arc(dedo.x * w, dedo.y * h, 12 * escala, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5f6dcc";
      ctx.fill();
    }
    if (!this.armado) {
      ctx.fillStyle = "#d7dae3aa";
      ctx.font = `${14 * escala}px system-ui, sans-serif`;
      ctx.fillText(this.listo ? "Tap here to play with the touchpad" : "…", w / 2, h / 2);
    }
  }
}

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

/** A metronome click: higher on the first beat. */
function clic(ctx: AudioContext, cuando: number, fuerte: boolean): void {
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.frequency.value = fuerte ? 1760 : 1175;
  gan.gain.setValueAtTime(0.0001, cuando);
  gan.gain.exponentialRampToValueAtTime(fuerte ? 0.35 : 0.2, cuando + 0.002);
  gan.gain.exponentialRampToValueAtTime(0.0001, cuando + 0.06);
  osc.connect(gan).connect(ctx.destination);
  osc.start(cuando);
  osc.stop(cuando + 0.08);
}
