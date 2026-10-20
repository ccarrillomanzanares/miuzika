/** Mixdown offline del proyecto a WAV (síntesis de previsualización + clips de audio). */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { audioAssets } from "./audio-store.ts";
import { loadDrumKit } from "./drum-kit.ts";
import { buildBusChain, buildMasterChain, buildTrackChain } from "./fx.ts";
import type { TrackChain } from "./fx.ts";
import { measureLoudness, normalizeBuffer } from "./loudness.ts";
import type { Loudness } from "./loudness.ts";
import { createNoiseBuffer, playInstrumentNote } from "./synth.ts";
import { prepareSynth, presetFor, WorkletInstrument } from "./worklet-synth.ts";
import { hashString } from "../../src/core/rng.ts";

const dbToGain = (db: number) => 10 ** (db / 20);

export interface RenderOptions {
  sampleRate?: number;
  normalize?: boolean;
  targetLufs?: number;
  limiter?: boolean;
  /** false = sin cadena de máster (para stems). */
  master?: boolean;
  /** false = sin buses de mezcla (para material que se reinserta en el proyecto). */
  buses?: boolean;
}

export interface RenderResult {
  blob: Blob;
  loudness: Loudness;
}

export async function renderProject(project: Project, options: RenderOptions = {}): Promise<RenderResult> {
  await loadDrumKit();
  const sampleRate = options.sampleRate ?? 44_100;
  const secondsPerBeat = 60 / project.bpm;
  const duration = project.lengthBars * beatsPerBar(project) * secondsPerBeat + 2;
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const useWorklet = await prepareSynth(context);

  const master =
    options.master === false
      ? null
      : buildMasterChain(context, project.master.gainDb, context.destination);
  const masterInput = master ? master.input : context.destination;
  const drumBus = options.buses === false ? null : buildBusChain(context, masterInput, "drums");
  const musicBus = options.buses === false ? null : buildBusChain(context, masterInput, "music");
  const noise = createNoiseBuffer(context);
  const soloed = project.tracks.some((track) => track.solo);
  const chains = new Map<string, TrackChain>();
  const synths = new Map<string, WorkletInstrument>();

  for (const track of project.tracks) {
    if (track.muted || (soloed && !track.solo)) continue;
    const bus =
      options.buses === false
        ? masterInput
        : track.instrument.type === "drumkit"
          ? drumBus!.input
          : musicBus!.input;
    const chain = buildTrackChain(context, track, bus, secondsPerBeat);
    chains.set(track.id, chain);
    if (useWorklet && track.instrument.type !== "drumkit") {
      const notes = track.clips.flatMap((clip) =>
        clip.notes.map((note) => ({
          note: note.pitch,
          velocity: note.velocity / 127,
          startAt: (clip.start + note.start) * secondsPerBeat,
          duration: note.duration * secondsPerBeat,
        })),
      );
      const synth = new WorkletInstrument(context, presetFor(track.instrument.type), {
        notes,
        variant: hashString(`${project.seed}|${track.id}`) % 1000,
      });
      synth.connect(chain.input);
      synths.set(track.id, synth);
    }
  }

  for (const track of project.tracks) {
    const chain = chains.get(track.id);
    if (!chain) continue;
    for (const clip of track.clips) {
      if (clip.audio) {
        const asset = audioAssets.get(clip.audio.assetId);
        if (!asset) continue;
        const source = context.createBufferSource();
        source.buffer = asset.buffer;
        const gain = context.createGain();
        gain.gain.value = Math.max(0, Math.min(2, dbToGain(clip.audio.gainDb)));
        source.connect(gain).connect(chain.input);
        const when = clip.start * secondsPerBeat;
        const offset = Math.max(0, clip.audio.offset * secondsPerBeat);
        const length = Math.max(0.01, clip.length * secondsPerBeat);
        source.start(when, offset, length);
        continue;
      }
      if (synths.has(track.id)) continue;
      for (const note of clip.notes) {
        playInstrumentNote(
          context,
          chain.input,
          track.instrument.type,
          note.pitch,
          (clip.start + note.start) * secondsPerBeat,
          note.duration * secondsPerBeat,
          note.velocity,
          noise,
        );
      }
    }
  }

  const rendered = await context.startRendering();
  for (const synth of synths.values()) synth.dispose();
  const shouldNormalize = options.normalize !== false && options.master !== false;
  const loudness = shouldNormalize
    ? normalizeBuffer(rendered, options.targetLufs ?? -14, -1, options.limiter !== false)
    : measureLoudness(rendered);
  return {
    blob: new Blob([audioBufferToWav(rendered)], { type: "audio/wav" }),
    loudness,
  };
}

export interface StemFile {
  name: string;
  blob: Blob;
}

export interface StemOptions {
  sampleRate?: number;
  /** Si se indica, exporta solo estas pistas. */
  trackIds?: string[];
  onProgress?: (index: number, total: number, name: string) => void;
}

/**
 * WAV por pista con sus FX, sin cadena de máster ni normalización.
 * Así se pueden mezclar fuera sin doble procesado.
 */
export async function renderStems(project: Project, options: StemOptions = {}): Promise<StemFile[]> {
  const soloed = project.tracks.some((track) => track.solo);
  const selected = options.trackIds ? new Set(options.trackIds) : null;
  const tracks = selected
    ? project.tracks.filter((track) => selected.has(track.id))
    : project.tracks.filter((track) => !track.muted && (!soloed || track.solo));
  if (tracks.length === 0) throw new Error("No hay pistas para exportar");

  const files: StemFile[] = [];
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index]!;
    options.onProgress?.(index + 1, tracks.length, track.name);
    const single: Project = { ...project, tracks: [track] };
    const { blob } = await renderProject(single, {
      ...(options.sampleRate ? { sampleRate: options.sampleRate } : {}),
      normalize: false,
      master: false,
    });
    files.push({
      name: `${String(index + 1).padStart(2, "0")}-${slug(track.name)}.wav`,
      blob,
    });
  }
  return files;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pista"
  );
}

export async function renderProjectToWav(project: Project, sampleRate = 44_100): Promise<Blob> {
  return (await renderProject(project, { sampleRate })).blob;
}

/** PCM 16-bit little-endian, estéreo si el buffer lo es. */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, data[channel]![frame]!));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      offset += 2;
    }
  }
  return output;
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
}
