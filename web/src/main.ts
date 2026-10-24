import type { CodeSource, InstrumentType, Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { createProject, projectStats } from "../../src/core/project.ts";
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
  slugDeNombre,
} from "./proyecto-archivo.ts";
import {
  guardarProyectoEnDisco,
  leerProyectoDeDisco,
  listarFicheros,
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
  serializarAgente,
} from "./agent/contexto.ts";
import type { TurnoAgente } from "./agent/contexto.ts";
import { fraseBarra, lineaResumen, pasoTerminado, segundos } from "./agent/actividad.ts";
import {
  cabecerasProyecto,
  registrarAjustador,
  registrarCreador,
  registrarIgualador,
  registrarImportador,
  setProyectoActivo,
} from "./agent/tools.ts";
import type {
  AjustePista,
  PeticionIgualar,
  PeticionPistas,
  PeticionProyecto,
} from "./agent/tools.ts";
import { ejecutarHerramienta } from "./agent/tools.ts";
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
/** Contador de gasto de la GPU (generico: lo alimenta /api/gpu/estado). */
const costeGpu = initCosteGpu(document.getElementById("gpu-coste"));

const timeline = new TimelineView(canvas, wrap, heads);

// Al plegar el chat se libera espacio: el lienzo tiene que reajustarse.
chat.onLayout(() => timeline.relayout());

// ── Agente: piensa y actúa (la clave la pone el servidor; las manos, el workspace)
const AGENTE_SISTEMA = [
  "Eres el agente musical de miuzika, un DAW que corre en el navegador.",
  "Trabajas en espanol: breve al hablar, pero con datos reales al informar.",
  "HAY DOS MOTORES y LOS DOS YA EXISTEN. NO escribas otro ni redefinas sus funciones:",
  "  - codigo/ = motor numpy (dsp, instruments, render, midi, cancion). Corre en este portatil.",
  "    Se importa: from instruments import kick.",
  "  - gpu/motor_gpu.py = motor nativo de GPU (torch): osciladores batcheados, saturacion 4x con",
  "    antialias, reverb FFT, shimmer, congelado espectral, granular, compresor y master. Se importa:",
  "    import motor_gpu as M. En el portatil NO hay torch, asi que ese motor solo se ejecuta en la",
  "    instancia con ejecutar_python(destino='lambda'); escribirlo no se valida aqui.",
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
  "Para ENTREGAR una cancion llama a anadir_pistas(midis=[...], wavs=[...], compases=N): crea pistas",
  "reales en el DAW. Pasa SIEMPRE compases=N (la duracion de la toma, p.ej. 80): todos los clips que",
  "anadas duran esos compases, tanto los MIDI como los WAV, asi que acaban en el mismo compas. La",
  "duracion de un clip se cuenta en compases, no en segundos de fichero. Deja los .mid y los .wav",
  "(stems, no master) en salida/. NO masterices ni limitadores el stereo final: el master se decide en",
  "el DAW con los faders; entrega pistas separadas.",
  "Para corregir una linea usa editar_fichero(path, busca, reemplaza). Para medir un WAV usa",
  "verificar_audio(path). Para un sample rapido copia plantillas/one_shot.py y cambia PARAMS.",
  "Si de verdad hace falta algo nuevo, crealo en codigo/experimental/ con nombres nuevos.",
  "ANTES DE ENTREGAR, PREGUNTA (no lo decidas tu): (a) ¿pistas MIDI, WAV o las dos? Si son las dos, el",
  "material se duplica y suena doble: o dejas las MIDI silenciadas, o no las anades. (b) Si algun stem queda",
  "mas de 12 dB por debajo de la mediana (pico), dilo y PREGUNTA si corregirlo antes de tocar el script.",
  "Sin compases, el audio dura lo que el fichero redondeado a compas y el MIDI acaba en su ultima nota:",
  "No estires unos para igualar los otros: si el usuario los quiere iguales, pregunta antes.",
  "REGLA DEL DINERO: en Lambda se paga la GPU por hora, asi que alli SOLO se ejecuta motor_gpu (torch).",
  "Un script que importe dsp/instruments/render/cancion es del motor numpy: eso va con destino='cpu',",
  "que es gratis. El servidor RECHAZA (409) un script de numpy en Lambda; no lo reintentes igual.",
  "CALIDAD MAXIMA = motor_gpu con saturar(drive, veces=4), ir_estereo(dur>=3), reverb y shimmer,",
  "congelar, granular, compresor_multibanda y limitador. Si el usuario pide 'la mejor calidad' o 'usa la",
  "GPU', el audio se renderiza con motor_gpu en Lambda; los stems se entregan sin limitar y el limitador",
  "solo va en la suma de referencia, con headroom.",
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
    setStatus(fraseBarra(pasoActual, enPaso, Date.now() - desde) + (nota ? ` · ${nota}` : ""));
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
        if (evento.tipo === "herramienta") {
          // Empieza una llamada: el reloj del paso arranca aqui.
          pasoActual = evento.texto;
          pasoDesde = Date.now();
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
    chat.update(burbuja, resultado.texto || "(sin respuesta final)");
    pararLatido();
    // Una linea discreta al final del historial: en que se fue el tiempo del turno.
    chat.add("meta", `✓ ${lineaResumen(resultado)} · ${getModel()}`);
    // El turno va al historial del proyecto: sobrevive a recargas y reinicios.
    if ((resultado.texto ?? "").trim() !== "") {
      const estado = agregarTurno(resumenAgente, turnosAgente, {
        usuario: texto,
        asistente: resultado.texto,
      });
      resumenAgente = estado.resumen;
      turnosAgente = estado.turnos;
      void guardarAgente();
    }
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
  // El historial no puede crecer sin limite: sistema + los ultimos turnos.
  if (conversacion.length > 30) conversacion.splice(1, conversacion.length - 25);
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
  // La conversación en curso pertenece al proyecto anterior: se tira.
  conversacion.length = 1;
  await refrescarManifiesto();
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

const HISTORY_LIMIT = 8;
/** Historial de undo: en memoria, de la sesión. El disco guarda el estado, no los pasos. */
let history: Project[] = [];
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
  // Una sola regla para todos: la del fichero maestro (proyecto-archivo.ts).
  return slugDeNombre(origen.name);
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
    const { faltan } = await hidratarAssets(view, slugDeProyecto(view));
    warnMissingAudio(faltan);
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
  return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  // Cambiar de proyecto no debe dejar los WAV del anterior ocupando RAM.
  liberarAssetsNoUsados(next);
  // Y el agente cambia de conversación: cada proyecto tiene la suya en disco.
  void cargarAgenteDelProyecto(next);
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
  /**
   * La duracion de una toma se cuenta en COMPASES, no en segundos de fichero: asi
   * el MIDI (que acaba en su ultima nota) y el WAV (que lleva cola) del mismo
   * instrumento acaban en el mismo compas. Si el agente no la dice, se toma la del
   * audio, que es lo que dura el material.
   */
  const compasesToma = peticion.compases && peticion.compases > 0 ? Math.trunc(peticion.compases) : 0;
  const clipsMidi: { trackId: string; clipId: string }[] = [];
  let largoAudio = 0;
  const avisos: string[] = [];

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
            const clipId = current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
            if (clipId) clipsMidi.push({ trackId: id, clipId });
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
      const meta = await metadatosWav(rutaEnProyecto(ruta, slugDeProyecto(project)));
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
        const existente = current.tracks.find((t) => t.kind === "audio" && t.name === nombre);
        current = applyOps(current, [
          { op: "register_audio_asset", assetId, name: nombre, durationBeats, ruta },
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
                  lengthBeats:
                    compasesToma > 0
                      ? compasesToma * beatsPerBar(current)
                      : compasesDeAudio(durationBeats, beatsPerBar(current)),
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
                  lengthBeats:
                    compasesToma > 0
                      ? compasesToma * beatsPerBar(current)
                      : compasesDeAudio(durationBeats, beatsPerBar(current)),
                  gainDb: 0,
                  name: nombre,
                  track: { name: nombre },
                },
              ]),
        ]).project;
        if (compasesToma > 0 && compasesToma * beatsPerBar(current) > durationBeats + 1e-6) {
          avisos.push(
            `${nombre}: pediste ${compasesToma} compases pero el WAV dura ${durationBeats.toFixed(1)} beats ` +
              `(${(durationBeats / beatsPerBar(current)).toFixed(2)} compases). El clip se queda en lo que hay.`,
          );
        }
        largoAudio = Math.max(
          largoAudio,
          compasesToma > 0 ? compasesToma * beatsPerBar(current) : compasesDeAudio(durationBeats, beatsPerBar(current)),
        );
        hechas.push(
          `${nombre} (audio streaming, ${durationBeats.toFixed(1)} beats, sin decodificar)`,
        );
        continue;
      }

      const res = await fetch(`/api/audio?path=${encodeURIComponent(rutaEnProyecto(ruta, slugDeProyecto(project)))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], fichero, { type: "audio/wav" });
      // El asset apunta a su ruta en disco: el proyecto es portable sin más.
      const asset = await loadAudioFile(file, current.bpm, ruta);
      current = applyOps(current, [
        {
          op: "register_audio_asset",
          assetId: asset.id,
          name: asset.name,
          durationBeats: asset.durationBeats,
          ruta,
        },
        {
          op: "add_audio_clip",
          assetId: asset.id,
          startBar: inicio,
          lengthBeats:
            compasesToma > 0
              ? compasesToma * beatsPerBar(current)
              : compasesDeAudio(asset.durationBeats, beatsPerBar(current)),
          gainDb: 0,
          name: nombre,
          track: { name: nombre },
        },
      ]).project;
      if (compasesToma > 0 && compasesToma * beatsPerBar(current) > asset.durationBeats + 1e-6) {
        avisos.push(
          `${nombre}: pediste ${compasesToma} compases pero el WAV dura ${asset.durationBeats.toFixed(1)} beats. ` +
            "El clip se queda en lo que hay.",
        );
      }
      largoAudio = Math.max(
        largoAudio,
        compasesToma > 0 ? compasesToma * beatsPerBar(current) : compasesDeAudio(asset.durationBeats, beatsPerBar(current)),
      );
      hechas.push(`${nombre} (audio, ${asset.durationBeats.toFixed(1)} beats)`);
    } catch (error) {
      fallos.push(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // La toma entera mide lo mismo: compases dichos por el agente o, si no, lo que
  // dura el audio. Los clips MIDI se estiran hasta ahi (nunca se recortan: sus
  // notas ya caben dentro).
  const barBeatsToma = beatsPerBar(current);
  const largoToma =
    compasesToma > 0 ? compasesToma * barBeatsToma : largoAudio;
  if (largoToma > 0) {
    const opsFinales: Op[] = [];
    for (const { trackId, clipId } of clipsMidi) {
      const pista = current.tracks.find((t) => t.id === trackId);
      const clip = pista?.clips.find((c) => c.id === clipId);
      if (clip && clip.length < largoToma - 1e-6) {
        opsFinales.push({ op: "set_clip_length", trackId, clipId, lengthBeats: largoToma });
      }
    }
    if (opsFinales.length > 0) current = applyOps(current, opsFinales).project;
    current = applyOps(current, [
      {
        op: "set_song",
        bpm: current.bpm,
        lengthBars: Math.max(
          current.lengthBars,
          inicio + Math.ceil(largoToma / barBeatsToma - 1e-6),
        ),
      },
    ]).project;
  }

  if (hechas.length > 0) {
    setProject(current);
    addMessage("system", `Pistas anadidas al proyecto: ${hechas.length}.`);
  }
  const texto = [
    hechas.length > 0 ? `Anadidas ${hechas.length} pistas:` : "No se anadio ninguna pista.",
    ...hechas.map((linea) => `- ${linea}`),
    ...(fallos.length > 0 ? ["Fallos:", ...fallos.map((linea) => `- ${linea}`)] : []),
    ...avisos,
    // El mismo material dos veces suena doble: se avisa en el acto, no después.
    ...(peticion.midis.length > 0 && peticion.wavs.length > 0
      ? [
          "AVISO: has anadido MIDI y WAV del mismo tema. Suenan los dos a la vez (doble nivel y fase). " +
            "Pregunta al usuario cual dejar y silencia el otro juego con ajustar_pistas.",
        ]
      : []),
  ].join("\n");
  return { ok: hechas.length > 0, texto };
}

/**
 * Iguala la duracion de los clips: todos al mismo numero de compases.
 *
 * Los clips se miden en compases, asi que el MIDI de un instrumento y el WAV del
 * mismo material tienen que acabar en el mismo compas. Va por ops (se deshace con
 * Ctrl+Z) y no toca notas, niveles ni tempo.
 */
function igualarClipsDesdeAgente(peticion: PeticionIgualar): { ok: boolean; texto: string } {
  if (!project) return { ok: false, texto: "No hay ningun proyecto abierto." };
  const bar = beatsPerBar(project);
  const normal = (texto: string): string =>
    texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const pedidas = (peticion.pistas ?? []).filter((n) => n.trim() !== "");
  const pistas =
    pedidas.length === 0
      ? project.tracks
      : project.tracks.filter((t) => pedidas.some((n) => normal(t.name).includes(normal(n))));
  if (pistas.length === 0) {
    return { ok: false, texto: `No encuentro ninguna pista que se llame asi: ${pedidas.join(", ")}` };
  }

  const masLargo = Math.max(0, ...pistas.flatMap((t) => t.clips.map((c) => c.length)));
  const objetivo =
    peticion.compases && peticion.compases > 0
      ? Math.trunc(peticion.compases) * bar
      : compasesDeAudio(masLargo, bar);
  if (!(objetivo > 0)) return { ok: false, texto: "No hay clips que igualar." };

  const ops: Op[] = [];
  let mudos = 0;
  for (const pista of pistas) {
    for (const clip of pista.clips) {
      if (Math.abs(clip.length - objetivo) > 1e-6) {
        ops.push({ op: "set_clip_length", trackId: pista.id, clipId: clip.id, lengthBeats: objetivo });
      }
    }
  }
  if (ops.length === 0) {
    return {
      ok: true,
      texto: `Nada que igualar: los ${pistas.length} clips ya duran ${(objetivo / bar).toFixed(2)} compases.`,
    };
  }
  for (const pista of pistas) {
    if (pista.kind === "audio") mudos += 1;
  }
  const siguiente = applyOps(project, [
    ...ops,
    {
      op: "set_song",
      bpm: project.bpm,
      lengthBars: Math.max(project.lengthBars, Math.ceil(objetivo / bar - 1e-6)),
    },
  ]).project;
  commitLive(siguiente);
  return {
    ok: true,
    texto:
      `Igualados ${ops.length} clips a ${(objetivo / bar).toFixed(2)} compases (${objetivo} beats) ` +
      `en ${pistas.length} pistas. El proyecto queda en ${siguiente.lengthBars} compases.`,
  };
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
registrarIgualador(igualarClipsDesdeAgente);

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
  return fecha.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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

  if (audios.length > 0) await importarAudioDesdeSelector(audios);
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
 * Migración de una sola vez. La versión anterior guardaba el proyecto en
 * `localStorage` (`miuzika.project`) y los WAV en IndexedDB; ya no se leen. Si
 * ese proyecto sigue ahí y su carpeta no tiene fichero maestro, se escribe a
 * disco adoptando los WAV que se llamen igual en `salida/` o `entrada/`.
 */
async function migrarProyectoAntiguo(): Promise<string> {
  let crudo: string | null = null;
  try {
    crudo = localStorage.getItem("miuzika.project");
  } catch {
    return "";
  }
  if (!crudo) return "";

  let viejo: Project;
  try {
    viejo = JSON.parse(crudo) as Project;
  } catch {
    return "";
  }
  if (!viejo || viejo.schemaVersion !== 1 || !Array.isArray(viejo.tracks)) return "";

  const slug = slugDeProyecto(viejo);
  try {
    // Si ya hay maestro, no hay nada que migrar: se tira la copia vieja.
    await leerProyectoDeDisco(rutaDeProyecto(slug));
    localStorage.removeItem("miuzika.project");
    return "";
  } catch {
    /* no hay maestro: se migra */
  }

  try {
    const ficheros = await listarFicheros();
    const deLaCarpeta = ficheros.filter((f) => f.path.startsWith(`proyectos/${slug}/`));
    const candidatos: { base: string; ruta: string }[] = [];
    for (const fichero of deLaCarpeta) {
      if (!/\.[^.]+$/.test(fichero.path)) continue;
      const base = (fichero.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
      candidatos.push({ base, ruta: fichero.path.slice(`proyectos/${slug}/`.length) });
    }
    // El nombre del asset puede venir sin el prefijo del proyecto ("bajo" para
    // "vitrina_bajo.wav"), así que primero exacto y después por sufijo.
    const buscarRuta = (nombre: string): string | undefined => {
      const buscado = nombre.toLowerCase();
      const exacto = candidatos.find((candidato) => candidato.base === buscado);
      if (exacto) return exacto.ruta;
      const sufijos = [`_${buscado}`, `-${buscado}`, ` ${buscado}`];
      return candidatos.find((candidato) => sufijos.some((sufijo) => candidato.base.endsWith(sufijo)))?.ruta;
    };
    let adoptados = 0;
    for (const asset of viejo.audioAssets ?? []) {
      if (asset.ruta) continue;
      const ruta = buscarRuta(asset.name);
      if (ruta) {
        asset.ruta = ruta;
        adoptados++;
      }
    }
    const { datos } = serializarProyecto(viejo, audioAssets);
    await guardarProyectoEnDisco(rutaDeProyecto(slug), JSON.stringify(datos, null, 2));
    localStorage.removeItem("miuzika.project");
    return (
      `Migrado a disco el proyecto “${viejo.name}” que estaba en el navegador: proyectos/${slug}/proyecto.json` +
      (adoptados > 0
        ? `, con ${adoptados} WAV adoptado(s) de la carpeta por su nombre.`
        : ". Sus WAV viejos estaban en IndexedDB y no se pueden recuperar; vuelve a importarlos si faltan.")
    );
  } catch (error) {
    return `No se pudo migrar el proyecto del navegador a disco: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Arranque: el disco es la fuente de verdad. Se abre el último proyecto usado
 * (queda apuntado en localStorage) leyendo su `proyecto.json`; si no hay apunte,
 * el más reciente que haya en `workspace/proyectos/`.
 */
async function boot(): Promise<void> {
  let aviso = "";
  let cargados = 0;
  let faltan: string[] = [];

  // Proyecto de la versión anterior (localStorage + IndexedDB) -> disco.
  const migracion = await migrarProyectoAntiguo();

  const slugGuardado = ((): string => {
    try {
      return localStorage.getItem(CLAVE_ABIERTO) ?? "";
    } catch {
      return "";
    }
  })();

  const abrir = async (slug: string): Promise<Project | null> => {
    try {
      return interpretarProyectoEnDisco(await leerProyectoDeDisco(rutaDeProyecto(slug))).proyecto;
    } catch {
      return null;
    }
  };

  let slug = slugGuardado;
  if (slug) project = await abrir(slug);
  if (!project) {
    // Sin apunte (o el fichero ya no está): el proyecto más reciente del disco.
    try {
      const lista = await listarProyectos();
      const primero = lista.find((candidato) => !candidato.error);
      if (primero) {
        slug = primero.slug;
        project = await abrir(slug);
        if (project) aviso = `Abierto el proyecto más reciente del disco (${primero.ruta}).`;
      }
    } catch {
      /* sin servidor no hay disco: se arranca vacío */
    }
  }

  if (project) {
    setBusy(true, "Cargando los WAV del proyecto…");
    try {
      const hidratado = await hidratarAssets(project, slug);
      cargados = hidratado.cargados;
      faltan = hidratado.faltan;
    } finally {
      setBusy(false);
    }
  }

  if (project) {
    setProject(project, false);
    addMessage("assistant", `Proyecto cargado del disco: "${project.name}". Pulsa play para escuchar.`);
    if (migracion) addMessage("system", migracion);
    if (aviso) addMessage("system", aviso);
    if (cargados > 0) addMessage("system", `WAV cargados de proyectos/${slug}/: ${cargados}.`);
    if (faltan.length > 0) warnMissingAudio(faltan);
  } else {
    setProject(null, false);
    if (migracion) addMessage("system", migracion);
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
    /** Para depurar: el contexto que ve el modelo y el ejecutor de herramientas. */
    get conversacion() {
      return conversacion;
    },
    herramienta: ejecutarHerramienta,
    get future() {
      return future;
    },
    anadirPistas: importarPistasDesdeAgente,
    stems: stemPlayer,
    crearProyecto: crearProyectoDesdeAgente,
    ajustarPistas: ajustarPistasDesdeAgente,
    costeGpu,
    nuevoProyecto: (nombre: string, bpm: number, lengthBars: number) =>
      setProject(createProject({ name: nombre, bpm, lengthBars })),
  };
}
