/**
 * Exportador Standard MIDI File (formato 1) sin dependencias.
 * Sirve para escuchar el resultado y para importarlo en openDAW.
 */

import type { Note, Project, Track } from "./types.ts";
import { beatsPerBar } from "./types.ts";
import { keyAccidentals } from "./theory.ts";
import { instrumentProgram } from "./ops.ts";

const PPQ = 960;

function vlq(value: number): number[] {
  let remaining = Math.max(0, Math.round(value));
  const bytes = [remaining & 0x7f];
  remaining >>= 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

function chunk(id: string, data: number[]): Uint8Array {
  const header = [...textBytes(id), (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff];
  return new Uint8Array([...header, ...data]);
}

interface TimedEvent {
  tick: number;
  priority: number;
  data: number[];
}

function keySignature(key: Project["key"]): number[] {
  const minor = key.mode === "minor" || key.mode === "harmonicMinor" ? 1 : 0;
  return [keyAccidentals(key), minor];
}

function noteEvents(notes: Note[], clipStartBeats: number, channel: number): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (const note of notes) {
    const start = Math.max(0, Math.round((clipStartBeats + note.start) * PPQ));
    const end = Math.max(start + 1, Math.round((clipStartBeats + note.start + note.duration) * PPQ));
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)));
    events.push({ tick: start, priority: 2, data: [0x90 | channel, pitch, velocity] });
    // Nota soltada con velocidad 64: evita notas colgadas.
    events.push({ tick: end, priority: 1, data: [0x80 | channel, pitch, 64] });
  }
  return events;
}

function encodeTrack(events: TimedEvent[], endTick: number): Uint8Array {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const data: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    data.push(...vlq(event.tick - previous), ...event.data);
    previous = event.tick;
  }
  data.push(...vlq(Math.max(0, endTick - previous)), 0xff, 0x2f, 0x00);
  return chunk("MTrk", data);
}

export function projectToMidi(project: Project): Uint8Array {
  const barBeats = beatsPerBar(project);
  const totalTicks = Math.round(project.lengthBars * barBeats * PPQ);
  const conductor: TimedEvent[] = [
    { tick: 0, priority: 0, data: meta(0x03, textBytes("miuzika")) },
    {
      tick: 0,
      priority: 0,
      data: meta(0x51, [
        (Math.round(60000000 / project.bpm) >>> 16) & 0xff,
        (Math.round(60000000 / project.bpm) >>> 8) & 0xff,
        Math.round(60000000 / project.bpm) & 0xff,
      ]),
    },
    {
      tick: 0,
      priority: 0,
      data: meta(0x58, [
        project.timeSignature.numerator,
        Math.round(Math.log2(project.timeSignature.denominator)),
        24,
        8,
      ]),
    },
    { tick: 0, priority: 0, data: meta(0x59, keySignature(project.key)) },
  ];

  const chunks = [encodeTrack(conductor, totalTicks)];
  const melodicChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let melodicIndex = 0;

  for (const track of project.tracks) {
    const isDrums = track.instrument.type === "drumkit";
    const channel = isDrums ? 9 : melodicChannels[melodicIndex++ % melodicChannels.length]!;
    const events: TimedEvent[] = [
      { tick: 0, priority: 0, data: meta(0x03, textBytes(track.name)) },
      { tick: 0, priority: 0, data: [0xc0 | channel, instrumentProgram(track) & 0x7f] },
    ];

    for (const clip of track.clips) {
      events.push(...noteEvents(clip.notes, clip.start, channel));
      // Los clips de audio no se exportan a MIDI (solo metadato de nombre).
      if (clip.audio) {
        events.push({
          tick: Math.round(clip.start * PPQ),
          priority: 0,
          data: meta(0x03, textBytes(`${clip.name} [audio:${clip.audio.assetId}]`)),
        });
      }
    }

    chunks.push(encodeTrack(events, totalTicks));
  }

  const header = new Uint8Array([
    ...textBytes("MThd"),
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x01, // formato 1
    (chunks.length >>> 8) & 0xff,
    chunks.length & 0xff,
    (PPQ >>> 8) & 0xff,
    PPQ & 0xff,
  ]);

  const totalLength = chunks.reduce((sum, part) => sum + part.length, header.length);
  const output = new Uint8Array(totalLength);
  output.set(header, 0);
  let offset = header.length;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function midiFileName(name: string): string {
  return `${name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "miuzika"}.mid`;
}

/** Cuenta de notas por pista, útil para diagnósticos. */
export function notesPerTrack(project: Project): Record<string, number> {
  const result: Record<string, number> = {};
  for (const track of project.tracks as Track[]) {
    result[track.id] = track.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
  }
  return result;
}
