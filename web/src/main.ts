import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { projectStats } from "../../src/core/project.ts";
import { projectToMidi } from "../../src/core/midi.ts";
import { applyOps } from "../../src/core/ops.ts";
import type { Op } from "../../src/core/ops.ts";
import { loadAudioFile } from "./audio-store.ts";
import { loadDrumKit } from "./drum-kit.ts";
import { openPianoRoll } from "./editor.ts";
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
const statusEl = $("status");
const songInfo = $("song-info");
const examples = $("examples");

const player = new PreviewPlayer();
const timeline = new TimelineView(canvas, wrap, heads);

let project: Project | null = loadStored();
let busy = false;

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

function setProject(next: Project | null): void {
  if (player.isPlaying) {
    player.stop();
    setPlaying(false);
  }
  project = next;
  persist();
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

async function send(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (!text || busy) return;
  addMessage("user", text);
  promptInput.value = "";
  setBusy(true, "Pensando…");

  try {
    if (!project || project.tracks.length === 0 || NEW_SONG.test(text)) {
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
  if (!project) return;
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

$("new-song").addEventListener("click", () => {
  if (project && project.tracks.length > 0 && !confirm("¿Empezar una canción nueva? Se perderá la actual.")) return;
  setProject(null);
  messages.innerHTML = "";
  addMessage("assistant", "Cuéntame qué quieres crear: género, tonalidad, tempo, instrumentos o una referencia.");
});

$("export-midi").addEventListener("click", () => {
  if (!project || project.tracks.length === 0) return;
  const bytes = projectToMidi(project);
  download(new Blob([bytes as BlobPart], { type: "audio/midi" }), `${slug(project.name)}.mid`);
});

$("export-json").addEventListener("click", () => {
  if (!project) return;
  download(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${slug(project.name)}.json`,
  );
});

$("export-opendaw").addEventListener("click", async () => {
  if (!project || project.tracks.length === 0) return;
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
  if (!project || project.tracks.length === 0) return;
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
    addMessage(
      "assistant",
      `Mixdown listo (${(result.blob.size / 1024 / 1024).toFixed(1)} MB) · ${result.loudness.lufs.toFixed(1)} LUFS · pico ${result.loudness.truePeakDb.toFixed(1)} dBTP.`,
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
  if (files.length === 0) return;
  if (!project) {
    addMessage("system", "Genera una canción antes de importar audio.");
    return;
  }
  setBusy(true, "Importando audio…");
  try {
    let current = project;
    const bar = Math.floor(player.beat / beatsPerBar(current));
    const maxLength = 16 * beatsPerBar(current);
    for (const file of files) {
      const asset = await loadAudioFile(file, current.bpm);
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
  } catch (error) {
    addMessage("system", `No se pudo importar: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
});

$<HTMLInputElement>("open").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as Project;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tracks)) throw new Error("Formato no reconocido");
    setProject(parsed);
    addMessage("assistant", `Abierto “${parsed.name}”.`);
  } catch (error) {
    addMessage("system", `No se pudo abrir: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
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

renderExamples();

// --- Arranque --------------------------------------------------------------

if (project) {
  setProject(project);
  addMessage("assistant", `Proyecto cargado: “${project.name}”. Pide cambios o pulsa ▶.`);
  if (project.tracks.some((track) => track.clips.some((clip) => clip.audio))) {
    addMessage(
      "system",
      "Este proyecto contiene audio, pero los WAV no se guardan en el JSON: vuelve a importarlos con «Audio».",
    );
  }
} else {
  setProject(null);
  addMessage(
    "assistant",
    "Soy Mizu, tu coproductor. Pídeme una canción completa o un loop: “synth pop 80s oscuro en re menor, lenta”.",
  );
}
setPlaying(false);
void loadDrumKit();
void player.prepare();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__miuzika = {
    player,
    timeline,
    get project() {
      return project;
    },
  };
}
