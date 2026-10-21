import type { CodeSource, Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { MIDI_ENABLED } from "../../src/config.ts";
import { listAudioAssets } from "./audio-db.ts";
import {
  loadHistoryFromDb,
  loadProjectFromDb,
  saveHistoryToDb,
  saveProjectToDb,
} from "./project-db.ts";
import { createProject, projectStats } from "../../src/core/project.ts";
import { projectToMidi } from "../../src/core/midi.ts";
import { applyOps } from "../../src/core/ops.ts";
import type { Op } from "../../src/core/ops.ts";
import {
  audioAssets,
  computePeaks,
  hydrateProjectAudio,
  loadAudioFile,
  persistAudioAsset,
} from "./audio-store.ts";
import { loadDrumKit } from "./drum-kit.ts";
import { openPianoRoll } from "./editor.ts";
import { openCodeLab } from "./code-lab.ts";
import type { CodeAudioRequest } from "./code-lab.ts";
import { renderStrudelAudio } from "./strudel-audio.ts";
import { exportProjectBundle, importProjectBundle } from "./project-bundle.ts";
import { fetchSongArtifact, openSongAgent } from "./song-agent.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";
import type { OpenDawAudioAsset } from "../../src/host/opendaw/adapter.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("timeline");
const wrap = $("canvas-wrap");
const heads = $("track-heads");
const messages = $("messages");
const promptInput = $<HTMLTextAreaElement>("prompt");
const sendButton = $<HTMLButtonElement>("send");
const playButton = $<HTMLButtonElement>("play");
const stopButton = $<HTMLButtonElement>("stop");
const undoButton = $<HTMLButtonElement>("undo");
const redoButton = $<HTMLButtonElement>("redo");
const statusEl = $("status");
const songInfo = $("song-info");
const examples = $("examples");

const timeline = new TimelineView(canvas, wrap, heads);

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

interface Example {
  text: string;
  tag: string;
}

const EXAMPLE_POOL: Example[] = [
  { tag: "synthpop", text: "créame una canción synth pop 80's oscura en re menor, lenta" },
  { tag: "synthpop", text: "synthpop cálido en la menor con pads y bajo pulsante" },
  { tag: "punk", text: "punk siniestro español de los 80, en mi menor" },
  { tag: "punk", text: "loop de bajo y batería estilo siniestro punk" },
  { tag: "techno", text: "techno hipnótico en la menor a 132 bpm, 32 compases" },
  { tag: "techno", text: "techno industrial oscuro con arp y kick contundente" },
  { tag: "ambient", text: "ambient melancólico para estudiar, sin batería" },
  { tag: "ambient", text: "drone ambient en do lidio, muy lento y sin percusión" },
  { tag: "rock", text: "rock en mi menor con guitarras distorsionadas" },
  { tag: "hiphop", text: "hip hop con swing en fa menor, 88 bpm" },
  { tag: "pop", text: "canción de 16 compases en do mayor, alegre" },
  { tag: "textura", text: "crea un loop de arp y pads en la menor" },
];

function pickExamples(pool: Example[], count = 4): Example[] {
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  const chosen: Example[] = [];
  const tags = new Set<string>();
  for (const example of shuffled) {
    if (tags.has(example.tag)) continue;
    chosen.push(example);
    tags.add(example.tag);
    if (chosen.length === count) return chosen;
  }
  for (const example of shuffled) {
    if (chosen.length >= count) break;
    if (!chosen.includes(example)) chosen.push(example);
  }
  return chosen;
}

function renderExamples(): void {
  examples.innerHTML = "";
  for (const example of pickExamples(EXAMPLE_POOL, 4)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = example.text;
    button.title = example.text;
    button.addEventListener("click", () => {
      promptInput.value = example.text;
      promptInput.focus();
    });
    examples.appendChild(button);
  }
  const shuffle = document.createElement("button");
  shuffle.type = "button";
  shuffle.className = "shuffle";
  shuffle.title = "Otras ideas";
  shuffle.setAttribute("aria-label", "Otras ideas");
  shuffle.textContent = "↻";
  shuffle.addEventListener("click", renderExamples);
  examples.appendChild(shuffle);
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
  sendButton.disabled = value;
  sendButton.textContent = value ? "…" : "Enviar";
  setStatus(text);
  updateActions();
}

/** Activa solo las acciones que tienen sentido para el proyecto actual. */
/** En modo audio oculta las pistas MIDI legacy sin borrarlas del proyecto guardado. */
function activeProject(source: Project | null): Project | null {
  if (!source || MIDI_ENABLED) return source;
  const tracks = source.tracks.filter((track) => track.kind === "audio");
  return tracks.length === source.tracks.length ? source : { ...source, tracks };
}

function applyMode(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-midi-only]")) {
    element.hidden = !MIDI_ENABLED;
  }
  if (!MIDI_ENABLED) {
    promptInput.placeholder = "Describe el cambio que quieres hacer…";
    statusEl.textContent = "Enter envía · Ctrl+rueda = zoom";
    document.body.classList.add("audio-only");
  }
}

function updateActions(): void {
  const enabled = ready && !busy;
  const view = activeProject(project);
  const hasProject = project !== null;
  const hasTracks = Boolean(view && view.tracks.length > 0);
  const hasMidi = Boolean(
    MIDI_ENABLED &&
      project?.tracks.some(
        (track) => track.kind === "midi" && track.clips.some((clip) => clip.notes.length > 0),
      ),
  );

  $<HTMLButtonElement>("export-wav").disabled = !enabled || !hasTracks;
  $<HTMLButtonElement>("export-stems").disabled = !enabled || !hasTracks;
  $<HTMLButtonElement>("export-midi").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("export-opendaw").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("export-json").disabled = !enabled || !hasProject;
  $<HTMLButtonElement>("save-bundle").disabled = !enabled || !hasProject;
  $<HTMLInputElement>("audio-file").disabled = !enabled || !hasProject;
  $<HTMLInputElement>("open").disabled = !enabled;
  $<HTMLSelectElement>("master-target").disabled = !enabled || !hasTracks;
  $<HTMLButtonElement>("code-lab").disabled = !enabled;
  $<HTMLButtonElement>("song-agent").disabled = !enabled;
  $<HTMLButtonElement>("fit-timeline").disabled = !enabled || !hasProject;
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

function addMessage(role: "user" | "assistant" | "system", text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
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

/** Mensaje con reproductor para escuchar el render sin salir de la app. */
function addAudioMessage(blob: Blob, text: string): void {
  const div = document.createElement("div");
  div.className = "msg assistant";
  const caption = document.createElement("div");
  caption.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = URL.createObjectURL(blob);
  audio.className = "render-audio";
  div.append(caption, audio);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
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

async function api<T>(url: string, body: unknown, timeoutMs = 130_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("El asistente tardó demasiado. Inténtalo de nuevo.");
    }
    throw new Error("No se pudo contactar con el servidor local. ¿Sigue corriendo `npm run dev`?");
  }

  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(
      `El servidor no devolvió respuesta (${response.status}). Puede haber reiniciado; vuelve a intentarlo.`,
    );
  }
  let data: T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error(`Respuesta inválida del servidor (${response.status}). Revisa la terminal de Vite.`);
  }
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

const NEW_SONG = /\b(otra canci[oó]n|nueva canci[oó]n|canci[oó]n nueva|desde cero|de cero|empezar de nuevo|empieza de nuevo)\b/i;
const STRUDEL_INTENT = /\b(strudel|patr[oó]n(es)? de c[oó]digo|c[oó]digo generativo)\b/i;

function updateSelectionBar(): void {
  const selected = project?.tracks.filter((track) => selectedTrackIds.includes(track.id)) ?? [];
  const bar = $<HTMLElement>("selection-bar");
  bar.hidden = selected.length === 0;
  $("selection-count").textContent = selected.length === 1 ? "1 pista" : `${selected.length} pistas`;
  const enabled = ready && !busy;
  $<HTMLButtonElement>("sel-mute").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-solo").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-stems").disabled = !enabled || selected.length === 0;
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

async function exportStems(trackIds?: string[]): Promise<void> {
  const base = activeProject(project);
  if (busy || !base || base.tracks.length === 0) return;
  setBusy(true, "Renderizando stems…");
  try {
    const { renderStems } = await import("./render.ts");
    const files = await renderStems(base, {
      ...(trackIds && trackIds.length > 0 ? { trackIds } : {}),
      onProgress: (index, total, name) => setStatus(`Stem ${index}/${total}: ${name}…`),
    });
    const { zipStems } = await import("./stems-zip.ts");
    const archive = await zipStems(files);
    const suffix = trackIds && trackIds.length > 0 ? "-seleccion" : "-stems";
    download(archive, `${slug(base.name)}${suffix}.zip`);
    addMessage("assistant", `Stems listos: ${files.length} pista(s) (pre-máster, con sus FX).`);
  } catch (error) {
    addMessage("system", `No se pudieron renderizar los stems: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

async function send(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (!text || busy || !ready) return;
  addMessage("user", text);
  promptInput.value = "";
  setBusy(true, "Pensando…");

  try {
    if (STRUDEL_INTENT.test(text)) {
      openCodeEditor();
      addMessage("assistant", "Abre el editor Strudel y pulsa «Renderizar WAV» para insertar el audio.");
      return;
    }

    const wantsTrack = /\b(añade|añadir|agrega|agregar|crea|crear)\b[\s\S]*\b(pista|track|parte)\b/i.test(text);
    if (!project && wantsTrack) {
      setProject(createProject({ name: "Nuevo proyecto" }));
    }
    const startsEmpty = project !== null && project.tracks.length === 0;
    const generateSong = !project || (startsEmpty && !wantsTrack) || NEW_SONG.test(text);

    if (generateSong) {
      const data = await api<{ project: Project; warnings?: string[] }>("/api/generate", { prompt: text });
      setProject(data.project);
      addMessage(
        "assistant",
        `Listo: “${data.project.name}”. ${data.project.tracks.length} pistas, ${data.project.lengthBars} compases. Pulsa ▶ para escucharlo.`,
      );
      for (const warning of data.warnings ?? []) addMessage("system", warning);
    } else {
      const data = await api<{ project: Project; text: string; toolLog: Array<{ name: string; ok: boolean }> }>(
        "/api/chat",
        { prompt: text, project },
      );
      setProject(data.project);
      addMessage("assistant", data.text || "Hecho.");
      const failed = data.toolLog.filter((entry) => !entry.ok);
      if (failed.length > 0) addMessage("system", `Herramientas con error: ${failed.map((entry) => entry.name).join(", ")}`);
    }
  } catch (error) {
    addMessage("system", `Error: ${error instanceof Error ? error.message : String(error)}`);
    if (!promptInput.value.trim()) promptInput.value = text;
  } finally {
    setBusy(false);
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "miuzika"
  );
}

/** Inserta una compilación Strudel en un proyecto; no toca el estado global. */
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

function openSongAgentDialog(): void {
  if (!ready) return;
  openSongAgent({
    onOpen: async (job) => {
      if (!job.bundle) throw new Error("El job no tiene bundle.");
      const blob = await fetchSongArtifact(job.id, job.bundle);
      const imported = await importProjectBundle(blob);
      const { missing } = await hydrateProjectAudio(imported.project);
      setProject(imported.project);
      addMessage(
        "assistant",
        `Canción abierta: “${imported.project.name}”. ${imported.project.tracks.length} pistas, ${imported.project.lengthBars} compases.`,
      );
      for (const warning of imported.warnings) addMessage("system", `Canción: ${warning}`);
      warnMissingAudio(missing);
    },
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
$("fit-timeline").addEventListener("click", () => timeline.fitToProject());

$("new-song").addEventListener("click", () => {
  if (!ready) return;
  if (project && project.tracks.length > 0 && !confirm("¿Empezar una canción nueva? Se perderá la actual.")) return;
  setProject(null);
  messages.innerHTML = "";
  addMessage("assistant", "Cuéntame qué quieres crear: género, tonalidad, tempo, instrumentos o una referencia.");
});

$("export-stems").addEventListener("click", () => void exportStems());

$("song-agent").addEventListener("click", () => openSongAgentDialog());
$("code-lab").addEventListener("click", () => openCodeEditor());

$("sel-mute").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "muted"));
$("sel-solo").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "solo"));
$("sel-stems").addEventListener("click", () => void exportStems(selectedTrackIds));
$("sel-delete").addEventListener("click", deleteSelectedTracks);
$("sel-all").addEventListener("click", () => timeline.selectAll());
$("sel-clear").addEventListener("click", () => timeline.clearSelection());

$("export-midi").addEventListener("click", () => {
  if (!ready || !project || project.tracks.length === 0) return;
  const bytes = projectToMidi(project);
  download(new Blob([bytes as BlobPart], { type: "audio/midi" }), `${slug(project.name)}.mid`);
});

$("export-json").addEventListener("click", () => {
  const view = activeProject(project);
  if (!ready || !view) return;
  download(
    new Blob([JSON.stringify(view, null, 2)], { type: "application/json" }),
    `${slug(view.name)}.json`,
  );
});

$("save-bundle").addEventListener("click", async () => {
  const view = activeProject(project);
  if (!ready || !view || busy) return;
  setBusy(true, "Empaquetando proyecto y WAVs…");
  try {
    const result = await exportProjectBundle(view);
    download(result.blob, `${slug(view.name)}.miuzika.zip`);
    addMessage(
      "assistant",
      `Proyecto guardado con MIDI, metadatos y WAVs (${(result.blob.size / 1024 / 1024).toFixed(1)} MB).`,
    );
    for (const warning of result.warnings) addMessage("system", warning);
  } catch (error) {
    addMessage("system", `No se pudo empaquetar el proyecto: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
});

function openDawAudioFiles(source: Project): Map<string, OpenDawAudioAsset> {
  const files = new Map<string, OpenDawAudioAsset>();
  for (const asset of source.audioAssets ?? []) {
    const loaded = audioAssets.get(asset.id);
    if (!loaded) continue;
    const uuid = new Uint8Array(16);
    crypto.getRandomValues(uuid);
    files.set(asset.id, {
      chunks: [
        {
          uuid,
          name: asset.name,
          durationInSeconds: loaded.buffer.duration,
          startInSeconds: 0,
        },
      ],
      durationInSeconds: loaded.buffer.duration,
    });
  }
  return files;
}

$("export-opendaw").addEventListener("click", async () => {
  if (!ready || !project || project.tracks.length === 0) return;
  setBusy(true, "Generando proyecto openDAW…");
  try {
    const { projectToOpenDaw } = await import("../../src/host/opendaw/adapter.ts");
    const result = await projectToOpenDaw(project, { audioAssets: openDawAudioFiles(project) });
    download(new Blob([result.bytes], { type: "application/octet-stream" }), `${slug(project.name)}.odw`);
    addMessage(
      "assistant",
      `Proyecto openDAW generado: ${result.stats.tracks} pistas, ${result.stats.regions} clips, ${result.stats.notes} notas, ${result.stats.devices} FX.`,
    );
    for (const warning of result.warnings) addMessage("system", `openDAW: ${warning}`);
  } catch (error) {
    addMessage("system", `No se pudo exportar a openDAW: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
});

$("export-wav").addEventListener("click", async () => {
  const view = activeProject(project);
  if (!ready || !view || view.tracks.length === 0) return;
  setBusy(true, "Renderizando WAV…");
  try {
    const target = $<HTMLSelectElement>("master-target").value;
    const options =
      target === "raw"
        ? { normalize: false }
        : { targetLufs: target === "commercial" ? -10 : -14 };
    const { renderProject } = await import("./render.ts");
    const result = await renderProject(view, options);
    download(result.blob, `${slug(view.name)}.wav`);
    addAudioMessage(
      result.blob,
      `WAV renderizado (${(result.blob.size / 1024 / 1024).toFixed(1)} MB) · ${result.loudness.lufs.toFixed(1)} LUFS · pico ${result.loudness.truePeakDb.toFixed(1)} dBTP. Reproducción aquí abajo; el archivo también se ha descargado.`,
    );
  } catch (error) {
    addMessage("system", `No se pudo renderizar: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
});

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

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  void send(promptInput.value);
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send(promptInput.value);
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

renderExamples();

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
    addMessage("assistant", `Proyecto cargado: “${project.name}”. Pide cambios o pulsa ▶.`);
    if (restoredFromDb) {
      addMessage("system", "Proyecto recuperado desde IndexedDB (localStorage no tenía una copia).");
    }
    if (recoveredAssets > 0) {
      addMessage(
        "system",
        `He encontrado ${recoveredAssets} WAV sueltos en IndexedDB y he creado un proyecto de recuperación con una pista por WAV. La disposición original no se puede reconstruir.`,
      );
    }
    if (!MIDI_ENABLED && project.tracks.some((track) => track.kind === "midi")) {
      addMessage(
        "system",
        "Este proyecto tiene pistas MIDI legacy: están ocultas y no se usan en modo audio.",
      );
    }
    if (result.missing.length > 0) {
      warnMissingAudio(result.missing);
    } else if (result.loaded > 0) {
      addMessage("system", `Audio restaurado desde IndexedDB: ${result.loaded} WAV.`);
    }
  } else {
    setProject(null, false);
    addMessage(
      "assistant",
      MIDI_ENABLED
        ? "Soy Mizu, tu coproductor. Pídeme una canción completa o un loop: “synth pop 80s oscuro en re menor, lenta”."
        : "Soy Mizu, tu coproductor. Pídeme cambios sobre el proyecto.",
    );
  }

  setPlaying(false);
  ready = true;
  updateActions();
}

applyMode();
updateActions();
void loadDrumKit();
void boot();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__miuzika = {
    timeline,
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
