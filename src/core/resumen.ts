/**
 * What the agent sees of the project: a compact summary with ids.
 *
 * Before, the agent could not look at the project: it only saw what the user pasted
 * with the "Template" button. It did not know which tracks existed, their ids, or
 * which devices they had, so it could not edit anything precisely. This is what the
 * `leer_proyecto` tool returns.
 *
 * Field names are in English on purpose: they are the same ones the `editar_proyecto`
 * ops expect (trackId, clipId, gainDb…), with no intermediate translation.
 */

import type { Clip, Device, Project, Track } from "./types.ts";
import { DEVICE_PARAMS, beatsPerBar } from "./types.ts";
import { projectStats } from "./project.ts";
import { aNotacion } from "./notacion.ts";

const NOMBRES_NOTA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 60 → "C4". */
export function nombreDeNota(pitch: number): string {
  return `${NOMBRES_NOTA[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function redondear(valor: number, decimales = 2): string {
  return String(Number(valor.toFixed(decimales)));
}

function lineaClip(clip: Clip, barBeats: number): string {
  const desde = clip.start / barBeats + 1;
  const compases = clip.length / barBeats;
  const partes = [`${clip.id} «${clip.name}» bar ${redondear(desde)} · ${redondear(compases)} bar(s)`];
  if (clip.notes.length > 0) {
    const alturas = clip.notes.map((nota) => nota.pitch);
    partes.push(
      `${clip.notes.length} notes ${nombreDeNota(Math.min(...alturas))}-${nombreDeNota(Math.max(...alturas))}`,
    );
  }
  if (clip.audio) partes.push(`audio ${clip.audio.assetId}${clip.audio.gainDb ? ` ${clip.audio.gainDb} dB` : ""}`);
  return `    - ${partes.join(" · ")}`;
}

function lineaPista(track: Track, indice: number, barBeats: number): string[] {
  const estado = [
    `${redondear(track.gainDb, 1)} dB`,
    track.pan !== 0 ? `pan ${redondear(track.pan)}` : "",
    track.muted ? "MUTE" : "",
    track.solo ? "SOLO" : "",
  ].filter((x) => x !== "");
  // With `archivo`, the library instrument plays, not the GM program.
  const instrumento = track.instrument.archivo
    ? `library «${track.instrument.preset ?? track.instrument.archivo}»`
    : (track.instrument.preset ? `${track.instrument.type}:${track.instrument.preset}` : track.instrument.type) +
      (track.instrument.program !== undefined ? ` GM ${track.instrument.program}` : "");
  const lineas = [`${indice + 1}. ${track.id} «${track.name}» [${track.kind}, ${instrumento}] ${estado.join(" · ")}`];
  lineas.push(...lineasEfectos(track.devices));
  if (track.sends?.length) {
    lineas.push(`    sends: ${track.sends.map((send) => `${send.busId} ${redondear(send.levelDb, 1)} dB`).join(", ")}`);
  }
  for (const clip of track.clips) lineas.push(lineaClip(clip, barBeats));
  return lineas;
}

function lineasEfectos(devices: Device[]): string[] {
  return devices.map((device) => {
    const params = Object.entries(device.params)
      .map(([clave, valor]) => `${clave}=${redondear(valor, 3)}`)
      .join(" ");
    return `    fx ${device.id} ${device.type}${device.enabled ? "" : " (off)"}: ${params}`;
  });
}

/**
 * Only one clip: its track, where it is, and its notes. Measured on Oct 27: with
 * `clip`, the whole summary was returned (6 tracks, 50 clips) PLUS the notes; it went
 * past 4,000 characters, was trimmed, and the agent spent another step reading the rest.
 */
function resumenDeClip(project: Project, clipId: string, maxNotas: number): string {
  const barBeats = beatsPerBar(project);
  const pista = project.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
  const clip = pista?.clips.find((candidato) => candidato.id === clipId);
  if (!pista || !clip) {
    const ids = project.tracks.flatMap((track) => track.clips.map((c) => c.id)).slice(0, 60).join(", ");
    return `There is no clip with id ${clipId}. Clips: ${ids || "none"}.`;
  }
  const lineas = [
    `${project.key.tonic} ${project.key.mode} · ${project.bpm} BPM · ${project.timeSignature.numerator}/${project.timeSignature.denominator}`,
    `Track ${pista.id} «${pista.name}» · ${lineaClip(clip, barBeats)}`,
  ];
  if (clip.notes.length === 0) {
    lineas.push("(no notes)");
    return lineas.join("\n");
  }
  // In the same compact notation escribir_notas uses, when possible: it takes a
  // fraction of the space and the model reads it like a score.
  const compacta = aNotacion(clip.notes);
  if (compacta !== null) {
    lineas.push("Notes in compact notation (quarter notes from the start of the clip):", compacta);
    return lineas.join("\n");
  }
  lineas.push("Notes (pitch, start, duration, velocity; times in quarter notes from the start of the clip):");
  const notas = [...clip.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  for (const nota of notas.slice(0, maxNotas)) {
    lineas.push(`${nota.pitch} ${nombreDeNota(nota.pitch)} ${redondear(nota.start, 3)} ${redondear(nota.duration, 3)} ${nota.velocity}`);
  }
  if (notas.length > maxNotas) lineas.push(`… and ${notas.length - maxNotas} more.`);
  return lineas.join("\n");
}

/**
 * Project summary. With `clipId`, ONLY that clip and its notes (up to `maxNotas`),
 * which is what is needed to rewrite it.
 */
export function resumenParaAgente(project: Project, opciones: { clipId?: string; maxNotas?: number } = {}): string {
  if (opciones.clipId) return resumenDeClip(project, opciones.clipId, opciones.maxNotas ?? 400);
  const barBeats = beatsPerBar(project);
  const stats = projectStats(project);
  const minutos = Math.floor(stats.seconds / 60);
  const segundos = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  const lineas = [
    `«${project.name}» · ${project.bpm} BPM · ${project.timeSignature.numerator}/${project.timeSignature.denominator} · ` +
      `${project.key.tonic} ${project.key.mode} · ${project.lengthBars} bars (${minutos}:${segundos}) · ` +
      `master ${project.master.gainDb} dB`,
    `Tracks (${project.tracks.length}). Times in bars from 1; in the ops, startBar starts at 0 and notes are in quarter notes.`,
  ];
  project.tracks.forEach((track, indice) => lineas.push(...lineaPista(track, indice, barBeats)));
  if (project.tracks.length === 0) lineas.push("(no tracks)");
  const buses = project.buses ?? [];
  if (buses.length > 0) {
    lineas.push(`Buses (${buses.length}): effect returns that play through the master; tracks send them signal with set_send.`);
    for (const bus of buses) {
      const fuentes = project.tracks.filter((track) => track.sends?.some((send) => send.busId === bus.id)).map((track) => track.name);
      lineas.push(`  ${bus.id} «${bus.name}» ${redondear(bus.gainDb, 1)} dB · fed by: ${fuentes.join(", ") || "nobody"}`);
      lineas.push(...lineasEfectos(bus.devices));
    }
  }

  const usados = new Set(
    [...project.tracks, ...buses].flatMap((cadena) => cadena.devices.map((device) => device.type)),
  );
  if (usados.size > 0) {
    lineas.push("Ranges of the fx used (Ms/Hz/Db suffix = that unit; no suffix, 0..1 or as indicated):");
    for (const tipo of usados) {
      const rangos = Object.entries(DEVICE_PARAMS[tipo])
        .map(([clave, [min, max]]) => `${clave} ${min}..${max}`)
        .join(", ");
      lineas.push(`  ${tipo}: ${rangos}`);
    }
  }

  return lineas.join("\n");
}
