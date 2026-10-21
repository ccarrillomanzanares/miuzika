/**
 * "Digest": representación compacta del proyecto para el LLM.
 * Nunca se manda el proyecto entero: se manda esto (presupuesto ~2-4k tokens).
 */

import type { Project, Track } from "./types.ts";
import { beatsPerBar } from "./types.ts";
import { describeKey } from "./theory.ts";
import { projectStats } from "./project.ts";

function formatDevices(track: Track): string {
  if (track.devices.length === 0) return "sin FX";
  return track.devices
    .map((device) => {
      const params = Object.entries(device.params)
        .map(([name, value]) => `${name}=${value}`)
        .join(",");
      return `${device.type}[${device.id}:${params}]`;
    })
    .join(" ");
}

function formatClips(track: Track, barBeats: number): string {
  if (track.clips.length === 0) return "sin clips";
  return track.clips
    .map((clip) => {
      const from = (clip.start / barBeats + 1).toFixed(1).replace(/\.0$/, "");
      const to = ((clip.start + clip.length) / barBeats + 1).toFixed(1).replace(/\.0$/, "");
      const kind = clip.audio ? `audio:${clip.audio.assetId}` : `${clip.notes.length}n`;
      return `${clip.id} "${clip.name}" c${from}-${to} (${kind})`;
    })
    .join(", ");
}

export interface DigestOptions {
  maxChars?: number;
  /** Incluye las notas del primer clip (para ediciones quirúrgicas). */
  includeNotesFor?: string;
}

export function projectDigest(project: Project, options: DigestOptions = {}): string {
  const maxChars = options.maxChars ?? 6000;
  const barBeats = beatsPerBar(project);
  const stats = projectStats(project);
  const minutes = Math.floor(stats.seconds / 60);
  const seconds = Math.round(stats.seconds % 60);

  const lines: string[] = [
    `PROYECTO "${project.name}" | ${project.bpm} BPM | ${describeKey(project.key)} | ${project.timeSignature.numerator}/${project.timeSignature.denominator} | ${project.lengthBars} compases | ${minutes}:${String(seconds).padStart(2, "0")} | seed ${project.seed}`,
    `MASTER ${project.master.gainDb} dB | ${stats.tracks} pistas (${stats.midiTracks} MIDI, ${stats.audioTracks} audio) | ${stats.clips} clips | ${stats.notes} notas`,
  ];
  if (project.audioAssets && project.audioAssets.length > 0) {
    lines.push(
      `AUDIO: ${project.audioAssets
        .map((asset) => `${asset.id} "${asset.name}" (${asset.durationBeats.toFixed(1)} beats)`)
        .join(" · ")}`,
    );
  }
  if (project.codeSources && project.codeSources.length > 0) {
    for (const source of project.codeSources) {
      lines.push(
        `CODE ${source.id} "${source.name}" ${source.language} ${source.bars} compases | pistas: ${source.trackIds.join(", ") || "pendiente"} | código: ${source.code.slice(0, 1200)}`,
      );
    }
  }
  lines.push("PISTAS:");

  project.tracks.forEach((track, index) => {
    lines.push(
      `${index + 1}. ${track.id} "${track.name}" ${track.kind}/${track.instrument.type}${
        track.instrument.preset ? `(${track.instrument.preset})` : ""
      } gain=${track.gainDb}dB pan=${track.pan}${track.muted ? " MUTE" : ""}${track.solo ? " SOLO" : ""} | FX: ${formatDevices(track)}`,
    );
    lines.push(`   ${formatClips(track, barBeats)}`);
    if (options.includeNotesFor && (track.id === options.includeNotesFor || track.name === options.includeNotesFor)) {
      const clip = track.clips[0];
      if (clip) {
        const notes = clip.notes
          .slice(0, 64)
          .map((note) => `${note.pitch}@${note.start.toFixed(2)}+${note.duration.toFixed(2)}v${note.velocity}`)
          .join(" ");
        lines.push(`   notas(${clip.id}, primeras ${Math.min(64, clip.notes.length)}): ${notes}`);
      }
    }
  });

  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 40)}\n… (digest truncado, usa consultas por pista)`;
}

/** Lista de ids válidos, para mensajes de error del agente. */
export function trackIds(project: Project): string {
  return project.tracks.map((track) => `${track.id}"${track.name}"`).join(", ") || "ninguna";
}
