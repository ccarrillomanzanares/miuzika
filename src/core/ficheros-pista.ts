/**
 * The audio files that belong to a set of tracks alone: what can go from disk when those tracks are deleted.
 *
 * Why (bug 45, seen 14-Nov): deleting a track left its WAVs in the project folder and their entries in `audioAssets`
 * (about 150 MB after seven discarded takes), with no question asked. A file another track still plays is never in
 * the list, whatever the answer.
 *
 * The same for the .mid a MIDI track's notes were read from (requested 15-Nov), for the tracks that recorded it:
 * a clip keeps its file in `origin.archivo` since that day; tracks imported before name no file and offer none.
 */

import type { AudioAsset, Project } from "./types.ts";

/** The assets with a file on disk that the given tracks use and no other track does, in the project's order. */
export function audioSoloDe(project: Project, trackIds: readonly string[]): AudioAsset[] {
  const fuera = new Set(trackIds);
  const deEstas = new Set<string>();
  const deOtras = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio) (fuera.has(track.id) ? deEstas : deOtras).add(clip.audio.assetId);
    }
  }
  // Two entries can name the same file (the same WAV imported twice): the file stays while any other track plays it.
  const rutasDeOtras = new Set((project.audioAssets ?? []).filter((a) => deOtras.has(a.id) && a.ruta).map((a) => a.ruta));
  return (project.audioAssets ?? []).filter((a) => deEstas.has(a.id) && !deOtras.has(a.id) && Boolean(a.ruta) && !rutasDeOtras.has(a.ruta));
}

/** The project without those entries of `audioAssets`. An entry a clip still plays is refused: it would play silence. */
export function sinAssets(project: Project, assetIds: readonly string[]): Project {
  const quitar = new Set(assetIds);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio && quitar.has(clip.audio.assetId)) throw new Error(`"${track.name}" still plays the audio ${clip.audio.assetId}`);
    }
  }
  return { ...project, audioAssets: (project.audioAssets ?? []).filter((a) => !quitar.has(a.id)) };
}

/** The .mid files the given tracks' clips were read from and no clip of another track was. */
export function midiSoloDe(project: Project, trackIds: readonly string[]): string[] {
  const fuera = new Set(trackIds);
  const deEstas = new Set<string>();
  const deOtras = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.origin?.archivo) (fuera.has(track.id) ? deEstas : deOtras).add(clip.origin.archivo);
    }
  }
  return [...deEstas].filter((archivo) => !deOtras.has(archivo));
}
