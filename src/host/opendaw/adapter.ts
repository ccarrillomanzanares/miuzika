/**
 * Adaptador real contra el SDK de openDAW.
 *
 * Usa imports dinámicos porque el SDK está pensado para un bundler (imports sin
 * extensión) y porque en Node hay que instalar shims antes de cargarlo.
 *
 * Alcance actual:
 *  - tempo, compases, master, pistas MIDI, clips y notas
 *  - volumen, pan, mute, solo
 *  - efectos: reverb, delay, waveshaper, crusher, compressor, gate, stereotool
 *  - audio WAV: pendiente (openDAW necesita SampleService/AudioFileBox)
 */

import type { Project as MiuzikaProject, Track } from "../../core/types.ts";
import { createProject, emptyTrack } from "../../core/project.ts";
import { beatsPerBar } from "../../core/types.ts";
import {
  PULSES_PER_BEAT,
  beatsToPulses,
  mapDevice,
  mapInstrument,
  pulsesToBeats,
  unitToVelocity,
  velocityToUnit,
} from "./mapping.ts";
import { installNodeShims } from "./shims.ts";

export interface OpenDawExport {
  bytes: ArrayBuffer;
  warnings: string[];
  stats: {
    tracks: number;
    regions: number;
    notes: number;
    devices: number;
    skippedDevices: number;
  };
}

export interface OpenDawImport {
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

export interface OpenDawBuildOptions {
  /** Muestras del kit para las pistas Playfield. */
  drumSamples?: OpenDawDrumSample[];
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
  };
  const noopTerminable = { terminate: () => {} };
  // En Node no hay audio real. El adaptador de openDAW pide un loader para
  // precalentar las muestras Playfield; le damos uno vacío para serializar.
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
    soundfontManager: {},
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

/** Asigna un parámetro, admitiendo rutas anidadas tipo "lowShelf.gain". */
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

/** Convierte nuestro IR en un proyecto de openDAW serializado. */
export async function projectToOpenDaw(
  source: MiuzikaProject,
  options: OpenDawBuildOptions = {},
): Promise<OpenDawExport> {
  const { core, adapters } = await loadSdk();
  const env = createHeadlessEnv();
  const project = core.Project.new(env as never);
  const warnings: string[] = [];
  const stats = { tracks: 0, regions: 0, notes: 0, devices: 0, skippedDevices: 0 };
  const audioUnitByTrack = new Map<string, unknown>();

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

      for (const track of source.tracks) {
        if (track.kind === "audio") {
          warnings.push(`"${track.name}": las pistas de audio todavía no se exportan a openDAW`);
          continue;
        }

        const instrument = mapInstrument(track.instrument.type);
        if (instrument.warning) warnings.push(`"${track.name}": ${instrument.warning}`);

        const factory =
          instrument.factory === "Playfield"
            ? adapters.InstrumentFactories.Playfield
            : adapters.InstrumentFactories.Vaporisateur;

        const product = project.api.createInstrument(factory as never, {
          name: track.name,
          ...(instrument.factory === "Playfield"
            ? { attachment: options.drumSamples ?? [] }
            : {}),
        } as never);

        const unit = project.boxAdapters.adapterFor(
          product.audioUnitBox,
          adapters.AudioUnitBoxAdapter,
        );
        unit.namedParameter.volume.setValue(track.gainDb);
        unit.namedParameter.panning.setValue(track.pan);
        unit.namedParameter.mute.setValue(track.muted);
        unit.namedParameter.solo.setValue(track.solo);
        audioUnitByTrack.set(track.id, product.audioUnitBox);

        track.devices.forEach((device, index) => {
          const mapped = mapDevice(device);
          if (!mapped.factory) {
            stats.skippedDevices++;
            warnings.push(`"${track.name}" / ${device.type}: ${mapped.reason ?? "sin equivalente"}`);
            return;
          }
          const effectFactory = (core.EffectFactories as unknown as Record<string, unknown>)[
            mapped.factory
          ] as never;
          const effectBox = project.api.insertEffect(
            product.audioUnitBox.audioEffects,
            effectFactory,
            index,
          );
          const adapter = project.boxAdapters.adapterFor(effectBox, adapters.Devices.isAny) as unknown as {
            namedParameter: Record<string, unknown>;
          };
          for (const param of mapped.params) {
            setParameter(adapter.namedParameter, param.name, param.value);
          }
          (effectBox as { enabled: { setValue: (value: boolean) => void } }).enabled.setValue(
            device.enabled,
          );
          stats.devices++;
        });

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

/** Lee un proyecto de openDAW y lo convierte a nuestro IR. */
export async function openDawToProject(bytes: ArrayBuffer): Promise<OpenDawImport> {
  const { core, adapters, boxes } = await loadSdk();
  const env = createHeadlessEnv();
  const project = core.Project.load(env as never, bytes);
  const warnings: string[] = [];

  try {
    const bpm = project.timelineBox.bpm.getValue();
    const pulses = project.timelineBox.durationInPulses.getValue();
    const result = createProject({
      name: "Importado de openDAW",
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
        name: unit.label || `Pista ${index}`,
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
      warnings.push("Las regiones de audio de openDAW no se importan todavía");
    }
    if (result.tracks.length === 0) warnings.push("No se encontraron pistas MIDI con notas");

    return { project: result, warnings, stats };
  } finally {
    project.terminate();
  }
}

/** Metadatos útiles para la UI sin exponer el SDK. */
export function summarizeExport(result: OpenDawExport): string {
  const { stats } = result;
  return `${stats.tracks} pistas · ${stats.regions} clips · ${stats.notes} notas · ${stats.devices} FX`;
}
