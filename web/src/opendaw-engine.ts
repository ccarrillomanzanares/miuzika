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
      { Project, AudioWorklets, Workers, GlobalSampleLoaderManager },
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
      throw new Error("El engine WASM de openDAW no está disponible");
    }
    return {
      context,
      core: { Project, AudioWorklets, Workers, GlobalSampleLoaderManager } as typeof import("@opendaw/studio-core"),
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

export interface OpenDawAudioInput {
  name: string;
  buffer: AudioBuffer;
}

async function prepareSamples(
  context: AudioContext,
  bpm: number,
  core: typeof import("@opendaw/studio-core"),
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
  // No usamos GlobalSampleLoaderManager aquí: calcula peaks en un worker y
  // tarda decenas de segundos con los WAV de canción completa. El engine solo
  // necesita los datos, y ya están en memoria.
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
export async function playWithOpenDaw(
  source: MiuzikaProject,
  onTick: (beat: number) => void,
  audioAssets: ReadonlyMap<string, OpenDawAudioInput> = new Map(),
): Promise<OpenDawPlaybackHandle> {
  const { context, core, UUID, Option, AudioData } = await bootEngine();
  const hasDrums = source.tracks.some((track) => track.instrument.type === "drumkit");
  const prepared = await prepareSamples(
    context,
    source.bpm,
    core,
    UUID,
    Option,
    AudioData,
    hasDrums,
    audioAssets,
  );
  const exported = await projectToOpenDaw(source, {
    drumSamples: prepared.attachments,
    audioAssets: prepared.audioFiles,
  });
  const { Project } = core;

  const env = {
    audioContext: context,
    audioWorklets: core.AudioWorklets.get(context),
    sampleManager: prepared.sampleManager,
    soundfontManager: {},
    sampleService: {},
    soundfontService: {},
  };

  const project = Project.load(env as never, exported.bytes);
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

  const subscription = project.engine.position.catchupAndSubscribe((owner) => {
    onTick(owner.getValue() / 960);
  });
  // El primer comando puede perderse mientras el processor termina de arrancar.
  project.engine.play();
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (!project.engine.isPlaying.getValue()) project.engine.play();

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
    stop: () => {
      project.engine.stop(true);
      subscription.terminate();
      project.engine.releaseWorklet();
      project.terminate();
    },
  };
}
