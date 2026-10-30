/**
 * Real adapter against the openDAW SDK.
 *
 * It uses dynamic imports because the SDK is meant for a bundler (extensionless
 * imports) and because in Node shims must be installed before loading it.
 *
 * Current scope:
 *  - tempo, bars, master, MIDI tracks, clips, and notes
 *  - volume, pan, mute, solo
 *  - effects: reverb, delay, waveshaper, crusher, compressor, gate, stereotool
 *  - audio tracks: AudioFileBox/AudioRegionBox (WAV bytes are provided to the
 *    engine during playback; the .odw only stores references)
 */

import type { Device, Project as MiuzikaProject, Track } from "../../core/types.ts";
import { createProject, emptyTrack } from "../../core/project.ts";
import { beatsPerBar } from "../../core/types.ts";
import {
  beatsToPulses,
  mapDevice,
  indicePresetGm,
  mapInstrument,
  pulsesToBeats,
  unitToVelocity,
  velocityToUnit,
} from "./mapping.ts";
import { installNodeShims } from "./shims.ts";
import { Option, UUID } from "@opendaw/lib-std";

interface OpenDawExport {
  bytes: ArrayBuffer;
  warnings: string[];
  stats: {
    tracks: number;
    regions: number;
    notes: number;
    devices: number;
    skippedDevices: number;
    buses: number;
    sends: number;
  };
}

interface OpenDawImport {
  project: MiuzikaProject;
  warnings: string[];
  stats: { tracks: number; regions: number; notes: number };
}

export interface OpenDawDrumSample {
  note: number;
  uuid: Uint8Array;
  name: string;
  durationInSeconds: number;
  exclude: boolean;
}

interface OpenDawAudioChunk {
  uuid: Uint8Array;
  name: string;
  /** Duration of the chunk in seconds. */
  durationInSeconds: number;
  /** Offset of the chunk inside the original WAV, in seconds. */
  startInSeconds: number;
}

export interface OpenDawSoundfont {
  /** uuid of the SoundfontFileBox and key with which the engine asks for the bytes. */
  uuid: Uint8Array;
  name: string;
  bytes: ArrayBuffer;
}

/** The installation's General MIDI SoundFont and its presets (bank, program). */
export interface OpenDawGm extends OpenDawSoundfont {
  presets: ReadonlyArray<{ bank: number; preset: number }>;
}

export interface OpenDawAudioAsset {
  chunks: ReadonlyArray<OpenDawAudioChunk>;
  durationInSeconds: number;
}

interface OpenDawBuildOptions {
  /** Kit samples for Playfield tracks. */
  drumSamples?: OpenDawDrumSample[];
  /** WAVs of the audio tracks, by IR asset id. */
  audioAssets?: ReadonlyMap<string, OpenDawAudioAsset>;
  /** SoundFonts by file path (`instrumento.archivo`). */
  soundfonts?: ReadonlyMap<string, OpenDawSoundfont>;
  /** General MIDI SoundFont: tracks with `instrument.program` play through it. */
  gm?: OpenDawGm;
}

interface HostEnv {
  audioContext: unknown;
  audioWorklets: { context: unknown };
  sampleManager: {
    register: () => { terminate: () => void };
    getOrCreate: (uuid: unknown) => unknown;
  };
  soundfontManager: unknown;
  sampleService: unknown;
  soundfontService: unknown;
}

function createHeadlessEnv(): HostEnv {
  const audioContext = {
    currentTime: 0,
    sampleRate: 48_000,
    destination: { maxChannelCount: 2 },
    // CaptureAudio is instantiated when creating a Tape track even if nothing is recorded.
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {},
    }),
    createStereoPanner: () => ({
      pan: { value: 0 },
      connect: () => {},
      disconnect: () => {},
    }),
  };
  const noopTerminable = { terminate: () => {} };
  // There is no real audio in Node. The openDAW adapter asks for a loader to
  // prewarm the Playfield samples; we give it an empty one so it can serialize.
  const emptyLoader = {
    state: { type: "error", reason: "headless" },
    data: { isEmpty: () => true },
    peaks: { isEmpty: () => true },
    subscribe: (observer: (state: unknown) => void) => {
      observer({ type: "error", reason: "headless" });
      return noopTerminable;
    },
  };
  return {
    audioContext,
    audioWorklets: { context: audioContext },
    sampleManager: {
      register: () => noopTerminable,
      getOrCreate: () => emptyLoader,
    },
    // A SoundfontDeviceBox asks for its loader when serializing; here it only needs
    // to exist and say it is not loaded (sound is not touched in Node).
    soundfontManager: {
      getOrCreate: () => ({
        uuid: new Uint8Array(16),
        state: { type: "error", reason: "headless" },
        // It has to be a real Option: openDAW calls `.match` on it.
        soundfont: Option.None,
        subscribe: (observer: (state: unknown) => void) => {
          observer({ type: "error", reason: "headless" });
          return noopTerminable;
        },
        invalidate: () => {},
      }),
      fetch: async () => {
        throw new Error("headless");
      },
      remove: () => {},
      invalidate: () => {},
    },
    sampleService: {},
    soundfontService: {},
  };
}

async function loadSdk() {
  installNodeShims();
  const [core, adapters, boxes] = await Promise.all([
    import("@opendaw/studio-core"),
    import("@opendaw/studio-adapters"),
    import("@opendaw/studio-boxes"),
  ]);
  return { core, adapters, boxes };
}

/** Sets a parameter, accepting nested paths like "lowShelf.gain". */
function setParameter(root: Record<string, unknown>, path: string, value: number | boolean): void {
  const parts = path.split(".");
  let target: unknown = root;
  for (let index = 0; index < parts.length - 1; index++) {
    target = (target as Record<string, unknown> | undefined)?.[parts[index]!];
  }
  const parameter = (target as Record<string, unknown> | undefined)?.[parts[parts.length - 1]!] as
    | { setValue: (next: number | boolean) => void }
    | undefined;
  parameter?.setValue(value);
}

/** Converts our IR into a serialized openDAW project. */
export async function projectToOpenDaw(
  source: MiuzikaProject,
  options: OpenDawBuildOptions = {},
): Promise<OpenDawExport> {
  const { core, adapters, boxes } = await loadSdk();
  const env = createHeadlessEnv();
  const project = core.Project.new(env as never);
  const warnings: string[] = [];
  const stats = { tracks: 0, regions: 0, notes: 0, devices: 0, skippedDevices: 0, buses: 0, sends: 0 };
  const audioFileByAsset = new Map<string, unknown>();

  try {
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(source.bpm);
      project.timelineBox.durationInPulses.setValue(
        beatsToPulses(source.lengthBars * beatsPerBar(source)),
      );

      const masterAdapter = project.boxAdapters.adapterFor(
        project.primaryAudioUnitBox,
        adapters.AudioUnitBoxAdapter,
      );
      masterAdapter.namedParameter.volume.setValue(source.master.gainDb);

      const aplicarMezcla = (audioUnitBox: unknown, track: Track): void => {
        const unit = project.boxAdapters.adapterFor(audioUnitBox as never, adapters.AudioUnitBoxAdapter);
        unit.namedParameter.volume.setValue(track.gainDb);
        unit.namedParameter.panning.setValue(track.pan);
        unit.namedParameter.mute.setValue(track.muted);
        unit.namedParameter.solo.setValue(track.solo);
      };

      // Effects go on all tracks: MIDI, SoundFont, and audio. Before, only synth
      // tracks had them; on audio tracks they were warned about and discarded.
      const aplicarEfectos = (audioUnitBox: { audioEffects: unknown }, track: { name: string; devices: Device[] }): void => {
        track.devices.forEach((device, index) => {
          const mapped = mapDevice(device);
          if (!mapped.factory) {
            stats.skippedDevices++;
            warnings.push(`"${track.name}" / ${device.type}: ${mapped.reason ?? "no equivalent"}`);
            return;
          }
          const effectFactory = (core.EffectFactories as unknown as Record<string, unknown>)[mapped.factory] as never;
          const effectBox = project.api.insertEffect(audioUnitBox.audioEffects as never, effectFactory, index);
          const adapter = project.boxAdapters.adapterFor(effectBox, adapters.Devices.isAny) as unknown as {
            namedParameter: Record<string, unknown>;
          };
          for (const param of mapped.params) setParameter(adapter.namedParameter, param.name, param.value);
          (effectBox as { enabled: { setValue: (value: boolean) => void } }).enabled.setValue(device.enabled);
          stats.devices++;
        });
      };

      // One SoundfontFileBox per file, even if several tracks use it (GM, above all).
      const ficherosSoundfont = new Map<string, unknown>();
      const ficheroSoundfont = (sf: OpenDawSoundfont): unknown => {
        const clave = Array.from(sf.uuid).join(",");
        let fichero = ficherosSoundfont.get(clave);
        if (!fichero) {
          fichero = boxes.SoundfontFileBox.create(
            project.boxGraph,
            sf.uuid as never,
            (box: { fileName: { setValue: (v: string) => void } }) => box.fileName.setValue(sf.name),
          );
          ficherosSoundfont.set(clave, fichero);
        }
        return fichero;
      };

      // Auxiliary buses: an AudioBusBox whose output goes into an "aux" AudioUnit, which
      // plays through the master; it carries its effects and volume like a track. This is
      // how openDAW's DAWproject importer sets it up (DawProjectImporter, EFFECT channels).
      const entradaDeBus = new Map<string, unknown>();
      for (const bus of source.buses ?? []) {
        const unitBox = adapters.AudioUnitFactory.create(
          project.skeleton as never,
          "aux" as never, // AudioUnitType.Aux
          Option.None as never,
        ) as unknown as { input: unknown; audioEffects: unknown };
        const busBox = boxes.AudioBusBox.create(project.boxGraph, UUID.generate(), (box) => {
          box.collection.refer(project.rootBox.audioBusses);
          box.label.setValue(bus.name);
          box.icon.setValue("Effects");
          box.color.setValue(adapters.ColorCodes.forAudioType("aux" as never).toString());
          box.enabled.setValue(true);
          box.output.refer(unitBox.input as never);
        });
        const unit = project.boxAdapters.adapterFor(unitBox as never, adapters.AudioUnitBoxAdapter);
        unit.namedParameter.volume.setValue(bus.gainDb);
        aplicarEfectos(unitBox, bus);
        entradaDeBus.set(bus.id, busBox.input);
        stats.buses++;
      }

      // Post-fader sends from a track to its buses.
      const aplicarEnvios = (audioUnitBox: { auxSends: unknown }, track: Track): void => {
        (track.sends ?? []).forEach((send, index) => {
          const entrada = entradaDeBus.get(send.busId);
          if (!entrada) {
            warnings.push(`"${track.name}": sends to a bus that does not exist (${send.busId})`);
            return;
          }
          boxes.AuxSendBox.create(project.boxGraph, UUID.generate(), (box) => {
            box.routing.setValue(1); // AudioSendRouting.Post
            box.sendGain.setValue(send.levelDb);
            box.sendPan.setValue(0);
            box.audioUnit.refer(audioUnitBox.auxSends as never);
            box.targetBus.refer(entrada as never);
            box.index.setValue(index);
          });
          stats.sends++;
        });
      };

      for (const track of source.tracks) {
        if (track.kind === "audio") {
          const product = project.api.createInstrument(
            adapters.InstrumentFactories.Tape as never,
            { name: track.name } as never,
          );
          const unit = project.boxAdapters.adapterFor(
            product.audioUnitBox,
            adapters.AudioUnitBoxAdapter,
          );
          unit.namedParameter.volume.setValue(track.gainDb);
          unit.namedParameter.panning.setValue(track.pan);
          unit.namedParameter.mute.setValue(track.muted);
          unit.namedParameter.solo.setValue(track.solo);
          const secondsPerBeat = 60 / source.bpm;

          for (const clip of track.clips) {
            if (!clip.audio) continue;
            const info = options.audioAssets?.get(clip.audio.assetId);
            if (!info) {
              warnings.push(
                `"${track.name}" / "${clip.name}": missing the WAV "${clip.audio.assetId}" for openDAW`,
              );
              continue;
            }
            const offsetSeconds = clip.audio.offset * secondsPerBeat;
            const lengthSeconds = clip.length * secondsPerBeat;
            const clipEnd = offsetSeconds + lengthSeconds;
            for (const chunk of info.chunks) {
              const overlapStart = Math.max(offsetSeconds, chunk.startInSeconds);
              const overlapEnd = Math.min(clipEnd, chunk.startInSeconds + chunk.durationInSeconds);
              if (overlapEnd <= overlapStart) continue;
              const fileKey = `${clip.audio.assetId}:${chunk.uuid.join("-")}`;
              let audioFile = audioFileByAsset.get(fileKey);
              if (!audioFile) {
                audioFile = boxes.AudioFileBox.create(project.boxGraph, chunk.uuid, (box) => {
                  box.fileName.setValue(chunk.name);
                  box.endInSeconds.setValue(chunk.durationInSeconds);
                });
                audioFileByAsset.set(fileKey, audioFile);
              }
              const regionStartBeats = clip.start + (overlapStart - offsetSeconds) / secondsPerBeat;
              const regionDurationSeconds = overlapEnd - overlapStart;
              const waveformOffset = overlapStart - chunk.startInSeconds;
              const region = project.api.createNotStretchedRegion({
                boxGraph: project.boxGraph,
                targetTrack: product.trackBox,
                audioFileBox: audioFile as never,
                sample: {
                  name: chunk.name,
                  duration: chunk.durationInSeconds,
                  bpm: 0,
                  sample_rate: 48_000,
                  origin: "import",
                  uuid: chunk.uuid as never,
                },
                position: beatsToPulses(regionStartBeats),
                name: clip.name,
                gainInDb: clip.audio.gainDb,
                waveformOffset,
              });
              // clip.length/offset are in beats; the unstretched region uses seconds.
              region.duration.setValue(regionDurationSeconds);
              region.loopDuration.setValue(regionDurationSeconds);
              region.waveformOffset.setValue(waveformOffset);
              region.gain.setValue(clip.audio.gainDb);
              stats.regions++;
            }
          }

          aplicarEfectos(product.audioUnitBox, track);
          aplicarEnvios(product.audioUnitBox, track);
          stats.tracks++;
          continue;
        }

        // Three ways to sound, in order: the track's own SoundFont (usar_instrumento),
        // the installation's General MIDI if the track has a program, and if not, openDAW's
        // instruments. All three carry mix, effects, and notes: before, the SoundFont branch
        // ended in `continue` and its notes were never exported.
        const soundfont =
          track.instrument.type === "soundfont" && track.instrument.archivo
            ? options.soundfonts?.get(track.instrument.archivo)
            : undefined;
        const presetGm =
          !soundfont && options.gm && track.instrument.program !== undefined
            ? indicePresetGm(options.gm.presets, track.instrument.program, track.instrument.type === "drumkit")
            : undefined;
        let product: { audioUnitBox: never; instrumentBox: unknown; trackBox: never };
        if (soundfont || (options.gm && presetGm !== undefined)) {
          const fuente = (soundfont ?? options.gm)!;
          const product0 = project.api.createInstrument(adapters.InstrumentFactories.Soundfont as never, {
            name: track.name,
            attachment: ficheroSoundfont(fuente),
          } as never) as unknown as typeof product;
          product = product0;
          if (presetGm !== undefined) {
            (product.instrumentBox as { presetIndex: { setValue: (v: number) => void } }).presetIndex.setValue(presetGm);
          } else {
            warnings.push(`"${track.name}": starts with the SoundFont ${fuente.name} (preset 0)`);
          }
        } else {
          const instrument = mapInstrument(track.instrument.type);
          if (instrument.warning) warnings.push(`"${track.name}": ${instrument.warning}`);
          const factory =
            instrument.factory === "Playfield"
              ? adapters.InstrumentFactories.Playfield
              : adapters.InstrumentFactories.Vaporisateur;
          product = project.api.createInstrument(factory as never, {
            name: track.name,
            ...(instrument.factory === "Playfield" ? { attachment: options.drumSamples ?? [] } : {}),
          } as never) as unknown as typeof product;
        }

        aplicarMezcla(product.audioUnitBox, track);
        aplicarEfectos(product.audioUnitBox, track);
        aplicarEnvios(product.audioUnitBox, track);

        for (const clip of track.clips) {
          const region = project.api.createNoteRegion({
            trackBox: product.trackBox,
            position: beatsToPulses(clip.start),
            duration: beatsToPulses(clip.length),
            name: clip.name,
          });
          stats.regions++;
          for (const note of clip.notes) {
            project.api.createNoteEvent({
              owner: { events: region.events },
              position: beatsToPulses(note.start),
              duration: beatsToPulses(note.duration),
              pitch: note.pitch,
              velocity: velocityToUnit(note.velocity),
            });
            stats.notes++;
          }
        }

        stats.tracks++;
      }
    });

    const bytes = new Uint8Array(project.toArrayBuffer()).buffer as ArrayBuffer;
    return { bytes, warnings, stats };
  } finally {
    project.terminate();
  }
}

/** Reads an openDAW project and converts it to our IR. */
export async function openDawToProject(bytes: ArrayBuffer): Promise<OpenDawImport> {
  const { core, adapters, boxes } = await loadSdk();
  const env = createHeadlessEnv();
  const project = core.Project.load(env as never, bytes);
  const warnings: string[] = [];

  try {
    const bpm = project.timelineBox.bpm.getValue();
    const pulses = project.timelineBox.durationInPulses.getValue();
    const result = createProject({
      name: "Imported from openDAW",
      bpm,
      lengthBars: Math.max(1, Math.ceil(pulsesToBeats(pulses) / 4)),
    });

    const stats = { tracks: 0, regions: 0, notes: 0 };
    let index = 0;

    for (const box of project.boxGraph.boxes()) {
      if (!(box instanceof boxes.AudioUnitBox)) continue;
      const unit = project.boxAdapters.adapterFor(box, adapters.AudioUnitBoxAdapter);
      if (!unit.isInstrument) continue;

      const inputName = unit.inputAdapter.mapOr(
        (adapter: { box: { name: string } }) => adapter.box.name,
        "",
      );

      const instrumentType: Track["instrument"]["type"] = inputName.includes("Playfield")
        ? "drumkit"
        : inputName.includes("Soundfont")
          ? "soundfont"
          : inputName.includes("Nano") || inputName.includes("Tape")
            ? "sampler"
            : "synth";

      const track: Track = emptyTrack({
        id: `trk_opendaw_${++index}`,
        name: unit.label || `Track ${index}`,
        kind: "midi",
        instrument: { type: instrumentType },
        gainDb: unit.namedParameter.volume.getValue(),
        pan: unit.namedParameter.panning.getValue(),
        muted: unit.namedParameter.mute.getValue(),
        solo: unit.namedParameter.solo.getValue(),
      });

      for (const trackAdapter of unit.tracks.values()) {
        for (const region of trackAdapter.regions.collection.asArray()) {
          if (!region.isNoteRegion()) continue;
          const notes = region.optCollection.isEmpty()
            ? []
            : region.optCollection.unwrap().events.asArray().map((event) => ({
                pitch: event.pitch,
                start: pulsesToBeats(event.position),
                duration: pulsesToBeats(event.duration),
                velocity: unitToVelocity(event.velocity),
              }));
          track.clips.push({
            id: `clp_opendaw_${++stats.regions}`,
            name: region.label || `Clip ${stats.regions}`,
            start: pulsesToBeats(region.position),
            length: pulsesToBeats(region.duration),
            notes,
          });
          stats.notes += notes.length;
        }
      }

      if (track.clips.length === 0) continue;
      result.tracks.push(track);
      stats.tracks++;
    }

    if (project.boxGraph.boxes().some((box) => box instanceof boxes.AudioRegionBox)) {
      warnings.push("openDAW audio regions are not imported yet");
    }
    if (result.tracks.length === 0) warnings.push("No MIDI tracks with notes were found");

    return { project: result, warnings, stats };
  } finally {
    project.terminate();
  }
}
