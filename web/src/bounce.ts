/**
 * Convierte pistas MIDI en pistas de audio ("bounce to samples").
 * Renderiza cada pista con sus FX, sin buses ni máster, y la sustituye por un clip WAV.
 * Al reproducirla de nuevo, la pista de audio pasa por el mismo bus que la original.
 */

import type { Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import type { Op } from "../../src/core/ops.ts";
import { applyOps } from "../../src/core/ops.ts";
import { audioAssets, computePeaks, persistAudioAsset } from "./audio-store.ts";
import { renderProject } from "./render.ts";
import { audioBufferToWav } from "./wav.ts";

let decodeContext: AudioContext | null = null;

export type BounceProgress = (index: number, total: number, name: string) => void;

interface RenderedTrack {
  track: Track;
  name: string;
  assetId: string;
  buffer: AudioBuffer;
}

/** Evita que un bounce sin máster se grabe recortado. El factor es común para conservar el balance. */
const BOUNCE_CEILING = 0.98;

export async function bounceTracks(
  project: Project,
  trackIds: string[],
  onProgress?: BounceProgress,
  onWarning?: (message: string) => void,
): Promise<Project> {
  const tracks = project.tracks.filter(
    (track) => track.kind === "midi" && trackIds.includes(track.id),
  );
  if (tracks.length === 0) throw new Error("No hay pistas MIDI seleccionadas");

  const totalBeats = project.lengthBars * beatsPerBar(project);
  decodeContext ??= new AudioContext();
  const rendered: RenderedTrack[] = [];

  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index]!;
    onProgress?.(index + 1, tracks.length, track.name);

    // Pista sola, con sus FX, sin buses ni cadena de máster. Mute/solo se recuperan después.
    const single: Project = {
      ...project,
      tracks: [{ ...track, muted: false, solo: false }],
    };
    const { blob } = await renderProject(single, { normalize: false, master: false, buses: false });
    const buffer = await decodeContext.decodeAudioData(await blob.arrayBuffer());

    rendered.push({
      track,
      name: `${track.name} [sample]`,
      assetId: `aud_bounce_${Date.now().toString(36)}_${index}`,
      buffer,
    });
  }

  // Si algún stem se pasa, atenuamos todos por igual para no romper el balance entre ellos.
  let peak = 0;
  for (const item of rendered) {
    for (let channel = 0; channel < item.buffer.numberOfChannels; channel++) {
      const data = item.buffer.getChannelData(channel);
      for (let frame = 0; frame < data.length; frame++) {
        peak = Math.max(peak, Math.abs(data[frame]!));
      }
    }
  }
  if (peak > BOUNCE_CEILING) {
    const scale = BOUNCE_CEILING / peak;
    for (const item of rendered) {
      for (let channel = 0; channel < item.buffer.numberOfChannels; channel++) {
        const data = item.buffer.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame++) data[frame] = data[frame]! * scale;
      }
    }
  }

  const barBeats = beatsPerBar(project);
  // add_audio_clip limita cada clip a 64 compases: partimos los stems largos en varios clips.
  const maxClipBeats = 64 * barBeats;
  const ops: Op[] = [];
  for (let index = 0; index < rendered.length; index++) {
    const item = rendered[index]!;
    const audioTrackId = `trk_bounce_${Date.now().toString(36)}_${index}`;
    audioAssets.set(item.assetId, {
      id: item.assetId,
      name: item.name,
      buffer: item.buffer,
      durationBeats: totalBeats,
      peaks: computePeaks(item.buffer),
    });

    const wav = new Blob([audioBufferToWav(item.buffer) as BlobPart], { type: "audio/wav" });
    if (!(await persistAudioAsset(item.assetId, item.name, totalBeats, wav))) {
      onWarning?.(
        `No se pudo guardar “${item.name}” en el navegador; sonará en esta sesión, pero se perderá al recargar.`,
      );
    }

    ops.push(
      {
        op: "add_track",
        id: audioTrackId,
        name: item.name,
        kind: "audio",
        instrument: { type: item.track.instrument.type },
        gainDb: 0,
        pan: 0,
      },
      {
        op: "register_audio_asset",
        assetId: item.assetId,
        name: item.name,
        durationBeats: totalBeats,
      },
    );
    for (let offset = 0; offset < totalBeats; offset += maxClipBeats) {
      const length = Math.min(maxClipBeats, totalBeats - offset);
      ops.push({
        op: "add_audio_clip",
        trackId: audioTrackId,
        assetId: item.assetId,
        startBar: offset / barBeats,
        offsetBeats: offset,
        lengthBeats: length,
        gainDb: 0,
        name: item.name,
      });
    }
    if (item.track.muted || item.track.solo) {
      ops.push({
        op: "set_track",
        trackId: audioTrackId,
        muted: item.track.muted,
        solo: item.track.solo,
      });
    }
    ops.push({ op: "remove_track", trackId: item.track.id });
  }

  return applyOps(project, ops).project;
}
