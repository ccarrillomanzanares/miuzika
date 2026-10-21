import type { InstrumentType, Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import type { SampleRequest } from "../../src/agent/sample-plan.ts";
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
  decodeAudioBlob,
  hydrateProjectAudio,
  loadAudioFile,
  persistAudioAsset,
} from "./audio-store.ts";
import { loadDrumKit } from "./drum-kit.ts";
import { openPianoRoll } from "./editor.ts";
import { openBounceDialog } from "./bounce-dialog.ts";
import { openSampleLab } from "./sample-lab.ts";
import { PreviewPlayer } from "./player.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";

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

const player = new PreviewPlayer();
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

const SAMPLE_EXAMPLE_POOL: Example[] = [
  { tag: "sample", text: "crea un sample de sintetizador dark wave" },
  { tag: "sample", text: "crea un kick industrial seco y contundente" },
  { tag: "sample", text: "crea un pad ambient cálido y ancho" },
  { tag: "sample", text: "crea un loop de batería siniestra" },
  { tag: "sample", text: "crea un bajo dark wave con distorsión" },
  { tag: "sample", text: "crea un riser de ruido para techno" },
  { tag: "sample", text: "crea un pluck metálico para hip hop" },
  { tag: "sample", text: "crea un stab industrial en re menor" },
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
  const pool = MIDI_ENABLED ? EXAMPLE_POOL : SAMPLE_EXAMPLE_POOL;
  for (const example of pickExamples(pool, 4)) {
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

timeline.onSeek = (beat) => {
  const view = activeProject(project);
  if (!view) return;
  if (openDawHandle) {
    openDawHandle.seek(beat);
    timeline.draw(beat);
    return;
  }
  if (player.isPlaying) player.play(view, beat);
  else player.seek(view, beat);
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

player.onTick = (beat) => timeline.draw(beat);
player.onEnd = () => setPlaying(false);

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
    promptInput.placeholder = "Describe el sample que quieres crear…";
    statusEl.textContent = "Enter envía · pide samples · Ctrl+rueda = zoom";
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
  $<HTMLButtonElement>("bounce-samples").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("export-midi").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("export-opendaw").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("export-json").disabled = !enabled || !hasProject;
  $<HTMLInputElement>("audio-file").disabled = !enabled || !hasProject;
  $<HTMLInputElement>("open").disabled = !enabled;
  $<HTMLSelectElement>("master-target").disabled = !enabled || !hasTracks;
  $<HTMLButtonElement>("sample-lab").disabled = !enabled;
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
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
  }
  setBusy(true, "Arrancando engine openDAW…");
  try {
    const { playWithOpenDaw } = await import("./opendaw-engine.ts");
    const endBeat = view.lengthBars * beatsPerBar(view);
    const handle = await playWithOpenDaw(view, (beat) => {
      timeline.draw(beat);
      if (openDawHandle && beat >= endBeat - 0.05) stopOpenDaw();
    });
    if (generation !== openDawGeneration) {
      handle.stop();
      return;
    }
    openDawHandle = handle;
    setPlaying(true);
    addMessage("assistant", "Reproduciendo con el engine de openDAW.");
  } catch (error) {
    if (generation !== openDawGeneration) return;
    addMessage(
      "system",
      `Engine openDAW no disponible (${error instanceof Error ? error.message : String(error)}). Uso el player interno.`,
    );
    const from = player.beat >= view.lengthBars * beatsPerBar(view) - 0.25 ? 0 : player.beat;
    player.play(view, from);
    setPlaying(true);
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
        instrument: { type: sampleInstrument(undefined, name) },
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

/** Cambio en vivo (mute/solo): no reinicia el player ni el playhead. */
function commitLive(next: Project): void {
  if (!project) return;
  const view = activeProject(next);
  if (!view) return;
  recordHistory();
  project = next;
  persist();
  timeline.refresh(view);
  player.setMuteState(view);
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
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
  }
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
const SAMPLE_INTENT = /\b(samples?|muestras?|wav)\b/i;

async function convertToSamples(base: Project, ids: string[]): Promise<void> {
  setBusy(true, "Congelando pistas a audio…");
  try {
    const { bounceTracks } = await import("./bounce.ts");
    const next = await bounceTracks(
      base,
      ids,
      (index, total, name) => setStatus(`Congelando ${index}/${total}: ${name}…`),
      (message) => addMessage("system", message),
    );
    setProject(next);
    addMessage(
      "assistant",
      `Congeladas ${ids.length} pista(s) a audio. Las no marcadas siguen en MIDI.`,
    );
  } catch (error) {
    addMessage("system", `No se pudo congelar: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

function updateSelectionBar(): void {
  const selected = project?.tracks.filter((track) => selectedTrackIds.includes(track.id)) ?? [];
  const bar = $<HTMLElement>("selection-bar");
  bar.hidden = selected.length === 0;
  $("selection-count").textContent = selected.length === 1 ? "1 pista" : `${selected.length} pistas`;
  const enabled = ready && !busy;
  const hasMidi = selected.some((track) => track.kind === "midi");
  $<HTMLButtonElement>("sel-mute").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-solo").disabled = !enabled || selected.length === 0;
  $<HTMLButtonElement>("sel-freeze").disabled = !enabled || !hasMidi;
  $<HTMLButtonElement>("sel-rendered").disabled = !enabled || !hasMidi;
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

function openFreezeDialog(): void {
  if (!ready || busy || !project) return;
  const midiTracks = project.tracks.filter((track) => track.kind === "midi");
  if (midiTracks.length === 0) {
    addMessage("system", "No hay pistas MIDI que congelar.");
    return;
  }
  const preselected = midiTracks
    .filter((track) => selectedTrackIds.includes(track.id))
    .map((track) => track.id);
  const base = project;
  openBounceDialog({
    tracks: midiTracks,
    ...(preselected.length > 0 ? { preselected } : {}),
    onConvert: (ids) => void convertToSamples(base, ids),
  });
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

function sampleInstrument(role: SampleRequest["role"] | undefined, trackName: string): InstrumentType {
  switch (role) {
    case "drums":
      return "drumkit";
    case "bass":
      return "bass";
    case "chords":
    case "pad":
      return "pad";
    case "lead":
      return "lead";
    case "arp":
      return "arp";
    default: {
      const name = trackName.toLowerCase();
      if (/drum|bater|perc|kick|snare/.test(name)) return "drumkit";
      if (/bass|bajo|sub/.test(name)) return "bass";
      if (/pad|chord|acord|ambient/.test(name)) return "pad";
      if (/lead|guitar|pluck|hook/.test(name)) return "lead";
      if (/arp/.test(name)) return "arp";
      return "synth";
    }
  }
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const TRACK_ALIASES: Record<string, string[]> = {
  drumkit: ["drum", "drums", "bateria", "percus"],
  bass: ["bass", "bajo", "sub"],
  synth: ["synth", "sintetizador"],
  pad: ["pad", "acordes", "chord"],
  lead: ["lead", "guitarra", "melodia"],
  arp: ["arp", "arpegio"],
};

function findAudioTrack(text: string, tracks: Track[]): Track | undefined {
  const haystack = normalizeText(text);
  for (const track of tracks) {
    if (haystack.includes(normalizeText(track.name))) return track;
  }
  for (const track of tracks) {
    const aliases = TRACK_ALIASES[track.instrument.type] ?? [];
    if (aliases.some((alias) => haystack.includes(alias))) return track;
  }
  return undefined;
}

interface AudioEditPlan {
  startBar: number;
  endBar: number;
  trackId: string;
  trackName: string;
}

function parseAudioEdit(text: string): AudioEditPlan | null {
  const view = activeProject(project);
  if (!view) return null;
  if (!/\b(cambia|cambiar|modifica|modificar|edita|editar|reemplaza|reemplazar|sustituye|sustituir|varia|variar|haz|genera)\b/i.test(text)) {
    return null;
  }
  const match = text.match(
    /(?:comp[aá]s(?:es)?|estrofas?|barras?|del|desde)?\s*(\d{1,3})\s*(?:a|al|hasta|–|-)\s*(\d{1,3})/i,
  );
  if (!match) return null;
  let start = Number(match[1]);
  let end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end) [start, end] = [end, start];
  start = Math.max(1, Math.min(view.lengthBars, start));
  end = Math.max(start, Math.min(view.lengthBars, end));
  const track = findAudioTrack(text, view.tracks.filter((candidate) => candidate.kind === "audio"));
  if (!track) return null;
  return { startBar: start - 1, endBar: end, trackId: track.id, trackName: track.name };
}

async function replaceAudioRange(text: string, plan: AudioEditPlan): Promise<void> {
  const full = project;
  const view = activeProject(full);
  if (!full || !view) return;
  const track = full.tracks.find((candidate) => candidate.id === plan.trackId);
  if (!track || track.kind !== "audio") return;

  const barBeats = beatsPerBar(full);
  const startBeat = plan.startBar * barBeats;
  const endBeat = plan.endBar * barBeats;
  const lengthBeats = endBeat - startBeat;
  const overlapping = track.clips.filter(
    (clip) => clip.audio && clip.start < endBeat && clip.start + clip.length > startBeat,
  );
  if (
    overlapping.some(
      (clip) =>
        !Number.isInteger(clip.start / barBeats) ||
        !Number.isInteger((clip.start + clip.length) / barBeats),
    )
  ) {
    addMessage(
      "system",
      "Esa pista tiene clips que no están alineados al compás; todavía no puedo cortarlos con precisión.",
    );
    return;
  }

  const seconds = (lengthBeats * 60) / full.bpm;
  setStatus(`Generando variación de ${track.name}…`);
  const generated = await api<{ wav: string; code: string }>(
    "/api/sound/create",
    {
      prompt: `${text}. Nueva variación para ${track.name}, compases ${plan.startBar + 1}–${plan.endBar}, ${full.bpm} BPM, ${full.key.tonic} ${full.key.mode}.`,
      duration: seconds,
      sampleRate: 48_000,
      seed: full.seed + plan.startBar * 7919 + plan.endBar,
      bpm: full.bpm,
      key: full.key,
      params: { kind: "one_shot", bars: plan.endBar - plan.startBar },
    },
    360_000,
  );
  setStatus(`Montando ${track.name}…`);
  const bytes = Uint8Array.from(atob(generated.wav), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: "audio/wav" });
  const buffer = await decodeAudioBlob(blob);
  const durationBeats = (buffer.duration * full.bpm) / 60;
  const assetId = `aud_edit_${Date.now().toString(36)}`;
  audioAssets.set(assetId, {
    id: assetId,
    name: `${track.name} ${plan.startBar + 1}-${plan.endBar}`,
    buffer,
    durationBeats,
    peaks: computePeaks(buffer),
  });
  if (!(await persistAudioAsset(assetId, `${track.name} ${plan.startBar + 1}-${plan.endBar}`, durationBeats, blob))) {
    addMessage("system", "La variación suena en esta sesión, pero no se pudo guardar en IndexedDB.");
  }

  const ops: Op[] = [
    {
      op: "register_audio_asset",
      assetId,
      name: `${track.name} ${plan.startBar + 1}-${plan.endBar}`,
      durationBeats,
    },
  ];
  for (const clip of overlapping) {
    if (!clip.audio) continue;
    ops.push({ op: "remove_clip", trackId: track.id, clipId: clip.id });
    if (clip.start < startBeat) {
      const leftBeats = startBeat - clip.start;
      ops.push({
        op: "add_audio_clip",
        trackId: track.id,
        assetId: clip.audio.assetId,
        startBar: clip.start / barBeats,
        offsetBeats: clip.audio.offset + leftBeats,
        lengthBeats: leftBeats,
        gainDb: clip.audio.gainDb,
        name: clip.name,
      });
    }
    if (clip.start + clip.length > endBeat) {
      const rightBeats = clip.start + clip.length - endBeat;
      ops.push({
        op: "add_audio_clip",
        trackId: track.id,
        assetId: clip.audio.assetId,
        startBar: endBeat / barBeats,
        offsetBeats: clip.audio.offset + (endBeat - clip.start),
        lengthBeats: rightBeats,
        gainDb: clip.audio.gainDb,
        name: clip.name,
      });
    }
  }
  ops.push({
    op: "add_audio_clip",
    trackId: track.id,
    assetId,
    startBar: plan.startBar,
    offsetBeats: 0,
    lengthBeats,
    gainDb: 0,
    name: `${track.name} ${plan.startBar + 1}-${plan.endBar}`,
  });

  setProject(applyOps(full, ops).project);
  addMessage(
    "assistant",
    `He cambiado los compases ${plan.startBar + 1}–${plan.endBar} de “${track.name}” con una variación nueva. El resto de la pista sigue igual.`,
  );
  if (Math.abs(durationBeats - lengthBeats) > 0.25) {
    addMessage("system", `La variación mide ${durationBeats.toFixed(2)} beats y el hueco ${lengthBeats}; revisa el empalme.`);
  }
}

async function createSamplesFromChat(text: string): Promise<void> {
  let base = project;
  if (!base) {
    base = createProject({ name: "Nuevo proyecto", prompt: text });
    setProject(base);
  }

  setStatus("Planificando samples…");
  const plan = await api<{ samples: SampleRequest[] }>("/api/sample/plan", {
    prompt: text,
    project: base,
  });
  if (plan.samples.length === 0) throw new Error("El plan no devolvió ningún sample.");

  const barBeats = beatsPerBar(base);
  const ops: Op[] = [];
  const created: Array<{ name: string; track: string; detail: string }> = [];

  for (let index = 0; index < plan.samples.length; index++) {
    const request = plan.samples[index]!;
    setStatus(`Escribiendo DSP ${index + 1}/${plan.samples.length}: ${request.name}…`);
    try {
      const loopSeconds = (request.bars * 4 * 60) / base.bpm;
      const duration = request.kind === "loop" ? loopSeconds : 2.4;
      const generated = await api<{ wav: string; code: string; frames: number }>(
        "/api/sound/create",
        {
          prompt:
            request.kind === "loop"
              ? `${request.prompt}. Loop de ${request.bars} compases, sin cola, preparado para repetir.`
              : request.prompt,
          duration,
          sampleRate: 48_000,
          seed: base.seed + index * 7919,
          bpm: base.bpm,
          key: base.key,
          params: { kind: request.kind, bars: request.bars, role: request.role ?? null },
        },
        360_000,
      );
      setStatus(`Renderizando ${request.name}…`);
      const bytes = Uint8Array.from(atob(generated.wav), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/wav" });
      const buffer = await decodeAudioBlob(blob);
      const durationBeats =
        request.kind === "loop" ? request.bars * 4 : (buffer.duration * base.bpm) / 60;
      const assetId = `aud_${slug(request.name)}_${Date.now().toString(36)}_${index}`;
      audioAssets.set(assetId, {
        id: assetId,
        name: request.name,
        buffer,
        durationBeats,
        peaks: computePeaks(buffer),
      });
      if (!(await persistAudioAsset(assetId, request.name, durationBeats, blob))) {
        addMessage(
          "system",
          `“${request.name}” no se pudo guardar en IndexedDB; sonará en esta sesión y se perderá al recargar.`,
        );
      }

      const trackName = request.track || request.name;
      const trackId = `trk_sample_${Date.now().toString(36)}_${index}`;
      ops.push(
        {
          op: "add_track",
          id: trackId,
          name: trackName,
          kind: "audio",
          instrument: { type: sampleInstrument(request.role, trackName) },
          gainDb: 0,
          pan: 0,
        },
        {
          op: "register_audio_asset",
          assetId,
          name: request.name,
          durationBeats,
        },
      );

      if (request.kind === "loop") {
        let repeats = 0;
        for (let startBar = 0; startBar < base.lengthBars; startBar += request.bars) {
          const lengthBeats = Math.min(
            request.bars * barBeats,
            (base.lengthBars - startBar) * barBeats,
          );
          ops.push({
            op: "add_audio_clip",
            trackId,
            assetId,
            startBar,
            offsetBeats: 0,
            lengthBeats,
            gainDb: 0,
            name: request.name,
          });
          repeats++;
        }
        created.push({
          name: request.name,
          track: trackName,
          detail: `loop de ${request.bars} compases ×${repeats}`,
        });
      } else {
        ops.push({
          op: "add_audio_clip",
          trackId,
          assetId,
          startBar: 0,
          offsetBeats: 0,
          lengthBeats: Math.min(durationBeats, 64 * barBeats),
          gainDb: 0,
          name: request.name,
        });
        created.push({
          name: request.name,
          track: trackName,
          detail: `one-shot de ${durationBeats.toFixed(2)} beats`,
        });
      }
    } catch (error) {
      addMessage(
        "system",
        `No se pudo crear “${request.name}”: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (created.length === 0) throw new Error("No se pudo renderizar ningún sample.");
  setProject(applyOps(base, ops).project);
  addMessage(
    "assistant",
    `He creado ${created.length} sample(s) de audio:\n${created
      .map((item) => `· “${item.name}” → pista “${item.track}” (${item.detail})`)
      .join("\n")}\n\nEstán montados en la timeline. Pulsa ▶ para escucharlos.`,
  );
  addMessage("system", "Son pistas de audio.");
}

async function renderRenderedSelection(): Promise<void> {
  if (!MIDI_ENABLED || busy || !project) return;
  const base = project;
  const tracks = base.tracks.filter(
    (track) => track.kind === "midi" && selectedTrackIds.includes(track.id),
  );
  if (tracks.length === 0) {
    addMessage("system", "Selecciona al menos una pista MIDI para renderizar con Rendered.");
    return;
  }

  setBusy(true, "Renderizando con Rendered…");
  const ops: Op[] = [];
  const done: string[] = [];
  const barBeats = beatsPerBar(base);
  const totalBeats = base.lengthBars * barBeats;
  const maxClipBeats = 64 * barBeats;

  try {
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index]!;
      setStatus(`Rendered ${index + 1}/${tracks.length}: ${track.name}…`);
      try {
        const data = await api<{ wav: string; notes: number }>(
          "/api/rendered/track",
          { project: base, trackId: track.id },
          360_000,
        );
        const bytes = Uint8Array.from(atob(data.wav), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/wav" });
        const buffer = await decodeAudioBlob(blob);
        const name = `${track.name} [Rendered]`.slice(0, 60);
        const assetId = `aud_rendered_${Date.now().toString(36)}_${index}`;
        audioAssets.set(assetId, {
          id: assetId,
          name,
          buffer,
          durationBeats: totalBeats,
          peaks: computePeaks(buffer),
        });
        if (!(await persistAudioAsset(assetId, name, totalBeats, blob))) {
          addMessage("system", `“${name}” no se pudo guardar en IndexedDB; se perderá al recargar.`);
        }

        const newTrackId = `trk_rendered_${Date.now().toString(36)}_${index}`;
        ops.push(
          {
            op: "add_track",
            id: newTrackId,
            name,
            kind: "audio",
            instrument: { type: track.instrument.type },
            gainDb: 0,
            pan: 0,
          },
          {
            op: "register_audio_asset",
            assetId,
            name,
            durationBeats: totalBeats,
          },
        );
        for (let offset = 0; offset < totalBeats; offset += maxClipBeats) {
          const length = Math.min(maxClipBeats, totalBeats - offset);
          ops.push({
            op: "add_audio_clip",
            trackId: newTrackId,
            assetId,
            startBar: offset / barBeats,
            offsetBeats: offset,
            lengthBeats: length,
            gainDb: 0,
            name,
          });
        }
        ops.push({
          op: "set_track",
          trackId: track.id,
          muted: true,
          solo: false,
        });
        done.push(track.name);
      } catch (error) {
        addMessage(
          "system",
          `Rendered falló en “${track.name}”: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (done.length === 0) throw new Error("No se pudo renderizar ninguna pista con Rendered.");
    setProject(applyOps(base, ops).project);
    addMessage(
      "assistant",
      `Rendered: ${done.length} pista(s) (${done.join(", ")}). Las pistas MIDI originales quedan silenciadas para comparar; puedes reactivarlas o deshacer.`,
    );
    addMessage("system", "Rendered usa las voces Python del motor, no el sintetizador WebAudio.");
  } catch (error) {
    addMessage("system", `Rendered: ${error instanceof Error ? error.message : String(error)}`);
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
    const edit = parseAudioEdit(text);
    if (edit) {
      await replaceAudioRange(text, edit);
      return;
    }
    if (SAMPLE_INTENT.test(text)) {
      await createSamplesFromChat(text);
      return;
    }
    if (!MIDI_ENABLED) {
      const audioTracks = activeProject(project)?.tracks.map((track) => `“${track.name}”`) ?? [];
      addMessage(
        "assistant",
        audioTracks.length > 0
          ? `Puedo crear samples o cambiar una sección de una pista de audio. Por ejemplo: “cambia los compases 25 a 29 de ${audioTracks[0]} con otra melodía”. Pistas: ${audioTracks.join(", ")}.`
          : "Pídeme un sample: “crea un kick industrial”, “un pad ambient cálido” o “un bajo dark wave”.",
      );
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

// --- Eventos ---------------------------------------------------------------

playButton.addEventListener("click", () => {
  const view = activeProject(project);
  if (!ready || busy || !view || view.tracks.length === 0) return;
  if (openDawHandle) {
    stopOpenDaw();
    return;
  }
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
    return;
  }

  // MIDI puro: engine de openDAW. Mezclas con audio: player interno (SampleService pendiente).
  if (!view.tracks.some((track) => track.kind === "audio") && view.tracks.some((track) => track.kind === "midi")) {
    void startOpenDawPlayback(view);
    return;
  }

  const end = view.lengthBars * beatsPerBar(view);
  const from = player.beat >= end - 0.25 ? 0 : player.beat;
  player.play(view, from);
  setPlaying(true);
});

stopButton.addEventListener("click", () => {
  if (openDawHandle) {
    stopOpenDaw();
    return;
  }
  openDawGeneration++;
  player.stop();
  setPlaying(false);
  const view = activeProject(project);
  if (view) player.seek(view, 0);
});

undoButton.addEventListener("click", () => void undo());
redoButton.addEventListener("click", () => void redo());

$("new-song").addEventListener("click", () => {
  if (!ready) return;
  if (project && project.tracks.length > 0 && !confirm("¿Empezar una canción nueva? Se perderá la actual.")) return;
  setProject(null);
  messages.innerHTML = "";
  addMessage("assistant", "Cuéntame qué quieres crear: género, tonalidad, tempo, instrumentos o una referencia.");
});

$("export-stems").addEventListener("click", () => void exportStems());

$("sample-lab").addEventListener("click", () => {
  if (!ready) return;
  const base = project ?? createProject({ name: "Nuevo proyecto" });
  if (!project) setProject(base);

  openSampleLab({
    bpm: base.bpm,
    key: base.key,
    tracks: base.tracks.filter((track) => track.kind === "audio").map((track) => track.name),
    onInsert: async ({ result, trackName }) => {
      const base = project;
      if (!base) return;
      const assetId = `aud_${slug(result.name)}_${Date.now().toString(36)}`;
      audioAssets.set(assetId, {
        id: assetId,
        name: result.name,
        buffer: result.buffer,
        durationBeats: result.durationBeats,
        peaks: computePeaks(result.buffer),
      });

      const bar = Math.min(511, Math.floor(player.beat / beatsPerBar(base)));
      const existing = base.tracks.find(
        (track) => track.kind === "audio" && track.name === trackName,
      );
      const ops: Op[] = [
        {
          op: "register_audio_asset",
          assetId,
          name: result.name,
          durationBeats: result.durationBeats,
        },
        {
          op: "add_audio_clip",
          ...(existing ? { trackId: existing.id } : { track: { name: trackName } }),
          assetId,
          startBar: bar,
          lengthBeats: Math.min(result.durationBeats, 64),
          gainDb: 0,
          name: result.name,
        },
      ];

      const saved = await persistAudioAsset(
        assetId,
        result.name,
        result.durationBeats,
        result.blob,
      );
      try {
        setProject(applyOps(base, ops).project);
        addMessage(
          "assistant",
          `Sample “${result.name}” insertado en “${trackName}”, compás ${bar + 1} (${result.durationBeats.toFixed(2)} beats).`,
        );
        if (!saved) {
          addMessage(
            "system",
            "El sample suena en esta sesión, pero no se pudo guardar en IndexedDB; se perderá al recargar.",
          );
        }
      } catch (error) {
        addMessage("system", `No se pudo insertar: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
});

$("bounce-samples").addEventListener("click", openFreezeDialog);

$("sel-mute").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "muted"));
$("sel-solo").addEventListener("click", () => toggleTracksFlag(selectedTrackIds, "solo"));
$("sel-freeze").addEventListener("click", openFreezeDialog);
$("sel-rendered").addEventListener("click", () => void renderRenderedSelection());
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

$("export-opendaw").addEventListener("click", async () => {
  if (!ready || !project || project.tracks.length === 0) return;
  setBusy(true, "Generando proyecto openDAW…");
  try {
    const { projectToOpenDaw } = await import("../../src/host/opendaw/adapter.ts");
    const result = await projectToOpenDaw(project);
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
    const bar = Math.floor(player.beat / beatsPerBar(current));
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
  setBusy(true, "Cargando audio…");
  try {
    const parsed = JSON.parse(await file.text()) as Project;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tracks)) throw new Error("Formato no reconocido");
    const { missing } = await hydrateProjectAudio(parsed);
    setProject(parsed);
    addMessage("assistant", `Abierto “${parsed.name}”.`);
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
        "Este proyecto tiene pistas MIDI legacy: están ocultas y no se usan en modo audio. Crea pistas nuevas con samples.",
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
        : "Soy Mizu, tu coproductor. Pídeme samples: “crea un kick industrial”, “un pad ambient cálido” o “un bajo dark wave”.",
    );
  }

  setPlaying(false);
  ready = true;
  updateActions();
}

applyMode();
updateActions();
void loadDrumKit();
void player.prepare();
void boot();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__miuzika = {
    player,
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
