/**
 * Reproducción con el motor real de openDAW (WASM si está disponible).
 * Único camino de playback: MIDI, batería Playfield y pistas WAV.
 */

import type { Project as MiuzikaProject } from "../../src/core/types.ts";
import type { OpenDawAudioAsset, OpenDawDrumSample } from "../../src/host/opendaw/adapter.ts";
import { projectToOpenDaw } from "../../src/host/opendaw/adapter.ts";
import workletsUrl from "@opendaw/studio-core/processors.js?url";
import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

export interface OpenDawPlaybackHandle {
  readonly context: AudioContext;
  readonly beat: number;
  readonly isPlaying: boolean;
  stop: () => void;
  seek: (beat: number) => void;
  /** Aplica mute/solo/volumen/pan al proyecto vivo del engine. */
  syncMix: (source: MiuzikaProject) => void;
  /** Arranca el transporte (si se cargó con `reproducir: false`). */
  play: () => void;
  /**
   * Nota en directo en el instrumento de una pista (el touchpad): `velocidad`
   * 1..127 la empieza, 0 la suelta. Suena con el transporte parado o en marcha.
   */
  nota: (nombrePista: string, pitch: number, velocidad: number) => void;
}

export interface OpcionesOpenDaw {
  /** false: carga el proyecto y deja el motor listo, sin arrancar el transporte. */
  reproducir?: boolean;
}

interface EngineBoot {
  context: AudioContext;
  core: typeof import("@opendaw/studio-core");
  UUID: typeof import("@opendaw/lib-std").UUID;
  Option: typeof import("@opendaw/lib-std").Option;
  AudioData: typeof import("@opendaw/lib-dsp").AudioData;
}

// El engine WASM registra el processor una sola vez por página y contexto.
// Guardarlo en globalThis evita crear un contexto nuevo tras un HMR.
const bootStore = globalThis as typeof globalThis & {
  __miuzikaOpenDawBoot?: Promise<EngineBoot>;
};

async function bootEngine(): Promise<EngineBoot> {
  if (bootStore.__miuzikaOpenDawBoot) return bootStore.__miuzikaOpenDawBoot;
  const boot = (async (): Promise<EngineBoot> => {
    const [
      { Project, AudioWorklets, Workers, GlobalSoundfontLoaderManager, OfflineEngineRenderer },
      { WasmEngine },
      { AnimationFrame },
      { UUID, Option },
      { AudioData },
    ] = await Promise.all([
      import("@opendaw/studio-core"),
      import("@opendaw/studio-core-wasm"),
      import("@opendaw/lib-dom"),
      import("@opendaw/lib-std"),
      import("@opendaw/lib-dsp"),
    ]);
    AnimationFrame.start(window);
    const context = new AudioContext({ sampleRate: 48_000, latencyHint: 0 });
    try {
      await Workers.install(workersUrl);
    } catch (error) {
      // HMR puede conservar la instalación estática entre módulos.
      if (!String(error).includes("already installed")) throw error;
    }
    AudioWorklets.install(workletsUrl);
    await AudioWorklets.createFor(context);
    WasmEngine.install({
      processorUrl: wasmProcessorUrl,
      offlineWorkerUrl: wasmOfflineWorkerUrl,
      wasmUrl: `${import.meta.env.BASE_URL}opendaw-wasm`,
    });
    if (!(await WasmEngine.ensureReady(context))) {
      throw new Error("The openDAW WASM engine is not available");
    }
    return {
      context,
      core: { Project, AudioWorklets, Workers, GlobalSoundfontLoaderManager, OfflineEngineRenderer } as typeof import("@opendaw/studio-core"),
      UUID,
      Option,
      AudioData,
    };
  })();
  bootStore.__miuzikaOpenDawBoot = boot;
  try {
    return await boot;
  } catch (error) {
    delete bootStore.__miuzikaOpenDawBoot;
    throw error;
  }
}

const DRUM_FILES: ReadonlyArray<{ note: number; file: string; name: string }> = [
  { note: 36, file: "kick-hard.wav", name: "Kick" },
  { note: 38, file: "snare-hard.wav", name: "Snare" },
  { note: 39, file: "clap-hard.wav", name: "Clap" },
  { note: 42, file: "hat-hard.wav", name: "Hat" },
  { note: 44, file: "hat-hard.wav", name: "Hat pedal" },
  { note: 46, file: "hat-open.wav", name: "Open hat" },
  { note: 45, file: "tom-low.wav", name: "Tom low" },
  { note: 47, file: "tom-mid.wav", name: "Tom mid" },
  { note: 48, file: "tom-high.wav", name: "Tom high" },
  { note: 49, file: "crash.wav", name: "Crash" },
  { note: 51, file: "ride.wav", name: "Ride" },
  { note: 37, file: "rim.wav", name: "Rim" },
  { note: 56, file: "cowbell.wav", name: "Cowbell" },
];

interface OpenDawAudioInput {
  name: string;
  buffer: AudioBuffer;
}

async function prepareSamples(
  context: AudioContext,
  bpm: number,
  UUID: typeof import("@opendaw/lib-std").UUID,
  Option: typeof import("@opendaw/lib-std").Option,
  AudioData: typeof import("@opendaw/lib-dsp").AudioData,
  hasDrums: boolean,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput>,
): Promise<{
  attachments: OpenDawDrumSample[];
  audioFiles: Map<string, OpenDawAudioAsset>;
  sampleManager: unknown;
}> {
  const samples = new Map<
    string,
    {
      data: import("@opendaw/lib-dsp").AudioData;
      meta: { name: string; bpm: number; duration: number; sample_rate: number; origin: "import" };
    }
  >();
  const attachments: OpenDawDrumSample[] = [];
  const audioFiles = new Map<string, OpenDawAudioAsset>();
  if (hasDrums) {
    for (const entry of DRUM_FILES) {
      try {
        const response = await fetch(`/drums/${entry.file}`);
        if (!response.ok) throw new Error(String(response.status));
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const data = AudioData.create(buffer.sampleRate, buffer.length, buffer.numberOfChannels);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          data.frames[channel]!.set(buffer.getChannelData(channel));
        }
        const uuid = UUID.generate();
        samples.set(UUID.toString(uuid), {
          data,
          meta: {
            name: entry.name,
            bpm,
            duration: buffer.duration,
            sample_rate: buffer.sampleRate,
            origin: "import",
          },
        });
        attachments.push({
          note: entry.note,
          uuid,
          name: entry.name,
          durationInSeconds: buffer.duration,
          exclude: false,
        });
      } catch (error) {
        console.warn(`[openDAW] no se pudo cargar ${entry.file}`, error);
      }
    }
  }
  for (const [id, asset] of audioAssets) {
    const buffer = asset.buffer;
    const chunks: OpenDawAudioAsset["chunks"][number][] = [];
    // El engine no carga fiablemente samples de ~4 minutos; partimos los WAV
    // en bloques de 2 minutos. Sigue siendo el mismo audio, sin recompresión.
    const chunkFrames = Math.max(1, Math.floor(buffer.sampleRate * 120));
    const chunkCount = Math.ceil(buffer.length / chunkFrames);
    for (let index = 0; index < chunkCount; index++) {
      const startFrame = index * chunkFrames;
      const frames = Math.min(chunkFrames, buffer.length - startFrame);
      if (frames <= 0) continue;
      const data = AudioData.create(buffer.sampleRate, frames, buffer.numberOfChannels);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        data.frames[channel]!.set(
          buffer.getChannelData(channel).subarray(startFrame, startFrame + frames),
        );
      }
      const uuid = UUID.generate();
      const name = chunkCount > 1 ? `${asset.name} #${index + 1}` : asset.name;
      const durationInSeconds = frames / buffer.sampleRate;
      samples.set(UUID.toString(uuid), {
        data,
        meta: {
          name,
          bpm,
          duration: durationInSeconds,
          sample_rate: buffer.sampleRate,
          origin: "import",
        },
      });
      chunks.push({
        uuid,
        name,
        durationInSeconds,
        startInSeconds: startFrame / buffer.sampleRate,
      });
    }
    audioFiles.set(id, { chunks, durationInSeconds: buffer.duration });
  }
  const loaders = new Map<string, unknown>();
  for (const [key, { data, meta }] of samples) {
    const terminator = { terminate: () => {} };
    const loader = {
      uuid: key,
      data: Option.wrap(data),
      peaks: Option.None,
      meta: Option.wrap(meta),
      state: { type: "loaded" as const },
      subscribe: (observer: (state: unknown) => void) => {
        observer({ type: "loaded" });
        return terminator;
      },
    };
    loaders.set(key, loader);
  }
  // No usamos el loader de samples de openDAW aquí: calcula peaks en un
  // worker y tarda decenas de segundos con los WAV de canción completa. El
  // engine solo necesita los datos, y ya están en memoria.
  const manager = {
    register: () => ({ terminate: () => {} }),
    record: () => {},
    invalidate: () => {},
    remove: (uuid: Uint8Array) => {
      loaders.delete(UUID.toString(uuid));
    },
    getOrCreate: (uuid: Uint8Array) => {
      const key = UUID.toString(uuid);
      const loader = loaders.get(key);
      if (!loader) throw new Error(`Sample no registrado: ${key}`);
      return loader;
    },
  };
  return { attachments, audioFiles, sampleManager: manager };
}

/**
 * Carga el IR en un Project de openDAW y lo reproduce.
 * `onTick` recibe el beat actual para mover el playhead.
 */
type SoundfontEntrada = { uuid: Uint8Array; name: string; bytes: ArrayBuffer };

/**
 * El proyecto de miuzika montado como Project de openDAW, con sus samples y
 * SoundFonts. Lo comparten la reproducción y la exportación a WAV.
 */
async function montarProyecto(
  source: MiuzikaProject,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput>,
  soundfonts: ReadonlyMap<string, SoundfontEntrada>,
  gm: SoundfontEntrada | null,
) {
  const { context, core, UUID, Option, AudioData } = await bootEngine();
  const hasDrums = source.tracks.some((track) => track.instrument.type === "drumkit");
  const prepared = await prepareSamples(
    context,
    source.bpm,
    UUID,
    Option,
    AudioData,
    hasDrums,
    audioAssets,
  );
  // Se parsean ANTES de exportar y de montar el proyecto: `getOrCreate` es síncrono
  // y el motor lo llama en cuanto ve un dispositivo Soundfont; y para el General
  // MIDI hace falta la lista de presets (banco, programa) al exportar.
  const parseados = new Map<string, unknown>();
  if (soundfonts.size > 0 || gm) {
    const { SoundFont2 } = (await import("soundfont2")) as unknown as {
      SoundFont2: new (bytes: Uint8Array) => unknown;
    };
    for (const sf of [...soundfonts.values(), ...(gm ? [gm] : [])]) {
      const clave = claveDeUuid(sf.uuid);
      if (!parseados.has(clave)) parseados.set(clave, new SoundFont2(new Uint8Array(sf.bytes)));
    }
  }
  const gmParseado = gm
    ? (parseados.get(claveDeUuid(gm.uuid)) as { presets: { header: { bank: number; preset: number } }[] })
    : null;

  const exported = await projectToOpenDaw(source, {
    drumSamples: prepared.attachments,
    audioAssets: prepared.audioFiles,
    soundfonts,
    ...(gm && gmParseado
      ? { gm: { ...gm, presets: gmParseado.presets.map((p) => ({ bank: p.header.bank, preset: p.header.preset })) } }
      : {}),
  });
  const { Project } = core;

  const env = {
    audioContext: context,
    audioWorklets: core.AudioWorklets.get(context),
    sampleManager: prepared.sampleManager,
    // El motor no recibe los bytes: recibe un gestor al que le pide el SoundFont
    // por uuid (`getOrCreate`). Es la única puerta que expone openDAW.
    soundfontManager: nuevoGestorDeSoundfonts(Option, parseados),
    sampleService: {},
    soundfontService: {},
  };

  const project = Project.load(env as never, exported.bytes);
  if (import.meta.env.DEV && (soundfonts.size > 0 || gm)) {
    // Sonda de desarrollo: qué ha entendido openDAW de cada SoundFont. Si `estado`
    // no es "loaded", el motor no ha podido parsear el fichero.
    const gestor = env.soundfontManager as {
      getOrCreate: (uuid: Uint8Array) => { state: { type: string }; soundfont: { isEmpty: () => boolean; unwrapOrUndefined?: () => { presets?: { length: number } } } };
    };
    (globalThis as unknown as { __miuzikaSoundfonts: unknown }).__miuzikaSoundfonts = Array.from(
      soundfonts,
      ([ruta, sf]) => {
        const cargador = gestor.getOrCreate(sf.uuid);
        let presets = 0;
        try {
          if (!cargador.soundfont.isEmpty()) {
            presets = cargador.soundfont.unwrapOrUndefined?.()?.presets?.length ?? 0;
          }
        } catch {
          presets = -1;
        }
        return { ruta, estado: cargador.state.type, presets };
      },
    );
  }
  return { project, context, core, Option };
}

export async function playWithOpenDaw(
  source: MiuzikaProject,
  onTick: (beat: number) => void,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput> = new Map(),
  soundfonts: ReadonlyMap<string, { uuid: Uint8Array; name: string; bytes: ArrayBuffer }> = new Map(),
  gm: { uuid: Uint8Array; name: string; bytes: ArrayBuffer } | null = null,
  opciones: OpcionesOpenDaw = {},
): Promise<OpenDawPlaybackHandle> {
  const { project, context } = await montarProyecto(source, audioAssets, soundfonts, gm);
  const units = new Map(
    project.rootBoxAdapter.audioUnits.adapters().map((unit) => [unit.label, unit] as const),
  );
  const syncMix = (source: MiuzikaProject): void => {
    project.editing.modify(() => {
      for (const track of source.tracks) {
        const unit = units.get(track.name);
        if (!unit) continue;
        unit.namedParameter.mute.setValue(track.muted);
        unit.namedParameter.solo.setValue(track.solo);
        unit.namedParameter.volume.setValue(track.gainDb);
        unit.namedParameter.panning.setValue(track.pan);
      }
    });
  };
  const worklet = project.startAudioWorklet();
  await worklet.isReady();
  await context.resume();
  // El motor pide los samples y los SoundFonts DESPUÉS de montar el proyecto, y
  // tarda en tenerlos (un Steinway son 40 MB). Si se arranca antes, lo que suena
  // al principio sale en silencio: medido el 28-oct, el primer acorde del pad y el
  // piano de la intro no se oían y lo de más adelante sí.
  await esperarCarga(project.engine);
  // Sin esto, un mute/solo/volumen puesto en parado se pierde: syncMix solo
  // corria cuando se cambiaba algo con el transporte ya sonando.
  syncMix(source);

  const subscription = project.engine.position.catchupAndSubscribe((owner) => {
    onTick(owner.getValue() / 960);
  });
  // El primer comando puede perderse mientras el processor termina de arrancar.
  const arrancar = async (): Promise<void> => {
    project.engine.play();
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!project.engine.isPlaying.getValue()) project.engine.play();
  };
  if (opciones.reproducir !== false) await arrancar();

  return {
    context,
    get beat() {
      return project.engine.position.getValue() / 960;
    },
    get isPlaying() {
      return project.engine.isPlaying.getValue();
    },
    seek: (beat) => {
      project.engine.setPosition(Math.max(0, beat) * 960);
    },
    syncMix,
    play: () => {
      void arrancar();
    },
    nota: (nombrePista, pitch, velocidad) => {
      const unit = units.get(nombrePista);
      if (!unit) return;
      const nota = Math.min(127, Math.max(0, Math.round(pitch)));
      project.engine.noteSignal(
        velocidad > 0
          ? { type: "note-on", uuid: unit.uuid, pitch: nota, velocity: Math.min(1, velocidad / 127) }
          : { type: "note-off", uuid: unit.uuid, pitch: nota },
      );
    },
    stop: () => {
      project.engine.stop(true);
      subscription.terminate();
      project.engine.releaseWorklet();
      project.terminate();
    },
  };
}


/**
 * La mezcla entera renderizada con el motor de openDAW, sin reproducirla: es la
 * exportación «WAV» del encargo, y suena igual que el Play (mismos instrumentos,
 * efectos y mezcla). Los stems largos que van por streaming no entran.
 */
export async function renderizarMezcla(
  source: MiuzikaProject,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput> = new Map(),
  soundfonts: ReadonlyMap<string, SoundfontEntrada> = new Map(),
  gm: SoundfontEntrada | null = null,
): Promise<{ sampleRate: number; canales: Float32Array[] }> {
  const { project, core, Option } = await montarProyecto(source, audioAssets, soundfonts, gm);
  const { DefaultObservableValue } = await import("@opendaw/lib-std");
  try {
    const audio = await core.OfflineEngineRenderer.start(project, Option.None as never, new DefaultObservableValue(0));
    return { sampleRate: audio.sampleRate, canales: [...audio.frames] as Float32Array[] };
  } finally {
    project.terminate();
  }
}

/**
 * Espera a que el motor haya cargado todo lo que ha pedido (samples y SoundFonts).
 * `queryLoadingComplete` sólo ve lo ya pedido, y las peticiones salen cuando el
 * worklet procesa el proyecto: por eso se pregunta varias veces, con un respiro.
 * Con tope: si algo no carga nunca, se reproduce igual a los 20 s.
 */
async function esperarCarga(engine: { queryLoadingComplete(): Promise<boolean> }, topeMs = 20_000): Promise<void> {
  const fin = Date.now() + topeMs;
  const pausa = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  for (let vuelta = 0; vuelta < 4 && Date.now() < fin; vuelta += 1) {
    await pausa(vuelta === 0 ? 60 : 40);
    await Promise.race([engine.queryLoadingComplete().catch(() => true), pausa(Math.max(0, fin - Date.now()))]);
  }
}

/**
 * Gestor de SoundFonts propio, sin pasar por el almacén de openDAW.
 *
 * El gestor de la librería intenta primero leer el .sf2 de su OPFS (IndexedDB
 * disfrazado); si ese almacén no está instalado, la promesa no se resuelve nunca y
 * el instrumento se queda en "progress" para siempre (medido). Aquí el fichero ya
 * está en memoria, así que se entrega ya parseado y el estado nace en "loaded".
 */
function nuevoGestorDeSoundfonts(
  Option: { wrap: (valor: unknown) => unknown; None: unknown },
  parseados: ReadonlyMap<string, unknown>,
): unknown {
  const cache = new Map<string, unknown>();
  return {
    getOrCreate: (uuid: Uint8Array) => {
      const clave = claveDeUuid(uuid);
      const existente = cache.get(clave);
      if (existente) return existente;
      const soundfont = parseados.get(clave);
      const cargador = {
        uuid,
        state: soundfont ? { type: "loaded" } : { type: "error", reason: "soundfont desconocido" },
        soundfont: soundfont ? Option.wrap(soundfont) : Option.None,
        meta: Option.None,
        subscribe: (observador: (estado: unknown) => void) => {
          observador(cargador.state);
          return { terminate: () => {} };
        },
        invalidate: () => {},
      };
      cache.set(clave, cargador);
      return cargador;
    },
    fetch: async () => {
      throw new Error("los SoundFonts se cargan del proyecto, no de la red");
    },
    remove: (uuid: Uint8Array) => {
      cache.delete(claveDeUuid(uuid));
    },
    invalidate: () => cache.clear(),
  };
}

function claveDeUuid(uuid: Uint8Array): string {
  return Array.from(uuid, (b) => b.toString(16).padStart(2, "0")).join("");
}
