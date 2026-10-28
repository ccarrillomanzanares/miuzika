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
  SEGUNDOS_STREAMING,
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
import { getModel, health, listModels, setModel } from "./llm.ts";
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
import { locale, traducirPagina } from "./i18n.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Textos fijos de la página en el idioma del navegador (la conversación no pasa por aquí).
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
/** Contador de gasto de la GPU (generico: lo alimenta /api/gpu/estado). */
const costeGpu = initCosteGpu(document.getElementById("gpu-coste"));

const timeline = new TimelineView(canvas, wrap, heads);

// Al plegar el chat se libera espacio: el lienzo tiene que reajustarse.
chat.onLayout(() => timeline.relayout());

// ── Agente: piensa y actúa (la clave la pone el servidor; las manos, el workspace)
const AGENTE_SISTEMA = promptDelSistema();

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
        (manifiestoMotor ? `\n\n=== MOTOR DISPONIBLE ===\n${manifiestoMotor}` : "") +
        bloqueContexto(resumenAgente, turnosAgente);
    }
  } catch {
    /* sin manifiesto: se trabaja con el prompt basico */
  }
}

const conversacion: ChatMessage[] = [{ role: "system", content: AGENTE_SISTEMA }];

let trabajando = false;

// ── Barra de actividad: frase de lo que hace + reloj, sin llenar el chat.
let latido: number | null = null;
let pasoActual = "pensando";
/** Cuando empezo la herramienta en curso (null = el modelo esta pensando). */
let pasoDesde: number | null = null;
/** Ultima senal del turno: evento del agente o resultado de una herramienta. */
let ultimoEventoMs = Date.now();
/** Control para cortar el turno desde «Cancelar». */
let cancelador: AbortController | null = null;

function pararLatido(): void {
  if (latido !== null) {
    clearInterval(latido);
    latido = null;
  }
}

/**
 * Lo que se puede decir con fundamento cuando el turno lleva rato callado: si la
 * GPU esta arrancando no esta colgado, esta esperando; si de verdad no hay
 * senales, se dice cuanto lleva asi.
 */
function avisoDeEspera(): string {
  const gpu = costeGpu.estado();
  if (gpu?.fase === "arrancando") {
    const rato = minutosYsegundos(gpu.arranque);
    return `GPU arrancando${rato ? ` ${rato}` : ""} · aún no factura`;
  }
  if (/@lambda/.test(pasoActual) && gpu?.fase === "activa") return "GPU ejecutando · sin salida todavía";
  // Un script en este equipo no manda señales hasta que acaba: un render de 2,5 min
  // salía como «⚠ sin señales» y parecía colgado. Su reloj ya dice cuánto lleva.
  if (pasoDesde !== null && /^(ejecutando|exportando) /.test(pasoActual)) return "";
  const callado = sinSenales(ultimoEventoMs);
  return callado > 0 ? `⚠ sin señales hace ${callado} s` : "";
}

/**
 * Repinta la barra cada segundo con lo que esta haciendo AHORA: el reloj del
 * turno y, si hay una herramienta corriendo, lo que lleva esa llamada.
 */
function arrancarLatido(desde: number): void {
  pararLatido();
  const pintar = (): void => {
    const enPaso = pasoDesde === null ? null : Date.now() - pasoDesde;
    const nota = avisoDeEspera();
    const marco = fraseBarra(pasoActual, enPaso, Date.now() - desde) + (nota ? ` · ${nota}` : "");
    setStatus(marco);
    // La misma frase, en el chat: la barra de abajo es pequeña y con el chat abierto
    // no se mira. Un turno largo sin esto parece que no hace nada.
    chat.mostrarProgreso(marco);
  };
  pintar();
  latido = window.setInterval(pintar, 1000);
}

async function responderAlUsuario(texto: string): Promise<void> {
  if (trabajando) {
    chat.add("system", "Sigo trabajando en el turno anterior: espera a que termine.");
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
  pasoActual = `Agente ${getModel()}: pensando`;
  pasoDesde = null;
  arrancarLatido(t0);
  try {
    const resultado = await ejecutarAgente(conversacion, {
      signal: cancelador.signal,
      alEvento: (evento) => {
        // Cualquier evento cuenta como señal de vida del turno.
        ultimoEventoMs = Date.now();
        // La actividad vive en la barra de abajo, no en tarjetas dentro del chat.
        if (evento.tipo === "progreso") {
          pasoActual = evento.texto;
          pasoDesde = null;
          setStatus(evento.texto);
          chat.mostrarProgreso(evento.texto);
          return;
        }
        if (evento.tipo === "herramienta") {
          // Empieza una llamada: el reloj del paso arranca aqui.
          pasoActual = evento.texto;
          pasoDesde = Date.now();
          chat.mostrarProgreso(evento.texto);
          return;
        }
        // Termino: su tiempo se queda a la vista hasta la siguiente herramienta.
        pasoDesde = null;
        pasoActual =
          evento.nombre && typeof evento.ms === "number"
            ? pasoTerminado(evento.nombre, evento.ms)
            : evento.texto;
        setStatus(fraseBarra(pasoActual, null, Date.now() - t0));
      },
    });
    chat.ocultarProgreso();
    chat.update(burbuja, resultado.texto || "(sin respuesta final)");
    pararLatido();
    // Una linea discreta al final del historial: en que se fue el tiempo del turno.
    chat.add("meta", `✓ ${lineaResumen(resultado)} · ${getModel()}`);
    // El turno va al historial del proyecto SIEMPRE, también si no hubo respuesta
    // final: si no, el encargo del usuario se perdía y el turno siguiente no sabía
    // qué se le había pedido.
    const estado = agregarTurno(resumenAgente, turnosAgente, {
      usuario: texto,
      asistente:
        (resultado.texto ?? "").trim() !== ""
          ? resultado.texto
          : `(turno sin respuesta final: ${lineaResumen(resultado)})`,
    });
    resumenAgente = estado.resumen;
    turnosAgente = estado.turnos;
    void guardarAgente();
    setStatus(
      `✓ listo · ${resultado.pasos} paso(s) · ${resultado.llamadas} herramienta(s) · ` +
        `${segundos(resultado.ms)} · ${getModel()}`,
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    pararLatido();
    if (cancelador?.signal.aborted) {
      chat.update(
        burbuja,
        "Turno cancelado por ti. Lo que ya estaba escrito en el disco se queda; si hay una GPU arrancada, " +
          "apágala con el contador de la cabecera (sigue facturando hasta que se apague).",
      );
      setStatus("✓ turno cancelado");
      void costeGpu.refrescar();
    } else {
      chat.update(burbuja, `No he podido completar el turno: ${mensaje}`);
      setStatus(`✗ error: ${mensaje.slice(0, 140)}`);
    }
  } finally {
    trabajando = false;
    pasoDesde = null;
    cancelador = null;
    $<HTMLButtonElement>("cancelar").hidden = true;
    chat.setBusy(false);
  }
  // El historial no puede crecer sin limite: sistema + los ultimos turnos, cortando
  // siempre por un mensaje del usuario (nunca entre una llamada y su resultado).
  recortarConversacion(conversacion, 25);
}

chat.onSend((texto) => {
  void responderAlUsuario(texto);
});

// Cancelar: corta el modelo y la herramienta en vuelo (una GPU a medias no se
// apaga sola, pero deja de tener un turno empujándola).
$("cancelar").addEventListener("click", () => {
  if (!cancelador) return;
  cancelador.abort();
  setStatus("cancelando… (la GPU, si está encendida, se apaga aparte)");
});

// El servidor publica un id de su código: si cambia, esta pestaña está vieja.
vigilarVersion(() => {
  const boton = $<HTMLButtonElement>("recargar");
  boton.hidden = false;
  boton.classList.add("activo");
  addMessage(
    "system",
    "El servidor tiene código más nuevo que esta pestaña. Pulsa «↻ versión nueva» para cargarlo: " +
      "hasta entonces la app va con el bundle viejo y el agente puede encontrarse funciones que ya no existen " +
      "(pasó con crear_proyecto).",
  );
});

$("recargar").addEventListener("click", () => location.reload());

/**
 * Conversación del agente POR PROYECTO, en `proyectos/<slug>/agente.json`.
 * Al recargar se rehidrata en el prompt de sistema, así que el agente sabe qué
 * se hizo antes en este proyecto (antes se perdía todo con un F5).
 */
let resumenAgente = "";
let turnosAgente: TurnoAgente[] = [];
/** Slug cuya conversación está cargada en memoria (para no recargarla sin motivo). */
let slugAgente = "";

async function cargarAgenteDelProyecto(vista: Project | null): Promise<void> {
  const slug = vista ? slugDeProyecto(vista) : "";
  if (slug === slugAgente) return;
  slugAgente = slug;
  resumenAgente = "";
  turnosAgente = [];
  if (slug !== "") {
    try {
      const res = await fetch(`/api/fs/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `proyectos/${slug}/agente.json` }),
      });
      if (res.ok) {
        const datos = (await res.json()) as { contenido?: string };
        const leido = interpretarAgente(String(datos.contenido ?? ""));
        resumenAgente = leido.resumen;
        turnosAgente = leido.turnos;
      }
    } catch {
      /* sin historial: se empieza limpio */
    }
  }
  // A MITAD de turno (el agente acaba de llamar a crear_proyecto) la conversación NO
  // se toca: es la del encargo en curso. Antes se vaciaba aquí y la siguiente llamada
  // al modelo llevaba sólo el prompt de sistema: el agente perdía la petición del
  // usuario, el proveedor contestaba 'load' a una conversación sin mensaje de usuario
  // y el turno se gastaba en reintentos (27-oct, proyecto «doubledare»). Sólo se
  // pone al día el prompt de sistema, que dice qué proyecto está abierto.
  if (trabajando) {
    await refrescarManifiesto();
    return;
  }
  // Fuera de un turno, la conversación en curso es del proyecto anterior: se tira, y
  // el panel se pinta con lo que el modelo recuerda de ESTE proyecto.
  conversacion.length = 1;
  chat.clear();
  if (turnosAgente.length > 0) {
    chat.add(
      "meta",
      `Conversación guardada de este proyecto: ${turnosAgente.length} turno(s). Es lo que recuerdo al empezar.`,
    );
    for (const turno of turnosAgente.slice(-4)) {
      if (turno.usuario) chat.add("user", turno.usuario);
      if (turno.asistente) chat.add("assistant", turno.asistente);
    }
  }
  await refrescarManifiesto();
}

/**
 * Foto del proyecto ANTES del turno, en `proyectos/<carpeta>/versiones/`: es lo
 * que permite al agente (herramienta `versiones`) volver atrás una pista o el
 * proyecto entero. El servidor se queda con las últimas MAX_VERSIONES.
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
    /* una foto que falla no puede impedir el turno */
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
    /* el historial no puede romper un turno */
  }
}

let project: Project | null = null;
/** Panel del touchpad (se crea más abajo; applyProject le avisa de los cambios). */
let panelPad: PanelPad | null = null;
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

/** Ruta completa (con la carpeta del proyecto) para <audio src>, que no manda cabeceras. */
function rutaCompleta(src: string): string {
  if (!project) return src;
  return rutaEnProyecto(src, slugDeProyecto(project));
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

// Un turno del agente hace decenas de cambios: con 8 el deshacer no llegaba ni al
// principio del turno. Para ir más atrás están las versiones (una por turno).
const HISTORY_LIMIT = 60;
/** Historial de undo: en memoria, de la sesión. El disco guarda el estado, no los pasos. */
let history: Project[] = [];
let future: Project[] = [];

/** Carpeta del proyecto en workspace/proyectos/ (fija desde que se crea: ver meta.carpeta). */
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
 * Carga el proyecto en openDAW. Con `reproducir: false` deja el motor listo sin
 * arrancar el transporte: es lo que usa el pad para sonar en directo.
 */
async function startOpenDawPlayback(view: Project, reproducir = true): Promise<void> {
  if (openDawHandle) stopOpenDaw();
  const generation = ++openDawGeneration;
  setBusy(true, reproducir ? "Cargando WAVs y arrancando openDAW…" : "Preparando los instrumentos…");
  try {
    const { faltan } = await hidratarAssets(view, slugDeProyecto(view));
    warnMissingAudio(faltan);
    const { playWithOpenDaw } = await import("./opendaw-engine.ts");
    const endBeat = view.lengthBars * beatsPerBar(view);
    // openDAW solo recibe lo que esta decodificado; los stems largos van aparte.
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
    `Faltan ${missing.length} WAV (${shown}${rest}). El proyecto los referencia, pero no están en la carpeta del proyecto: ` +
      "esas pistas sonarán vacías hasta que los WAV vuelvan a su sitio.",
  );
}

function warnPersistence(message: string): void {
  if (persistenceWarned) return;
  persistenceWarned = true;
  addMessage("system", message);
}

/** Clave con el proyecto abierto: lo único que queda en el navegador. */
const CLAVE_ABIERTO = "miuzika.proyecto-abierto";

/**
 * Un cambio del proyecto: apunta el proyecto abierto (para reabrirlo al
 * recargar) y programa la escritura del fichero maestro. No hay más estado en
 * el navegador: los datos y los WAV viven en el disco.
 */
function persist(): void {
  try {
    if (project) localStorage.setItem(CLAVE_ABIERTO, slugDeProyecto(project));
    else localStorage.removeItem(CLAVE_ABIERTO);
  } catch {
    warnPersistence("No se pudo apuntar el proyecto abierto en localStorage.");
  }
  programarGuardado();
}

// ── Fichero maestro en disco: proyectos/<slug>/proyecto.json ────────────────
// Autoguardado con retardo: escribir en cada arrastre de fader sería un POST por
// movimiento; 1,5 s tras el último cambio es invisible y no pierde nada. El botón
// «Guardar» (y Ctrl+S) fuerza la escritura y lo cuenta en el chat.
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
 * Escribe el fichero maestro. `silencioso` (autoguardado) sólo deja el aviso en
 * la barra de estado; el botón «Guardar» además lo cuenta en el chat.
 */
async function guardarEnDisco(silencioso: boolean): Promise<void> {
  const vista = project;
  if (!vista) {
    if (!silencioso) addMessage("system", "No hay proyecto abierto que guardar.");
    return;
  }
  if (!ready) return;
  if (guardando) {
    // Ya hay una escritura en vuelo: al terminar se relanza con el estado nuevo.
    guardadoPendiente = true;
    return;
  }
  guardando = true;
  const ruta = rutaDeProyecto(slugDeProyecto(vista));
  try {
    const { datos, sinRuta } = serializarProyecto(vista, audioAssets);
    await guardarProyectoEnDisco(ruta, JSON.stringify(datos, null, 2));
    setStatus(`✓ guardado ${ruta} · ${horaActual()} · ${datos.proyecto.tracks.length} pistas`);
    if (!silencioso) {
      const conRuta = datos.proyecto.audioAssets?.filter((asset) => asset.ruta).length ?? 0;
      addMessage(
        "assistant",
        `Guardado en ${ruta}: ${datos.proyecto.tracks.length} pista(s), ${datos.proyecto.bpm} BPM, ` +
          `${datos.proyecto.lengthBars} compases, ${conRuta} WAV de la carpeta` +
          (sinRuta.length > 0
            ? `. ${sinRuta.length} sin fichero en disco (${sinRuta.slice(0, 3).join(", ")}): ésos no viajan con el proyecto.`
            : "."),
      );
    }
  } catch (error) {
    addMessage(
      "system",
      `No se pudo guardar en disco: ${error instanceof Error ? error.message : String(error)}. ` +
        "Los cambios están en pantalla, pero no en el fichero maestro.",
    );
    setStatus("✗ no se pudo guardar en disco");
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
  setBusy(true, "Cargando audio…");
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
  setBusy(true, "Cargando audio…");
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
  // El historial es de UN proyecto: deshacer nunca debe resucitar otro proyecto
  // dentro de la carpeta del actual.
  if (!project || !next || slugDeProyecto(project) !== slugDeProyecto(next)) {
    history = [];
    future = [];
    record = false;
  }
  if (record && project) recordHistory();
  applyProject(next);
  updateHistoryButtons();
}

/** Cambio en vivo (mute/solo): no reinicia el engine ni el playhead. */
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
    addMessage("system", `No se pudo cambiar ${flag}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyProject(next: Project | null): void {
  if (openDawHandle) stopOpenDaw();
  else openDawGeneration++;
  setPlaying(false);
  project = next;
  // Cambiar de proyecto no debe dejar los WAV del anterior ocupando RAM.
  liberarAssetsNoUsados(next);
  // Y el agente cambia de conversación: cada proyecto tiene la suya en disco.
  void cargarAgenteDelProyecto(next);
  persist();
  updateActions();
  const view = next;
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
  panelPad?.proyectoCambiado();
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
  const duracionBeats = request.bars * barBeats;
  // El WAV renderizado va al disco como cualquier otro audio del proyecto: si no,
  // el fichero maestro no podría referenciarlo y se perdería al recargar.
  let ruta: string | null = null;
  try {
    const fichero = new File([rendered.blob], `${slugDeProyecto(base)}_strudel_${request.sourceId}.wav`, {
      type: "audio/wav",
    });
    ruta = (await subirAudio(fichero, slugDeProyecto(base))).path;
  } catch (error) {
    addMessage(
      "system",
      `El audio de Strudel no se pudo escribir en la carpeta del proyecto (${
        error instanceof Error ? error.message : String(error)
      }): sonará en esta sesión, pero el proyecto no lo referenciará.`,
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
  const view = project;
  if (!ready || busy || !view || view.tracks.length === 0) return;
  if (openDawHandle?.isPlaying) {
    stopOpenDaw();
    return;
  }
  // Un motor cargado sin reproducir (el del pad) se descarga y se arranca de nuevo.
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
  if (project && project.tracks.length > 0 && !confirm("¿Cerrar este proyecto y empezar otro? El actual queda guardado en disco.")) return;
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

// El botón «Encargo» del chat: un formulario que escribe el mensaje (no lo envía).
const formularioEncargo = new FormularioEncargo({
  proyecto: () => project,
  escribir: (texto) => escribirEnCompositor(texto),
});
setAbrirEncargo(() => void formularioEncargo.abrir());

// Las herramientas del agente que tocan el proyecto (agent/acciones.ts) trabajan
// sobre ESTA pestaña a través de un contrato pequeño.
/**
 * Exportación del encargo: el proyecto a MIDI y/o la mezcla a WAV, en
 * `proyectos/<carpeta>/salida/`. El WAV lo renderiza el mismo motor que el Play.
 */
async function exportarProyecto(formatos: { midi: boolean; wav: boolean }): Promise<{ ok: boolean; texto: string }> {
  const view = project;
  if (!view) return { ok: false, texto: "No hay proyecto abierto." };
  const slug = slugDeProyecto(view);
  const hechos: string[] = [];
  try {
    if (formatos.midi) {
      const bytes = midiDeProyecto(view);
      const fichero = new File([bytes as unknown as BlobPart], `${slug}.mid`, { type: "audio/midi" });
      const { path } = await subirAudio(fichero, slug, "salida");
      const pistas = view.tracks.filter((t) => t.kind === "midi").length;
      hechos.push(`MIDI: proyectos/${slug}/${path} (${pistas} pista(s), ${view.bpm} BPM).`);
    }
    if (formatos.wav) {
      const { faltan } = await hidratarAssets(view, slug);
      warnMissingAudio(faltan);
      const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
      for (const [id, asset] of audioAssets) {
        if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
      }
      const soundfonts = await cargarSoundfontsDelProyecto(view);
      const gm = await cargarGm(view);
      const { renderizarMezcla } = await import("./opendaw-engine.ts");
      const mezcla = await renderizarMezcla(view, paraEngine, soundfonts, gm);
      const canales = mezcla.canales.slice(0, 2);
      if (canales.length === 0 || canales[0]!.length === 0) throw new Error("el render salió vacío");
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
          `pico ${picoDb.toFixed(1)} dBFS${pico > 1 ? " — RECORTA: baja el master" : ""}).`,
      );
    }
    return { ok: true, texto: hechos.join("\n") || "No se ha pedido ningún formato." };
  } catch (error) {
    return {
      ok: false,
      texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}No se pudo exportar: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const acciones = crearAcciones({
  proyecto: () => project,
  fijar: (siguiente) => setProject(siguiente),
  enVivo: (siguiente) => commitLive(siguiente),
  avisar: (texto) => addMessage("system", texto),
  exportar: exportarProyecto,
});
registrarAcciones(acciones);

// El touchpad como instrumento (web/src/pad.ts).
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
      addMessage("system", `No se pudo guardar lo grabado: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  avisar: (texto) => addMessage("system", texto),
  dibujar: (beat) => timeline.draw(beat),
});
$<HTMLButtonElement>("pad").addEventListener("click", () => panelPad?.abrir());

/** ¿Es un MIDI? Un .mid NO es audio: son notas, y hay que leerlas, no decodificarlas. */
function esMidi(file: File): boolean {
  return /\.(mid|midi)$/i.test(file.name) || /midi/i.test(file.type);
}

/**
 * Mete un `.mid` del disco en el proyecto: copia el fichero a `entrada/`, lee sus
 * pistas con `/api/midi` y las crea como pistas MIDI, con el mismo camino que
 * `anadir_pistas` (así el resultado se puede deshacer y se guarda solo).
 *
 * Antes no existía ninguna vía: «Abrir» lo trataba como un proyecto JSON y fallaba,
 * y el lienzo prometía «arrastra un WAV aquí» sin tener manejador de arrastre.
 */
async function importarMidiDesdeDisco(file: File): Promise<void> {
  if (!ready) return;
  setBusy(true, `Leyendo ${file.name}…`);
  try {
    if (!project) {
      const nombre = nombreDeProyectoDesdeFicheros([file]).slice(0, 40) || "MIDI";
      setProject(createProject({ name: nombre, bpm: 120, lengthBars: 32 }));
    }
    if (!project) return;
    const slug = slugDeProyecto(project);
    const { path } = await subirAudio(file, slug);
    const puesto = await acciones.anadirPistas({ midis: [path], wavs: [], inicioCompas: 0 });
    addMessage("system", puesto.ok ? `MIDI «${file.name}» importado.` : puesto.texto);
  } catch (error) {
    addMessage(
      "system",
      `No se pudo leer «${file.name}»: ${error instanceof Error ? error.message : String(error)}. ` +
        "Tiene que ser un MIDI estándar (.mid); si es un .midi de algún programa raro, expórtalo de nuevo.",
    );
  } finally {
    setBusy(false);
  }
}

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
 *
 * Cada fichero se copia primero a `proyectos/<slug>/entrada/`: el proyecto es
 * portable porque referencia sus WAV por ruta, no por bytes en el navegador.
 *
 * `destino` decide dónde caen: «anadir» respeta el proyecto abierto y el cursor;
 * «nuevo» empieza de cero con el nombre de la carpeta elegida (el caso de abrir
 * la carpeta `salida/` de un proyecto, que antes se pegaba al proyecto viejo).
 */
async function importarAudio(files: File[], destino: "anadir" | "nuevo" = "anadir"): Promise<void> {
  if (!ready || files.length === 0) return;
  const nuevo = destino === "nuevo" || !project;
  const LIMITE_RAM = 900 * 1024 * 1024; // ~900 MB: por encima el navegador se cae
  const nombreNuevo = nombreDeProyectoDesdeFicheros(files);
  setBusy(true, nuevo ? `Creando “${nombreNuevo}”…` : "Importando audio…");
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
      // 1) al disco. Sin copia no hay nada que el fichero maestro pueda referenciar.
      let ruta = "";
      try {
        ruta = (await subirAudio(file, slug)).path;
      } catch (error) {
        sinDisco.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // 2) duración y onda las mide el servidor (el WAV ya está en su sitio).
      const meta = await metadatosWav(rutaEnProyecto(ruta, slug));
      const segundos = meta.duracionSeg;
      let assetId: string;
      let nombre = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Audio";
      let durationBeats = Math.max(0.25, (segundos * current.bpm) / 60);

      if (segundos >= SEGUNDOS_STREAMING) {
        // Largo: nunca se decodifica (así caben stems de 6 minutos).
        assetId = idDeAsset(nombre);
        registrarAssetStreaming({
          id: assetId,
          name: nombre,
          durationBeats,
          src: ruta,
          peaks: Float32Array.from(meta.picos),
        });
      } else {
        // Corto: decodificado para que openDAW lo pueda reproducir.
        const asset = await loadAudioFile(file, current.bpm, ruta);
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
        ? `Proyecto nuevo “${current.name}” a ${current.bpm} BPM con ${metidos} audio(s) copiados a ` +
            `proyectos/${slug}/entrada/, cada uno en su pista. Si los stems son de otro tempo, cámbialo antes de darle al play.`
        : `${metidos} audio(s) copiados a proyectos/${slug}/entrada/ y añadidos en el compás ${bar + 1}, cada uno en su pista.`,
    );
    if (cortado) {
      addMessage(
        "system",
        `Paré en ${Math.round(ramAudioBytes() / 1048576)} MB de audio en memoria (límite ~900 MB): ` +
          "el navegador se quedaría sin aire. Importa los stems restantes en otra tanda (los largos no se decodifican, así que caben).",
      );
    }
    for (const fallo of sinDisco.slice(0, 4)) addMessage("system", `No se pudo copiar al disco: ${fallo}`);
    if (sinDisco.length > 4) addMessage("system", `…y ${sinDisco.length - 4} más sin copiar.`);
  } catch (error) {
    addMessage("system", `No se pudo importar: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

/**
 * Pregunta qué hacer con los audios elegidos. Con proyecto abierto el usuario
 * elige: añadirlos (como siempre) o empezar uno nuevo con el nombre de la carpeta.
 */
type DestinoAudio = "anadir" | "nuevo" | "cancelar";

function preguntarDestinoAudio(files: File[]): Promise<DestinoAudio> {
  const dialogo = $<HTMLDialogElement>("dialogo-audio");
  const nombre = nombreDeProyectoDesdeFicheros(files);
  $("audio-anadir").textContent = `Añadir a “${project?.name ?? "—"}”`;
  $("audio-nuevo").textContent = `Proyecto nuevo “${nombre}”`;
  $("dialogo-audio-detalle").textContent =
    `${files.length} fichero(s). «Añadir» los mete en el proyecto abierto, en el compás del cursor; ` +
    `«Proyecto nuevo» empieza de cero con el nombre de la carpeta (${nombre}).`;

  return new Promise((resolver) => {
    let contestado = false;
    const terminar = (valor: DestinoAudio): void => {
      if (contestado) return;
      contestado = true;
      dialogo.close();
      resolver(valor);
    };
    // onclick/oncancel se reasignan (no se acumulan) en cada apertura.
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

/** Punto único para importar audio con el selector: pregunta el destino si hay proyecto. */
async function importarAudioDesdeSelector(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const destino: DestinoAudio = project ? await preguntarDestinoAudio(files) : "nuevo";
  if (destino === "cancelar") return;
  await importarAudio(files, destino);
}

/** Fecha corta para la lista de proyectos ("23 oct, 21:04"). */
function fechaCorta(iso: string): string {
  if (!iso) return "sin fecha";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "sin fecha";
  return fecha.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Diálogo «Sonidos»: busca en la biblioteca CC0 (índice del servidor) y trae lo que
 * elijas al proyecto. Sin copiar a mano: el sample entra convertido y normalizado.
 */
let sonidosTimer: number | null = null;
let sonidosReproduciendo: HTMLAudioElement | null = null;

async function pintarSonidos(consulta: string): Promise<void> {
  const lista = $("lista-sonidos");
  const texto = consulta.trim();
  if (texto === "") {
    lista.innerHTML = `<p class="vacio">4.231 samples CC0 (VCSL). Escribe lo que buscas.</p>`;
    return;
  }
  lista.innerHTML = `<p class="vacio">Buscando «${escapeHtml(texto)}»…</p>`;
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
    // La biblioteca trae la misma toma en 6-12 capas y repeticiones: se agrupa por
    // instrumento y se queda el primero (el que mejor puntuó), diciendo cuántos hay.
    const porInstrumento = new Map<string, { fila: (typeof todos)[number]; cuantos: number }>();
    for (const fila of todos) {
      const previo = porInstrumento.get(fila.instrumento);
      if (previo) previo.cuantos += 1;
      else porInstrumento.set(fila.instrumento, { fila, cuantos: 1 });
    }
    const filas = [...porInstrumento.values()].map((x) => ({ ...x.fila, cuantos: x.cuantos }));
    if (filas.length === 0) {
      lista.innerHTML = `<p class="vacio">Nada parecido a «${escapeHtml(texto)}» en los ${datos.total ?? 0} samples.</p>`;
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
          `<button class="icon" data-oir="${escapeHtml(r.rutaAudio)}" title="Escuchar">▶</button>` +
          `<span class="sonido-nombre"><strong>${escapeHtml(r.instrumento)}</strong>` +
          `<em>${escapeHtml(r.familia)}${medidas ? " · " + escapeHtml(medidas) : ""}` +
          `${(r as { cuantos?: number }).cuantos && (r as { cuantos?: number }).cuantos! > 1 ? ` · ${(r as { cuantos?: number }).cuantos} variantes` : ""}` +
          `${r.strudel ? ` · Strudel: s("${escapeHtml(r.strudel)}")` : ""}</em></span>` +
          `<button data-traer="${escapeHtml(r.archivo)}" data-nombre="${escapeHtml(
            r.instrumento.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          )}">Añadir</button>` +
          `</div>`
        );
      })
      .join("");
  } catch (error) {
    lista.innerHTML = `<p class="vacio">No pude buscar: ${escapeHtml(
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

/** Abre el diálogo con los proyectos que tienen proyecto.json en el disco. */
async function abrirListaDeProyectos(): Promise<void> {
  const dialogo = $<HTMLDialogElement>("dialogo-proyectos");
  const lista = $("lista-proyectos");
  lista.innerHTML = `<p class="vacio">Leyendo workspace/proyectos/…</p>`;
  if (!dialogo.open) dialogo.showModal();
  try {
    const proyectos = await listarProyectos();
    if (proyectos.length === 0) {
      lista.innerHTML =
        `<p class="vacio">Todavía no hay ningún <code>proyecto.json</code> en <code>workspace/proyectos/</code>. ` +
        "Se crea con el botón «Guardar» o solo, 1,5 s después de cualquier cambio.</p>";
      return;
    }
    lista.innerHTML = proyectos
      .map((proyecto) => {
        const detalle = proyecto.error
          ? `ilegible: ${proyecto.error}`
          : `${proyecto.bpm} BPM · ${proyecto.compases} compases · ${proyecto.pistas} pista(s)`;
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
    lista.innerHTML = `<p class="vacio">No se pudo leer la lista: ${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</p>`;
  }
}

/**
 * Abre un proyecto del disco: el fichero maestro manda y sus WAV se cargan de la
 * carpeta (`/api/audio`), decodificados si son cortos y por streaming si son largos.
 */
async function abrirProyectoDeDisco(ruta: string): Promise<void> {
  setBusy(true, "Abriendo proyecto de disco…");
  restoring = true;
  try {
    const texto = await leerProyectoDeDisco(ruta);
    const disco = interpretarProyectoEnDisco(texto);
    const carpeta = carpetaDeRuta(ruta);
    // La carpeta de la que se abre es la del proyecto, se llame como se llame: antes
    // un proyecto abierto de proyectos/stahl/ llamado «Stahl II» se guardaba en
    // proyectos/stahl-ii/, sin sus WAV.
    disco.proyecto.meta = { ...disco.proyecto.meta, carpeta };
    const { cargados, faltan } = await hidratarAssets(disco.proyecto, carpeta);
    // `restoring` sigue en true al aplicar el proyecto: abrir no debe reescribir
    // el fichero maestro (pisaría lo que haya en disco, incluido guardadoEn).
    setProject(disco.proyecto);
    addMessage(
      "assistant",
      `Abierto del disco “${disco.proyecto.name}” (proyectos/${carpeta}/): ` +
        `${disco.proyecto.tracks.length} pista(s), ${disco.proyecto.bpm} BPM, ${disco.proyecto.lengthBars} compases` +
        (cargados > 0 ? `, ${cargados} WAV cargado(s) de la carpeta.` : "."),
    );
    if (faltan.length > 0) warnMissingAudio(faltan);
  } catch (error) {
    restoring = false;
    addMessage(
      "system",
      `No se pudo abrir ${ruta}: ${error instanceof Error ? error.message : String(error)}`,
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
    // Escuchar sin traerlo: el <audio> lee el WAV del catálogo tal cual.
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
        addMessage("system", r.ok ? `Sample añadido al proyecto desde la biblioteca.` : r.texto);
      },
    );
  }
});

$("lista-proyectos").addEventListener("click", (event) => {
  const boton = (event.target as HTMLElement).closest<HTMLElement>("[data-ruta]");
  if (!boton) return;
  if (boton.dataset.error === "1") {
    addMessage("system", "Ese proyecto.json está ilegible: no se puede abrir.");
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
 * Reparte lo que se elige en «Abrir» o se suelta sobre el lienzo: un proyecto
 * (.json / .miuzika.zip), audio (WAV, MP3…) o MIDI (.mid).
 *
 * El orden importa: primero el proyecto, porque las pistas necesitan dónde ir.
 */
async function abrirArchivos(todos: File[]): Promise<void> {
  if (!ready || todos.length === 0) return;

  const audios = todos.filter((file) => esAudio(file));
  const midis = todos.filter((file) => !esAudio(file) && esMidi(file));
  const proyectos = todos.filter((file) => !esAudio(file) && !esMidi(file));

  if (proyectos.length > 1) {
    addMessage("system", `Solo se abre un proyecto a la vez: uso «${proyectos[0].name}».`);
  }

  if (proyectos.length > 0) {
    const file = proyectos[0];
    setBusy(true, "Cargando proyecto…");
    restoring = true;
    try {
      let parsed: Project;
      const avisos: string[] = [];
      const esZip = /\.(miuzika\.)?zip$/i.test(file.name);
      if (esZip) {
        // Los WAV del bundle se escriben en la carpeta del proyecto y el proyecto
        // se queda con sus rutas: así el bundle se convierte en un proyecto de disco.
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
              `No se pudo copiar ${wav.nombre} al proyecto: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } else {
        // Un .json puede ser un fichero maestro, un bundle suelto o un Project.
        const disco = interpretarProyectoEnDisco(await file.text());
        parsed = disco.proyecto;
      }
      const { faltan } = await hidratarAssets(parsed, slugDeProyecto(parsed));
      setProject(parsed);
      addMessage(
        "assistant",
        `Abierto “${parsed.name}”. Sus WAV se buscan en proyectos/${slugDeProyecto(parsed)}/ por la ruta de cada asset.`,
      );
      for (const aviso of avisos) addMessage("system", aviso);
      warnMissingAudio(faltan);
    } catch (error) {
      addMessage("system", `No se pudo abrir: ${error instanceof Error ? error.message : String(error)}`);
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

// Arrastrar y soltar sobre la ventana. El estado vacío prometía «arrastra un WAV
// aquí» desde el primer día y no había ningún manejador: soltar un fichero no hacía
// absolutamente nada.
for (const tipo of ["dragenter", "dragover"] as const) {
  document.addEventListener(tipo, (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    document.body.classList.add("arrastrando");
  });
}

document.addEventListener("dragleave", (event: DragEvent) => {
  if (event.relatedTarget) return; // se mueve por dentro de la ventana: no parpadea
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
  // Con texto seleccionado en la página, Ctrl+C/X son del navegador: si no, al
  // copiar un trozo de la respuesta del agente el atajo se lo comía el portapapeles
  // de clips y no copiaba nada.
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
    // Ctrl+S = escribir el fichero maestro ahora, sin esperar al autoguardado.
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

// --- Arranque --------------------------------------------------------------

/**
 * Arranque: el disco es la fuente de verdad, pero **no se abre ningún proyecto
 * solo**. El usuario decide con «Proyectos» (o pidiendo una pieza nueva).
 *
 * Antes se abría el último apuntado en `localStorage` y sustituía lo que el
 * usuario estuviera mirando; en un proyecto vacío se leía como fallo de carga.
 * El lienzo vacío ya explica qué hacer, así que aquí no se escribe nada.
 */
async function boot(): Promise<void> {
  setProject(null, false);
  // `cargarAgenteDelProyecto` sale antes cuando el slug no cambia ("" -> ""), así que
  // el prompt de sistema se quedaba con el texto pelado: sin manifiesto y sin la
  // línea del proyecto. El turno lo refresca igual antes de enviar, pero el estado en
  // reposo mentía a quien lo mirase (y a `__miuzika.conversacion`).
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
    /** Para depurar: el contexto que ve el modelo y el ejecutor de herramientas. */
    get conversacion() {
      return conversacion;
    },
    herramienta: ejecutarHerramienta,
    get future() {
      return future;
    },
    acciones,
    abrirArchivos,   // mismo camino que «Abrir» y el arrastre: sirve para probarlo
    stems: stemPlayer,
    costeGpu,
    nuevoProyecto: (nombre: string, bpm: number, lengthBars: number) =>
      setProject(createProject({ name: nombre, bpm, lengthBars })),
  };
}

/**
 * Los .sf2 del proyecto, para dárselos al motor. Se piden al servidor porque el
 * fichero vive en `proyectos/<slug>/` y no en memoria: así el proyecto sigue
 * siendo portable y suena igual en otra máquina.
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

/** El SoundFont General MIDI, una vez por sesión (son ~30 MB). */
let gmEnMemoria: { ruta: string; sf: { uuid: Uint8Array; name: string; bytes: ArrayBuffer } } | null = null;

/**
 * El SoundFont General MIDI de `workspace/catalogo/gm/`, si alguna pista lo usa
 * (una pista MIDI con `instrument.program`). Sin fichero, esas pistas suenan con
 * los instrumentos de openDAW, como antes.
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
        "Hay pistas con instrumento General MIDI pero no hay SoundFont GM en workspace/catalogo/gm/: suenan con los sintetizadores de openDAW.",
      );
      return null;
    }
    if (gmEnMemoria?.ruta === info.ruta) return gmEnMemoria.sf;
    setStatus(`Cargando el SoundFont General MIDI (${info.nombre ?? info.ruta})…`);
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

/** 16 bytes estables a partir de la ruta: el adaptador y el motor deben coincidir. */
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
