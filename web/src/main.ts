import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
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
import { openBounceDialog } from "./bounce-dialog.ts";
import { openSampleLab } from "./sample-lab.ts";
import { PreviewPlayer } from "./player.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";

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

function pickExamples(count = 4): Example[] {
  const pool = [...EXAMPLE_POOL];
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  const chosen: Example[] = [];
  const tags = new Set<string>();
  for (const example of pool) {
    if (tags.has(example.tag)) continue;
    chosen.push(example);
    tags.add(example.tag);
    if (chosen.length === count) return chosen;
  }
  for (const example of pool) {
    if (chosen.length >= count) break;
    if (!chosen.includes(example)) chosen.push(example);
  }
  return chosen;
}

function renderExamples(): void {
  examples.innerHTML = "";
  for (const example of pickExamples(4)) {
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
  if (!project) return;
  if (player.isPlaying) player.play(project, beat);
  else player.seek(project, beat);
};

timeline.onToggleMute = (trackId) => {
  if (!project) return;
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return;
  track.muted = !track.muted;
  timeline.setMuted(trackId, track.muted);
  player.setTrackMuted(trackId, track.muted);
  persist();
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
function updateActions(): void {
  const enabled = ready && !busy;
  const hasProject = project !== null;
  const hasTracks = Boolean(project && project.tracks.length > 0);
  const hasMidi = Boolean(
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
}

function setPlaying(value: boolean): void {
  playButton.textContent = value ? "❚❚" : "▶";
  playButton.classList.toggle("active", value);
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

function persist(): void {
  if (project) localStorage.setItem("miuzika.project", JSON.stringify(project));
  else localStorage.removeItem("miuzika.project");
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

function saveHistory(): void {
  try {
    while (history.length > 0 && JSON.stringify(history).length > 4_000_000) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* sin historial persistente */
    }
  }
}

function updateHistoryButtons(): void {
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
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
  if (record && project) {
    history.push(structuredClone(project));
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
    saveHistory();
  }
  applyProject(next);
  updateHistoryButtons();
}

function applyProject(next: Project | null): void {
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
  }
  project = next;
  persist();
  updateActions();
  if (!next) {
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
  timeline.setProject(next);
  const stats = projectStats(next);
  const minutes = Math.floor(stats.seconds / 60);
  const seconds = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  songInfo.innerHTML = `<strong>${escapeHtml(next.name)}</strong><span>${next.bpm} BPM · ${next.key.tonic} ${next.key.mode} · ${next.lengthBars} compases · ${stats.tracks} pistas · ${stats.notes} notas · ${minutes}:${seconds}</span>`;
}

async function api<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(130_000),
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

async function send(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (!text || busy || !ready) return;
  addMessage("user", text);
  promptInput.value = "";
  setBusy(true, "Pensando…");

  try {
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
  if (!ready || !project) return;
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
    return;
  }
  const end = project.lengthBars * beatsPerBar(project);
  const from = player.beat >= end - 0.25 ? 0 : player.beat;
  player.play(project, from);
  setPlaying(true);
});

stopButton.addEventListener("click", () => {
  player.stop();
  setPlaying(false);
  if (project) player.seek(project, 0);
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

$("export-stems").addEventListener("click", async () => {
  if (!ready || !project || project.tracks.length === 0) return;
  setBusy(true, "Renderizando stems…");
  try {
    const { renderStems } = await import("./render.ts");
    const files = await renderStems(project, {
      onProgress: (index, total, name) => setStatus(`Stem ${index}/${total}: ${name}…`),
    });
    const { zipStems } = await import("./stems-zip.ts");
    const archive = await zipStems(files);
    download(archive, `${slug(project.name)}-stems.zip`);
    addMessage("assistant", `Stems listos: ${files.length} pistas (pre-máster, con sus FX).`);
  } catch (error) {
    addMessage("system", `No se pudieron renderizar los stems: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
});

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

$("bounce-samples").addEventListener("click", () => {
  if (!ready || !project) return;
  const midiTracks = project.tracks.filter((track) => track.kind === "midi");
  if (midiTracks.length === 0) {
    addMessage("system", "No hay pistas MIDI que congelar.");
    return;
  }
  const base = project;
  openBounceDialog({
    tracks: midiTracks,
    onConvert: (ids) => void convertToSamples(base, ids),
  });
});

$("export-midi").addEventListener("click", () => {
  if (!ready || !project || project.tracks.length === 0) return;
  const bytes = projectToMidi(project);
  download(new Blob([bytes as BlobPart], { type: "audio/midi" }), `${slug(project.name)}.mid`);
});

$("export-json").addEventListener("click", () => {
  if (!ready || !project) return;
  download(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${slug(project.name)}.json`,
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
  if (!ready || !project || project.tracks.length === 0) return;
  setBusy(true, "Renderizando WAV…");
  try {
    const target = $<HTMLSelectElement>("master-target").value;
    const options =
      target === "raw"
        ? { normalize: false }
        : { targetLufs: target === "commercial" ? -10 : -14 };
    const { renderProject } = await import("./render.ts");
    const result = await renderProject(project, options);
    download(result.blob, `${slug(project.name)}.wav`);
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
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
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
    if (result.missing.length > 0) {
      warnMissingAudio(result.missing);
    } else if (result.loaded > 0) {
      addMessage("system", `Audio restaurado desde IndexedDB: ${result.loaded} WAV.`);
    }
  } else {
    setProject(null, false);
    addMessage(
      "assistant",
      "Soy Mizu, tu coproductor. Pídeme una canción completa o un loop: “synth pop 80s oscuro en re menor, lenta”.",
    );
  }

  setPlaying(false);
  ready = true;
  updateActions();
}

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
    get history() {
      return history;
    },
    get future() {
      return future;
    },
  };
}
