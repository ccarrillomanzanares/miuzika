import type { CodeSource, InstrumentType, Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { listAudioAssets } from "./audio-db.ts";
import {
  loadHistoryFromDb,
  loadProjectFromDb,
  saveHistoryToDb,
  saveProjectToDb,
} from "./project-db.ts";
import { createProject, projectStats } from "../../src/core/project.ts";
import { applyOps } from "../../src/core/ops.ts";
import type { Op } from "../../src/core/ops.ts";
import {
  assetsStreamingGuardados,
  audioAssets,
  computePeaks,
  guardarAssetsStreaming,
  hydrateProjectAudio,
  loadAudioFile,
  persistAudioAsset,
  registrarAssetStreaming,
} from "./audio-store.ts";
import { StemPlayer } from "./stem-player.ts";
import { openPianoRoll } from "./editor.ts";
import { openCodeLab } from "./code-lab.ts";
import type { CodeAudioRequest } from "./code-lab.ts";
import { renderStrudelAudio } from "./strudel-audio.ts";
import { importProjectBundle } from "./project-bundle.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";
import { initChat } from "./chat.ts";
import { getModel, health, listModels, setModel } from "./llm.ts";
import type { ChatMessage } from "./llm.ts";
import { ejecutarAgente } from "./agent/agent.ts";
import {
  cabecerasProyecto,
  registrarAjustador,
  registrarCreador,
  registrarImportador,
  setProyectoActivo,
} from "./agent/tools.ts";
import type { AjustePista, PeticionPistas, PeticionProyecto } from "./agent/tools.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("timeline");
const wrap = $("canvas-wrap");
const heads = $("track-heads");
const playButton = $<HTMLButtonElement>("play");
const stopButton = $<HTMLButtonElement>("stop");
const undoButton = $<HTMLButtonElement>("undo");
const redoButton = $<HTMLButtonElement>("redo");
const statusEl = $("status");
const songInfo = $("song-info");

const chat = initChat();

const timeline = new TimelineView(canvas, wrap, heads);

// Al plegar el chat se libera espacio: el lienzo tiene que reajustarse.
chat.onLayout(() => timeline.relayout());

// ── Agente: piensa y actúa (la clave la pone el servidor; las manos, el workspace)
const AGENTE_SISTEMA = [
  "Eres el agente musical de miuzika, un DAW que corre en el navegador.",
  "Trabajas en espanol: breve al hablar, pero con datos reales al informar.",
  "El MOTOR YA EXISTE en codigo/ (dsp, instruments, render, midi, cancion). NO escribas otro",
  "motor ni redefinas sus funciones: importalas (from instruments import kick).",
  "El servidor RECHAZA (409) un fichero nuevo que redefina un simbolo del motor, y tambien",
  "los scripts patch*/parche*, y las escrituras con contenido vacio.",
  "FLUJO obligatorio, en este orden: (1) el manifiesto de abajo YA te da las firmas, no leas",
  "dsp.py/instruments.py/render.py para descubrirlas; (2) escribe el script COMPLETO una sola vez,",
  "importando el motor; (3) ejecutalo con ejecutar_python en el paso siguiente; (4) si falla,",
  "corrige con editar_fichero(busca, reemplaza) y vuelve a ejecutar -- NUNCA reescribas el fichero",
  "entero; (5) verifica el WAV con verificar_audio; (6) responde con las metricas medidas.",
  "No ejecutes ficheros ajenos para 'ver que hacen': ejecuta solo los scripts que escribas tu.",
  "Si NO hay proyecto abierto, PREGUNTA al usuario como llamarlo (no lo inventes) y llama a",
  "crear_proyecto(nombre) ANTES de escribir nada: su nombre es su carpeta (proyectos/<nombre>/) y",
  "todo lo que escribas en 'salida/...' caera ahi.",
  "Para ENTREGAR una cancion llama a anadir_pistas(midis=[...], wavs=[...]): crea pistas reales en el",
  "DAW. Deja los .mid y los .wav (stems, no master) en salida/. NO masterices ni limitadores el stereo",
  "final: el master se decide en el DAW con los faders; entrega pistas separadas.",
  "Para corregir una linea usa editar_fichero(path, busca, reemplaza). Para medir un WAV usa",
  "verificar_audio(path). Para un sample rapido copia plantillas/one_shot.py y cambia PARAMS.",
  "Si de verdad hace falta algo nuevo, crealo en codigo/experimental/ con nombres nuevos.",
  "Directorio de trabajo: workspace/. Python 3 con numpy (sin scipy).",
  "No inventes resultados: si algo falla, ensena el error y corrigelo.",
].join(" ");

let manifiestoMotor = "";

/** Trae el manifiesto del motor y lo deja disponible para el prompt. */
async function refrescarManifiesto(): Promise<void> {
  try {
    const res = await fetch("/api/manifiesto");
    if (!res.ok) return;
    const datos = (await res.json()) as { manifiesto?: string };
    manifiestoMotor = datos.manifiesto ?? "";
    const sistema = conversacion[0];
    if (sistema && sistema.role === "system") {
      const carpeta = project
        ? `\n\n=== PROYECTO ABIERTO ===\nCarpeta del proyecto: proyectos/${slugDeProyecto(project)}/\n` +
          "Escribe ahi los WAV y MIDI con rutas como 'salida/tema.wav' (el servidor las resuelve " +
          "dentro de la carpeta del proyecto). 'codigo/', 'herramientas/' y 'plantillas/' son comunes."
        : "\n\n=== PROYECTO ===\nNo hay proyecto abierto: crea uno o usa anadir_pistas.";
      sistema.content =
        AGENTE_SISTEMA +
        carpeta +
        (manifiestoMotor ? `\n\n=== MOTOR DISPONIBLE ===\n${manifiestoMotor}` : "");
    }
  } catch {
    /* sin manifiesto: se trabaja con el prompt basico */
  }
}

const conversacion: ChatMessage[] = [{ role: "system", content: AGENTE_SISTEMA }];

let trabajando = false;

async function responderAlUsuario(texto: string): Promise<void> {
  if (trabajando) {
    chat.add("system", "Sigo trabajando en el turno anterior: espera a que termine.");
    return;
  }
  trabajando = true;
  chat.setBusy(true);
  await refrescarManifiesto();
  conversacion.push({ role: "user", content: texto });
  const burbuja = chat.add("assistant", "…");
  setStatus(`Agente ${getModel()}: pensando…`);
  try {
    const resultado = await ejecutarAgente(conversacion, {
      alEvento: (evento) => {
        if (evento.tipo === "herramienta") chat.add("system", `⚙ ${evento.texto}`);
        else setStatus(evento.texto);
      },
    });
    chat.update(burbuja, resultado.texto || "(sin respuesta final)");
    setStatus(
      `Agente ${getModel()} · ${resultado.pasos} paso(s) · ${resultado.llamadas} herramienta(s) · ` +
        `${(resultado.ms / 1000).toFixed(1)} s`,
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    chat.update(burbuja, `No he podido completar el turno: ${mensaje}`);
    setStatus(`Agente error: ${mensaje.slice(0, 140)}`);
  } finally {
    trabajando = false;
    chat.setBusy(false);
  }
  // El historial no puede crecer sin limite: sistema + los ultimos turnos.
  if (conversacion.length > 30) conversacion.splice(1, conversacion.length - 25);
}

chat.onSend((texto) => {
  void responderAlUsuario(texto);
});

let project: Project | null = loadStored();
let busy = false;
let ready = false;
let restoring = false;
let selectedTrackIds: string[] = [];
let selectedClipIds: string[] = [];
/** Referencias copiadas con Ctrl+C (se pegan duplicando el original). */
let portapapeles: { trackId: string; clipId: string; start: number }[] = [];
let persistenceWarned = false;
let openDawHandle: OpenDawPlaybackHandle | null = null;
let openDawGeneration = 0;

const stemPlayer = new StemPlayer();
/** Por encima de estos segundos el WAV no se decodifica: se reproduce por streaming. */
const SEGUNDOS_STREAMING = 30;

/** Ruta completa (con la carpeta del proyecto) para <audio src>, que no manda cabeceras. */
function rutaCompleta(src: string): string {
  const compartido = /^(codigo|herramientas|plantillas|proyectos|_archivo)\//.test(src);
  if (compartido || !project) return src;
  return `proyectos/${slugDeProyecto(project)}/${src}`;
}

/** Duracion y picos de un WAV sin decodificarlo en el navegador. */
async function metadatosWav(ruta: string): Promise<{
  picos: number[];
  duracionSeg: number;
}> {
  const res = await fetch(`/api/picos?path=${encodeURIComponent(ruta)}&cubos=1024`, {
    headers: cabecerasProyecto(),
  });
  if (!res.ok) throw new Error(`no se pudo leer ${ruta}`);
  const datos = (await res.json()) as { picos?: number[]; duracionSeg?: number };
  return { picos: datos.picos ?? [], duracionSeg: Number(datos.duracionSeg ?? 0) };
}

/** Prepara los stems de streaming del proyecto abierto (los que no van por openDAW). */
function sincronizarStems(): void {
  const vista = project;
  if (!vista) {
    stemPlayer.definir([]);
    return;
  }
  stemPlayer.setBpm(vista.bpm);
  const haySolo = vista.tracks.some((track) => track.solo);
  const defs: {
    clave: string;
    url: string;
    startBeat: number;
    lengthBeat: number;
    offsetBeat: number;
    gainDb: number;
  }[] = [];
  for (const track of vista.tracks) {
    // Solo suena lo que suena: mute lo calla y, si hay algún solo, manda ese.
    if (track.muted || (haySolo && !track.solo)) continue;
    for (const clip of track.clips) {
      if (!clip.audio) continue;
      const asset = audioAssets.get(clip.audio.assetId);
      if (!asset?.streaming || !asset.src) continue;
      defs.push({
        clave: `${clip.audio.assetId}:${clip.id}`,
        url: `/api/audio?path=${encodeURIComponent(rutaCompleta(asset.src))}`,
        startBeat: clip.start,
        lengthBeat: clip.length,
        offsetBeat: clip.audio.offset,
        gainDb: clip.audio.gainDb + track.gainDb,
      });
    }
  }
  stemPlayer.definir(defs);
}

const HISTORY_KEY = "miuzika.history";
const HISTORY_LIMIT = 8;
let history: Project[] = loadHistory();
let future: Project[] = [];

/** Nombre de proyecto a partir del fichero entregado (salida/sacramento_multitrack.mid -> sacramento). */
function nombreDesdeRuta(ruta: string): string {
  const base = (ruta.split("/").pop() ?? "proyecto").replace(/\.[^.]+$/, "");
  const limpio = base
    .replace(/^midi_/i, "")
    .replace(/_(multitrack|master|mix|stems?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return (limpio || base || "proyecto").slice(0, 40);
}

/** Carpeta del proyecto en workspace/proyectos/: solo el nombre, en slug. */
function slugDeProyecto(origen: Project): string {
  const base = origen.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Solo el nombre: la carpeta es predecible ("sacramento" -> proyectos/sacramento/).
  return base || "proyecto";
}

function currentBeat(): number {
  return openDawHandle?.beat ?? timeline.currentBeat;
}

timeline.onSeek = (beat) => {
  const view = activeProject(project);
  if (!view) return;
  if (openDawHandle) openDawHandle.seek(beat);
  timeline.draw(beat);
};

timeline.onToggleMute = (trackId) => toggleTracksFlag([trackId], "muted");
timeline.onToggleSolo = (trackId) => toggleTracksFlag([trackId], "solo");
timeline.onSelectionChange = (ids) => {
  selectedTrackIds = ids;
  updateSelectionBar();
};
timeline.onClipSelectionChange = (ids) => {
  selectedClipIds = ids;
  updateSelectionBar();
};
timeline.onClipsDrop = (movimientos, copiar) => {
  if (!project || movimientos.length === 0) return;
  const ops: Op[] = movimientos.map((mov) => ({
    op: (copiar ? "duplicate_clip" : "move_clip") as "duplicate_clip" | "move_clip",
    trackId: mov.trackId,
    clipId: mov.clipId,
    startBeat: mov.startBeat,
    ...(mov.trackDestinoId ? { trackDestinoId: mov.trackDestinoId } : {}),
  }));
  aplicarOpsClips(ops, `${copiar ? "Copiado" : "Movido"}(s) ${ops.length} clip(s).`, copiar);
};

timeline.onEditClip = (trackId, clipId) => {
  if (!project) return;
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return;
  openPianoRoll(clip, (notes) => {
    if (!project) return;
    try {
      const { project: next } = applyOps(project, [
        { op: "replace_clip_notes", trackId, clipId, notes },
      ]);
      setProject(next);
      addMessage("assistant", `Editado a mano: ${notes.length} notas en “${clip.name}”.`);
    } catch (error) {
      addMessage("system", `No se pudo guardar la edición: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};


function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setBusy(value: boolean, text = ""): void {
  busy = value;
  setStatus(text);
  updateActions();
}

function activeProject(source: Project | null): Project | null {
  return source;
}

function updateActions(): void {
  const enabled = ready && !busy;
  const view = activeProject(project);
  const hasProject = project !== null;
  const hasTracks = Boolean(view && view.tracks.length > 0);

  $<HTMLInputElement>("audio-file").disabled = !enabled || !hasProject;
  $<HTMLInputElement>("open").disabled = !enabled;
  $<HTMLButtonElement>("code-lab").disabled = !enabled;
  $<HTMLButtonElement>("new-song").disabled = !enabled;
  playButton.disabled = !enabled || !hasTracks;
  stopButton.disabled = !ready || !hasTracks;
  updateSelectionBar();
}

function setPlaying(value: boolean): void {
  playButton.textContent = value ? "❚❚" : "▶";
  playButton.classList.toggle("active", value);
}

function stopOpenDaw(): void {
  stemPlayer.detener();
  openDawGeneration++;
  const handle = openDawHandle;
  openDawHandle = null;
  if (handle) {
    try {
      handle.stop();
    } catch {
      /* ya parado */
    }
  }
  setPlaying(false);
}

async function startOpenDawPlayback(view: Project): Promise<void> {
  if (openDawHandle) stopOpenDaw();
  const generation = ++openDawGeneration;
  setBusy(true, "Cargando WAVs y arrancando openDAW…");
  try {
    const { missing } = await hydrateProjectAudio(view);
    warnMissingAudio(missing);
    const { playWithOpenDaw } = await import("./opendaw-engine.ts");
    const endBeat = view.lengthBars * beatsPerBar(view);
    // openDAW solo recibe lo que esta decodificado; los stems largos van aparte.
    const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
    for (const [id, asset] of audioAssets) {
      if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
    }
    const handle = await playWithOpenDaw(
      view,
      (beat) => {
        timeline.draw(beat);
        stemPlayer.sincronizar(beat);
        if (openDawHandle && beat >= endBeat - 0.05) stopOpenDaw();
      },
      paraEngine,
    );
    if (generation !== openDawGeneration) {
      handle.stop();
      return;
    }
    openDawHandle = handle;
    setPlaying(true);
    await stemPlayer.reproducir(handle.beat);
    const cuantos = stemPlayer.vocesActivas;
    addMessage(
      "assistant",
      cuantos > 0
        ? `Reproduciendo con openDAW (MIDI) y ${cuantos} stem(s) por streaming.`
        : "Reproduciendo con el engine de openDAW.",
    );
  } catch (error) {
    if (generation !== openDawGeneration) return;
    setPlaying(false);
    addMessage(
      "system",
      `No se pudo arrancar el engine de openDAW: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    setBusy(false);
  }
}

function addMessage(role: "assistant" | "system", text: string): void {
  chat.add(role, text);
}

function warnMissingAudio(missing: string[]): void {
  if (missing.length === 0) return;
  const shown = missing.slice(0, 3).join(", ");
  const rest = missing.length > 3 ? ` y ${missing.length - 3} más` : "";
  addMessage(
    "system",
    `Faltan ${missing.length} WAV (${shown}${rest}). El proyecto los referencia, pero no están guardados en este navegador; vuelve a importarlos con «Audio».`,
  );
}

function warnPersistence(message: string): void {
  if (persistenceWarned) return;
  persistenceWarned = true;
  addMessage("system", message);
}

function persist(): void {
  if (project) {
    try {
      localStorage.setItem("miuzika.project", JSON.stringify(project));
    } catch {
      // Evita que al recargar se lea una versión vieja de localStorage.
      try {
        localStorage.removeItem("miuzika.project");
      } catch {
        /* noop */
      }
      warnPersistence("No se pudo guardar el proyecto en localStorage; se guardará en IndexedDB.");
    }
    void saveProjectToDb(project).then((ok) => {
      if (!ok) warnPersistence("No se pudo guardar el proyecto en IndexedDB. Exporta el JSON cuanto antes.");
    });
  } else {
    try {
      localStorage.removeItem("miuzika.project");
    } catch {
      /* noop */
    }
    void saveProjectToDb(null);
  }
}

function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem("miuzika.project");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    return parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function loadHistory(): Project[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Project => Boolean(entry) && entry.schemaVersion === 1)
      .slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

interface AudioRecovery {
  project: Project;
  assets: number;
}

/** Si el proyecto se perdió pero los WAV siguen en IndexedDB, crea pistas recuperables. */
async function recoverOrphanAudio(): Promise<AudioRecovery | null> {
  const stored = await listAudioAssets();
  if (stored.length === 0) return null;
  const base = createProject({ name: "Audio recuperado", lengthBars: 32 });
  const barBeats = beatsPerBar(base);
  const ops: Op[] = [];
  const limit = Math.min(stored.length, 32);
  for (let index = 0; index < limit; index++) {
    const asset = stored[index]!;
    if (!(asset.blob instanceof Blob)) continue;
    const name = (asset.name || `Audio ${index + 1}`).slice(0, 60);
    const trackId = `trk_recover_${index}`;
    const durationBeats = Math.max(1, asset.durationBeats || barBeats);
    ops.push(
      {
        op: "add_track",
        id: trackId,
        name,
        kind: "audio",
        instrument: { type: "sampler" },
        gainDb: 0,
        pan: 0,
      },
      {
        op: "register_audio_asset",
        assetId: asset.id,
        name: asset.name,
        durationBeats,
      },
      {
        op: "add_audio_clip",
        trackId,
        assetId: asset.id,
        startBar: 0,
        offsetBeats: 0,
        lengthBeats: Math.min(durationBeats, 64 * barBeats),
        gainDb: 0,
        name,
      },
    );
  }
  if (ops.length === 0) return null;
  try {
    return { project: applyOps(base, ops).project, assets: stored.length };
  } catch {
    return null;
  }
}

function saveHistory(): void {
  try {
    while (history.length > 0 && JSON.stringify(history).length > 4_000_000) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    warnPersistence("El historial no cabe en localStorage; queda en memoria e IndexedDB.");
  }
  void saveHistoryToDb(history);
}

function updateHistoryButtons(): void {
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
}

function recordHistory(): void {
  if (!project) return;
  history.push(structuredClone(project));
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
  saveHistory();
}

async function undo(): Promise<void> {
  if (!ready || restoring || busy) return;
  const previous = history.pop();
  if (!previous) return;
  if (project) future.push(project);
  saveHistory();
  restoring = true;
  setBusy(true, "Cargando audio…");
  try {
    const { missing } = await hydrateProjectAudio(previous);
    applyProject(previous);
    warnMissingAudio(missing);
  } finally {
    restoring = false;
    setBusy(false);
    updateHistoryButtons();
  }
}

async function redo(): Promise<void> {
  if (!ready || restoring || busy) return;
  const next = future.pop();
  if (!next) return;
  if (project) {
    history.push(project);
    if (history.length > HISTORY_LIMIT) history.shift();
  }
  saveHistory();
  restoring = true;
  setBusy(true, "Cargando audio…");
  try {
    const { missing } = await hydrateProjectAudio(next);
    applyProject(next);
    warnMissingAudio(missing);
  } finally {
    restoring = false;
    setBusy(false);
    updateHistoryButtons();
  }
}

function setProject(next: Project | null, record = true): void {
  if (record && project) recordHistory();
  applyProject(next);
  updateHistoryButtons();
}

/** Cambio en vivo (mute/solo): no reinicia el engine ni el playhead. */
function commitLive(next: Project): void {
  if (!project) return;
  const view = activeProject(next);
  if (!view) return;
  recordHistory();
  project = next;
  persist();
  timeline.refresh(view);
  sincronizarStems();
  openDawHandle?.syncMix(view);
  updateActions();
  updateHistoryButtons();
}

function toggleTracksFlag(ids: string[], flag: "muted" | "solo"): void {
  if (!project || busy) return;
  const tracks = project.tracks.filter((track) => ids.includes(track.id));
  if (tracks.length === 0) return;
  const value = !tracks.every((track) => track[flag]);
  const ops: Op[] = tracks.map((track) =>
    flag === "muted"
      ? { op: "set_track", trackId: track.id, muted: value }
      : { op: "set_track", trackId: track.id, solo: value },
  );
  try {
    commitLive(applyOps(project, ops).project);
  } catch (error) {
    addMessage("system", `No se pudo cambiar ${flag}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyProject(next: Project | null): void {
  if (openDawHandle) stopOpenDaw();
  else openDawGeneration++;
  setPlaying(false);
  project = next;
  persist();
  updateActions();
  const view = activeProject(next);
  if (!view) {
    timeline.setProject({
      schemaVersion: 1,
      id: "empty",
      name: "Sin título",
      bpm: 100,
      key: { tonic: "D", mode: "minor" },
      timeSignature: { numerator: 4, denominator: 4 },
      lengthBars: 16,
      seed: 1,
      tracks: [],
      master: { gainDb: 0 },
      meta: { createdAt: new Date().toISOString() },
    });
    songInfo.textContent = "";
    return;
  }
  setProyectoActivo(slugDeProyecto(view));
  timeline.setProject(view);
  // setProject cambia los datos y los cabezales, pero no repinta el lienzo:
  // sin esto, un proyecto aplicado por el agente deja la timeline vacia.
  timeline.relayout();
  sincronizarStems();
  const stats = projectStats(view);
  const minutes = Math.floor(stats.seconds / 60);
  const seconds = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  songInfo.innerHTML =
    `<strong>${escapeHtml(view.name)}</strong>` +
    `<span>${view.bpm} BPM · ${view.key.tonic} ${view.key.mode} · ${view.lengthBars} compases · ` +
    `${stats.tracks} pistas · ${stats.notes} notas · ${minutes}:${seconds}</span>` +
    `<span class="carpeta" title="Carpeta del proyecto en el servidor">proyectos/${escapeHtml(slugDeProyecto(view))}/</span>`;
}

function updateSelectionBar(): void {
  const selected = project?.tracks.filter((track) => selectedTrackIds.includes(track.id)) ?? [];
  const clips = selectedClipIds.length;
  const bar = $<HTMLElement>("selection-bar");
  bar.hidden = selected.length === 0 && clips === 0;
  const partes: string[] = [];
  if (selected.length > 0) partes.push(selected.length === 1 ? "1 pista" : `${selected.length} pistas`);
  if (clips > 0) partes.push(clips === 1 ? "1 clip" : `${clips} clips`);
  $("selection-count").textContent = partes.join(" · ") || "0";
  const enabled = ready && !busy;
  $<HTMLButtonElement>("sel-mute").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-solo").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-delete").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-all").disabled = !enabled || !project || project.tracks.length === 0;
  $<HTMLButtonElement>("sel-clear").disabled = selected.length === 0 && clips === 0;
  $<HTMLButtonElement>("clip-copy").disabled = !enabled || clips === 0;
  $<HTMLButtonElement>("clip-paste").disabled = !enabled || portapapeles.length === 0;
  $<HTMLButtonElement>("clip-dup").disabled = !enabled || clips === 0;
}

/** Devuelve el par (pista, clip) de cada id seleccionado. */
function clipsSeleccionados(): { trackId: string; clipId: string; start: number; length: number }[] {
  if (!project) return [];
  const salida: { trackId: string; clipId: string; start: number; length: number }[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (selectedClipIds.includes(clip.id)) {
        salida.push({ trackId: track.id, clipId: clip.id, start: clip.start, length: clip.length });
      }
    }
  }
  return salida;
}

/** Aplica ops de clips y deja seleccionado lo que ha quedado (las copias, si las hay). */
function aplicarOpsClips(ops: Op[], mensaje: string, seleccionarNuevas: boolean): void {
  if (!project || ops.length === 0) return;
  try {
    const antes = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    const siguiente = applyOps(project, ops).project;
    commitLive(siguiente);
    if (seleccionarNuevas) {
      const nuevas = siguiente.tracks
        .flatMap((track) => track.clips.map((clip) => clip.id))
        .filter((id) => !antes.has(id));
      if (nuevas.length > 0) timeline.selectClips(nuevas);
    }
    addMessage("system", mensaje);
  } catch (error) {
    addMessage("system", `No se pudo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function copiarClips(): void {
  const clips = clipsSeleccionados();
  if (clips.length === 0) return;
  portapapeles = clips.map(({ trackId, clipId, start }) => ({ trackId, clipId, start }));
  addMessage("system", `Copiado(s) ${clips.length} clip(s). Ctrl+V para pegar en el cursor.`);
  updateSelectionBar();
}

function pegarClips(): void {
  if (!project || portapapeles.length === 0) return;
  const base = Math.min(...portapapeles.map((item) => item.start));
  // iman a semicorchea, igual que el arrastre
  const destino = Math.round(currentBeat() / 0.25) * 0.25;
  const ops: Op[] = portapapeles.map((item) => ({
    op: "duplicate_clip" as const,
    trackId: item.trackId,
    clipId: item.clipId,
    startBeat: Math.max(0, destino + (item.start - base)),
  }));
  aplicarOpsClips(ops, `Pegado(s) ${ops.length} clip(s) en el compás ${Math.floor(destino / 4) + 1}.`, true);
}

function duplicarClips(): void {
  const clips = clipsSeleccionados();
  if (clips.length === 0) return;
  const ops: Op[] = clips.map((item) => ({
    op: "duplicate_clip" as const,
    trackId: item.trackId,
    clipId: item.clipId,
    startBeat: item.start + item.length,
  }));
  aplicarOpsClips(ops, `Duplicado(s) ${ops.length} clip(s) a continuación.`, true);
}

function borrarClips(): void {
  const clips = clipsSeleccionados();
  if (clips.length === 0) return;
  const ops: Op[] = clips.map((item) => ({
    op: "remove_clip" as const,
    trackId: item.trackId,
    clipId: item.clipId,
  }));
  aplicarOpsClips(ops, `Borrado(s) ${ops.length} clip(s).`, false);
}

function deleteSelectedTracks(): void {
  if (!project || busy) return;
  const tracks = project.tracks.filter((track) => selectedTrackIds.includes(track.id));
  if (tracks.length === 0) return;
  const label = tracks.length === 1 ? `“${tracks[0]!.name}”` : `${tracks.length} pistas`;
  if (!confirm(`¿Borrar ${label}?`)) return;
  const ops: Op[] = tracks.map((track) => ({ op: "remove_track", trackId: track.id }));
  try {
    setProject(applyOps(project, ops).project);
    addMessage(
      "assistant",
      `Borradas ${tracks.length} pista(s): ${tracks.map((track) => `“${track.name}”`).join(", ")}.`,
    );
  } catch (error) {
    addMessage("system", `No se pudieron borrar: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Renderiza con el motor real de Strudel y lo inserta como pista de audio. */
async function renderStrudelAudioSource(request: CodeAudioRequest): Promise<void> {
  const base = project;
  if (!base) throw new Error("No hay proyecto abierto.");
  const barBeats = beatsPerBar(base);
  const rendered = await renderStrudelAudio(request.code, request.bars, base.bpm, barBeats);
  const assetId = `aud_strudel_${request.sourceId}_${Date.now().toString(36)}`;
  const assetName = `${request.name} [Strudel]`;
  audioAssets.set(assetId, {
    id: assetId,
    name: assetName,
    buffer: rendered.buffer,
    durationBeats: request.bars * barBeats,
    peaks: computePeaks(rendered.buffer),
  });
  if (!(await persistAudioAsset(assetId, assetName, request.bars * barBeats, rendered.blob))) {
    addMessage("system", "El audio Strudel suena en esta sesión, pero no se pudo guardar en IndexedDB.");
  }

  const previous = base.codeSources?.find((source) => source.id === request.sourceId);
  const oldTrackIds = previous?.trackIds.filter((id) =>
    base.tracks.some((track) => track.id === id),
  ) ?? [];
  const trackId = `trk_${request.sourceId}_audio`.slice(0, 64);
  const removeIds = [...new Set([...oldTrackIds, ...(base.tracks.some((t) => t.id === trackId) ? [trackId] : [])])];
  const ops: Op[] = removeIds.map((id) => ({ op: "remove_track", trackId: id }));
  ops.push({
    op: "register_audio_asset",
    assetId,
    name: assetName,
    durationBeats: request.bars * barBeats,
  });
  ops.push({
    op: "add_track",
    id: trackId,
    name: `${request.name} · audio`.slice(0, 60),
    kind: "audio",
    instrument: { type: "sampler" },
  });
  ops.push({
    op: "add_audio_clip",
    trackId,
    assetId,
    startBar: 0,
    lengthBeats: request.bars * barBeats,
    name: assetName.slice(0, 60),
  });
  const { project: next } = applyOps(base, ops);
  const source: CodeSource = {
    id: request.sourceId,
    name: request.name,
    language: "strudel",
    code: request.code,
    bars: request.bars,
    trackIds: [trackId],
    compiledAt: new Date().toISOString(),
    mode: "audio",
    assetId,
  };
  next.codeSources = [
    ...(next.codeSources ?? []).filter((candidate) => candidate.id !== source.id),
    source,
  ];
  setProject(next);
  addMessage(
    "assistant",
    `Strudel audio “${request.name}”: ${rendered.durationSeconds.toFixed(1)} s renderizados con el motor real y añadidos como pista de audio.`,
  );
  for (const warning of rendered.warnings) addMessage("system", `Strudel audio: ${warning}`);
}

function openCodeEditor(): void {
  if (!ready) return;
  if (!project) setProject(createProject({ name: "Strudel", bpm: 120 }));
  if (!project) return;
  openCodeLab({
    project,
    onRenderAudio: renderStrudelAudioSource,
  });
}

// --- Eventos ---------------------------------------------------------------

playButton.addEventListener("click", () => {
  const view = activeProject(project);
  if (!ready || busy || !view || view.tracks.length === 0) return;
  if (openDawHandle) {
    stopOpenDaw();
    return;
  }
  void startOpenDawPlayback(view);
});

stopButton.addEventListener("click", () => {
  stopOpenDaw();
  openDawGeneration++;
  timeline.draw(0);
});

undoButton.addEventListener("click", () => void undo());
redoButton.addEventListener("click", () => void redo());

$("new-song").addEventListener("click", () => {
  if (!ready) return;
  if (project && project.tracks.length > 0 && !confirm("¿Empezar una canción nueva? Se perderá la actual.")) return;
  setProject(null);
  chat.clear();
});

$("code-lab").addEventListener("click", () => openCodeEditor());

$("clip-copy").addEventListener("click", copiarClips);
$("clip-paste").addEventListener("click", pegarClips);
$("clip-dup").addEventListener("click", duplicarClips);
$("sel-mute").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "muted"));
$("sel-solo").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "solo"));
$("sel-delete").addEventListener("click", deleteSelectedTracks);
$("sel-all").addEventListener("click", () => timeline.selectAll());
$("sel-clear").addEventListener("click", () => timeline.clearSelection());

/**
 * Crea pistas reales en el proyecto desde ficheros de workspace/: los .mid como
 * pistas MIDI con sus notas y los .wav como pistas de audio. Reutiliza el mismo
 * camino que el importador de «Audio» (loadAudioFile -> persistAudioAsset -> ops).
 */
async function importarPistasDesdeAgente(
  peticion: PeticionPistas,
): Promise<{ ok: boolean; texto: string }> {
  const inicio = Math.max(0, Math.min(511, Math.trunc(peticion.inicioCompas)));
  const MAX_NOTAS = 2000; // tope de la op add_notes
  const hechas: string[] = [];
  const fallos: string[] = [];

  // 1) sin proyecto hace falta el nombre ANTES de leer nada: la carpeta del
  //    proyecto es lo que permite resolver 'salida/...'. Se crea provisional y
  //    luego se ajustan tempo y compases con set_song.
  let creadoAqui = false;
  if (!project) {
    if (!peticion.nombreProyecto) {
      const sugerencia = nombreDesdeRuta(peticion.midis[0] ?? peticion.wavs[0] ?? "");
      return {
        ok: false,
        texto:
          "No hay proyecto abierto y no me has dado nombre. PREGUNTA al usuario como quiere llamar el " +
          "proyecto" +
          (sugerencia ? ` (sugerencia: "${sugerencia}")` : "") +
          " y vuelve a llamar con nombre_proyecto. No inventes el nombre.",
      };
    }
    setProject(
      createProject({
        name: peticion.nombreProyecto.slice(0, 40),
        bpm: 120,
        lengthBars: 32,
      }),
    );
    creadoAqui = true;
  }

  // 2) leer los MIDI (la carpeta del proyecto ya existe, asi que 'salida/...' resuelve)
  interface PistaMidi {
    name: string;
    program?: number;
    channel?: number;
    notes: { pitch: number; start: number; duration: number; velocity: number }[];
  }
  const material: { ruta: string; bpm: number; tracks: PistaMidi[] }[] = [];
  for (const ruta of peticion.midis) {
    try {
      const res = await fetch(`/api/midi?path=${encodeURIComponent(ruta)}`, {
        headers: cabecerasProyecto(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const datos = (await res.json()) as { bpm?: number; tracks?: PistaMidi[] };
      material.push({
        ruta,
        bpm: Number(datos.bpm) || 120,
        tracks: (datos.tracks ?? []).filter((pista) => (pista.notes?.length ?? 0) > 0),
      });
    } catch (error) {
      fallos.push(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2) si no hay proyecto, se crea con el tempo y la duracion del propio material
  if (!project) {
    return { ok: false, texto: "No se pudo crear el proyecto." };
  }

  let current: Project = project;

  // 3) si lo hemos creado aqui, ajustamos tempo y compases al material real
  if (creadoAqui) {
    let finBeat = 0;
    for (const bloque of material) {
      for (const pista of bloque.tracks) {
        for (const nota of pista.notes) finBeat = Math.max(finBeat, nota.start + nota.duration);
      }
    }
    if (material.length > 0) {
      const bpm = material[0]?.bpm ?? project.bpm;
      const compases = Math.max(4, Math.min(512, Math.ceil(finBeat / 4) + 1));
      current = applyOps(current, [{ op: "set_song", bpm, lengthBars: compases }]).project;
    }
  }

  let contador = current.tracks.length;

  for (const bloque of material) {
    {
      const pistas = bloque.tracks;
      for (const pista of pistas) {
        const prog = pista.program ?? 0;
        const canal = pista.channel ?? 0;
        const tipo: InstrumentType =
          canal === 9
            ? "drumkit"
            : prog === 38
              ? "bass"
              : prog === 89 || prog === 91
                ? "pad"
                : prog === 53
                  ? "lead"
                  : "synth";
        const id = `trk_ag_${contador++}`;
        const nombre = pista.name.slice(0, 60);
        current = applyOps(current, [
          { op: "add_track", id, name: nombre, kind: "midi", instrument: { type: tipo, program: prog } },
        ]).project;
        for (let i = 0; i < pista.notes.length; i += MAX_NOTAS) {
          const trozo = pista.notes.slice(i, i + MAX_NOTAS);
          if (i === 0) {
            current = applyOps(current, [
              { op: "add_notes", trackId: id, startBar: inicio, name: nombre, notes: trozo },
            ]).project;
          } else {
            // Los trozos siguen en el MISMO clip: si no, cada trozo crea un clip
            // nuevo desde el compas inicial y se solapan (Bateria: 2376 notas).
            const clipId = current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
            current = applyOps(current, [
              { op: "add_notes", trackId: id, clipId, notes: trozo },
            ]).project;
          }
        }
        hechas.push(`${nombre} (MIDI, ${pista.notes.length} notas)`);
      }
    }
  }

  // prefijo comun de los WAV, para que las pistas no se llamen "tema_bateria"
  // Prefijo a quitar de los nombres: el del fichero comun y, si no hay varios,
  // el del propio proyecto ("sacramento_bajo.wav" -> "bajo").
  let prefijo = project ? `${slugDeProyecto(project)}_` : "";
  if (peticion.wavs.length > 1) {
    const bases = peticion.wavs.map((r) => (r.split("/").pop() ?? r).replace(/\.[^.]+$/, ""));
    let comun = bases[0] ?? "";
    for (const base of bases.slice(1)) {
      while (comun.length > 0 && !base.startsWith(comun)) comun = comun.slice(0, -1);
    }
    if (comun.includes("_")) prefijo = comun.slice(0, comun.lastIndexOf("_") + 1);
  }

  for (const ruta of peticion.wavs) {
    try {
      const fichero = ruta.split("/").pop() ?? "audio.wav";
      const sinExt = fichero.replace(/\.[^.]+$/, "");
      const recortado = prefijo && sinExt.startsWith(prefijo) ? sinExt.slice(prefijo.length) : sinExt;
      const nombre = (recortado || sinExt || "Audio").slice(0, 60);

      // Los stems largos NO se decodifican: streaming con <audio> y picos del
      // servidor. Asi caben muchos a la vez (la RAM no crece con la duracion).
      const meta = await metadatosWav(ruta);
      if (meta.duracionSeg >= SEGUNDOS_STREAMING) {
        const durationBeats = (meta.duracionSeg * current.bpm) / 60;
        const assetId = `aud_st_${Date.now().toString(36)}_${contador++}`;
        registrarAssetStreaming({
          id: assetId,
          name: nombre,
          durationBeats,
          src: ruta,
          peaks: Float32Array.from(meta.picos),
        });
        guardarAssetsStreaming();
        const existente = current.tracks.find((t) => t.kind === "audio" && t.name === nombre);
        current = applyOps(current, [
          { op: "register_audio_asset", assetId, name: nombre, durationBeats },
          ...(existente
            ? [
                // Reimportar REEMPLAZA los clips de esa pista: asi se corrige una
                // tanda mal recortada sin acabar con dos pistas iguales.
                ...existente.clips.map((clip) => ({
                  op: "remove_clip" as const,
                  trackId: existente.id,
                  clipId: clip.id,
                })),
                {
                  op: "add_audio_clip" as const,
                  assetId,
                  startBar: inicio,
                  lengthBeats: durationBeats,
                  gainDb: 0,
                  name: nombre,
                  trackId: existente.id,
                },
              ]
            : [
                {
                  op: "add_audio_clip" as const,
                  assetId,
                  startBar: inicio,
                  lengthBeats: durationBeats,
                  gainDb: 0,
                  name: nombre,
                  track: { name: nombre },
                },
              ]),
        ]).project;
        hechas.push(
          `${nombre} (audio streaming, ${durationBeats.toFixed(1)} beats, sin decodificar)`,
        );
        continue;
      }

      const res = await fetch(`/api/audio?path=${encodeURIComponent(ruta)}`, {
        headers: cabecerasProyecto(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], fichero, { type: "audio/wav" });
      const asset = await loadAudioFile(file, current.bpm);
      const guardado = await persistAudioAsset(asset.id, asset.name, asset.durationBeats, file);
      current = applyOps(current, [
        {
          op: "register_audio_asset",
          assetId: asset.id,
          name: asset.name,
          durationBeats: asset.durationBeats,
        },
        {
          op: "add_audio_clip",
          assetId: asset.id,
          startBar: inicio,
          lengthBeats: asset.durationBeats,
          gainDb: 0,
          name: nombre,
          track: { name: nombre },
        },
      ]).project;
      hechas.push(
        `${nombre} (audio, ${asset.durationBeats.toFixed(1)} beats${guardado ? "" : ", NO guardado en IndexedDB"})`,
      );
    } catch (error) {
      fallos.push(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (hechas.length > 0) {
    setProject(current);
    addMessage("system", `Pistas anadidas al proyecto: ${hechas.length}.`);
  }
  const texto = [
    hechas.length > 0 ? `Anadidas ${hechas.length} pistas:` : "No se anadio ninguna pista.",
    ...hechas.map((linea) => `- ${linea}`),
    ...(fallos.length > 0 ? ["Fallos:", ...fallos.map((linea) => `- ${linea}`)] : []),
  ].join("\n");
  return { ok: hechas.length > 0, texto };
}

/** Crea un proyecto vacio con el nombre pedido (lo llama el agente tras preguntar). */
function crearProyectoDesdeAgente(peticion: PeticionProyecto): { ok: boolean; texto: string } {
  const nombre = peticion.nombre.trim();
  if (!nombre) return { ok: false, texto: "Falta el nombre del proyecto." };
  const previo = project?.name ?? null;
  const bpm = Math.min(300, Math.max(20, Math.round(peticion.bpm)));
  const compases = Math.min(512, Math.max(4, Math.round(peticion.compases)));
  setProject(createProject({ name: nombre.slice(0, 40), bpm, lengthBars: compases }));
  const carpeta = project ? slugDeProyecto(project) : "?";
  if (previo) {
    addMessage("system", `Sustituido el proyecto “${previo}” por “${nombre}” (Ctrl+Z lo recupera).`);
  }
  addMessage("system", `Proyecto “${nombre}” creado (carpeta proyectos/${carpeta}/).`);
  return {
    ok: true,
    texto: `Proyecto "${nombre}" creado. Carpeta: proyectos/${carpeta}/. Ahora escribe los .wav y .mid en salida/... y llamalos con anadir_pistas.`,
  };
}

/**
 * Mueve faders por nombre de pista: es como el agente aplica una mezcla.
 *
 * Va por ops (set_track), asi que es un cambio normal del proyecto: entra en el
 * historial, se deshace con Ctrl+Z y no reinicia el engine (commitLive).
 */
function ajustarPistasDesdeAgente(peticion: { pistas: AjustePista[] }): { ok: boolean; texto: string } {
  if (!project) return { ok: false, texto: "No hay ningun proyecto abierto." };
  const normal = (texto: string): string =>
    texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const ops: Op[] = [];
  const hechas: string[] = [];
  const faltan: string[] = [];

  for (const ajuste of peticion.pistas) {
    const buscado = normal(ajuste.nombre);
    if (buscado === "") continue;
    const pista =
      project.tracks.find((t) => normal(t.name) === buscado) ??
      project.tracks.find((t) => normal(t.name).includes(buscado)) ??
      project.tracks.find((t) => buscado.includes(normal(t.name)));
    if (!pista) {
      faltan.push(ajuste.nombre);
      continue;
    }
    const op: Op = { op: "set_track", trackId: pista.id };
    const cambios: string[] = [];
    if (typeof ajuste.gainDb === "number" && Number.isFinite(ajuste.gainDb)) {
      op.gainDb = Math.min(12, Math.max(-60, ajuste.gainDb));
      cambios.push(`${op.gainDb >= 0 ? "+" : ""}${op.gainDb.toFixed(1)} dB`);
    }
    if (typeof ajuste.pan === "number" && Number.isFinite(ajuste.pan)) {
      op.pan = Math.min(1, Math.max(-1, ajuste.pan));
      cambios.push(`paneo ${op.pan.toFixed(2)}`);
    }
    if (typeof ajuste.muted === "boolean") {
      op.muted = ajuste.muted;
      cambios.push(ajuste.muted ? "mute" : "sin mute");
    }
    if (typeof ajuste.solo === "boolean") {
      op.solo = ajuste.solo;
      cambios.push(ajuste.solo ? "solo" : "sin solo");
    }
    if (cambios.length === 0) continue;
    ops.push(op);
    hechas.push(`${pista.name}: ${cambios.join(", ")}`);
  }

  if (ops.length > 0) {
    try {
      commitLive(applyOps(project, ops).project);
    } catch (error) {
      return {
        ok: false,
        texto: `No se pudo ajustar: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const partes: string[] = [];
  if (hechas.length > 0) partes.push(`Ajustadas ${hechas.length} pista(s):\n${hechas.join("\n")}`);
  if (faltan.length > 0) {
    const nombres = project.tracks.map((t) => t.name).join(", ");
    partes.push(`No encuentro: ${faltan.join(", ")}. Las pistas son: ${nombres}.`);
  }
  if (partes.length === 0) partes.push("No habia nada que cambiar.");
  return { ok: hechas.length > 0, texto: partes.join("\n\n") };
}

registrarImportador(importarPistasDesdeAgente);
registrarCreador(crearProyectoDesdeAgente);
registrarAjustador(ajustarPistasDesdeAgente);

/** ¿Es un fichero de audio? (por MIME o por extension) */
function esAudio(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(wav|mp3|ogg|oga|flac|aif|aiff|m4a)$/i.test(file.name);
}

/** RAM que ocupan los audio ya decodificados (Float32 intercalado). */
function ramAudioBytes(): number {
  let total = 0;
  for (const asset of audioAssets.values()) {
    if (!asset.buffer) continue; // los de streaming no ocupan RAM
    total += asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }
  return total;
}

/**
 * Mete ficheros de audio en el proyecto: una pista por fichero, en el compas actual.
 * Lo usan tanto el boton «Audio» como «Abrir» (una sola via para lo mismo).
 */
async function importarAudio(files: File[]): Promise<void> {
  if (!ready || files.length === 0) return;
  if (!project) {
    addMessage("system", "Genera una canción antes de importar audio.");
    return;
  }
  const LIMITE_RAM = 900 * 1024 * 1024; // ~900 MB: por encima el navegador se cae
  setBusy(true, "Importando audio…");
  try {
    let current = project;
    let persisted = true;
    let cortado = false;
    const bar = Math.floor(currentBeat() / beatsPerBar(current));
    for (const file of files) {
      if (ramAudioBytes() > LIMITE_RAM) {
        cortado = true;
        break;
      }
      const asset = await loadAudioFile(file, current.bpm);
      if (!(await persistAudioAsset(asset.id, asset.name, asset.durationBeats, file))) persisted = false;
      // pista propia por fichero: asi cada stem tiene su fader
      current = applyOps(current, [
        {
          op: "register_audio_asset",
          assetId: asset.id,
          name: asset.name,
          durationBeats: asset.durationBeats,
        },
        {
          op: "add_audio_clip",
          assetId: asset.id,
          startBar: bar,
          lengthBeats: asset.durationBeats,
          gainDb: 0,
          name: asset.name,
          track: { name: asset.name.slice(0, 60) || "Audio" },
        },
      ]).project;
    }
    setProject(current);
    addMessage(
      "assistant",
      `Añadidos ${files.length - (cortado ? 1 : 0)} audio(s) en el compás ${bar + 1}, cada uno en su pista.`,
    );
    if (cortado) {
      addMessage(
        "system",
        `Paré en ${Math.round(ramAudioBytes() / 1048576)} MB de audio en memoria (límite ~900 MB): ` +
          "el navegador se quedaría sin aire. Importa los stems restantes en otra tanda.",
      );
    }
    if (!persisted) {
      addMessage(
        "system",
        "El audio suena en esta sesión, pero no se pudo guardar en IndexedDB; se perderá al recargar.",
      );
    }
  } catch (error) {
    addMessage("system", `No se pudo importar: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

$<HTMLInputElement>("audio-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await importarAudio(files);
});

$<HTMLInputElement>("open").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const todos = Array.from(input.files ?? []);
  input.value = "";
  if (!ready || todos.length === 0) return;

  // El mismo boton sirve para proyecto (.json/.zip) y para audio (WAV, uno o varios).
  const audios = todos.filter(esAudio);
  const proyectos = todos.filter((file) => !esAudio(file));

  if (proyectos.length > 1) {
    addMessage("system", `Solo se abre un proyecto a la vez: uso «${proyectos[0].name}».`);
  }

  if (proyectos.length > 0) {
    const file = proyectos[0];
    setBusy(true, "Cargando proyecto…");
    try {
      let parsed: Project;
      let bundleWarnings: string[] = [];
      if (/\.(miuzika\.)?zip$/i.test(file.name)) {
        const imported = await importProjectBundle(file);
        parsed = imported.project;
        bundleWarnings = imported.warnings;
      } else {
        parsed = JSON.parse(await file.text()) as Project;
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tracks)) {
          throw new Error("Formato no reconocido");
        }
      }
      const { missing } = await hydrateProjectAudio(parsed);
      setProject(parsed);
      addMessage("assistant", `Abierto “${parsed.name}”.`);
      for (const warning of bundleWarnings) addMessage("system", warning);
      warnMissingAudio(missing);
    } catch (error) {
      addMessage("system", `No se pudo abrir: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  if (audios.length > 0) await importarAudio(audios);
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
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
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedClipIds.length > 0) {
        event.preventDefault();
        borrarClips();
        return;
      }
      if (selectedTrackIds.length === 0) return;
      event.preventDefault();
      deleteSelectedTracks();
    }
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "a") {
    event.preventDefault();
    timeline.selectAll();
  } else if (key === "c") {
    event.preventDefault();
    copiarClips();
  } else if (key === "v") {
    event.preventDefault();
    pegarClips();
  } else if (key === "d") {
    event.preventDefault();
    duplicarClips();
  } else if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) void redo();
    else void undo();
  } else if (key === "y") {
    event.preventDefault();
    void redo();
  }
});

// --- Arranque --------------------------------------------------------------

async function boot(): Promise<void> {
  // Los assets de streaming no estan en IndexedDB: viven en el servidor.
  for (const guardado of assetsStreamingGuardados()) {
    if (!audioAssets.has(guardado.id)) registrarAssetStreaming(guardado);
  }
  let restoredFromDb = false;
  let recoveredAssets = 0;

  if (!project) {
    const stored = await loadProjectFromDb();
    if (stored) {
      project = stored;
      restoredFromDb = true;
    }
  }
  if (history.length === 0) {
    const storedHistory = await loadHistoryFromDb();
    if (storedHistory.length > 0) history = storedHistory.slice(-HISTORY_LIMIT);
  }
  if (!project) {
    const recovered = await recoverOrphanAudio();
    if (recovered) {
      project = recovered.project;
      recoveredAssets = recovered.assets;
    }
  }

  const hasAudio = Boolean(
    project &&
      ((project.audioAssets?.length ?? 0) > 0 ||
        project.tracks.some((track) => track.clips.some((clip) => clip.audio))),
  );
  let result: Awaited<ReturnType<typeof hydrateProjectAudio>> = { loaded: 0, missing: [] };

  if (hasAudio) setBusy(true, "Cargando audio…");
  try {
    if (project) result = await hydrateProjectAudio(project);
  } catch (error) {
    addMessage(
      "system",
      `No se pudo cargar el audio guardado: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (hasAudio) setBusy(false);
  }

  if (project) {
    setProject(project, false);
    addMessage("assistant", `Proyecto cargado: "${project.name}". Pulsa play para escuchar.`);
    if (restoredFromDb) {
      addMessage("system", "Proyecto recuperado desde IndexedDB (localStorage no tenía una copia).");
    }
    if (recoveredAssets > 0) {
      addMessage(
        "system",
        `He encontrado ${recoveredAssets} WAV sueltos en IndexedDB y he creado un proyecto de recuperación con una pista por WAV. La disposición original no se puede reconstruir.`,
      );
    }
    if (result.missing.length > 0) {
      warnMissingAudio(result.missing);
    } else if (result.loaded > 0) {
      addMessage("system", `Audio restaurado desde IndexedDB: ${result.loaded} WAV.`);
    }
  } else {
    setProject(null, false);
  }

  setPlaying(false);
  ready = true;
  updateActions();
}

updateActions();
void boot();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__miuzika = {
    timeline,
    llm: { getModel, setModel, health, listModels },
    undo,
    redo,
    get project() {
      return project;
    },
    get audioAssets() {
      return audioAssets;
    },
    get openDawPlayback() {
      return openDawHandle;
    },
    get history() {
      return history;
    },
    get future() {
      return future;
    },
    anadirPistas: importarPistasDesdeAgente,
    stems: stemPlayer,
    crearProyecto: crearProyectoDesdeAgente,
    ajustarPistas: ajustarPistasDesdeAgente,
    nuevoProyecto: (nombre: string, bpm: number, lengthBars: number) =>
      setProject(createProject({ name: nombre, bpm, lengthBars })),
  };
}
