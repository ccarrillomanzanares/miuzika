/**
 * Playback with the real openDAW engine (WASM if available).
 * The only playback path: MIDI, Playfield drums and WAV tracks.
 */

import type { Project as MiuzikaProject } from "../../src/core/types.ts";
import type { OpenDawAudioAsset, OpenDawDrumSample } from "../../src/host/opendaw/adapter.ts";
import { projectToOpenDaw } from "../../src/host/opendaw/adapter.ts";
import { repartirZonasGlobales } from "./soundfont-zonas.ts";
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
  /** Applies mute/solo/volume/pan to the engine's live project. */
  syncMix: (source: MiuzikaProject) => void;
  /** Starts the transport (if it was loaded with `reproducir: false`). */
  play: () => void;
  /**
   * Live note on a track's instrument (the touchpad): `velocidad` 1..127 starts it,
   * 0 releases it. It sounds with the transport stopped or running.
   */
  nota: (nombrePista: string, pitch: number, velocidad: number) => void;
}

export interface OpcionesOpenDaw {
  /** false: loads the project and leaves the engine ready, without starting the transport. */
  reproducir?: boolean;
}

interface EngineBoot {
  context: AudioContext;
  core: typeof import("@opendaw/studio-core");
  UUID: typeof import("@opendaw/lib-std").UUID;
  Option: typeof import("@opendaw/lib-std").Option;
  AudioData: typeof import("@opendaw/lib-dsp").AudioData;
}

// The WASM engine registers the processor only once per page and context.
// Keeping it in globalThis avoids creating a new context after an HMR.
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
      // HMR may keep the static installation between modules.
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
        console.warn(`[openDAW] could not load ${entry.file}`, error);
      }
    }
  }
  for (const [id, asset] of audioAssets) {
    const buffer = asset.buffer;
    const chunks: OpenDawAudioAsset["chunks"][number][] = [];
    // The engine does not reliably load samples of ~4 minutes; we split the WAVs
    // into 2-minute chunks. It is still the same audio, with no recompression.
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
  // We do not use openDAW's sample loader here: it computes peaks in a
  // worker and takes tens of seconds with full-song WAVs. The engine only needs
  // the data, and it is already in memory.
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
      if (!loader) throw new Error(`Sample not registered: ${key}`);
      return loader;
    },
  };
  return { attachments, audioFiles, sampleManager: manager };
}

/**
 * Loads the IR into an openDAW Project and plays it.
 * `onTick` receives the current beat to move the playhead.
 */
type SoundfontEntrada = { uuid: Uint8Array; name: string; bytes: ArrayBuffer };

/**
 * The miuzika project built as an openDAW Project, with its samples and
 * SoundFonts. Playback and WAV export share it.
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
  // They are parsed BEFORE exporting and building the project: `getOrCreate` is
  // synchronous and the engine calls it as soon as it sees a Soundfont device; and for
  // General MIDI the preset list (bank, program) is needed when exporting.
  const parseados = new Map<string, unknown>();
  if (soundfonts.size > 0 || gm) {
    const { SoundFont2 } = (await import("soundfont2")) as unknown as {
      SoundFont2: new (bytes: Uint8Array) => unknown;
    };
    for (const sf of [...soundfonts.values(), ...(gm ? [gm] : [])]) {
      const clave = claveDeUuid(sf.uuid);
      if (parseados.has(clave)) continue;
      const parseado = new SoundFont2(new Uint8Array(sf.bytes));
      // openDAW discards global zones: without this, 113 of the 128 GM presets lose the loop.
      repartirZonasGlobales(parseado as Parameters<typeof repartirZonasGlobales>[0]);
      parseados.set(clave, parseado);
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
    // The engine does not receive the bytes: it receives a manager it asks for the
    // SoundFont by uuid (`getOrCreate`). It is the only door openDAW exposes.
    soundfontManager: nuevoGestorDeSoundfonts(Option, parseados),
    sampleService: {},
    soundfontService: {},
  };

  const project = Project.load(env as never, exported.bytes);
  if (import.meta.env.DEV && (soundfonts.size > 0 || gm)) {
    // Development probe: what openDAW has understood from each SoundFont. If `estado`
    // is not "loaded", the engine has not been able to parse the file.
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
  // The engine requests the samples and SoundFonts AFTER building the project, and
  // takes a while to have them (a Steinway is 40 MB). If it starts before, what sounds
  // at the beginning comes out silent: measured on Oct 28, the pad's first chord and the
  // intro piano were not heard and later parts were.
  await esperarCarga(project.engine);
  // Without this, a mute/solo/volume set while stopped is lost: syncMix only
  // ran when something was changed with the transport already playing.
  syncMix(source);

  const subscription = project.engine.position.catchupAndSubscribe((owner) => {
    onTick(owner.getValue() / 960);
  });
  // The first command can be lost while the processor finishes starting up.
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
 * The whole mix rendered with the openDAW engine, without playing it: it is the
 * brief's "WAV" export, and it sounds the same as Play (same instruments, effects and
 * mix). Long stems that go through streaming are not included.
 */
export async function renderizarMezcla(
  source: MiuzikaProject,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput> = new Map(),
  soundfonts: ReadonlyMap<string, SoundfontEntrada> = new Map(),
  gm: SoundfontEntrada | null = null,
): Promise<{ sampleRate: number; canales: Float32Array[] }> {
  const { project, core, Option } = await montarProyecto(source, audioAssets, soundfonts, gm);
  const { DefaultObservableValue } = await import("@opendaw/lib-std");
  const { loopArea } = project.timelineBox;
  const conBucle = loopArea.enabled.getValue();
  try {
    // Not `OfflineEngineRenderer.start`: it stops rendering after 10 s of silence
    // (below −72 dB) once something has sounded. Measured on Oct 28 on "Hard": the
    // piano alone had 17 s with no notes (bars 17-24) and everything after came out
    // MUTED in `escuchar_mezcla`; the agent spent ~40 steps looking for broken clips. A
    // long pause in the song would cut the exported WAV the same way. Here it renders
    // up to the end of the last clip, plus a tail for reverbs and delays.
    project.boxGraph.beginTransaction();
    loopArea.enabled.setValue(false);
    project.boxGraph.endTransaction();
    const fin = project.lastRegionAction();
    const segundos = project.tempoMap.intervalToSeconds(0, fin) + COLA_RENDER_SEG;
    const renderer = await core.OfflineEngineRenderer.create(project, Option.None as never);
    const audio = await renderer.render(
      { maxDurationSeconds: segundos, silenceDurationSeconds: segundos },
      0,
      fin,
      new DefaultObservableValue(0),
    );
    return { sampleRate: audio.sampleRate, canales: [...audio.frames] as Float32Array[] };
  } finally {
    project.boxGraph.beginTransaction();
    loopArea.enabled.setValue(conBucle);
    project.boxGraph.endTransaction();
    project.terminate();
  }
}

/**
 * Seconds still rendered after the last clip: the reverb and delay tails. The final
 * silence is trimmed anyway (the engine leaves 0.25 s), so it does not lengthen the
 * WAV if there is no tail. `start` gave 30 s; with 10 the long reverbs fit.
 */
const COLA_RENDER_SEG = 10;

/**
 * Waits for the engine to load everything it has requested (samples and SoundFonts).
 * `queryLoadingComplete` only sees what has already been requested, and requests come
 * out when the worklet processes the project: that is why it is asked several times,
 * with a breather. With a cap: if something never loads, it still plays at 20 s.
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
 * Our own SoundFont manager, without going through the openDAW store.
 *
 * The library manager first tries to read the .sf2 from its OPFS (IndexedDB in
 * disguise); if that store is not installed, the promise never resolves and the
 * instrument stays in "progress" forever (measured). Here the file is already in
 * memory, so it is delivered already parsed and the state starts as "loaded".
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
        state: soundfont ? { type: "loaded" } : { type: "error", reason: "unknown soundfont" },
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
      throw new Error("SoundFonts are loaded from the project, not from the network");
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
