/**
 * The wiring: creates each piece, connects them and listens to the page. No logic lives here.
 *
 *   sesion            the open project, undo, autosave
 *   transporte        play and stop (openDAW + long stems)
 *   seleccion         timeline selection and clip commands
 *   importar          project files, audio and MIDI from outside
 *   dialogo-proyectos the list of projects on disk
 *   exportar          mix to WAV/MP3, notes to MIDI
 *   gpu-barra         the rented GPU's cost and Off button, with every module closed
 *   ajustes           Settings: the accounts the app rents from
 *   modulos/          what generates material: each one only reads the project and hands in audio
 */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeProyecto, createProject, projectStats } from "../../src/core/project.ts";
import { applyOps } from "../../src/core/ops.ts";
import { audioAssets, liberarAssetsNoUsados, sincronizarDuraciones } from "./audio-store.ts";
import { BarraGpu } from "./gpu-barra.ts";
import { crearAnfitrion } from "./modulos/anfitrion.ts";
import { VentanaAceStep } from "./modulos/ace-step/ventana.ts";
import { VentanaMulaCover } from "./modulos/mulacover/ventana.ts";
import { VentanaDemucs } from "./modulos/demucs/ventana.ts";
import { VentanaStableAudio } from "./modulos/stableaudio/ventana.ts";
import { VentanaStrudel } from "./modulos/strudel/ventana.ts";
import { SelectorInstrumento } from "./selector-instrumento.ts";
import { mostrarAviso } from "./aviso-unico.ts";
import { VentanaAMidi } from "./a-midi.ts";
import { PanelPad } from "./pad.ts";
import { etiquetaInstrumento } from "../../src/core/instrumentos.ts";
import { VentanaAjustes } from "./ajustes.ts";
import { crearAvisos } from "./avisos.ts";
import { crearDetectorDoble } from "./doble-pulsacion.ts";
import { vigilarVersion } from "./build.ts";
import { initDialogoProyectos } from "./dialogo-proyectos.ts";
import { openPianoRoll } from "./editor.ts";
import { crearExportador } from "./exportar.ts";
import { t, traducirPagina } from "./i18n.ts";
import { crearImportador } from "./importar.ts";
import { Seleccion } from "./seleccion.ts";
import { Sesion } from "./sesion.ts";
import { cargarGm, cargarSoundfontsDelProyecto } from "./sonidos-proyecto.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";
import { Transporte } from "./transporte.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

traducirPagina();

const playButton = $<HTMLButtonElement>("play");
const stopButton = $<HTMLButtonElement>("stop");
const undoButton = $<HTMLButtonElement>("undo");
const redoButton = $<HTMLButtonElement>("redo");
const statusEl = $("status");
const songInfo = $("song-info");
const bpmGlobal = $<HTMLInputElement>("bpm-global");

const timeline = new TimelineView($<HTMLCanvasElement>("timeline"), $("canvas-wrap"), $("track-heads"));
const avisos = crearAvisos($<HTMLButtonElement>("avisos-toggle"), $("avisos"), () => timeline.relayout());

function setStatus(texto: string): void {
  statusEl.textContent = texto;
}

function pintarPlay(sonando: boolean): void {
  playButton.textContent = sonando ? "❚❚" : "▶";
  playButton.classList.toggle("active", sonando);
}

function avisarFaltan(faltan: string[]): void {
  if (faltan.length === 0) return;
  const resto = faltan.length > 3 ? ` and ${faltan.length - 3} more` : "";
  avisos.error(
    `Missing ${faltan.length} WAV (${faltan.slice(0, 3).join(", ")}${resto}). The project references them but they are not ` +
      "in the project folder: those tracks will play silence until the WAVs are back in place.",
  );
}

function pintarCancion(view: Project | null): void {
  bpmGlobal.disabled = !view;
  bpmGlobal.value = view ? String(view.bpm) : "";
  if (!view) {
    songInfo.textContent = "";
    return;
  }
  const stats = projectStats(view);
  const minutos = Math.floor(stats.seconds / 60);
  const segundos = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  const carpeta = carpetaDeProyecto(view);
  songInfo.innerHTML =
    `<strong>${escapeHtml(view.name)}</strong>` +
    `<span>${view.key.tonic} ${view.key.mode} · ${view.lengthBars} bars · ` +
    `${stats.tracks} tracks · ${stats.notes} notes · ${minutos}:${segundos}</span>` +
    `<span class="carpeta" title="Project folder on the server">proyectos/${escapeHtml(carpeta)}/</span>`;
}

function pintarBotones(): void {
  const enabled = sesion.ready && !sesion.busy;
  const hayPistas = Boolean(sesion.project && sesion.project.tracks.length > 0);
  $<HTMLInputElement>("audio-file").disabled = !enabled;
  $<HTMLInputElement>("open").disabled = !enabled;
  $<HTMLButtonElement>("new-song").disabled = !enabled;
  playButton.disabled = !enabled || !hayPistas;
  stopButton.disabled = !sesion.ready || !hayPistas;
  undoButton.disabled = !sesion.puedeDeshacer;
  redoButton.disabled = !sesion.puedeRehacer;
  seleccion.pintarBarra();
}

/** The touchpad panel (created further down; the session tells it when the project changes). */
let panelPad: PanelPad | null = null;

// Read before the session exists: setting its first project would overwrite it.
const ultimoAbierto = Sesion.ultimoAbierto();
const sesion = new Sesion(avisos, {
  alAplicar(next) {
    transporte.detenerPorCambio();
    sincronizarDuraciones(next);
    // Changing project must not leave the previous project's WAVs occupying RAM.
    liberarAssetsNoUsados(next);
    timeline.setProject(next ?? createProject({ name: "Untitled", bpm: 100, lengthBars: 16 }));
    pintarCancion(next);
    if (!next) return;
    // setProject changes the data and the heads, but does not repaint the canvas.
    timeline.relayout();
    transporte.sincronizarStems(next);
    panelPad?.proyectoCambiado();
  },
  alEnVivo(next, estructura) {
    sincronizarDuraciones(next);
    pintarCancion(next);
    timeline.refresh(next);
    transporte.sincronizarStems(next);
    // The running engine only follows mute, solo, volume and pan. A clip that moved needs the
    // project mounted again, from where it was playing.
    if (estructura && transporte.sonando) void transporte.reproducir(next);
    // The Pad's engine (loaded, stopped) would keep the old instruments: unloaded, the next note loads it again.
    else if (estructura && transporte.motor) transporte.detener();
    else transporte.syncMix(next);
    panelPad?.proyectoCambiado();
  },
  alCambiarEstado: () => pintarBotones(),
  estado: setStatus,
  avisarFaltan,
});

const transporte = new Transporte({ sesion, timeline, avisos, pintarPlay, avisarFaltan });
const seleccion = new Seleccion({ sesion, timeline, avisos, beatActual: () => transporte.beat });
const importador = crearImportador({ sesion, avisos, beatActual: () => transporte.beat, avisarFaltan });
const dialogoProyectos = initDialogoProyectos({ sesion, avisos, avisarFaltan });
if (ultimoAbierto) void dialogoProyectos.reabrir(ultimoAbierto);
const exportador = crearExportador({
  proyecto: () => sesion.project,
  cargarSoundfonts: cargarSoundfontsDelProyecto,
  cargarGm: (view) => cargarGm(view, (texto) => avisos.info(texto), setStatus),
  avisarFaltan,
});

const gpu = new BarraGpu({
  zona: $("gpu-zona"),
  texto: $("gpu-texto"),
  apagar: $<HTMLButtonElement>("gpu-apagar"),
  tarea: $("modulo-tarea"),
  cancelar: $<HTMLButtonElement>("modulo-cancelar"),
  avisos,
});
const ajustes = new VentanaAjustes(gpu);
$("ajustes").addEventListener("click", () => void ajustes.abrir());
const anfitrion = crearAnfitrion({ sesion, avisos, renderizarFuente: exportador.renderizarFuente, abrirAjustes: () => ajustes.abrir() });
const modulos: Record<string, { abrir(): Promise<void> }> = {
  "ace-step": new VentanaAceStep(anfitrion, gpu),
  mulacover: new VentanaMulaCover(anfitrion, gpu),
  demucs: new VentanaDemucs(anfitrion, gpu),
  stableaudio: new VentanaStableAudio(anfitrion, gpu),
  strudel: new VentanaStrudel(anfitrion),
};

$("modulos").addEventListener("click", (event) => {
  const id = (event.target as HTMLElement).dataset.modulo;
  if (!id) return;
  $<HTMLDetailsElement>("modulos").open = false;
  void modulos[id]?.abrir();
});

bpmGlobal.addEventListener("change", () => {
  const view = sesion.project;
  if (!view) return;
  const bpm = Number(bpmGlobal.value);
  if (bpm === view.bpm) return;
  try {
    sesion.commitLive(applyOps(view, [{ op: "set_tempo", bpm }]).project, true);
  } catch {
    avisos.error(`A tempo has to be between 20 and 300 BPM: “${bpmGlobal.value}” was not applied.`);
    bpmGlobal.value = String(view.bpm);
  }
});

timeline.onSeek = (beat) => {
  if (!sesion.project) return;
  transporte.seek(beat);
  timeline.draw(beat);
};

timeline.onEditClip = (trackId, clipId) => {
  const project = sesion.project;
  const clip = project?.tracks.find((track) => track.id === trackId)?.clips.find((candidate) => candidate.id === clipId);
  if (!project || !clip) return;
  openPianoRoll(clip, beatsPerBar(project), (notes) => {
    if (!sesion.project) return;
    try {
      sesion.setProject(applyOps(sesion.project, [{ op: "replace_clip_notes", trackId, clipId, notes }]).project);
      avisos.info(`Edited by hand: ${notes.length} notes in “${clip.name}”.`);
    } catch (error) {
      avisos.error(`Could not save the edit: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};

// The instrument of a MIDI track (8-Nov): applied live, like a moved clip, so a playing engine is mounted again.
const selectorInstrumento = new SelectorInstrumento({
  proyecto: () => sesion.project,
  aplicar(trackId, instrumento) {
    const view = sesion.project;
    if (!view || sesion.busy) return;
    try {
      sesion.commitLive(applyOps(view, [{ op: "set_instrument", trackId, instrument: instrumento }]).project, true);
      const pista = sesion.project?.tracks.find((t) => t.id === trackId);
      if (pista) avisos.info(`“${pista.name}” now plays ${etiquetaInstrumento(pista.instrument)}.`);
    } catch (error) {
      avisos.error(`Could not change the instrument: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
timeline.onEditInstrument = (trackId) => selectorInstrumento.abrir(trackId);

// To MIDI (8-Nov): the selected audio track's notes as a new MIDI track, with Basic Pitch on this machine.
const ventanaAMidi = new VentanaAMidi({
  proyecto: () => sesion.project,
  aplicar: (next) => sesion.commitLive(next, true),
  avisos,
});
$("sel-midi").addEventListener("click", () => {
  const id = seleccion.pistasElegidas()[0];
  if (id) void ventanaAMidi.abrir(id);
});

// The touchpad as an instrument (8-Nov, brought from old miuzika, where it was built from humseed and never exercised).
panelPad = new PanelPad({
  proyecto: () => sesion.project,
  motorActual: () => transporte.motor,
  motor: async () => {
    const view = sesion.project;
    return view ? transporte.prepararMotor(view) : null;
  },
  parar: () => transporte.detener(),
  cursor: () => timeline.currentBeat,
  guardarClip: (trackId, startBeat, notas) => {
    const view = sesion.project;
    if (!view) return;
    try {
      const ahora = new Date();
      const hora = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
      sesion.setProject(applyOps(view, [{ op: "add_notes", trackId, startBar: Math.round(startBeat / beatsPerBar(view)), name: `Pad ${hora}`, notes: notas }]).project);
    } catch (error) {
      avisos.error(`Could not save the recording: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  avisar: (texto) => avisos.info(texto),
  dibujar: (beat) => timeline.draw(beat),
});
$("pad").addEventListener("click", () => panelPad?.abrir());

// --- Buttons ---------------------------------------------------------------

function reproducirOPausar(): void {
  const view = sesion.project;
  if (!sesion.ready || sesion.busy || !view || view.tracks.length === 0) return;
  if (transporte.sonando) {
    transporte.detener();
    return;
  }
  void transporte.reproducir(view);
}

function parar(): void {
  transporte.detener();
  timeline.draw(0);
}

playButton.addEventListener("click", reproducirOPausar);
stopButton.addEventListener("click", parar);

undoButton.addEventListener("click", () => void sesion.undo());
redoButton.addEventListener("click", () => void sesion.redo());

$("new-song").addEventListener("click", () => {
  if (!sesion.ready) return;
  if (sesion.project && sesion.project.tracks.length > 0 && !confirm("Close this project and start another one? The current one stays saved on disk.")) return;
  sesion.setProject(null);
});

$("guardar").addEventListener("click", () => sesion.guardarAhora());

// Export menu (8-Nov: Carlos asked for MIDI and WAV; only MP3 had a button, the other two were the old agent's).
let exportando = false;
$("exportar").addEventListener("click", async (event) => {
  const formato = (event.target as HTMLElement).closest<HTMLElement>("[data-formato]")?.dataset.formato as "mp3" | "wav" | "midi" | undefined;
  if (!formato) return;
  $<HTMLDetailsElement>("exportar").open = false;
  if (exportando) return;
  exportando = true;
  const nombre = formato.toUpperCase();
  setStatus(formato === "midi" ? "Writing the MIDI…" : formato === "mp3" ? t("mp3.renderizando", "Rendering the mix to MP3…") : "Rendering the mix to WAV…");
  try {
    const r = await exportador.exportar({ midi: formato === "midi", wav: formato === "wav", mp3: formato === "mp3" });
    setStatus(r.texto.split("\n").pop() ?? r.texto);
    if (!r.ok) avisos.error(r.texto);
    else avisos.info(r.texto.split("\n").filter((linea) => linea.startsWith(`${nombre}:`)).join(" ") || r.texto);
    // Audio tracks left out of a MIDI is information, not a failure.
    for (const aviso of r.avisos) (aviso.startsWith("MIDI export left out") ? avisos.info : avisos.error).call(avisos, aviso);
    // Carlos, 8-Nov: the MIDI export "tiene que informar… y un check de no volver a aparecer". The Log line stays always.
    if (formato === "midi") {
      if (!r.ok && r.texto.startsWith("There are no MIDI tracks")) await mostrarAviso("midi-sin-pistas", "Nothing to export as MIDI", r.texto);
      const fuera = r.avisos.find((a) => a.startsWith("MIDI export left out"));
      if (fuera) await mostrarAviso("midi-audio-fuera", "Audio tracks left out of the MIDI", `${fuera} The .mid has the MIDI tracks only.`);
    }
  } finally {
    exportando = false;
  }
});

$<HTMLInputElement>("audio-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await importador.abrirArchivos(files);
});

$<HTMLInputElement>("open").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const todos = Array.from(input.files ?? []);
  input.value = "";
  await importador.abrirArchivos(todos);
});

$("recargar").addEventListener("click", () => location.reload());
vigilarVersion(() => {
  const boton = $<HTMLButtonElement>("recargar");
  boton.hidden = false;
  boton.classList.add("activo");
});

// The autosave waits 1.5 s: leaving inside that window would lose the last change.
window.addEventListener("beforeunload", (event) => {
  if (!sesion.hayCambiosSinGuardar) return;
  sesion.volcarPendiente();
  event.preventDefault();
});

// --- Drag and drop ---------------------------------------------------------

for (const tipo of ["dragenter", "dragover"] as const) {
  document.addEventListener(tipo, (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    document.body.classList.add("arrastrando");
  });
}

document.addEventListener("dragleave", (event: DragEvent) => {
  if (event.relatedTarget) return; // moving inside the window: do not flicker
  document.body.classList.remove("arrastrando");
});

document.addEventListener("drop", (event: DragEvent) => {
  const data = event.dataTransfer;
  if (!data) return;
  event.preventDefault();
  document.body.classList.remove("arrastrando");
  const ficheros = Array.from(data.files ?? []);
  if (ficheros.length > 0) void importador.abrirArchivos(ficheros);
});

// --- Keyboard --------------------------------------------------------------

const esDoblePulsacion = crearDetectorDoble();

/** Space is the transport's unless the person is typing or a dialog is open. */
function espacioEsDelTransporte(target: HTMLElement | null): boolean {
  if (document.querySelector("dialog[open], .modal")) return false;
  if (target?.isContentEditable || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return false;
  // A file input keeps the focus after choosing a file: there, Space would reopen the picker.
  return target?.tagName !== "INPUT" || (target as HTMLInputElement).type === "file";
}

// Also on keyup: that is when a focused button or file input would act on Space, and the Play
// button keeps the focus after a click, so Space would toggle twice.
window.addEventListener("keyup", (event) => {
  if (event.code === "Space" && espacioEsDelTransporte(event.target as HTMLElement | null)) event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (event.code === "Space" && espacioEsDelTransporte(target)) {
    event.preventDefault();
    if (event.repeat) return;
    if (esDoblePulsacion(event.timeStamp)) parar();
    else reproducirOPausar();
    return;
  }
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (target?.isContentEditable) return;
  // With text selected on the page, Ctrl+C/X belong to the browser.
  const texto = window.getSelection();
  const hayTexto = Boolean(texto && !texto.isCollapsed && texto.toString().trim().length > 0);
  if (hayTexto && ["c", "x"].includes(event.key.toLowerCase())) return;
  if (event.key === "Escape") {
    timeline.clearSelection();
    return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key === "0") {
    event.preventDefault();
    timeline.fitToProject();
    return;
  }
  if (!modifier) {
    if ((event.key === "Delete" || event.key === "Backspace") && seleccion.borrar()) event.preventDefault();
    return;
  }
  const acciones: Record<string, () => void> = {
    a: () => timeline.selectAll(),
    c: () => seleccion.copiar(),
    v: () => seleccion.pegar(),
    d: () => seleccion.duplicar(),
    s: () => sesion.guardarAhora(),
    z: () => void (event.shiftKey ? sesion.redo() : sesion.undo()),
    y: () => void sesion.redo(),
  };
  const accion = acciones[event.key.toLowerCase()];
  if (accion) {
    event.preventDefault();
    accion();
  }
});

// --- Startup ---------------------------------------------------------------

// No project opens on its own: the user decides with "Projects" or "Open".
sesion.setProject(null, false);
pintarPlay(false);
sesion.ready = true;
pintarBotones();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__miuzika = { sesion, transporte, timeline, audioAssets, exportador, importador };
}
