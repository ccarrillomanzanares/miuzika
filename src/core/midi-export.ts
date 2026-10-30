/**
 * The project → a MIDI file (type 1, one track per MIDI track in the project).
 *
 * It is the "MIDI" export of the brief: what is in the project, as-is, to take to
 * another DAW. The agent used to write a Python script that read proyecto.json
 * (export_midi.py, Oct 27) and it was a different one every time.
 *
 * - The project's tempo and time signature on track 0.
 * - Each MIDI track with its name and General MIDI program (if it has one); drums
 *   go on channel 10. Audio tracks are not included: they are not notes.
 * - Notes are read from the clips (clip start + note start), without snapping to
 *   the grid.
 *
 * No DOM: tested with `node --test`.
 */

import type { Project } from "./types.ts";

/** Pulses per quarter note in the file. */
export const PPQ = 480;

function vlq(valor: number): number[] {
  let v = Math.max(0, Math.round(valor));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function texto(tipo: number, cadena: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(cadena)).slice(0, 127);
  return [0xff, tipo, ...vlq(bytes.length), ...bytes];
}

function trozo(id: string, datos: number[]): number[] {
  const n = datos.length;
  return [...Array.from(id, (c) => c.charCodeAt(0)), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...datos];
}

interface Evento {
  tick: number;
  /** Note-offs before note-ons on the same tick. */
  orden: number;
  bytes: number[];
}

function pistaDeEventos(cabecera: number[], eventos: Evento[], finTick: number): number[] {
  eventos.sort((a, b) => a.tick - b.tick || a.orden - b.orden);
  const datos = [...cabecera];
  let anterior = 0;
  for (const e of eventos) {
    datos.push(...vlq(e.tick - anterior), ...e.bytes);
    anterior = e.tick;
  }
  datos.push(...vlq(Math.max(0, finTick - anterior)), 0xff, 0x2f, 0x00);
  return trozo("MTrk", datos);
}

export function midiDeProyecto(project: Project): Uint8Array {
  const { numerator, denominator } = project.timeSignature;
  const microsPorNegra = Math.round(60_000_000 / Math.max(1, project.bpm));
  const beatsPorCompas = (numerator * 4) / denominator;
  const finTick = Math.round(project.lengthBars * beatsPorCompas * PPQ);

  const pistas: number[][] = [];
  // Track 0: name, tempo, and time signature.
  pistas.push(
    pistaDeEventos(
      [
        0x00, ...texto(0x03, project.name),
        0x00, 0xff, 0x51, 0x03, (microsPorNegra >>> 16) & 0xff, (microsPorNegra >>> 8) & 0xff, microsPorNegra & 0xff,
        0x00, 0xff, 0x58, 0x04, numerator, Math.round(Math.log2(denominator)), 24, 8,
      ],
      [],
      finTick,
    ),
  );

  let siguienteCanal = 0;
  for (const track of project.tracks) {
    if (track.kind !== "midi") continue;
    const bateria = track.instrument.type === "drumkit";
    let canal = 9;
    if (!bateria) {
      canal = siguienteCanal % 16 === 9 ? (siguienteCanal + 1) % 16 : siguienteCanal % 16;
      siguienteCanal = canal + 1;
    }
    const programa = Math.min(127, Math.max(0, track.instrument.program ?? 0));
    const cabecera = [0x00, ...texto(0x03, track.name), 0x00, 0xc0 | canal, programa];
    const eventos: Evento[] = [];
    for (const clip of track.clips) {
      for (const nota of clip.notes) {
        // What falls outside the clip does not play in the DAW: nor does it in the MIDI.
        if (nota.start >= clip.length) continue;
        const inicio = Math.round((clip.start + nota.start) * PPQ);
        const fin = Math.max(inicio + 1, Math.round((clip.start + Math.min(nota.start + nota.duration, clip.length)) * PPQ));
        const altura = Math.min(127, Math.max(0, Math.round(nota.pitch)));
        const velocidad = Math.min(127, Math.max(1, Math.round(nota.velocity)));
        eventos.push({ tick: inicio, orden: 1, bytes: [0x90 | canal, altura, velocidad] });
        eventos.push({ tick: fin, orden: 0, bytes: [0x80 | canal, altura, 0] });
      }
    }
    pistas.push(pistaDeEventos(cabecera, eventos, finTick));
  }

  const cabecera = trozo("MThd", [0, 1, (pistas.length >>> 8) & 0xff, pistas.length & 0xff, (PPQ >>> 8) & 0xff, PPQ & 0xff]);
  return Uint8Array.from([...cabecera, ...pistas.flat()]);
}
