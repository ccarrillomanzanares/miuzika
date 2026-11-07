/**
 * A .mid already in the project folder becomes MIDI tracks. Moved out of the agent's
 * `importarPistas` (the MIDI half): same decisions, without the agent around them.
 */

import type { InstrumentType, Project } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { applyOps } from "../../src/core/ops.ts";
import { nombrePistaMidi } from "../../src/core/gm-nombres.ts";
import { cabeceraDeProyecto } from "./proyecto-disco.ts";

interface PistaMidi {
  name: string;
  program?: number;
  channel?: number;
  notes: { pitch: number; start: number; duration: number; velocity: number }[];
}

/** Cap of the add_notes op. */
const MAX_NOTAS = 2000;

/** General MIDI families (program 0-127): basses 32-39, leads 80-87, pads 88-95; channel 10 is drums. */
function tipoDeInstrumento(canal: number, programa: number): InstrumentType {
  if (canal === 9) return "drumkit";
  if (programa >= 32 && programa <= 39) return "bass";
  if (programa >= 88 && programa <= 95) return "pad";
  if (programa >= 80 && programa <= 87) return "lead";
  return "synth";
}

export async function pistasDesdeMidi(
  project: Project,
  ruta: string,
  inicio: number,
  /** The project was created for this file: it takes the file's tempo instead of warning. */
  adoptarTempo: boolean,
): Promise<{ project: Project; hechas: string[]; avisos: string[] }> {
  const res = await fetch(`/api/midi?path=${encodeURIComponent(ruta)}`, {
    headers: cabeceraDeProyecto(carpetaDeProyecto(project)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const datos = (await res.json()) as { bpm?: number; tracks?: PistaMidi[] };
  const bpm = Number(datos.bpm) || 120;
  const pistas = (datos.tracks ?? []).filter((pista) => (pista.notes?.length ?? 0) > 0);

  const avisos: string[] = [];
  // A MIDI at 90 BPM inside a 120 BPM project sounds at 120, because the notes are beats.
  if (!adoptarTempo && Math.abs(bpm - project.bpm) > 0.5) {
    avisos.push(`${ruta}: the MIDI is at ${bpm} BPM and the project at ${project.bpm}. The notes are placed in beats, so they will sound faster or slower.`);
  }

  let current = adoptarTempo ? applyOps(project, [{ op: "set_song", bpm }]).project : project;
  let contador = current.tracks.length;
  const hechas: string[] = [];
  for (const pista of pistas) {
    const id = `trk_midi_${contador++}`;
    const nombre = nombrePistaMidi(pista).slice(0, 60);
    current = applyOps(current, [
      {
        op: "add_track",
        id,
        name: nombre,
        kind: "midi",
        instrument: { type: tipoDeInstrumento(pista.channel ?? 0, pista.program ?? 0), program: pista.program ?? 0 },
      },
    ]).project;
    for (let i = 0; i < pista.notes.length; i += MAX_NOTAS) {
      const trozo = pista.notes.slice(i, i + MAX_NOTAS);
      // The chunks stay in the SAME clip: otherwise they overlap from the start bar (Drums: 2,376 notes).
      const clipId = i === 0 ? undefined : current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
      current = applyOps(current, [
        i === 0
          ? { op: "add_notes", trackId: id, startBar: inicio, name: nombre, notes: trozo }
          : { op: "add_notes", trackId: id, clipId, notes: trozo },
      ]).project;
    }
    hechas.push(`${nombre} (MIDI, ${pista.notes.length} notes)`);
  }
  return { project: current, hechas, avisos };
}
