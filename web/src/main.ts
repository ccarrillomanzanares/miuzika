import type { CodeSource, Project } from "../../src/core/types.ts";
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
  audioAssets,
  computePeaks,
  hydrateProjectAudio,
  loadAudioFile,
  persistAudioAsset,
} from "./audio-store.ts";
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
      sistema.content =
        AGENTE_SISTEMA + (manifiestoMotor ? `\n\n=== MOTOR DISPONIBLE ===\n${manifiestoMotor}` : "");
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
let persistenceWarned = false;
let openDawHandle: OpenDawPlaybackHandle | null = null;
let openDawGeneration = 0;

const HISTORY_KEY = "miuzika.history";
const HISTORY_LIMIT = 8;
let history: Project[] = loadHistory();
let future: Project[] = [];

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
    const handle = await playWithOpenDaw(
      view,
      (beat) => {
        timeline.draw(beat);
        if (openDawHandle && beat >= endBeat - 0.05) stopOpenDaw();
      },
      audioAssets,
    );
    if (generation !== openDawGeneration) {
      handle.stop();
      return;
    }
    openDawHandle = handle;
    setPlaying(true);
    addMessage("assistant", "Reproduciendo con el engine de openDAW.");
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
  timeline.setProject(view);
  const stats = projectStats(view);
  const minutes = Math.floor(stats.seconds / 60);
  const seconds = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  songInfo.innerHTML = `<strong>${escapeHtml(view.name)}</strong><span>${view.bpm} BPM · ${view.key.tonic} ${view.key.mode} · ${view.lengthBars} compases · ${stats.tracks} pistas · ${stats.notes} notas · ${minutes}:${seconds}</span>`;
}

function updateSelectionBar(): void {
  const selected = project?.tracks.filter((track) => selectedTrackIds.includes(track.id)) ?? [];
  const bar = $<HTMLElement>("selection-bar");
  bar.hidden = selected.length === 0;
  $("selection-count").textContent = selected.length === 1 ? "1 pista" : `${selected.length} pistas`;
  const enabled = ready && !busy;
  $<HTMLButtonElement>("sel-mute").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-solo").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-delete").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-all").disabled = !enabled || !project || project.tracks.length === 0;
  $<HTMLButtonElement>("sel-clear").disabled = selected.length === 0;
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

$("sel-mute").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "muted"));
$("sel-solo").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "solo"));
$("sel-delete").addEventListener("click", deleteSelectedTracks);
$("sel-all").addEventListener("click", () => timeline.selectAll());
$("sel-clear").addEventListener("click", () => timeline.clearSelection());

$<HTMLInputElement>("audio-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!ready || files.length === 0) return;
  if (!project) {
    addMessage("system", "Genera una canción antes de importar audio.");
    return;
  }
  setBusy(true, "Importando audio…");
  try {
    let current = project;
    let persisted = true;
    const bar = Math.floor(currentBeat() / beatsPerBar(current));
    const maxLength = 16 * beatsPerBar(current);
    for (const file of files) {
      const asset = await loadAudioFile(file, current.bpm);
      if (!(await persistAudioAsset(asset.id, asset.name, asset.durationBeats, file))) persisted = false;
      const existing = current.tracks.find((track) => track.kind === "audio" && track.name === "Audio");
      const base = {
        op: "add_audio_clip" as const,
        assetId: asset.id,
        startBar: bar,
        lengthBeats: Math.min(asset.durationBeats, maxLength),
        gainDb: 0,
        name: asset.name,
      };
      const addOp: Op = existing
        ? { ...base, trackId: existing.id }
        : { ...base, track: { name: "Audio" } };
      const ops: Op[] = [
        {
          op: "register_audio_asset",
          assetId: asset.id,
          name: asset.name,
          durationBeats: asset.durationBeats,
        },
        addOp,
      ];
      current = applyOps(current, ops).project;
    }
    setProject(current);
    addMessage(
      "assistant",
      `Añadidos ${files.length} audio(s) en el compás ${bar + 1}. Ahora puedes pedirme que los mueva, los recorte o los mezcle.`,
    );
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
});

$<HTMLInputElement>("open").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!ready || !file) return;
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
    input.value = "";
  }
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
  };
}
