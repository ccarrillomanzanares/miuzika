/**
 * "Pad" panel: play the laptop touchpad as an instrument.
 *
 * Native capture is started by the server (server/api/pad.ts) and arrives over SSE;
 * the mapping to notes is `src/core/pad.ts`; the sound is the chosen track's
 * instrument in the openDAW engine (noteSignal), and what is recorded enters the
 * project as a normal clip (undoable with Ctrl+Z).
 *
 * Arm and release: with the pad armed, the cursor freezes while a finger is resting
 * (otherwise touching drags the pointer away). It is armed by pressing on the pad
 * drawing and released with Esc (or Ctrl+Alt+T if the page does not respond).
 */

import type { Note, Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { GrabadorPad, MapeoPad, MODOS_PAD, type ModoPad, type NotaPad } from "../../src/core/pad.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";

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
  /** Puts what was recorded in as a clip of the track (with history). */
  guardarClip(trackId: string, startBeat: number, notas: Note[]): void;
  avisar(texto: string): void;
  /** Moves the timeline playhead during recording. */
  dibujar(beat: number): void;
}

const ETIQUETAS_MODO: Record<ModoPad, string> = { teclas: "Keys", pads: "Pads", deslizar: "Slide" };
/** ELAN0712 ratio (3520 × 1784). */
const PROPORCION = 1784 / 3520;

interface Dedo {
  x: number;
  y: number;
}

export class PanelPad {
  private dialogo: HTMLDialogElement;
  private lienzo: HTMLCanvasElement;
  private selPista: HTMLSelectElement;
  private selModo: HTMLSelectElement;
  private octavaEl: HTMLSpanElement;
  private botonGrabar: HTMLButtonElement;
  private estadoEl: HTMLSpanElement;
  private eventos: EventSource | null = null;
  private listo = false;
  private armado = false;
  private octava = 4;
  private mapeo: MapeoPad | null = null;
  private dedos = new Map<number, Dedo>();
  private sonando = new Set<number>();
  private pidiendoMotor: Promise<OpenDawPlaybackHandle | null> | null = null;
  private grabacion: {
    grabador: GrabadorPad;
    trackId: string;
    ctx: AudioContext;
    inicioBeat: number;
    /** Context time at which the transport starts (after the count-in). */
    t0: number;
    bpm: number;
    clic: number;
    marco: number;
  } | null = null;

  constructor(private deps: DepsPad) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho dialogo-pad";
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza">
        <strong>Pad</strong>
        <button class="icon" data-cerrar title="Close">✕</button>
      </div>
      <div class="pad-mandos">
        <label>Track <select data-pista></select></label>
        <label>Mode <select data-modo></select></label>
        <span class="pad-octava">Octave <button data-oct="-1">−</button><span data-octava>4</span><button data-oct="1">+</button></span>
        <button data-grabar class="pad-grabar">● Record</button>
      </div>
      <canvas class="pad-lienzo"></canvas>
      <span class="pad-estado" data-estado>Starting touchpad capture…</span>`;
    document.body.append(this.dialogo);
    const q = <T extends Element>(sel: string): T => this.dialogo.querySelector(sel) as T;
    this.lienzo = q("canvas");
    this.selPista = q("[data-pista]");
    this.selModo = q("[data-modo]");
    this.octavaEl = q("[data-octava]");
    this.botonGrabar = q("[data-grabar]");
    this.estadoEl = q("[data-estado]");
    for (const modo of MODOS_PAD) this.selModo.add(new Option(ETIQUETAS_MODO[modo], modo));

    q<HTMLButtonElement>("[data-cerrar]").addEventListener("click", () => this.cerrar());
    this.dialogo.addEventListener("close", () => this.alCerrar());
    // The panel is not modal (the timeline remains visible), so Esc does not arrive as
    // the dialog's "cancel": it is listened for on the page. With the pad armed it releases
    // it; without arming, it closes the panel.
    document.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape" || !this.dialogo.open) return;
      evento.preventDefault();
      if (this.armado) void this.armar(false);
      else this.cerrar();
    });
    this.lienzo.addEventListener("pointerdown", () => {
      if (!this.armado) void this.armar(true);
    });
    this.selPista.addEventListener("change", () => this.alCambiarPista());
    this.selModo.addEventListener("change", () => this.configurar({ modo: this.selModo.value as ModoPad }));
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-oct]").forEach((boton) =>
      boton.addEventListener("click", () => {
        this.octava = Math.min(7, Math.max(1, this.octava + Number(boton.dataset.oct)));
        this.octavaEl.textContent = String(this.octava);
        this.configurar({ octava: this.octava });
      }),
    );
    this.botonGrabar.addEventListener("click", () => {
      if (this.grabacion) void this.pararGrabacion();
      else void this.empezarGrabacion();
    });
  }

  abrir(): void {
    const project = this.deps.proyecto();
    if (!project) {
      this.deps.avisar("Open or create a project to play with the pad.");
      return;
    }
    this.rellenarPistas(project);
    this.dialogo.show();
    this.ajustarLienzo();
    void this.conectar();
  }

  /** The project has changed (another track, another key): the mapping is redone. */
  proyectoCambiado(): void {
    if (!this.dialogo.open) return;
    const project = this.deps.proyecto();
    if (!project) {
      this.cerrar();
      return;
    }
    if (!this.grabacion) this.rellenarPistas(project);
  }

  private cerrar(): void {
    if (this.dialogo.open) this.dialogo.close();
  }

  private alCerrar(): void {
    if (this.grabacion) void this.pararGrabacion();
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

  private pistasMidi(project: Project): Track[] {
    return project.tracks.filter((track) => track.kind === "midi");
  }

  private rellenarPistas(project: Project): void {
    const anterior = this.selPista.value;
    this.selPista.replaceChildren();
    for (const track of this.pistasMidi(project)) this.selPista.add(new Option(track.name, track.id));
    if (this.selPista.options.length === 0) this.selPista.add(new Option("(no MIDI tracks)", ""));
    if ([...this.selPista.options].some((o) => o.value === anterior)) this.selPista.value = anterior;
    this.alCambiarPista();
  }

  private pista(): Track | null {
    const project = this.deps.proyecto();
    return project?.tracks.find((track) => track.id === this.selPista.value) ?? null;
  }

  private alCambiarPista(): void {
    const track = this.pista();
    const project = this.deps.proyecto();
    if (!project) return;
    // A drumkit is played with pads; everything else, with keys or sliding.
    if (track?.instrument.type === "drumkit") this.selModo.value = "pads";
    else if (this.selModo.value === "pads" || this.selModo.value === "") this.selModo.value = "teclas";
    this.soltarTodo();
    this.mapeo = new MapeoPad({ modo: this.selModo.value as ModoPad, key: project.key, octava: this.octava });
    this.dibujar();
  }

  private configurar(cambios: { modo?: ModoPad; octava?: number }): void {
    if (!this.mapeo) return;
    for (const nota of this.mapeo.configurar(cambios)) this.sonar(nota);
    this.dibujar();
  }

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
        this.estado(`The pad cannot be used: ${datos.error ?? res.status}`);
        return;
      }
      if (datos.enMarcha) this.estado("Tap the pad below to play · Esc releases the mouse");
    } catch (error) {
      this.estado(`The pad cannot be used: ${error instanceof Error ? error.message : String(error)}`);
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
      this.estado("Tap the pad below to play · Esc releases the mouse");
      return;
    }
    if (datos.error) {
      this.estado(`Pad: ${datos.error}`);
      return;
    }
    if (datos.fin !== undefined) {
      this.listo = false;
      this.armado = false;
      this.soltarTodo();
      if (this.dialogo.open && !datos.error) this.estado("The pad capture has stopped.");
      return;
    }
    if (datos.desarmado) {
      this.armado = false;
      this.soltarTodo();
      this.estado("Pad released (Ctrl+Alt+T). Tap the pad to play again.");
      return;
    }
    if (!datos.e || datos.id === undefined || !this.mapeo || !this.armado) return;
    const x = datos.x ?? 0;
    const y = datos.y ?? 0;
    if (datos.e === "up") this.dedos.delete(datos.id);
    else this.dedos.set(datos.id, { x, y });
    for (const nota of this.mapeo.dedo(datos.e, datos.id, x, y)) this.sonar(nota);
    this.dibujar();
  }

  private async armar(activo: boolean): Promise<void> {
    if (activo && !this.listo) return;
    this.armado = activo;
    if (!activo) this.soltarTodo();
    this.dialogo.classList.toggle("armado", activo);
    this.estado(
      activo
        ? `Playing ${this.pista()?.name ?? ""} · Esc releases the mouse`
        : "Tap the pad below to play · Esc releases the mouse",
    );
    if (activo) void this.asegurarMotor();
    await fetch("/api/pad/orden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orden: activo ? "armar" : "desarmar" }),
    }).catch(() => {});
  }

  private asegurarMotor(): Promise<OpenDawPlaybackHandle | null> {
    const actual = this.deps.motorActual();
    if (actual) return Promise.resolve(actual);
    this.pidiendoMotor ??= this.deps.motor().finally(() => {
      this.pidiendoMotor = null;
    });
    return this.pidiendoMotor;
  }

  private sonar(nota: NotaPad): void {
    const track = this.pista();
    if (!track) return;
    if (nota.accion === "on") this.sonando.add(nota.nota);
    else this.sonando.delete(nota.nota);
    const motor = this.deps.motorActual();
    try {
      if (motor) motor.nota(track.name, nota.nota, nota.accion === "on" ? nota.velocidad : 0);
      else if (nota.accion === "on") void this.asegurarMotor();
    } catch {
      /* the engine was unloading: the next note requests it again */
    }
    if (this.grabacion) this.grabacion.grabador.registrar(nota, this.beatGrabacion());
  }

  private soltarTodo(): void {
    if (this.mapeo) for (const nota of this.mapeo.soltarTodo()) this.sonar(nota);
    this.dedos.clear();
    this.sonando.clear();
    this.dibujar();
  }

  // ---------------------------------------------------------------- recording

  /** Quarter notes since the start of the recording (negative during the count-in). */
  private beatGrabacion(): number {
    const g = this.grabacion;
    if (!g) return 0;
    return ((g.ctx.currentTime - g.t0) * g.bpm) / 60;
  }

  private async empezarGrabacion(): Promise<void> {
    const project = this.deps.proyecto();
    const track = this.pista();
    if (!project || !track) {
      this.estado("Pick a MIDI track to record into.");
      return;
    }
    const motor = await this.asegurarMotor();
    if (!motor) {
      this.estado("Could not start the sound engine.");
      return;
    }
    const porCompas = beatsPerBar(project);
    // From the start of the bar where the cursor is.
    const inicioBeat = Math.floor(this.deps.cursor() / porCompas) * porCompas;
    const segundosPorBeat = 60 / project.bpm;
    const ahora = motor.context.currentTime + 0.1;
    // One bar of count-in with the metronome; then the transport starts.
    const t0 = ahora + porCompas * segundosPorBeat;
    this.grabacion = {
      grabador: new GrabadorPad(),
      trackId: track.id,
      ctx: motor.context,
      inicioBeat,
      t0,
      bpm: project.bpm,
      clic: 0,
      marco: 0,
    };
    motor.seek(inicioBeat);
    this.programarClics(ahora, porCompas, segundosPorBeat);
    window.setTimeout(() => {
      if (this.grabacion && this.deps.motorActual() === motor) motor.play();
    }, Math.max(0, (t0 - motor.context.currentTime) * 1000 - 20));
    const seguir = (): void => {
      if (!this.grabacion) return;
      const beat = this.beatGrabacion();
      if (beat >= 0) this.deps.dibujar(inicioBeat + beat);
      this.grabacion.marco = requestAnimationFrame(seguir);
    };
    this.grabacion.marco = requestAnimationFrame(seguir);
    this.botonGrabar.textContent = "■ Stop";
    this.botonGrabar.classList.add("grabando");
    this.estado(`Recording into ${track.name} from bar ${inicioBeat / porCompas + 1} (one bar count-in)…`);
    if (!this.armado) void this.armar(true);
  }

  /** Metronome on the engine clock: the count-in and then every beat. */
  private programarClics(desde: number, porCompas: number, segundosPorBeat: number): void {
    const g = this.grabacion;
    if (!g) return;
    let siguiente = 0;
    const programar = (): void => {
      if (!this.grabacion) return;
      const ctx = g.ctx;
      while (desde + siguiente * segundosPorBeat < ctx.currentTime + 0.25) {
        const cuando = desde + siguiente * segundosPorBeat;
        if (cuando >= ctx.currentTime - 0.01) clic(ctx, cuando, siguiente % porCompas === 0);
        siguiente += 1;
      }
    };
    programar();
    g.clic = window.setInterval(programar, 60);
  }

  private async pararGrabacion(): Promise<void> {
    const g = this.grabacion;
    if (!g) return;
    const fin = this.beatGrabacion();
    this.grabacion = null;
    window.clearInterval(g.clic);
    cancelAnimationFrame(g.marco);
    this.botonGrabar.textContent = "● Record";
    this.botonGrabar.classList.remove("grabando");
    if (this.mapeo) {
      for (const nota of this.mapeo.soltarTodo()) {
        g.grabador.registrar(nota, fin);
        this.sonar(nota);
      }
    }
    const notas = g.grabador.terminar(fin);
    this.deps.parar();
    if (notas.length === 0) {
      this.estado("No notes were recorded.");
      return;
    }
    this.deps.guardarClip(g.trackId, g.inicioBeat, notas);
    this.estado(`Recorded ${notas.length} notes. Ctrl+Z removes them.`);
  }

  // ----------------------------------------------------------------- drawing

  private estado(texto: string): void {
    this.estadoEl.textContent = texto;
  }

  private ajustarLienzo(): void {
    const ancho = Math.max(320, this.lienzo.clientWidth || 640);
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
    ctx.font = `${11 * escala}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const zona of zonas) {
      const x = zona.x0 * w;
      const y = zona.y0 * h;
      const zw = (zona.x1 - zona.x0) * w;
      const zh = (zona.y1 - zona.y0) * h;
      ctx.fillStyle = this.sonando.has(zona.nota) ? "#ff5f6d55" : "transparent";
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
