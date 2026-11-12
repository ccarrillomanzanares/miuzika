/**
 * Piano roll of one clip. The edits are its own (undo/redo inside) and reach the project only with Apply, as one change.
 * Requested 11-Nov, taking openDAW Studio's note editor as the model: undo, resize from the end, audition, piano keys,
 * playback, multi-select, keyboard moves, grid and quantize, velocity lane, zoom, key highlight, the menu tools and drum
 * piece names. The edit logic is pure and tested in src/core/editor-notas.ts; this file draws and routes input.
 */

import type { Clip, KeySignature, Note } from "../../src/core/types.ts";
import { nombreDeNota } from "../../src/core/theory.ts";
import {
  Historial,
  LARGO_MINIMO,
  REJILLAS,
  ajustar,
  alargar,
  borrar,
  clasesDeLaTonalidad,
  cuantizar,
  darLaVuelta,
  desplazar,
  duplicar,
  escalarTiempo,
  invertir,
  nombrePiezaGm,
  transponer,
  velocidad,
} from "../../src/core/editor-notas.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";

const PITCHES = 128;
const ALTO_VELOCIDAD = 72;
/** Canvas width cap: browsers refuse canvases past ~32k px. */
const ANCHO_MAXIMO = 16000;
/** Pixels from a note's end that grab its length instead of moving it. */
const BORDE = 6;

/**
 * Each clip's undo/redo outlives the window (reported 11-Nov: after closing and opening again the edits were there but
 * undo was gone). Kept in memory for the tab, keyed by project, track and clip, and reused only if the clip's notes are
 * still the ones the window left: an undo in the main window, or any other change, starts a fresh history instead of
 * undoing over notes that are no longer those.
 */
const historiales = new Map<string, { historial: Historial; notasAlCerrar: string }>();
/** The notes as data only, so the comparison does not depend on the order of their properties. */
const firma = (notas: readonly Note[]) => JSON.stringify(notas.map((n) => [n.pitch, n.start, n.duration, n.velocity]));

export interface OpcionesEditor {
  /** Project, track and clip: where this clip's history is kept between openings. */
  claveHistorial: string;
  clip: Clip;
  trackId: string;
  tiemposPorCompas: number;
  bpm: number;
  key: KeySignature;
  esBateria: boolean;
  /** The track's mute and solo, read and toggled live on the project (requested 11-Nov). */
  mezcla: {
    estado: () => { muted: boolean; solo: boolean; otraEnSolo: boolean };
    alternar: (flag: "muted" | "solo") => void;
  };
  /** The engine to hear notes through; loading it can take a few seconds. */
  motor: () => Promise<OpenDawPlaybackHandle | null>;
  onApply: (notes: Note[]) => void;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function openPianoRoll(o: OpcionesEditor): void {
  const { clip } = o;
  const largo = clip.length;
  let notas: Note[] = clip.notes.map((n) => ({ ...n }));
  let sel = new Set<number>();
  const guardado = historiales.get(o.claveHistorial);
  const historial =
    guardado && guardado.notasAlCerrar === firma(clip.notes) ? guardado.historial : new Historial();
  let rejilla = 0.25;
  let pxPorBeat = 84;
  let altoFila = 11;
  let verEscala = !o.esBateria;
  let ultimoLargo = 0.25;
  let ultimaVelocidad = 100;
  const enTonalidad = clasesDeLaTonalidad(o.key);

  const overlay = document.createElement("div");
  overlay.className = "modal";
  const opcionesRejilla = REJILLAS.map(
    (r) => `<option value="${r.beats}"${r.beats === 0.25 ? " selected" : ""}>${r.etiqueta}</option>`,
  ).join("");
  overlay.innerHTML = `
    <div class="modal-card pr-card">
      <header>
        <div><strong>${escape(clip.name)}</strong><span data-info></span></div>
        <button class="close" title="Close (Esc)">×</button>
      </header>
      <div class="pr-barra">
        <span class="pr-grupo">
          <button data-accion="deshacer" title="Undo (Ctrl+Z)">↶</button>
          <button data-accion="rehacer" title="Redo (Ctrl+Y)">↷</button>
        </span>
        <span class="pr-grupo">
          <button data-accion="reproducir" title="Play the clip as edited (Space)">▶</button>
          <button data-mezcla="muted" title="Mute this track">M</button>
          <button data-mezcla="solo" title="Solo this track">S</button>
        </span>
        <span class="pr-grupo">
          <label title="Grid for adding, moving, lengths and quantize">Grid <select data-rejilla>${opcionesRejilla}</select></label>
          <button data-accion="cuantizar" title="Snap the starts of the selected notes (all, if none) to the grid">Quantize</button>
        </span>
        <span class="pr-grupo">
          <button data-accion="semitonoMas" title="Up a semitone (↑)">+1</button>
          <button data-accion="semitonoMenos" title="Down a semitone (↓)">−1</button>
          <button data-accion="octavaMas" title="Up an octave (Shift+↑)">+12</button>
          <button data-accion="octavaMenos" title="Down an octave (Shift+↓)">−12</button>
        </span>
        <span class="pr-grupo">
          <button data-accion="invertir" title="Mirror the pitches: the lowest note becomes the highest">Invert</button>
          <button data-accion="darLaVuelta" title="Mirror in time: the last note becomes the first">Reverse</button>
          <button data-accion="doble" title="Twice as long: positions and lengths">×2</button>
          <button data-accion="mitad" title="Half as long: positions and lengths">÷2</button>
          <button data-accion="duplicar" title="Copy the selection right after it (Ctrl+D)">Duplicate</button>
        </span>
        <span class="pr-grupo">
          Zoom
          <button data-accion="zoomHMenos" title="Narrower (Ctrl+wheel)">↔−</button>
          <button data-accion="zoomHMas" title="Wider (Ctrl+wheel)">↔+</button>
          <button data-accion="zoomVMenos" title="Shorter rows">↕−</button>
          <button data-accion="zoomVMas" title="Taller rows">↕+</button>
        </span>
        <label class="pr-grupo" ${o.esBateria ? "hidden" : ""} title="Shade the rows of the project's key; notes outside it turn red">
          <input type="checkbox" data-escala ${verEscala ? "checked" : ""} /> Key: ${escape(o.key.tonic)} ${escape(o.key.mode)}
        </label>
      </div>
      <div class="pr-cuerpo">
        <div class="pr-teclas"><canvas data-teclas></canvas></div>
        <div class="pr-scroll"><canvas data-rejilla-notas></canvas></div>
        <div class="pr-vel-etiqueta">Velocity</div>
        <div class="pr-vel"><canvas data-velocidad></canvas></div>
      </div>
      <footer>
        <span class="hint">Click: add · drag: move (Ctrl copies) · drag the end: length · drag on empty: select · right click: delete · arrows move · Space plays · closing keeps the changes</span>
        <span class="pr-aviso" data-aviso hidden></span>
        <button class="cancel" title="Close and throw away the changes">Discard</button>
        <button class="apply">Apply</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const q = <T extends Element>(s: string) => overlay.querySelector<T>(s)!;
  const lienzo = q<HTMLCanvasElement>("[data-rejilla-notas]");
  const teclas = q<HTMLCanvasElement>("[data-teclas]");
  const lienzoVel = q<HTMLCanvasElement>("[data-velocidad]");
  const scroll = q<HTMLElement>(".pr-scroll");
  const scrollTeclas = q<HTMLElement>(".pr-teclas");
  const scrollVel = q<HTMLElement>(".pr-vel");
  const info = q<HTMLElement>("[data-info]");
  const botonPlay = q<HTMLButtonElement>('[data-accion="reproducir"]');
  const aviso = q<HTMLElement>("[data-aviso]");
  const ctx = lienzo.getContext("2d")!;
  const ctxTeclas = teclas.getContext("2d")!;
  const ctxVel = lienzoVel.getContext("2d")!;
  const anchoTeclas = o.esBateria ? 120 : 52;

  // ------------------------------------------------------------------ geometry

  const ancho = () => Math.max(1, Math.ceil(largo * pxPorBeat));
  const alto = () => PITCHES * altoFila;
  const xDe = (beat: number) => beat * pxPorBeat;
  const yDe = (pitch: number) => (PITCHES - 1 - pitch) * altoFila;
  const beatEn = (x: number) => Math.max(0, Math.min(largo, x / pxPorBeat));
  const pitchEn = (y: number) => Math.max(0, Math.min(PITCHES - 1, PITCHES - 1 - Math.floor(y / altoFila)));
  const local = (e: MouseEvent, c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function dimensionar(): void {
    pxPorBeat = Math.min(pxPorBeat, ANCHO_MAXIMO / Math.max(1, largo));
    lienzo.width = ancho();
    lienzo.height = alto();
    teclas.width = anchoTeclas;
    teclas.height = alto();
    lienzoVel.width = ancho();
    lienzoVel.height = ALTO_VELOCIDAD;
  }

  /** The topmost note under a point (the last drawn wins). */
  function notaEn(x: number, y: number): number {
    const beat = beatEn(x);
    const pitch = pitchEn(y);
    for (let i = notas.length - 1; i >= 0; i--) {
      const n = notas[i]!;
      if (n.pitch === pitch && beat >= n.start && x <= xDe(n.start + n.duration) + 2) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------------- drawing

  let caja: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let cursorBeat: number | null = null;

  function dibujar(): void {
    const w = lienzo.width;
    const h = lienzo.height;
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, w, h);
    for (let pitch = 0; pitch < PITCHES; pitch++) {
      const y = yDe(pitch);
      const negra = [1, 3, 6, 8, 10].includes(pitch % 12);
      const dentro = verEscala && enTonalidad.has(pitch % 12);
      ctx.fillStyle = dentro ? (negra ? "#1a2030" : "#1e2535") : negra ? "#141822" : "#181c26";
      ctx.fillRect(0, y, w, altoFila);
      if (pitch % 12 === 0) {
        ctx.fillStyle = "#262c3a";
        ctx.fillRect(0, y + altoFila - 1, w, 1);
      }
    }
    const pasos = Math.ceil(largo / rejilla - 1e-9);
    for (let paso = 0; paso <= pasos; paso++) {
      const beat = paso * rejilla;
      const x = Math.round(xDe(beat));
      const compas = Math.abs(beat / o.tiemposPorCompas - Math.round(beat / o.tiemposPorCompas)) < 1e-6;
      const tiempo = Math.abs(beat - Math.round(beat)) < 1e-6;
      ctx.fillStyle = compas ? "#394052" : tiempo ? "#2a303d" : "#1e2330";
      ctx.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < notas.length; i++) {
      const n = notas[i]!;
      const x = xDe(n.start);
      const y = yDe(n.pitch);
      const anchoNota = Math.max(3, n.duration * pxPorBeat - 1);
      const fuera = verEscala && !enTonalidad.has(n.pitch % 12);
      const elegida = sel.has(i);
      ctx.globalAlpha = 0.45 + 0.55 * (n.velocity / 127);
      ctx.fillStyle = elegida ? "#ffd166" : fuera ? "#e06c75" : "#61afef";
      ctx.beginPath();
      ctx.roundRect(x, y + 1, anchoNota, Math.max(2, altoFila - 2), 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (elegida) {
        ctx.strokeStyle = "#fff4d0";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (anchoNota > 26 && altoFila >= 10) {
        ctx.fillStyle = "#0c0e13";
        ctx.font = "8px ui-monospace, monospace";
        ctx.fillText(String(n.velocity), x + 3, y + altoFila - 3);
      }
    }
    if (caja) {
      ctx.strokeStyle = "#ffd166";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.min(caja.x0, caja.x1) + 0.5,
        Math.min(caja.y0, caja.y1) + 0.5,
        Math.abs(caja.x1 - caja.x0),
        Math.abs(caja.y1 - caja.y0),
      );
      ctx.setLineDash([]);
    }
    if (cursorBeat !== null) {
      ctx.fillStyle = "#ff6b7a";
      ctx.fillRect(Math.round(xDe(cursorBeat)), 0, 2, h);
    }
    dibujarVelocidad();
    pintarEstado();
  }

  function dibujarTeclas(): void {
    ctxTeclas.fillStyle = "#0f1117";
    ctxTeclas.fillRect(0, 0, teclas.width, teclas.height);
    for (let pitch = 0; pitch < PITCHES; pitch++) {
      const y = yDe(pitch);
      const negra = [1, 3, 6, 8, 10].includes(pitch % 12);
      ctxTeclas.fillStyle = negra ? "#20242e" : "#cfd3dc";
      ctxTeclas.fillRect(0, y, teclas.width - 1, altoFila - 1);
      const pieza = o.esBateria ? nombrePiezaGm(pitch) : undefined;
      const etiqueta = pieza ?? (pitch % 12 === 0 ? nombreDeNota(pitch) : "");
      if (etiqueta && altoFila >= 8) {
        ctxTeclas.fillStyle = negra ? "#cfd3dc" : "#1a1d25";
        ctxTeclas.font = `${Math.min(10, altoFila - 2)}px ui-monospace, monospace`;
        ctxTeclas.fillText(etiqueta, 4, y + altoFila - 3);
      }
    }
  }

  function dibujarVelocidad(): void {
    ctxVel.fillStyle = "#0f1117";
    ctxVel.fillRect(0, 0, lienzoVel.width, lienzoVel.height);
    ctxVel.fillStyle = "#1e2330";
    ctxVel.fillRect(0, 0, lienzoVel.width, 1);
    for (let i = 0; i < notas.length; i++) {
      const n = notas[i]!;
      const x = Math.round(xDe(n.start));
      const h = Math.round((n.velocity / 127) * (ALTO_VELOCIDAD - 6));
      ctxVel.fillStyle = sel.has(i) ? "#ffd166" : "#61afef";
      ctxVel.fillRect(x, ALTO_VELOCIDAD - h, 3, h);
      ctxVel.fillRect(x, ALTO_VELOCIDAD - h, Math.max(3, Math.min(10, n.duration * pxPorBeat - 1)), 2);
    }
  }

  function pintarEstado(): void {
    const elegidas = sel.size > 0 ? ` · ${sel.size} selected` : "";
    info.textContent = `${notas.length} notes · ${largo} beats${elegidas}`;
    q<HTMLButtonElement>('[data-accion="deshacer"]').disabled = !historial.puedeDeshacer;
    q<HTMLButtonElement>('[data-accion="rehacer"]').disabled = !historial.puedeRehacer;
    q<HTMLButtonElement>('[data-accion="duplicar"]').disabled = sel.size === 0;
  }

  /** Redraw everything after a zoom, keeping the same spot in the middle of the view. */
  function rehacerVista(): void {
    const cx = (scroll.scrollLeft + scroll.clientWidth / 2) / lienzo.width;
    const cy = (scroll.scrollTop + scroll.clientHeight / 2) / lienzo.height;
    dimensionar();
    dibujarTeclas();
    dibujar();
    scroll.scrollLeft = cx * lienzo.width - scroll.clientWidth / 2;
    scroll.scrollTop = cy * lienzo.height - scroll.clientHeight / 2;
  }

  // ------------------------------------------------------------------- edits

  /** Every edit goes through here: one undo step, then redraw. */
  function editar(nuevas: Note[], nuevaSel: Set<number> = sel): void {
    historial.guardar(notas);
    notas = nuevas;
    sel = new Set([...nuevaSel].filter((i) => i < notas.length));
    dibujar();
  }

  function accion(nombre: string): void {
    switch (nombre) {
      case "deshacer": {
        const previas = historial.deshacer(notas);
        if (previas) {
          notas = previas;
          sel = new Set([...sel].filter((i) => i < notas.length));
          dibujar();
        }
        return;
      }
      case "rehacer": {
        const siguientes = historial.rehacer(notas);
        if (siguientes) {
          notas = siguientes;
          sel = new Set([...sel].filter((i) => i < notas.length));
          dibujar();
        }
        return;
      }
      case "reproducir":
        if (reproduccion) pararReproduccion();
        else void reproducir();
        return;
      case "cuantizar":
        return editar(cuantizar(notas, sel, rejilla, largo));
      case "semitonoMas":
        return editar(transponer(notas, sel, 1));
      case "semitonoMenos":
        return editar(transponer(notas, sel, -1));
      case "octavaMas":
        return editar(transponer(notas, sel, 12));
      case "octavaMenos":
        return editar(transponer(notas, sel, -12));
      case "invertir":
        return editar(invertir(notas, sel));
      case "darLaVuelta":
        return editar(darLaVuelta(notas, sel));
      case "doble":
      case "mitad": {
        // Notes past the clip end are dropped, so the selection by index no longer holds.
        const res = escalarTiempo(notas, sel, nombre === "doble" ? 2 : 0.5, largo);
        return editar(res, res.length === notas.length ? sel : new Set());
      }
      case "duplicar": {
        if (sel.size === 0) return;
        const res = duplicar(notas, sel, largo);
        return editar(res.notas, res.seleccion);
      }
      case "zoomHMas":
        pxPorBeat = Math.min(400, pxPorBeat * 1.5);
        return rehacerVista();
      case "zoomHMenos":
        pxPorBeat = Math.max(12, pxPorBeat / 1.5);
        return rehacerVista();
      case "zoomVMas":
        altoFila = Math.min(24, altoFila + 3);
        return rehacerVista();
      case "zoomVMenos":
        altoFila = Math.max(5, altoFila - 3);
        return rehacerVista();
    }
  }

  // ---------------------------------------------------------------- sound

  let motor: OpenDawPlaybackHandle | null = null;
  let pidiendo: Promise<OpenDawPlaybackHandle | null> | null = null;
  const sonando = new Map<string, number>();

  function asegurarMotor(): Promise<OpenDawPlaybackHandle | null> {
    if (motor) return Promise.resolve(motor);
    pidiendo ??= o
      .motor()
      .then((m) => (motor = m))
      .catch(() => null)
      .finally(() => {
        pidiendo = null;
      });
    return pidiendo;
  }

  function nota(pitch: number, vel: number): void {
    try {
      motor?.nota(o.trackId, pitch, vel);
    } catch {
      motor = null; // the engine was unloaded: the next sound asks for it again
    }
  }

  /** A short preview of one note. The first one may be silent while the engine loads. */
  function oir(pitch: number, vel = 100): void {
    if (!motor) {
      void asegurarMotor();
      return;
    }
    const clave = `oir:${pitch}`;
    if (sonando.has(clave)) {
      window.clearTimeout(sonando.get(clave));
      nota(pitch, 0);
    }
    nota(pitch, vel);
    sonando.set(
      clave,
      window.setTimeout(() => {
        nota(pitch, 0);
        sonando.delete(clave);
      }, 260),
    );
  }

  let reproduccion: { t0: number; ultimo: number; vivas: Map<number, { pitch: number; fin: number }>; marco: number } | null = null;

  async function reproducir(): Promise<void> {
    botonPlay.textContent = "…";
    botonPlay.title = "Getting the instruments ready…";
    const m = await asegurarMotor();
    if (!overlay.isConnected) return;
    if (!m) {
      botonPlay.textContent = "▶";
      aviso.hidden = false;
      aviso.textContent = "The instruments could not be loaded: nothing to hear.";
      return;
    }
    botonPlay.textContent = "■";
    botonPlay.title = "Stop (Space)";
    reproduccion = { t0: performance.now(), ultimo: -1e-9, vivas: new Map(), marco: 0 };
    const paso = () => {
      const r = reproduccion;
      if (!r) return;
      const beat = ((performance.now() - r.t0) / 1000) * (o.bpm / 60);
      // The notes as they are now: an edit made while it plays is heard on the next pass over it.
      for (const [i, viva] of r.vivas) {
        if (beat >= viva.fin) {
          nota(viva.pitch, 0);
          r.vivas.delete(i);
        }
      }
      if (beat >= largo) {
        pararReproduccion();
        return;
      }
      notas.forEach((n, i) => {
        if (n.start > r.ultimo && n.start <= beat && !r.vivas.has(i)) {
          nota(n.pitch, n.velocity);
          r.vivas.set(i, { pitch: n.pitch, fin: n.start + n.duration });
        }
      });
      r.ultimo = beat;
      cursorBeat = beat;
      dibujar();
      r.marco = requestAnimationFrame(paso);
    };
    reproduccion.marco = requestAnimationFrame(paso);
  }

  function pararReproduccion(): void {
    const r = reproduccion;
    reproduccion = null;
    if (r) {
      cancelAnimationFrame(r.marco);
      for (const viva of r.vivas.values()) nota(viva.pitch, 0);
    }
    cursorBeat = null;
    botonPlay.textContent = "▶";
    botonPlay.title = "Play the clip as edited (Space)";
    if (overlay.isConnected) dibujar();
  }

  // ------------------------------------------------------------- pointer: notes

  type Arrastre =
    | { tipo: "mover"; base: Note[]; elegidas: number[]; beat0: number; pitch0: number; ancla: number; copiar: boolean; ultimoPitch: number }
    | { tipo: "alargar"; base: Note[]; beat0: number }
    | { tipo: "caja"; aditiva: boolean; previa: Set<number> };
  let arrastre: Arrastre | null = null;
  let movido = false;
  let origen = { x: 0, y: 0 };

  lienzo.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y } = local(e, lienzo);
    origen = { x, y };
    movido = false;
    try {
      lienzo.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const i = notaEn(x, y);
    if (i >= 0) {
      if (e.shiftKey) {
        if (sel.has(i)) sel.delete(i);
        else sel.add(i);
        dibujar();
        arrastre = null;
        return;
      }
      if (!sel.has(i)) sel = new Set([i]);
      const n = notas[i]!;
      const finX = xDe(n.start + n.duration);
      const base = notas.map((m) => ({ ...m }));
      if (x >= finX - BORDE && n.duration * pxPorBeat > BORDE * 2) {
        arrastre = { tipo: "alargar", base, beat0: beatEn(x) };
      } else {
        arrastre = {
          tipo: "mover",
          base,
          elegidas: [...sel],
          beat0: beatEn(x),
          pitch0: pitchEn(y),
          ancla: i,
          copiar: e.ctrlKey || e.metaKey,
          ultimoPitch: n.pitch,
        };
        oir(n.pitch, n.velocity);
      }
      dibujar();
      return;
    }
    arrastre = { tipo: "caja", aditiva: e.shiftKey, previa: new Set(sel) };
  });

  lienzo.addEventListener("pointermove", (e) => {
    const { x, y } = local(e, lienzo);
    const a = arrastre;
    if (!a) {
      lienzo.style.cursor = cursorEn(x, y);
      return;
    }
    if (!movido && Math.hypot(x - origen.x, y - origen.y) < 4) return;
    movido = true;
    if (a.tipo === "caja") {
      caja = { x0: origen.x, y0: origen.y, x1: x, y1: y };
      const b0 = beatEn(Math.min(caja.x0, caja.x1));
      const b1 = beatEn(Math.max(caja.x0, caja.x1));
      const p0 = pitchEn(Math.max(caja.y0, caja.y1));
      const p1 = pitchEn(Math.min(caja.y0, caja.y1));
      const dentro = new Set<number>();
      notas.forEach((n, i) => {
        if (n.pitch >= p0 && n.pitch <= p1 && n.start < b1 && n.start + n.duration > b0) dentro.add(i);
      });
      sel = a.aditiva ? new Set([...a.previa, ...dentro]) : dentro;
      dibujar();
      return;
    }
    if (a.tipo === "alargar") {
      const d = ajustar(beatEn(x) - a.beat0, rejilla);
      notas = alargar(a.base, sel, d, largo);
      dibujar();
      return;
    }
    // Move (or copy with Ctrl): the time step snaps to the grid, the pitch follows the row. Always from the notes and
    // selection of the pointerdown, so a copy is made once however long the drag.
    let base = a.base;
    let elegidas = new Set(a.elegidas);
    let ancla = a.ancla;
    if (a.copiar) {
      base = [...a.base, ...a.elegidas.map((i) => ({ ...a.base[i]! }))];
      elegidas = new Set(a.elegidas.map((_, k) => a.base.length + k));
      ancla = a.base.length + a.elegidas.indexOf(a.ancla);
    }
    const dBeat = ajustar(beatEn(x) - a.beat0, rejilla);
    const dPitch = pitchEn(y) - a.pitch0;
    notas = transponer(desplazar(base, elegidas, dBeat, largo), elegidas, dPitch);
    sel = elegidas;
    const pitchAncla = notas[ancla]?.pitch;
    if (pitchAncla !== undefined && pitchAncla !== a.ultimoPitch) {
      a.ultimoPitch = pitchAncla;
      oir(pitchAncla);
    }
    dibujar();
  });

  function soltar(e: PointerEvent): void {
    const a = arrastre;
    arrastre = null;
    caja = null;
    if (!a) return;
    if (a.tipo === "caja") {
      if (!movido) {
        // A click on empty space adds a note at the grid step under the pointer, and selects it.
        const { x, y } = local(e, lienzo);
        const start = Math.min(Math.floor(beatEn(x) / rejilla + 1e-9) * rejilla, Math.max(0, largo - LARGO_MINIMO));
        const n: Note = {
          pitch: pitchEn(y),
          start,
          duration: Math.min(ultimoLargo, largo - start),
          velocity: ultimaVelocidad,
        };
        const nuevas = [...notas.map((m) => ({ ...m })), n];
        editar(nuevas, new Set([nuevas.length - 1]));
        oir(n.pitch, n.velocity);
        return;
      }
      dibujar();
      return;
    }
    const cambiado = JSON.stringify(a.base) !== JSON.stringify(notas);
    if (cambiado) {
      const despues = notas;
      notas = a.base;
      editar(despues);
      if (a.tipo === "alargar") {
        const primera = [...sel][0];
        if (primera !== undefined) ultimoLargo = notas[primera]!.duration;
      }
    } else if (!movido && !e.shiftKey && a.tipo === "mover") {
      // A plain click on a selected note keeps only that one selected.
      const i = notaEn(origen.x, origen.y);
      if (i >= 0) {
        sel = new Set([i]);
        ultimoLargo = notas[i]!.duration;
        ultimaVelocidad = notas[i]!.velocity;
      }
      dibujar();
    } else dibujar();
  }
  lienzo.addEventListener("pointerup", soltar);
  lienzo.addEventListener("pointercancel", () => {
    if (arrastre && arrastre.tipo !== "caja") notas = arrastre.base;
    if (arrastre?.tipo === "mover") sel = new Set(arrastre.elegidas);
    arrastre = null;
    caja = null;
    dibujar();
  });

  function cursorEn(x: number, y: number): string {
    const i = notaEn(x, y);
    if (i < 0) return "crosshair";
    const n = notas[i]!;
    return x >= xDe(n.start + n.duration) - BORDE && n.duration * pxPorBeat > BORDE * 2 ? "ew-resize" : "grab";
  }

  lienzo.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const { x, y } = local(e, lienzo);
    const i = notaEn(x, y);
    if (i < 0) return;
    // Right click deletes the note under the pointer; with it selected, the whole selection.
    editar(borrar(notas, sel.has(i) ? sel : new Set([i])), new Set());
  });

  scroll.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      accion(e.deltaY < 0 ? "zoomHMas" : "zoomHMenos");
    },
    { passive: false },
  );
  scroll.addEventListener("scroll", () => {
    scrollTeclas.scrollTop = scroll.scrollTop;
    scrollVel.scrollLeft = scroll.scrollLeft;
  });
  // The keys and the velocity lane follow the grid; scrolling over them moves the grid.
  scrollTeclas.addEventListener("wheel", (e) => {
    e.preventDefault();
    scroll.scrollTop += e.deltaY;
  }, { passive: false });
  scrollVel.addEventListener("wheel", (e) => {
    e.preventDefault();
    scroll.scrollLeft += e.deltaY + e.deltaX;
  }, { passive: false });

  // ---------------------------------------------------------- pointer: keys

  teclas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    oir(pitchEn(local(e, teclas).y));
  });

  // ------------------------------------------------------- pointer: velocity

  let arrastreVel: { base: Note[]; objetivo: Set<number> } | null = null;

  function velocidadEn(e: PointerEvent): number {
    const { y } = local(e, lienzoVel);
    return Math.round(((ALTO_VELOCIDAD - y) / (ALTO_VELOCIDAD - 6)) * 127);
  }

  lienzoVel.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x } = local(e, lienzoVel);
    // The note whose bar is nearest the pointer; a selected one wins a tie, and then the whole selection follows.
    let mejor = -1;
    let distancia = Infinity;
    notas.forEach((n, i) => {
      const x0 = xDe(n.start);
      const x1 = x0 + Math.max(6, Math.min(10, n.duration * pxPorBeat));
      const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      if (d < distancia || (d === distancia && sel.has(i))) {
        mejor = i;
        distancia = d;
      }
    });
    if (mejor < 0 || distancia > 8) return;
    try {
      lienzoVel.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    arrastreVel = { base: notas.map((n) => ({ ...n })), objetivo: sel.has(mejor) ? new Set(sel) : new Set([mejor]) };
    notas = velocidad(arrastreVel.base, arrastreVel.objetivo, velocidadEn(e));
    dibujar();
  });
  lienzoVel.addEventListener("pointermove", (e) => {
    if (!arrastreVel) return;
    notas = velocidad(arrastreVel.base, arrastreVel.objetivo, velocidadEn(e));
    dibujar();
  });
  const soltarVel = () => {
    const a = arrastreVel;
    arrastreVel = null;
    if (!a || JSON.stringify(a.base) === JSON.stringify(notas)) return;
    const despues = notas;
    notas = a.base;
    editar(despues);
    const primera = [...a.objetivo][0];
    if (primera !== undefined) ultimaVelocidad = notas[primera]!.velocity;
  };
  lienzoVel.addEventListener("pointerup", soltarVel);
  lienzoVel.addEventListener("pointercancel", soltarVel);

  // ------------------------------------------------------------- toolbar, keys

  overlay.querySelectorAll<HTMLButtonElement>("[data-accion]").forEach((b) =>
    b.addEventListener("click", () => {
      accion(b.dataset.accion!);
      b.blur();
    }),
  );
  const selRejilla = q<HTMLSelectElement>("[data-rejilla]");
  selRejilla.addEventListener("change", () => {
    rejilla = Number(selRejilla.value);
    ultimoLargo = rejilla;
    selRejilla.blur();
    dibujar();
  });
  const chkEscala = q<HTMLInputElement>("[data-escala]");
  chkEscala.addEventListener("change", () => {
    verEscala = chkEscala.checked;
    chkEscala.blur();
    dibujar();
  });

  /**
   * The editor's keys. Registered on capture so they come before the page's and the Pad's handlers, and stopped once
   * used: the page already ignores its keys while a .modal is open (bug 38).
   */
  function alTeclado(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      guardarYCerrar();
      return;
    }
    const destino = e.target as HTMLElement | null;
    if (destino && ["INPUT", "SELECT", "TEXTAREA"].includes(destino.tagName) && destino !== chkEscala) return;
    const mod = e.ctrlKey || e.metaKey;
    const tecla = e.key.toLowerCase();
    let hecho = true;
    if (mod && tecla === "z") accion(e.shiftKey ? "rehacer" : "deshacer");
    else if (mod && tecla === "y") accion("rehacer");
    else if (mod && tecla === "a") {
      sel = new Set(notas.map((_, i) => i));
      dibujar();
    } else if (mod && tecla === "d") accion("duplicar");
    else if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
      if (sel.size > 0) editar(borrar(notas, sel), new Set());
    } else if (!mod && e.code === "Space") {
      if (!e.repeat) accion("reproducir");
    } else if (!mod && e.key.startsWith("Arrow") && sel.size > 0) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const paso = (e.shiftKey ? 12 : 1) * (e.key === "ArrowUp" ? 1 : -1);
        editar(transponer(notas, sel, paso));
        const primera = [...sel][0];
        if (primera !== undefined) oir(notas[primera]!.pitch, notas[primera]!.velocity);
      } else editar(desplazar(notas, sel, e.key === "ArrowRight" ? rejilla : -rejilla, largo));
    } else hecho = false;
    if (hecho) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  window.addEventListener("keydown", alTeclado, true);

  // ------------------------------------------------------------------ close

  function cerrar(): void {
    pararReproduccion();
    for (const [clave, t] of sonando) {
      window.clearTimeout(t);
      nota(Number(clave.slice(4)), 0);
    }
    sonando.clear();
    window.removeEventListener("keydown", alTeclado, true);
    overlay.remove();
  }
  // Bug 40 (11-Nov): ×, Esc and a click outside threw the edits away; only Apply kept them. Every way out keeps them now,
  // as one change (one Ctrl+Z in the main window takes the whole edit back); only Discard throws them away, and asks.
  const hayCambios = () => firma(notas) !== firma(clip.notes);
  function guardarYCerrar(): void {
    const finales = hayCambios() ? [...notas].sort((a, b) => a.start - b.start || a.pitch - b.pitch) : clip.notes;
    if (finales !== clip.notes) o.onApply(finales);
    historiales.set(o.claveHistorial, { historial, notasAlCerrar: firma(finales) });
    cerrar();
  }
  q(".close").addEventListener("click", guardarYCerrar);
  q(".apply").addEventListener("click", guardarYCerrar);
  q(".cancel").addEventListener("click", () => {
    if (hayCambios() && !window.confirm(`Discard the changes to “${clip.name}”?`)) return;
    cerrar();
  });
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) guardarYCerrar();
  });

  // Mute and solo act on the project at once (they are not edits of the clip: Discard does not undo them).
  const botonesMezcla = overlay.querySelectorAll<HTMLButtonElement>("[data-mezcla]");
  function pintarMezcla(): void {
    const m = o.mezcla.estado();
    botonesMezcla.forEach((b) => b.classList.toggle("active", b.dataset.mezcla === "muted" ? m.muted : m.solo));
    const texto = m.muted
      ? "This track is muted: you will not hear it."
      : m.otraEnSolo && !m.solo
        ? "Another track is on Solo: you will not hear this one."
        : "";
    aviso.textContent = texto;
    aviso.hidden = !texto;
  }
  botonesMezcla.forEach((b) =>
    b.addEventListener("click", () => {
      o.mezcla.alternar(b.dataset.mezcla as "muted" | "solo");
      b.blur();
      pintarMezcla();
    }),
  );
  pintarMezcla();

  // A short clip fills the width instead of leaving half the window empty.
  pxPorBeat = Math.max(pxPorBeat, (scroll.clientWidth - 2) / Math.max(1, largo));
  dimensionar();
  dibujarTeclas();
  dibujar();
  // Centred on the notes; an empty clip opens around C4 (a drum track, around the kit).
  const pitches = notas.map((n) => n.pitch);
  const centro = pitches.length > 0 ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : o.esBateria ? 42 : 60;
  scroll.scrollTop = Math.max(0, yDe(centro) - scroll.clientHeight / 2);
  scrollTeclas.scrollTop = scroll.scrollTop;
  // Loaded now so the first click is heard (the Pad does the same).
  void asegurarMotor();
}
