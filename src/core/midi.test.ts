import { test } from "node:test";
import assert from "node:assert/strict";

import { projectToMidi } from "./midi.ts";
import { composePlan, presetPlan } from "./plan.ts";
import { applyOps } from "./ops.ts";
import { createProject } from "./project.ts";

function readVarLen(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let index = offset;
  while (true) {
    const byte = bytes[index++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, index];
  }
}

interface ParsedMidi {
  format: number;
  trackCount: number;
  ppq: number;
  noteOns: number;
  tempos: number[];
  titles: string[];
  endOfTrack: boolean;
}

function parseMidi(bytes: Uint8Array): ParsedMidi {
  const id = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(id, "MThd");
  const headerLength = (bytes[4]! << 24) | (bytes[5]! << 16) | (bytes[6]! << 8) | bytes[7]!;
  assert.equal(headerLength, 6);
  const format = (bytes[8]! << 8) | bytes[9]!;
  const trackCount = (bytes[10]! << 8) | bytes[11]!;
  const ppq = (bytes[12]! << 8) | bytes[13]!;

  let offset = 14;
  let noteOns = 0;
  let endOfTrack = true;
  const tempos: number[] = [];
  const titles: string[] = [];

  for (let track = 0; track < trackCount; track++) {
    const trackId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    assert.equal(trackId, "MTrk");
    const length = (bytes[offset + 4]! << 24) | (bytes[offset + 5]! << 16) | (bytes[offset + 6]! << 8) | bytes[offset + 7]!;
    const end = offset + 8 + length;
    let cursor = offset + 8;

    while (cursor < end) {
      const [, next] = readVarLen(bytes, cursor);
      cursor = next;
      const status = bytes[cursor++]!;
      if (status === 0xff) {
        const type = bytes[cursor++]!;
        const [metaLength, afterLength] = readVarLen(bytes, cursor);
        cursor = afterLength;
        const data = bytes.slice(cursor, cursor + metaLength);
        cursor += metaLength;
        if (type === 0x2f) {
          // fin de pista
        } else if (type === 0x51) {
          tempos.push((data[0]! << 16) | (data[1]! << 8) | data[2]!);
        } else if (type === 0x03) {
          titles.push(new TextDecoder().decode(data));
        }
      } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
        const pitch = bytes[cursor++]!;
        const velocity = bytes[cursor++]!;
        void pitch;
        if ((status & 0xf0) === 0x90 && velocity > 0) noteOns++;
      } else if ((status & 0xf0) === 0xc0) {
        cursor += 1;
      } else {
        throw new Error(`Evento MIDI inesperado: 0x${status.toString(16)}`);
      }
    }
    if (cursor !== end) endOfTrack = false;
    offset = end;
  }

  assert.equal(offset, bytes.length, "no deben sobrar bytes");
  return { format, trackCount, ppq, noteOns, tempos, titles, endOfTrack };
}

test("el MIDI es formato 1 con conductor y una pista por track", () => {
  const { project } = applyOps(createProject(), composePlan(presetPlan("synthpop80s")));
  const parsed = parseMidi(projectToMidi(project));
  assert.equal(parsed.format, 1);
  assert.equal(parsed.trackCount, project.tracks.length + 1);
  assert.equal(parsed.ppq, 960);
  assert.ok(parsed.endOfTrack);
  assert.equal(parsed.tempos.length, 1);
  assert.ok(Math.abs(60_000_000 / parsed.tempos[0]! - project.bpm) < 0.01);
  assert.ok(parsed.titles.includes("Drums"));
});

test("el número de note-on coincide con las notas del proyecto", () => {
  const { project } = applyOps(createProject(), composePlan(presetPlan("siniestroPunk")));
  const expected = project.tracks.reduce(
    (sum, track) => sum + track.clips.reduce((clipSum, clip) => clipSum + clip.notes.length, 0),
    0,
  );
  assert.equal(parseMidi(projectToMidi(project)).noteOns, expected);
});

test("la batería va al canal 10", () => {
  const { project } = applyOps(createProject(), composePlan(presetPlan("techno", { bars: 8 })));
  const bytes = projectToMidi(project);
  // Busca un note-on con canal 9 (0x99).
  assert.ok(bytes.some((byte) => byte === 0x99), "debe haber note-on en el canal 10");
});
