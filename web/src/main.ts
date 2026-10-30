import type { CodeSource, Project } from "../../src/core/types.ts";
import { promptDelSistema } from "./agente-prompt.ts";
import { FormularioEncargo } from "./formulario-encargo.ts";
import { escribirEnCompositor, setAbrirEncargo } from "./chat.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeProyecto, createProject, projectStats } from "../../src/core/project.ts";
import { compasesDeAudio } from "../../src/core/tiempo.ts";
import { applyOps } from "../../src/core/ops.ts";
import type { Op } from "../../src/core/ops.ts";
import {
  assetsPorStreaming,
  reservarDecodificado,
  audioAssets,
  computePeaks,
  hidratarAssets,
  idDeAsset,
  liberarAssetsNoUsados,
  loadAudioFile,
  metadatosWav,
  registrarAssetStreaming,
  rutaEnProyecto,
} from "./audio-store.ts";
import { StemPlayer } from "./stem-player.ts";
import { openPianoRoll } from "./editor.ts";
import { openCodeLab } from "./code-lab.ts";
import type { CodeAudioRequest } from "./code-lab.ts";
import { renderStrudelAudio } from "./strudel-audio.ts";
import { importProjectBundle } from "./project-bundle.ts";
import {
  carpetaDeRuta,
  interpretarProyectoEnDisco,
  nombreDeProyectoDesdeFicheros,
  rutaDeProyecto,
  serializarProyecto,
} from "./proyecto-archivo.ts";
import {
  guardarProyectoEnDisco,
  leerProyectoDeDisco,
  listarProyectos,
  subirAudio,
} from "./proyecto-disco.ts";
import { TimelineView, escapeHtml } from "./timeline.ts";
import { initChat } from "./chat.ts";
import { initCosteGpu } from "./gpu-coste.ts";
import { minutosYsegundos, sinSenales } from "./gpu-texto.ts";
import { vigilarVersion } from "./build.ts";
import { cargarConfigLlm, getModel, health, listModels, setModel } from "./llm.ts";
import { AjustesModelos } from "./ajustes-modelos.ts";
import type { ChatMessage } from "./llm.ts";
import { ejecutarAgente } from "./agent/agent.ts";
import {
  agregarTurno,
  bloqueContexto,
  interpretarAgente,
  recortarConversacion,
  serializarAgente,
} from "./agent/contexto.ts";
import type { TurnoAgente } from "./agent/contexto.ts";
import { fraseBarra, lineaResumen, pasoTerminado, segundos } from "./agent/actividad.ts";
import { cabeceraDeProyecto, registrarAcciones, setProyectoActivo } from "./agent/tools.ts";
import { crearAcciones } from "./agent/acciones.ts";
import { CARPETA_VERSIONES, nombreDeVersion } from "../../src/core/versiones.ts";
import { ejecutarHerramienta } from "./agent/tools.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";
import { PanelPad } from "./pad.ts";
import { audioBufferToWav } from "./wav.ts";
import { midiDeProyecto } from "../../src/core/midi-export.ts";
import { informeEscucha, nivelesPorTramo, notasPorTramo, type PistaEscuchada } from "../../src/core/escucha.ts";
import { locale, traducirPagina } from "./i18n.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Fixed page texts in the browser's language (the conversation does not go through here).
traducirPagina();

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
/** GPU spending counter (generic: fed by /api/gpu/estado). */
const costeGpu = initCosteGpu(document.getElementById("gpu-coste"));

const timeline = new TimelineView(canvas, wrap, heads);

// Collapsing the chat frees up space: the canvas has to be readjusted.
chat.onLayout(() => timeline.relayout());

// ── Agent: thinks and acts (the server sets the key; the workspace sets the hands)
const AGENTE_SISTEMA = promptDelSistema();

let manifiestoMotor = "";

/** Fetches the engine manifest and makes it available to the prompt. */
async function refrescarManifiesto(): Promise<void> {
  try {
    const res = await fetch("/api/manifiesto");
    if (!res.ok) return;
    const datos = (await res.json()) as { manifiesto?: string };
    manifiestoMotor = datos.manifiesto ?? "";
    const sistema = conversacion[0];
    if (sistema && sistema.role === "system") {
      const carpeta = project
        ? `\n\n=== OPEN PROJECT ===\nProject folder: proyectos/${slugDeProyecto(project)}/\n` +
          "Write the WAV and MIDI files there with paths like 'salida/tema.wav' (the server resolves them " +
          "inside the project folder). 'codigo/', 'herramientas/' and 'plantillas/' are shared."
        : "\n\n=== PROJECT ===\nThere is no open project: create one or use anadir_pistas.";
      sistema.content =
        AGENTE_SISTEMA +
        carpeta +
        (manifiestoMotor ? `\n\n=== AVAILABLE ENGINE ===\n${manifiestoMotor}` : "") +
        bloqueContexto(resumenAgente, turnosAgente);
    }
  } catch {
    /* no manifest: work with the basic prompt */
  }
}

const conversacion: ChatMessage[] = [{ role: "system", content: AGENTE_SISTEMA }];

let trabajando = false;

// ── Activity bar: a phrase for what it is doing + clock, without filling the chat.
let latido: number | null = null;
let pasoActual = "thinking";
/** When the current tool started (null = the model is thinking). */
let pasoDesde: number | null = null;
/** Last signal from the turn: agent event or tool result. */
let ultimoEventoMs = Date.now();
/** Control to cut the turn from "Cancel". */
let cancelador: AbortController | null = null;

function pararLatido(): void {
  if (latido !== null) {
    clearInterval(latido);
    latido = null;
  }
}

/**
 * What can honestly be said when the turn has been quiet for a while: if the GPU is
 * starting it is not hung, it is waiting; if there really are no signals, it says how
 * long it has been like that.
 */
function avisoDeEspera(): string {
  const gpu = costeGpu.estado();
  if (gpu?.fase === "arrancando") {
    const rato = minutosYsegundos(gpu.arranque);
    return `GPU starting${rato ? ` ${rato}` : ""} · not billing yet`;
  }
  if (/@lambda/.test(pasoActual) && gpu?.fase === "activa") return "GPU running · no output yet";
  // A script on this machine sends no signals until it finishes: a 2.5-min render
  // showed up as "⚠ no signal" and looked hung. Its clock already says how long it has been.
  if (pasoDesde !== null && /^(running|exporting) /.test(pasoActual)) return "";
  const callado = sinSenales(ultimoEventoMs);
  return callado > 0 ? `⚠ no signal for ${callado}s` : "";
}

/**
 * Repaints the bar every second with what it is doing NOW: the turn clock and, if a
 * tool is running, how long that call has been going.
 */
function arrancarLatido(desde: number): void {
  pararLatido();
  const pintar = (): void => {
    const enPaso = pasoDesde === null ? null : Date.now() - pasoDesde;
    const nota = avisoDeEspera();
    const marco = fraseBarra(pasoActual, enPaso, Date.now() - desde) + (nota ? ` · ${nota}` : "");
    setStatus(marco);
    // The same phrase, in the chat: the bottom bar is small and with the chat open
    // nobody looks at it. A long turn without this looks like it is doing nothing.
    chat.mostrarProgreso(marco);
  };
  pintar();
  latido = window.setInterval(pintar, 1000);
}

async function responderAlUsuario(texto: string): Promise<void> {
  if (trabajando) {
    chat.add("system", "Still working on the previous turn: wait for it to finish.");
    return;
  }
  trabajando = true;
  chat.setBusy(true);
  cancelador = new AbortController();
  $<HTMLButtonElement>("cancelar").hidden = false;
  await refrescarManifiesto();
  await guardarVersion(texto);
  conversacion.push({ role: "user", content: texto });
  const burbuja = chat.add("assistant", "…");
  const t0 = Date.now();
  ultimoEventoMs = t0;
  pasoActual = `Agent ${getModel()}: thinking`;
  pasoDesde = null;
  arrancarLatido(t0);
  try {
    const resultado = await ejecutarAgente(conversacion, {
      signal: cancelador.signal,
      alEvento: (evento) => {
        // Any event counts as a sign of life for the turn.
        ultimoEventoMs = Date.now();
        // The activity lives in the bottom bar, not in cards inside the chat.
        if (evento.tipo === "progreso") {
          pasoActual = evento.texto;
          pasoDesde = null;
          setStatus(evento.texto);
          chat.mostrarProgreso(evento.texto);
          return;
        }
        if (evento.tipo === "herramienta") {
          // A call starts: the step clock starts here.
          pasoActual = evento.texto;
          pasoDesde = Date.now();
          chat.mostrarProgreso(evento.texto);
          return;
        }
        // Finished: its time stays visible until the next tool.
        pasoDesde = null;
        pasoActual =
          evento.nombre && typeof evento.ms === "number"
            ? pasoTerminado(evento.nombre, evento.ms)
            : evento.texto;
        setStatus(fraseBarra(pasoActual, null, Date.now() - t0));
      },
    });
    chat.ocultarProgreso();
    chat.update(burbuja, resultado.texto || "(no final answer)");
    pararLatido();
    // A discreet line at the end of the history: where the turn's time went.
    chat.add("meta", `✓ ${lineaResumen(resultado)} · ${getModel()}`);
    // The turn goes into the project history ALWAYS, even if there was no final
    // answer: otherwise the user's brief was lost and the next turn did not know
    // what had been asked.
    const estado = agregarTurno(resumenAgente, turnosAgente, {
      usuario: texto,
      asistente:
        (resultado.texto ?? "").trim() !== ""
          ? resultado.texto
          : `(turn without a final answer: ${lineaResumen(resultado)})`,
    });
    resumenAgente = estado.resumen;
    turnosAgente = estado.turnos;
    void guardarAgente();
    setStatus(
      `✓ done · ${resultado.pasos} step(s) · ${resultado.llamadas} tool(s) · ` +
        `${segundos(resultado.ms)} · ${getModel()}`,
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    pararLatido();
    if (cancelador?.signal.aborted) {
      chat.update(
        burbuja,
        "Turn cancelled by you. Whatever was already written to disk stays; if a GPU is running, " +
          "stop it from the counter in the header (it keeps billing until it stops).",
      );
      setStatus("✓ turn cancelled");
      void costeGpu.refrescar();
    } else {
      chat.update(burbuja, `I could not finish the turn: ${mensaje}`);
      setStatus(`✗ error: ${mensaje.slice(0, 140)}`);
    }
  } finally {
    trabajando = false;
    pasoDesde = null;
    cancelador = null;
    $<HTMLButtonElement>("cancelar").hidden = true;
    chat.setBusy(false);
  }
  // The history cannot grow without limit: system + the last turns, always cutting
  // at a user message (never between a call and its result).
  recortarConversacion(conversacion, 25);
}

chat.onSend((texto) => {
  void responderAlUsuario(texto);
});

// Cancel: cuts off the model and the tool in flight (a half-done GPU does not switch
// itself off, but it no longer has a turn pushing it).
$("cancelar").addEventListener("click", () => {
  if (!cancelador) return;
  cancelador.abort();
  setStatus("cancelling… (a running GPU is stopped separately)");
});

// The server publishes an id for its code: if it changes, this tab is stale.
vigilarVersion(() => {
  const boton = $<HTMLButtonElement>("recargar");
  boton.hidden = false;
  boton.classList.add("activo");
  addMessage(
    "system",
    "The server has newer code than this tab. Click “↻ new version” to load it: " +
      "until then the app runs the old bundle and the agent may hit functions that no longer exist " +
      "(it happened with crear_proyecto).",
  );
});

$("recargar").addEventListener("click", () => location.reload());

/**
 * Agent conversation PER PROJECT, in `proyectos/<slug>/agente.json`.
 * On reload it is rehydrated into the system prompt, so the agent knows what was
 * done before in this project (before, everything was lost with an F5).
 */
let resumenAgente = "";
let turnosAgente: TurnoAgente[] = [];
/** Slug whose conversation is loaded in memory (so it is not reloaded needlessly). */
let slugAgente = "";

/**
 * With no project open the conversation goes to `proyectos/sin-proyecto/agente.json`
 * (the same folder the server uses for things without a project). Before, it was not
 * saved anywhere and an F5 threw away what had been said (STATUS Oct 28, pending 1).
 * It does not show up in the project list: only folders with proyecto.json count there.
 */
const SLUG_SIN_PROYECTO = "sin-proyecto";

async function cargarAgenteDelProyecto(vista: Project | null): Promise<void> {
  const slug = vista ? slugDeProyecto(vista) : SLUG_SIN_PROYECTO;
  if (slug === slugAgente) return;
  slugAgente = slug;
  resumenAgente = "";
  turnosAgente = [];
  try {
    const res = await fetch(`/api/fs/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `proyectos/${slug}/agente.json` }),
    });
    if (res.ok) {
      const datos = (await res.json()) as { contenido?: string };
      // At startup "sin-proyecto" is requested and then the project being restored:
      // if this read arrives late, it cannot overwrite that of the already open project.
      if (slugAgente !== slug) return;
      const leido = interpretarAgente(String(datos.contenido ?? ""));
      resumenAgente = leido.resumen;
      turnosAgente = leido.turnos;
    }
  } catch {
    /* sin historial: se empieza limpio */
  }
  // MID-TURN (the agent has just called crear_proyecto) the conversation is NOT
  // touched: it is the one for the brief in progress. Before, it was emptied here and the
  // next model call carried only the system prompt: the agent lost the user's request,
  // the provider answered 'load' to a conversation with no user message and the turn was
  // wasted on retries (Oct 27, "doubledare" project). Only the system prompt is brought
  // up to date, saying which project is open.
  if (trabajando) {
    await refrescarManifiesto();
    return;
  }
  // Outside a turn, the current conversation belongs to the previous project: it is
  // discarded, and the panel is painted with what the model remembers from THIS project.
  conversacion.length = 1;
  chat.clear();
  if (turnosAgente.length > 0) {
    chat.add(
      "meta",
      `Conversation saved in this project: ${turnosAgente.length} turn(s). This is what I remember when I start.`,
    );
    for (const turno of turnosAgente.slice(-4)) {
      if (turno.usuario) chat.add("user", turno.usuario);
      if (turno.asistente) chat.add("assistant", turno.asistente);
    }
  }
  await refrescarManifiesto();
}

/**
 * Snapshot of the project BEFORE the turn, in `proyectos/<carpeta>/versiones/`: it is
 * what lets the agent (the `versiones` tool) go back one track or the whole project.
 * The server keeps the last MAX_VERSIONES.
 */
async function guardarVersion(pedido: string): Promise<void> {
  const vista = project;
  if (!vista) return;
  try {
    const { datos } = serializarProyecto(vista, audioAssets);
    await fetch(`/api/fs/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `proyectos/${slugDeProyecto(vista)}/${CARPETA_VERSIONES}/${nombreDeVersion(new Date(), pedido)}`,
        contenido: JSON.stringify(datos),
      }),
    });
  } catch {
    /* a snapshot that fails cannot stop the turn */
  }
}

async function guardarAgente(): Promise<void> {
  if (slugAgente === "") return;
  try {
    await fetch(`/api/fs/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `proyectos/${slugAgente}/agente.json`,
        contenido: JSON.stringify(serializarAgente(resumenAgente, turnosAgente, getModel()), null, 2),
      }),
    });
  } catch {
    /* the history cannot break a turn */
  }
}

let project: Project | null = null;
/** Touchpad panel (created further down; applyProject notifies it of changes). */
let panelPad: PanelPad | null = null;
let busy = false;
let ready = false;
let restoring = false;
let selectedTrackIds: string[] = [];
let selectedClipIds: string[] = [];
/** References copied with Ctrl+C (they are pasted by duplicating the original). */
let portapapeles: { trackId: string; clipId: string; start: number }[] = [];
let persistenceWarned = false;
let openDawHandle: OpenDawPlaybackHandle | null = null;
let openDawGeneration = 0;

const stemPlayer = new StemPlayer();

/** Full path (with the project folder) for <audio src>, which does not send headers. */
function rutaCompleta(src: string): string {
  if (!project) return src;
  return rutaEnProyecto(src, slugDeProyecto(project));
}

/** Prepares the streaming stems of the open project (the ones that do not go through openDAW). */
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
    // Only what sounds is heard: mute silences it and, if there is any solo, that wins.
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

// An agent turn makes dozens of changes: with 8, undo did not even reach the start of
// the turn. To go further back there are versions (one per turn).
const HISTORY_LIMIT = 60;
/** Undo history: in memory, for the session. The disk keeps the state, not the steps. */
let history: Project[] = [];
let future: Project[] = [];

/** Project folder in workspace/proyectos/ (fixed from creation: see meta.carpeta). */
function slugDeProyecto(origen: Project): string {
  return carpetaDeProyecto(origen);
}

function currentBeat(): number {
  return openDawHandle?.beat ?? timeline.currentBeat;
}

timeline.onSeek = (beat) => {
  const view = project;
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
  aplicarOpsClips(ops, `${copiar ? "Copied" : "Moved"} ${ops.length} clip(s).`, copiar);
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
      addMessage("assistant", `Edited by hand: ${notes.length} notes in “${clip.name}”.`);
    } catch (error) {
      addMessage("system", `Could not save the edit: ${error instanceof Error ? error.message : String(error)}`);
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

function updateActions(): void {
  const enabled = ready && !busy;
  const view = project;
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

/**
 * Loads the project into openDAW. With `reproducir: false` it leaves the engine ready
 * without starting the transport: that is what the pad uses to sound live.
 */
async function startOpenDawPlayback(view: Project, reproducir = true): Promise<void> {
  if (openDawHandle) stopOpenDaw();
  const generation = ++openDawGeneration;
  setBusy(true, reproducir ? "Loading WAVs and starting openDAW…" : "Getting the instruments ready…");
  try {
    const { faltan } = await hidratarAssets(view, slugDeProyecto(view));
    warnMissingAudio(faltan);
    const { playWithOpenDaw } = await import("./opendaw-engine.ts");
    const endBeat = view.lengthBars * beatsPerBar(view);
    // openDAW only receives what is decoded; long stems are handled separately.
    const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
    for (const [id, asset] of audioAssets) {
      if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
    }
    const soundfonts = await cargarSoundfontsDelProyecto(view);
    const gm = await cargarGm(view);
    const handle = await playWithOpenDaw(
      view,
      (beat) => {
        timeline.draw(beat);
        stemPlayer.sincronizar(beat);
        if (openDawHandle && beat >= endBeat - 0.05) stopOpenDaw();
      },
      paraEngine,
      soundfonts,
      gm,
      { reproducir },
    );
    if (generation !== openDawGeneration) {
      handle.stop();
      return;
    }
    openDawHandle = handle;
    if (!reproducir) return;
    setPlaying(true);
    await stemPlayer.reproducir(handle.beat);
    const cuantos = stemPlayer.vocesActivas;
    addMessage(
      "assistant",
      cuantos > 0
        ? `Playing with openDAW (MIDI) and ${cuantos} streamed stem(s).`
        : "Playing with the openDAW engine.",
    );
  } catch (error) {
    if (generation !== openDawGeneration) return;
    setPlaying(false);
    addMessage(
      "system",
      `Could not start the openDAW engine: ${error instanceof Error ? error.message : String(error)}`,
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
  const rest = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
  addMessage(
    "system",
    `Missing ${missing.length} WAV (${shown}${rest}). The project references them but they are not in the project folder: ` +
      "those tracks will play silence until the WAVs are back in place.",
  );
}

function warnPersistence(message: string): void {
  if (persistenceWarned) return;
  persistenceWarned = true;
  addMessage("system", message);
}

/** Key with the open project: the only thing left in the browser. */
const CLAVE_ABIERTO = "miuzika.proyecto-abierto";

/**
 * A project change: it records the open project (to reopen it on reload) and schedules
 * the master file write. There is no more state in the browser: the data and the WAVs
 * live on disk.
 */
function persist(): void {
  try {
    if (project) localStorage.setItem(CLAVE_ABIERTO, slugDeProyecto(project));
    else localStorage.removeItem(CLAVE_ABIERTO);
  } catch {
    warnPersistence("Could not record the open project in localStorage.");
  }
  programarGuardado();
}

// ── Master file on disk: proyectos/<slug>/proyecto.json ─────────────────────
// Autosave with a delay: writing on every fader drag would be a POST per movement;
// 1.5 s after the last change is invisible and loses nothing. The "Save" button (and
// Ctrl+S) forces the write and reports it in the chat.
const RETARDO_GUARDADO = 1500;
let guardadoTimer: number | null = null;
let guardando = false;
let guardadoPendiente = false;

function programarGuardado(): void {
  if (!ready || restoring || !project) return;
  if (guardadoTimer !== null) window.clearTimeout(guardadoTimer);
  guardadoTimer = window.setTimeout(() => {
    guardadoTimer = null;
    void guardarEnDisco(true);
  }, RETARDO_GUARDADO);
}

function horaActual(): string {
  return new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Writes the master file. `silencioso` (autosave) only leaves the notice in the status
 * bar; the "Save" button also reports it in the chat.
 */
async function guardarEnDisco(silencioso: boolean): Promise<void> {
  const vista = project;
  if (!vista) {
    if (!silencioso) addMessage("system", "There is no open project to save.");
    return;
  }
  if (!ready) return;
  if (guardando) {
    // There is already a write in flight: when it finishes it is relaunched with the new state.
    guardadoPendiente = true;
    return;
  }
  guardando = true;
  const ruta = rutaDeProyecto(slugDeProyecto(vista));
  try {
    const { datos, sinRuta } = serializarProyecto(vista, audioAssets);
    await guardarProyectoEnDisco(ruta, JSON.stringify(datos, null, 2));
    setStatus(`✓ saved ${ruta} · ${horaActual()} · ${datos.proyecto.tracks.length} tracks`);
    if (!silencioso) {
      const conRuta = datos.proyecto.audioAssets?.filter((asset) => asset.ruta).length ?? 0;
      addMessage(
        "assistant",
        `Saved to ${ruta}: ${datos.proyecto.tracks.length} track(s), ${datos.proyecto.bpm} BPM, ` +
          `${datos.proyecto.lengthBars} bars, ${conRuta} WAV from the folder` +
          (sinRuta.length > 0
            ? `. ${sinRuta.length} without a file on disk (${sinRuta.slice(0, 3).join(", ")}): those do not travel with the project.`
            : "."),
      );
    }
  } catch (error) {
    addMessage(
      "system",
      `Could not save to disk: ${error instanceof Error ? error.message : String(error)}. ` +
        "The changes are on screen, but not in the project file.",
    );
    setStatus("✗ could not save to disk");
  } finally {
    guardando = false;
    if (guardadoPendiente) {
      guardadoPendiente = false;
      programarGuardado();
    }
  }
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
}

async function undo(): Promise<void> {
  if (!ready || restoring || busy) return;
  const previous = history.pop();
  if (!previous) return;
  if (project) future.push(project);
  restoring = true;
  setBusy(true, "Loading audio…");
  try {
    const { faltan } = await hidratarAssets(previous, slugDeProyecto(previous));
    applyProject(previous);
    warnMissingAudio(faltan);
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
  restoring = true;
  setBusy(true, "Loading audio…");
  try {
    const { faltan } = await hidratarAssets(next, slugDeProyecto(next));
    applyProject(next);
    warnMissingAudio(faltan);
  } finally {
    restoring = false;
    setBusy(false);
    updateHistoryButtons();
  }
}

function setProject(next: Project | null, record = true): void {
  // The history belongs to ONE project: undo must never resurrect another project
  // inside the current one's folder.
  if (!project || !next || slugDeProyecto(project) !== slugDeProyecto(next)) {
    history = [];
    future = [];
    record = false;
  }
  if (record && project) recordHistory();
  applyProject(next);
  updateHistoryButtons();
}

/** Live change (mute/solo): it does not restart the engine or the playhead. */
function commitLive(next: Project): void {
  if (!project) return;
  const view = next;
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
    addMessage("system", `Could not change ${flag}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyProject(next: Project | null): void {
  if (openDawHandle) stopOpenDaw();
  else openDawGeneration++;
  setPlaying(false);
  project = next;
  // Changing project must not leave the previous project's WAVs occupying RAM.
  liberarAssetsNoUsados(next);
  // And the agent changes conversation: each project has its own on disk.
  void cargarAgenteDelProyecto(next);
  persist();
  updateActions();
  const view = next;
  if (!view) {
    timeline.setProject({
      schemaVersion: 1,
      id: "empty",
      name: "Untitled",
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
  panelPad?.proyectoCambiado();
  timeline.setProject(view);
  // setProject changes the data and the heads, but does not repaint the canvas:
  // without this, a project applied by the agent leaves the timeline empty.
  timeline.relayout();
  sincronizarStems();
  const stats = projectStats(view);
  const minutes = Math.floor(stats.seconds / 60);
  const seconds = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  songInfo.innerHTML =
    `<strong>${escapeHtml(view.name)}</strong>` +
    `<span>${view.bpm} BPM · ${view.key.tonic} ${view.key.mode} · ${view.lengthBars} bars · ` +
    `${stats.tracks} tracks · ${stats.notes} notes · ${minutes}:${seconds}</span>` +
    `<span class="carpeta" title="Project folder on the server">proyectos/${escapeHtml(slugDeProyecto(view))}/</span>`;
}

function updateSelectionBar(): void {
  const selected = project?.tracks.filter((track) => selectedTrackIds.includes(track.id)) ?? [];
  const clips = selectedClipIds.length;
  const bar = $<HTMLElement>("selection-bar");
  bar.hidden = selected.length === 0 && clips === 0;
  const partes: string[] = [];
  if (selected.length > 0) partes.push(selected.length === 1 ? "1 track" : `${selected.length} tracks`);
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

/** Returns the (track, clip) pair for each selected id. */
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

/** Applies clip ops and leaves whatever remains selected (the copies, if any). */
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
    addMessage("system", `Could not: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function copiarClips(): void {
  const clips = clipsSeleccionados();
  if (clips.length === 0) return;
  portapapeles = clips.map(({ trackId, clipId, start }) => ({ trackId, clipId, start }));
  addMessage("system", `Copied ${clips.length} clip(s). Ctrl+V pastes at the cursor.`);
  updateSelectionBar();
}

function pegarClips(): void {
  if (!project || portapapeles.length === 0) return;
  const base = Math.min(...portapapeles.map((item) => item.start));
  // sixteenth-note snap, same as dragging
  const destino = Math.round(currentBeat() / 0.25) * 0.25;
  const ops: Op[] = portapapeles.map((item) => ({
    op: "duplicate_clip" as const,
    trackId: item.trackId,
    clipId: item.clipId,
    startBeat: Math.max(0, destino + (item.start - base)),
  }));
  aplicarOpsClips(ops, `Pasted ${ops.length} clip(s) at bar ${Math.floor(destino / 4) + 1}.`, true);
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
  aplicarOpsClips(ops, `Duplicated ${ops.length} clip(s) right after.`, true);
}

function borrarClips(): void {
  const clips = clipsSeleccionados();
  if (clips.length === 0) return;
  const ops: Op[] = clips.map((item) => ({
    op: "remove_clip" as const,
    trackId: item.trackId,
    clipId: item.clipId,
  }));
  aplicarOpsClips(ops, `Deleted ${ops.length} clip(s).`, false);
}

function deleteSelectedTracks(): void {
  if (!project || busy) return;
  const tracks = project.tracks.filter((track) => selectedTrackIds.includes(track.id));
  if (tracks.length === 0) return;
  const label = tracks.length === 1 ? `“${tracks[0]!.name}”` : `${tracks.length} tracks`;
  if (!confirm(`Delete ${label}?`)) return;
  const ops: Op[] = tracks.map((track) => ({ op: "remove_track", trackId: track.id }));
  try {
    setProject(applyOps(project, ops).project);
    addMessage(
      "assistant",
      `Deleted ${tracks.length} track(s): ${tracks.map((track) => `“${track.name}”`).join(", ")}.`,
    );
  } catch (error) {
    addMessage("system", `Could not delete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Renders with the real Strudel engine and inserts it as an audio track. */
async function renderStrudelAudioSource(request: CodeAudioRequest): Promise<void> {
  const base = project;
  if (!base) throw new Error("There is no open project.");
  const barBeats = beatsPerBar(base);
  const rendered = await renderStrudelAudio(request.code, request.bars, base.bpm, barBeats);
  const assetId = `aud_strudel_${request.sourceId}_${Date.now().toString(36)}`;
  const assetName = `${request.name} [Strudel]`;
  const duracionBeats = request.bars * barBeats;
  // The rendered WAV goes to disk like any other audio in the project: otherwise the
  // master file could not reference it and it would be lost on reload.
  let ruta: string | null = null;
  try {
    const fichero = new File([rendered.blob], `${slugDeProyecto(base)}_strudel_${request.sourceId}.wav`, {
      type: "audio/wav",
    });
    ruta = (await subirAudio(fichero, slugDeProyecto(base))).path;
  } catch (error) {
    addMessage(
      "system",
      `Strudel audio could not be written to the project folder (${
        error instanceof Error ? error.message : String(error)
      }): it will play in this session, but the project will not reference it.`,
    );
  }
  audioAssets.set(assetId, {
    id: assetId,
    name: assetName,
    buffer: rendered.buffer,
    durationBeats: duracionBeats,
    peaks: computePeaks(rendered.buffer),
    src: ruta ?? "",
    streaming: false,
  });

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
    durationBeats: duracionBeats,
    ...(ruta ? { ruta } : {}),
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
    `Strudel audio “${request.name}”: ${rendered.durationSeconds.toFixed(1)} s rendered with the real engine and added as an audio track.`,
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

// --- Events ----------------------------------------------------------------

playButton.addEventListener("click", () => {
  const view = project;
  if (!ready || busy || !view || view.tracks.length === 0) return;
  if (openDawHandle?.isPlaying) {
    stopOpenDaw();
    return;
  }
  // An engine loaded without playing (the pad's) is unloaded and started again.
  if (openDawHandle) stopOpenDaw();
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
  if (project && project.tracks.length > 0 && !confirm("Close this project and start another one? The current one stays saved on disk.")) return;
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

// "Models" menu: the agent's provider, key and model (server/api/proveedores.ts).
void cargarConfigLlm();
const ajustesModelos = new AjustesModelos((proveedor, modelo) =>
  addMessage("system", `The agent will use ${modelo} (${proveedor}) from the next turn on.`),
);
$<HTMLButtonElement>("ajustes-modelos").addEventListener("click", () => void ajustesModelos.abrir());

// The chat's "Brief" button: a form that writes the message (it does not send it).
const formularioEncargo = new FormularioEncargo({
  proyecto: () => project,
  escribir: (texto) => escribirEnCompositor(texto),
});
setAbrirEncargo(() => void formularioEncargo.abrir());

// The agent tools that touch the project (agent/acciones.ts) work on THIS tab through a
// small contract.
/**
 * Brief export: the project to MIDI and/or the mix to WAV, in
 * `proyectos/<carpeta>/salida/`. The WAV is rendered by the same engine as Play.
 */
async function exportarProyecto(formatos: { midi: boolean; wav: boolean }): Promise<{ ok: boolean; texto: string }> {
  const view = project;
  if (!view) return { ok: false, texto: "There is no open project." };
  const slug = slugDeProyecto(view);
  const hechos: string[] = [];
  try {
    if (formatos.midi) {
      const bytes = midiDeProyecto(view);
      const fichero = new File([bytes as unknown as BlobPart], `${slug}.mid`, { type: "audio/midi" });
      const { path } = await subirAudio(fichero, slug, "salida");
      const pistas = view.tracks.filter((t) => t.kind === "midi").length;
      hechos.push(`MIDI: proyectos/${slug}/${path} (${pistas} track(s), ${view.bpm} BPM).`);
    }
    if (formatos.wav) {
      const render = await prepararRender(view, slug);
      const mezcla = await render.renderizar(view);
      const canales = mezcla.canales.slice(0, 2);
      if (canales.length === 0 || canales[0]!.length === 0) throw new Error("the render came out empty");
      const buffer = new AudioBuffer({ length: canales[0]!.length, numberOfChannels: canales.length, sampleRate: mezcla.sampleRate });
      canales.forEach((datos, i) => buffer.copyToChannel(datos as Float32Array<ArrayBuffer>, i));
      let pico = 0;
      for (const datos of canales) for (let i = 0; i < datos.length; i += 1) pico = Math.max(pico, Math.abs(datos[i]!));
      const fichero = new File([audioBufferToWav(buffer)], `${slug}.wav`, { type: "audio/wav" });
      const { path } = await subirAudio(fichero, slug, "salida");
      const segundos = buffer.length / buffer.sampleRate;
      const picoDb = pico > 0 ? 20 * Math.log10(pico) : -Infinity;
      hechos.push(
        `WAV: proyectos/${slug}/${path} (${Math.floor(segundos / 60)}:${String(Math.round(segundos % 60)).padStart(2, "0")}, ` +
          `peak ${picoDb.toFixed(1)} dBFS${pico > 1 ? " — CLIPPING: lower the master" : ""}).`,
      );
    }
    const fuera = formatos.wav ? assetsPorStreaming(view) : [];
    if (fuera.length > 0) {
      hechos.push(`Not in the WAV (long, played by streaming, outside openDAW): ${fuera.join(", ")}.`);
    }
    return { ok: true, texto: hechos.join("\n") || "No format was requested." };
  } catch (error) {
    return {
      ok: false,
      texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}Could not export: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * What the engine needs to render the project without playing it: WAVs, the project's
 * SoundFonts and the GM. It is loaded once and serves several renders (the mix and each
 * track alone in `escuchar_mezcla`).
 */
async function prepararRender(view: Project, slug: string) {
  const { faltan } = await hidratarAssets(view, slug);
  warnMissingAudio(faltan);
  const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
  for (const [id, asset] of audioAssets) {
    if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
  }
  const soundfonts = await cargarSoundfontsDelProyecto(view);
  const gm = await cargarGm(view);
  // `cargarSoundfontsDelProyecto` silently skips the .sf2 files that do not arrive: here
  // they are noted, because a track without its instrument is exactly what has to be diagnosed.
  const sinCargar = [
    ...new Set(
      view.tracks.flatMap((t) => (t.instrument.type === "soundfont" && t.instrument.archivo && !soundfonts.has(t.instrument.archivo) ? [t.instrument.archivo] : [])),
    ),
  ];
  const { renderizarMezcla } = await import("./opendaw-engine.ts");
  return { sinCargar, renderizar: (vista: Project) => renderizarMezcla(vista, paraEngine, soundfonts, gm) };
}

/**
 * `escuchar_mezcla`: the level of the mix and of each track alone, by bar ranges,
 * rendered with openDAW. It is what really sounds, not the agent's numpy render
 * (STATUS Oct 28, pending 7).
 */
async function escucharMezcla(opciones: { pistas?: string[]; compasesPorTramo?: number }): Promise<{ ok: boolean; texto: string }> {
  const view = project;
  if (!view) return { ok: false, texto: "There is no open project." };
  try {
    const compasesPorTramo = Math.max(1, Math.min(16, Math.trunc(opciones.compasesPorTramo ?? 4)));
    const tiemposTramo = compasesPorTramo * beatsPerBar(view);
    const tramos = Math.max(1, Math.ceil(view.lengthBars / compasesPorTramo));
    const pedidas = (opciones.pistas ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const elegidas = view.tracks.filter(
      (t) => pedidas.length === 0 || pedidas.includes(t.id.toLowerCase()) || pedidas.includes(t.name.toLowerCase()),
    );
    if (pedidas.length > 0 && elegidas.length === 0) {
      return { ok: false, texto: `No tracks named ${pedidas.join(", ")}. Tracks: ${view.tracks.map((t) => t.name).join(", ")}.` };
    }
    const render = await prepararRender(view, slugDeProyecto(view));
    const medir = (r: { sampleRate: number; canales: Float32Array[] }) =>
      nivelesPorTramo(r.canales.slice(0, 2), r.sampleRate, view.bpm, tiemposTramo, tramos);
    setStatus("Listening: rendering the mix…");
    const mezcla = medir(await render.renderizar(view));
    const pistas: PistaEscuchada[] = [];
    for (const [i, pista] of elegidas.entries()) {
      setStatus(`Listening: track ${i + 1}/${elegidas.length} (${pista.name})…`);
      // The track alone, without mute or solo: it measures whether its instrument produces signal.
      const sola: Project = { ...view, tracks: [{ ...pista, muted: false, solo: false }] };
      // Streaming WAV clips do not go through openDAW: counting them would give a false MUTE.
      const enMotor = pista.clips.filter((clip) => !(clip.audio && audioAssets.get(clip.audio.assetId)?.streaming));
      pistas.push({
        nombre: pista.name,
        muted: pista.muted,
        notas: notasPorTramo({ clips: enMotor }, tiemposTramo, tramos),
        niveles: medir(await render.renderizar(sola)),
      });
    }
    const fuera = assetsPorStreaming(view);
    const nota = fuera.length > 0 ? `\nNOT measured (long WAVs through streaming, outside openDAW; they sound in Play): ${fuera.join(", ")}.` : "";
    return { ok: true, texto: informeEscucha({ compasesPorTramo, mezcla, pistas, sinCargar: render.sinCargar }) + nota };
  } catch (error) {
    return { ok: false, texto: `Could not listen to the mix: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const acciones = crearAcciones({
  proyecto: () => project,
  fijar: (siguiente) => setProject(siguiente),
  enVivo: (siguiente) => commitLive(siguiente),
  avisar: (texto) => addMessage("system", texto),
  exportar: exportarProyecto,
  escuchar: escucharMezcla,
});
registrarAcciones(acciones);

// The touchpad as an instrument (web/src/pad.ts).
panelPad = new PanelPad({
  proyecto: () => project,
  motorActual: () => openDawHandle,
  motor: async () => {
    const view = project;
    if (!view) return null;
    if (!openDawHandle) await startOpenDawPlayback(view, false);
    return openDawHandle;
  },
  parar: () => stopOpenDaw(),
  cursor: () => timeline.currentBeat,
  guardarClip: (trackId, startBeat, notas) => {
    const view = project;
    if (!view) return;
    try {
      const { project: siguiente } = applyOps(view, [
        {
          op: "add_notes",
          trackId,
          startBar: Math.round(startBeat / beatsPerBar(view)),
          name: `Pad ${horaActual()}`,
          notes: notas,
        },
      ]);
      setProject(siguiente);
    } catch (error) {
      addMessage("system", `Could not save the recording: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  avisar: (texto) => addMessage("system", texto),
  dibujar: (beat) => timeline.draw(beat),
});
$<HTMLButtonElement>("pad").addEventListener("click", () => panelPad?.abrir());

/** Is it a MIDI? A .mid is NOT audio: it is notes, and they have to be read, not decoded. */
function esMidi(file: File): boolean {
  return /\.(mid|midi)$/i.test(file.name) || /midi/i.test(file.type);
}

/**
 * Puts a `.mid` from disk into the project: copies the file to `entrada/`, reads its
 * tracks with `/api/midi` and creates them as MIDI tracks, through the same path as
 * `anadir_pistas` (so the result can be undone and saves itself).
 *
 * Before, there was no way at all: "Open" treated it as a JSON project and failed,
 * and the canvas promised "drag a WAV here'" without having a drag handler.
 */
async function importarMidiDesdeDisco(file: File): Promise<void> {
  if (!ready) return;
  setBusy(true, `Reading ${file.name}…`);
  try {
    if (!project) {
      const nombre = nombreDeProyectoDesdeFicheros([file]).slice(0, 40) || "MIDI";
      setProject(createProject({ name: nombre, bpm: 120, lengthBars: 32 }));
    }
    if (!project) return;
    const slug = slugDeProyecto(project);
    const { path } = await subirAudio(file, slug);
    const puesto = await acciones.anadirPistas({ midis: [path], wavs: [], inicioCompas: 0 });
    addMessage("system", puesto.ok ? `MIDI “${file.name}” imported.` : puesto.texto);
  } catch (error) {
    addMessage(
      "system",
      `Could not read “${file.name}”: ${error instanceof Error ? error.message : String(error)}. ` +
        "It has to be a standard MIDI file (.mid); if it is a .midi from some odd program, export it again.",
    );
  } finally {
    setBusy(false);
  }
}

/** Is it an audio file? (by MIME or by extension) */
function esAudio(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(wav|mp3|ogg|oga|flac|aif|aiff|m4a)$/i.test(file.name);
}

/** RAM taken up by the audio already decoded (interleaved Float32). */
function ramAudioBytes(): number {
  let total = 0;
  for (const asset of audioAssets.values()) {
    if (!asset.buffer) continue; // streaming ones do not take up RAM
    total += asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }
  return total;
}

/**
 * Puts audio files into the project: one track per file, at the current bar.
 * Both the "Audio" button and "Open" use it (a single path for the same thing).
 *
 * Each file is first copied to `proyectos/<slug>/entrada/`: the project is portable
 * because it references its WAVs by path, not by bytes in the browser.
 *
 * `destino` decides where they land: "anadir" respects the open project and the cursor;
 * "nuevo" starts from scratch with the chosen folder's name (the case of opening a
 * project's `salida/` folder, which before was pasted onto the old project).
 */
async function importarAudio(files: File[], destino: "anadir" | "nuevo" = "anadir"): Promise<void> {
  if (!ready || files.length === 0) return;
  const nuevo = destino === "nuevo" || !project;
  const LIMITE_RAM = 900 * 1024 * 1024; // ~900 MB: above this the browser crashes
  const nombreNuevo = nombreDeProyectoDesdeFicheros(files);
  setBusy(true, nuevo ? `Creating “${nombreNuevo}”…` : "Importing audio…");
  try {
    let current =
      nuevo
        ? createProject({ name: nombreNuevo, bpm: 120, lengthBars: 32 })
        : (project as Project);
    const slug = slugDeProyecto(current);
    let cortado = false;
    const sinDisco: string[] = [];
    let metidos = 0;
    const bar = nuevo ? 0 : Math.floor(currentBeat() / beatsPerBar(current));

    for (const file of files) {
      if (ramAudioBytes() > LIMITE_RAM) {
        cortado = true;
        break;
      }
      // 1) to disk. Without a copy there is nothing the master file can reference.
      let ruta = "";
      try {
        ruta = (await subirAudio(file, slug)).path;
      } catch (error) {
        sinDisco.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // 2) duration and waveform are measured by the server (the WAV is already in place).
      const meta = await metadatosWav(rutaEnProyecto(ruta, slug));
      const segundos = meta.duracionSeg;
      let assetId: string;
      let nombre = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Audio";
      let durationBeats = Math.max(0.25, (segundos * current.bpm) / 60);

      const soltar = reservarDecodificado(segundos);
      if (!soltar) {
        // Long and with no memory for it: it is not decoded (so 6-minute stems fit).
        assetId = idDeAsset(nombre);
        registrarAssetStreaming({
          id: assetId,
          name: nombre,
          durationBeats,
          src: ruta,
          peaks: Float32Array.from(meta.picos),
        });
      } else {
        // It fits: decoded so openDAW can play it.
        const asset = await loadAudioFile(file, current.bpm, ruta).finally(soltar);
        assetId = asset.id;
        nombre = asset.name;
        durationBeats = asset.durationBeats;
      }

      current = applyOps(current, [
        {
          op: "register_audio_asset",
          assetId,
          name: nombre,
          durationBeats,
          ruta,
        },
        {
          op: "add_audio_clip",
          assetId,
          startBar: bar,
          lengthBeats: compasesDeAudio(durationBeats, beatsPerBar(current)),
          gainDb: 0,
          name: nombre,
          track: { name: nombre },
        },
      ]).project;
      metidos++;
    }

    setProject(current);
    addMessage(
      "assistant",
      nuevo
        ? `New project “${current.name}” at ${current.bpm} BPM with ${metidos} audio file(s) copied to ` +
            `proyectos/${slug}/entrada/, one per track. If the stems are at another tempo, change it before pressing play.`
        : `${metidos} audio file(s) copied to proyectos/${slug}/entrada/ and added at bar ${bar + 1}, one per track.`,
    );
    if (cortado) {
      addMessage(
        "system",
        `Stopped at ${Math.round(ramAudioBytes() / 1048576)} MB of audio in memory (~900 MB limit): ` +
          "the browser would run out of room. Import the remaining stems in another batch (long ones are not decoded, so they fit).",
      );
    }
    for (const fallo of sinDisco.slice(0, 4)) addMessage("system", `Could not copy to disk: ${fallo}`);
    if (sinDisco.length > 4) addMessage("system", `…and ${sinDisco.length - 4} more not copied.`);
  } catch (error) {
    addMessage("system", `Could not import: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

/**
 * Asks what to do with the chosen audio files. With a project open the user chooses:
 * add them (as always) or start a new one with the folder's name.
 */
type DestinoAudio = "anadir" | "nuevo" | "cancelar";

function preguntarDestinoAudio(files: File[]): Promise<DestinoAudio> {
  const dialogo = $<HTMLDialogElement>("dialogo-audio");
  const nombre = nombreDeProyectoDesdeFicheros(files);
  $("audio-anadir").textContent = `Add to “${project?.name ?? "—"}”`;
  $("audio-nuevo").textContent = `New project “${nombre}”`;
  $("dialogo-audio-detalle").textContent =
    `${files.length} file(s). “Add” puts them in the open project, at the cursor bar; ` +
    `“New project” starts from scratch with the folder name (${nombre}).`;

  return new Promise((resolver) => {
    let contestado = false;
    const terminar = (valor: DestinoAudio): void => {
      if (contestado) return;
      contestado = true;
      dialogo.close();
      resolver(valor);
    };
    // onclick/oncancel are reassigned (not accumulated) on each opening.
    $("audio-anadir").onclick = () => terminar("anadir");
    $("audio-nuevo").onclick = () => terminar("nuevo");
    $("audio-cancelar").onclick = () => terminar("cancelar");
    dialogo.oncancel = (event) => {
      event.preventDefault();
      terminar("cancelar");
    };
    dialogo.onclose = () => {
      if (!contestado) {
        contestado = true;
        resolver("cancelar");
      }
    };
    dialogo.showModal();
  });
}

/** Single entry point for importing audio with the picker: asks for the destination if there is a project. */
async function importarAudioDesdeSelector(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const destino: DestinoAudio = project ? await preguntarDestinoAudio(files) : "nuevo";
  if (destino === "cancelar") return;
  await importarAudio(files, destino);
}

/** Short date for the project list ("23 Oct, 21:04"). */
function fechaCorta(iso: string): string {
  if (!iso) return "no date";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "no date";
  return fecha.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * "Sounds" dialog: searches the CC0 library (server index) and brings what you choose
 * into the project. No manual copying: the sample comes in converted and normalized.
 */
let sonidosTimer: number | null = null;
let sonidosReproduciendo: HTMLAudioElement | null = null;

async function pintarSonidos(consulta: string): Promise<void> {
  const lista = $("lista-sonidos");
  const texto = consulta.trim();
  if (texto === "") {
    lista.innerHTML = `<p class="vacio">4,231 CC0 samples (VCSL). Type what you are looking for.</p>`;
    return;
  }
  lista.innerHTML = `<p class="vacio">Searching “${escapeHtml(texto)}”…</p>`;
  try {
    const res = await fetch("/api/catalogo/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consulta: texto, limite: 30 }),
    });
    const datos = (await res.json()) as {
      total?: number;
      resultados?: {
        archivo: string;
        rutaAudio: string;
        instrumento: string;
        familia: string;
        strudel: string | null;
        perfil?: Record<string, number>;
      }[];
    };
    const todos = datos.resultados ?? [];
    // The library brings the same take in 6-12 layers and repetitions: it is grouped by
    // instrument and the first one is kept (the one that scored best), saying how many there are.
    const porInstrumento = new Map<string, { fila: (typeof todos)[number]; cuantos: number }>();
    for (const fila of todos) {
      const previo = porInstrumento.get(fila.instrumento);
      if (previo) previo.cuantos += 1;
      else porInstrumento.set(fila.instrumento, { fila, cuantos: 1 });
    }
    const filas = [...porInstrumento.values()].map((x) => ({ ...x.fila, cuantos: x.cuantos }));
    if (filas.length === 0) {
      lista.innerHTML = `<p class="vacio">Nothing like “${escapeHtml(texto)}” among the ${datos.total ?? 0} samples.</p>`;
      return;
    }
    lista.innerHTML = filas
      .map((r) => {
        const p = r.perfil ?? {};
        const medidas = [
          p.duracion_s !== undefined ? `${p.duracion_s} s` : "",
          p.centroide_hz !== undefined ? `${Math.round(p.centroide_hz)} Hz` : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        return (
          `<div class="sonido-fila">` +
          `<button class="icon" data-oir="${escapeHtml(r.rutaAudio)}" title="Listen">▶</button>` +
          `<span class="sonido-nombre"><strong>${escapeHtml(r.instrumento)}</strong>` +
          `<em>${escapeHtml(r.familia)}${medidas ? " · " + escapeHtml(medidas) : ""}` +
          `${(r as { cuantos?: number }).cuantos && (r as { cuantos?: number }).cuantos! > 1 ? ` · ${(r as { cuantos?: number }).cuantos} variants` : ""}` +
          `${r.strudel ? ` · Strudel: s("${escapeHtml(r.strudel)}")` : ""}</em></span>` +
          `<button data-traer="${escapeHtml(r.archivo)}" data-nombre="${escapeHtml(
            r.instrumento.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          )}">Add</button>` +
          `</div>`
        );
      })
      .join("");
  } catch (error) {
    lista.innerHTML = `<p class="vacio">Could not search: ${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</p>`;
  }
}

function abrirSonidos(): void {
  const dialogo = $<HTMLDialogElement>("dialogo-sonidos");
  if (!dialogo.open) dialogo.showModal();
  const campo = $<HTMLInputElement>("sonidos-buscar");
  campo.focus();
  void pintarSonidos(campo.value);
}

/** Opens the dialog with the projects that have a proyecto.json on disk. */
async function abrirListaDeProyectos(): Promise<void> {
  const dialogo = $<HTMLDialogElement>("dialogo-proyectos");
  const lista = $("lista-proyectos");
  lista.innerHTML = `<p class="vacio">Reading workspace/proyectos/…</p>`;
  if (!dialogo.open) dialogo.showModal();
  try {
    const proyectos = await listarProyectos();
    if (proyectos.length === 0) {
      lista.innerHTML =
        `<p class="vacio">There is no <code>proyecto.json</code> in <code>workspace/proyectos/</code> yet. ` +
        "It is created with the “Save” button, or on its own 1.5 s after any change.</p>";
      return;
    }
    lista.innerHTML = proyectos
      .map((proyecto) => {
        const detalle = proyecto.error
          ? `unreadable: ${proyecto.error}`
          : `${proyecto.bpm} BPM · ${proyecto.compases} bars · ${proyecto.pistas} track(s)`;
        return (
          `<button class="proyecto-fila" data-ruta="${escapeHtml(proyecto.ruta)}"` +
          `${proyecto.error ? ' data-error="1"' : ""}>` +
          `<strong>${escapeHtml(proyecto.nombre)}</strong>` +
          `<span>${escapeHtml(detalle)}</span>` +
          `<em>proyectos/${escapeHtml(proyecto.slug)}/ · ${fechaCorta(proyecto.actualizado)} · ` +
          `${Math.round(proyecto.bytes / 1024)} KB</em>` +
          "</button>"
        );
      })
      .join("");
  } catch (error) {
    lista.innerHTML = `<p class="vacio">Could not read the list: ${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</p>`;
  }
}

/**
 * Opens a project from disk: the master file rules and its WAVs are loaded from the
 * folder (`/api/audio`), decoded if they are short and streamed if they are long.
 */
async function abrirProyectoDeDisco(ruta: string): Promise<void> {
  setBusy(true, "Opening project from disk…");
  restoring = true;
  try {
    const texto = await leerProyectoDeDisco(ruta);
    const disco = interpretarProyectoEnDisco(texto);
    const carpeta = carpetaDeRuta(ruta);
    // The folder it is opened from is the project's, whatever it is called: before, a
    // project opened from proyectos/stahl/ named "Stahl II" was saved in
    // proyectos/stahl-ii/, without its WAVs.
    disco.proyecto.meta = { ...disco.proyecto.meta, carpeta };
    const { cargados, faltan } = await hidratarAssets(disco.proyecto, carpeta);
    // `restoring` is still true when applying the project: opening must not rewrite
    // the master file (it would overwrite what is on disk, including guardadoEn).
    setProject(disco.proyecto);
    addMessage(
      "assistant",
      `Opened from disk “${disco.proyecto.name}” (proyectos/${carpeta}/): ` +
        `${disco.proyecto.tracks.length} track(s), ${disco.proyecto.bpm} BPM, ${disco.proyecto.lengthBars} bars` +
        (cargados > 0 ? `, ${cargados} WAV loaded from the folder.` : "."),
    );
    if (faltan.length > 0) warnMissingAudio(faltan);
  } catch (error) {
    restoring = false;
    addMessage(
      "system",
      `Could not open ${ruta}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    restoring = false;
    setBusy(false);
  }
}

$("sonidos").addEventListener("click", () => abrirSonidos());
$("sonidos-cerrar").addEventListener("click", () => $<HTMLDialogElement>("dialogo-sonidos").close());
$<HTMLInputElement>("sonidos-buscar").addEventListener("input", (event) => {
  const valor = (event.target as HTMLInputElement).value;
  if (sonidosTimer !== null) window.clearTimeout(sonidosTimer);
  sonidosTimer = window.setTimeout(() => void pintarSonidos(valor), 280);
});

$("lista-sonidos").addEventListener("click", (event) => {
  const objetivo = (event.target as HTMLElement).closest("button");
  if (!objetivo) return;
  const oir = objetivo.dataset.oir;
  if (oir) {
    // Listen without bringing it in: the <audio> reads the catalog WAV as is.
    sonidosReproduciendo?.pause();
    sonidosReproduciendo = new Audio(`/api/catalogo/audio?path=${encodeURIComponent(oir)}`);
    void sonidosReproduciendo.play();
    return;
  }
  const traer = objetivo.dataset.traer;
  if (traer) {
    objetivo.disabled = true;
    objetivo.textContent = "…";
    void acciones.usarSample({ archivo: traer, nombre: objetivo.dataset.nombre ?? "sample" }).then(
      (r) => {
        objetivo.disabled = false;
        objetivo.textContent = r.ok ? "✓" : "error";
        addMessage("system", r.ok ? `Sample added to the project from the library.` : r.texto);
      },
    );
  }
});

$("lista-proyectos").addEventListener("click", (event) => {
  const boton = (event.target as HTMLElement).closest<HTMLElement>("[data-ruta]");
  if (!boton) return;
  if (boton.dataset.error === "1") {
    addMessage("system", "That proyecto.json is unreadable: it cannot be opened.");
    return;
  }
  const ruta = boton.dataset.ruta ?? "";
  $<HTMLDialogElement>("dialogo-proyectos").close();
  if (ruta) void abrirProyectoDeDisco(ruta);
});

$("proyectos-cerrar").addEventListener("click", () => {
  $<HTMLDialogElement>("dialogo-proyectos").close();
});

$("proyectos").addEventListener("click", () => void abrirListaDeProyectos());

$("guardar").addEventListener("click", () => {
  if (guardadoTimer !== null) {
    window.clearTimeout(guardadoTimer);
    guardadoTimer = null;
  }
  void guardarEnDisco(false);
});

$<HTMLInputElement>("audio-file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await importarAudioDesdeSelector(files);
});

/**
 * Distributes what is chosen in "Open" or dropped onto the canvas: a project
 * (.json / .miuzika.zip), audio (WAV, MP3…) or MIDI (.mid).
 *
 * Order matters: the project first, because the tracks need somewhere to go.
 */
async function abrirArchivos(todos: File[]): Promise<void> {
  if (!ready || todos.length === 0) return;

  const audios = todos.filter((file) => esAudio(file));
  const midis = todos.filter((file) => !esAudio(file) && esMidi(file));
  const proyectos = todos.filter((file) => !esAudio(file) && !esMidi(file));

  if (proyectos.length > 1) {
    addMessage("system", `Only one project can be opened at a time: using “${proyectos[0].name}”.`);
  }

  if (proyectos.length > 0) {
    const file = proyectos[0];
    setBusy(true, "Loading project…");
    restoring = true;
    try {
      let parsed: Project;
      const avisos: string[] = [];
      const esZip = /\.(miuzika\.)?zip$/i.test(file.name);
      if (esZip) {
        // The bundle's WAVs are written into the project folder and the project keeps
        // their paths: that way the bundle becomes an on-disk project.
        const imported = await importProjectBundle(file);
        parsed = imported.project;
        avisos.push(...imported.warnings);
        const slug = slugDeProyecto(parsed);
        parsed.audioAssets ??= [];
        for (const wav of imported.wavs) {
          try {
            const ficha = new File([wav.data as unknown as BlobPart], wav.nombre, { type: "audio/wav" });
            const { path } = await subirAudio(ficha, slug);
            const asset = parsed.audioAssets.find((candidato) => candidato.id === wav.assetId);
            if (asset) asset.ruta = path;
            else parsed.audioAssets.push({ id: wav.assetId, name: wav.nombre, durationBeats: 1, ruta: path });
          } catch (error) {
            avisos.push(
              `Could not copy ${wav.nombre} to the project: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } else {
        // A .json can be a master file, a loose bundle or a Project.
        const disco = interpretarProyectoEnDisco(await file.text());
        parsed = disco.proyecto;
      }
      const { faltan } = await hidratarAssets(parsed, slugDeProyecto(parsed));
      setProject(parsed);
      addMessage(
        "assistant",
        `Opened “${parsed.name}”. Its WAVs are looked up in proyectos/${slugDeProyecto(parsed)}/ using each asset's path.`,
      );
      for (const aviso of avisos) addMessage("system", aviso);
      warnMissingAudio(faltan);
    } catch (error) {
      addMessage("system", `Could not open: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      restoring = false;
      setBusy(false);
    }
  }

  for (const midi of midis) await importarMidiDesdeDisco(midi);

  if (audios.length > 0) await importarAudioDesdeSelector(audios);
}

$<HTMLInputElement>("open").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const todos = Array.from(input.files ?? []);
  input.value = "";
  await abrirArchivos(todos);
});

// Drag and drop onto the window. The empty state promised "drag a WAV here" from day
// one and there was no handler: dropping a file did absolutely nothing.
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
  if (ficheros.length > 0) void abrirArchivos(ficheros);
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (target?.isContentEditable) return;
  // With text selected on the page, Ctrl+C/X belong to the browser: otherwise, when
  // copying a piece of the agent's answer, the shortcut was eaten by the clips
  // clipboard and nothing was copied.
  const seleccion = window.getSelection();
  const hayTexto = Boolean(seleccion && !seleccion.isCollapsed && seleccion.toString().trim().length > 0);
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
  } else if (key === "s") {
    // Ctrl+S = write the master file now, without waiting for autosave.
    event.preventDefault();
    if (guardadoTimer !== null) {
      window.clearTimeout(guardadoTimer);
      guardadoTimer = null;
    }
    void guardarEnDisco(false);
  } else if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) void redo();
    else void undo();
  } else if (key === "y") {
    event.preventDefault();
    void redo();
  }
});

// --- Startup ---------------------------------------------------------------

/**
 * Startup: the disk is the source of truth, but **no project is opened on its own**.
 * The user decides with "Projects" (or by asking for a new piece).
 *
 * Before, the last one recorded in `localStorage` was opened and replaced whatever the
 * user was looking at; in an empty project it read as a loading failure. The empty
 * canvas already explains what to do, so nothing is written here.
 */
async function boot(): Promise<void> {
  setProject(null, false);
  // The system prompt has to carry the manifest and the project line from startup
  // (before, it stayed bare and the resting state lied to whoever looked at
  // `__miuzika.conversacion`). `cargarAgenteDelProyecto` refreshes it too, but it is
  // not awaited here.
  await refrescarManifiesto();
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
    /** For debugging: the context the model sees and the tool runner. */
    get conversacion() {
      return conversacion;
    },
    herramienta: ejecutarHerramienta,
    get future() {
      return future;
    },
    acciones,
    abrirArchivos,   // same path as "Open" and drag-and-drop: useful for testing
    stems: stemPlayer,
    costeGpu,
    nuevoProyecto: (nombre: string, bpm: number, lengthBars: number) =>
      setProject(createProject({ name: nombre, bpm, lengthBars })),
  };
}

/**
 * The project's .sf2 files, to hand them to the engine. They are requested from the
 * server because the file lives in `proyectos/<slug>/` and not in memory: that way the
 * project remains portable and sounds the same on another machine.
 */
async function cargarSoundfontsDelProyecto(
  view: Project,
): Promise<Map<string, { uuid: Uint8Array; name: string; bytes: ArrayBuffer }>> {
  const mapa = new Map<string, { uuid: Uint8Array; name: string; bytes: ArrayBuffer }>();
  for (const track of view.tracks) {
    const archivo = track.instrument.type === "soundfont" ? track.instrument.archivo : undefined;
    if (!archivo || mapa.has(archivo)) continue;
    const respuesta = await fetch(`/api/audio?path=${encodeURIComponent(archivo)}`, {
      headers: cabeceraDeProyecto(slugDeProyecto(view)),
    }).catch(() => null);
    if (!respuesta || !respuesta.ok) continue;
    mapa.set(archivo, {
      uuid: uuidDeSoundfont(archivo),
      name: archivo.split("/").pop() ?? "instrumento.sf2",
      bytes: await respuesta.arrayBuffer(),
    });
  }
  return mapa;
}

/** The General MIDI SoundFont, once per session (~30 MB). */
let gmEnMemoria: { ruta: string; sf: { uuid: Uint8Array; name: string; bytes: ArrayBuffer } } | null = null;

/**
 * The General MIDI SoundFont from `workspace/catalogo/gm/`, if any track uses it (a MIDI
 * track with `instrument.program`). Without the file, those tracks sound with openDAW's
 * instruments, as before.
 */
async function cargarGm(view: Project): Promise<{ uuid: Uint8Array; name: string; bytes: ArrayBuffer } | null> {
  const loUsa = view.tracks.some(
    (t) => t.kind === "midi" && t.instrument.program !== undefined && !(t.instrument.type === "soundfont" && t.instrument.archivo),
  );
  if (!loUsa) return null;
  try {
    const info = (await (await fetch("/api/gm")).json()) as { ruta?: string | null; nombre?: string };
    if (!info.ruta) {
      warnPersistence(
        "Some tracks use a General MIDI instrument but there is no GM SoundFont in workspace/catalogo/gm/: they play with openDAW's synths.",
      );
      return null;
    }
    if (gmEnMemoria?.ruta === info.ruta) return gmEnMemoria.sf;
    setStatus(`Loading the General MIDI SoundFont (${info.nombre ?? info.ruta})…`);
    const respuesta = await fetch(`/api/audio?path=${encodeURIComponent(info.ruta)}`);
    if (!respuesta.ok) return null;
    gmEnMemoria = {
      ruta: info.ruta,
      sf: { uuid: uuidDeSoundfont(info.ruta), name: info.nombre ?? "gm.sf2", bytes: await respuesta.arrayBuffer() },
    };
    return gmEnMemoria.sf;
  } catch {
    return null;
  }
}

/** 16 stable bytes from the path: the adapter and the engine must match. */
function uuidDeSoundfont(texto: string): Uint8Array {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    h1 = Math.imul(h1 ^ texto.charCodeAt(i), 16777619) >>> 0;
    h2 = (h2 + Math.imul(texto.charCodeAt(i) + i, 2654435761)) >>> 0;
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const fuente = i < 8 ? h1 : h2;
    bytes[i] = (fuente >>> ((i % 4) * 8)) & 0xff;
  }
  return bytes;
}
