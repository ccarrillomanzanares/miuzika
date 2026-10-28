/**
 * Lo que el agente ve del proyecto: un resumen compacto y con ids.
 *
 * Antes el agente no podía mirar el proyecto: sólo veía lo que el usuario pegara
 * con el botón «Plantilla». No sabía qué pistas había, ni sus ids, ni qué
 * dispositivos tenían, así que no podía editar nada con precisión. Esto es lo que
 * devuelve la herramienta `leer_proyecto`.
 *
 * Los nombres de campo están en inglés a propósito: son los mismos que esperan las
 * ops de `editar_proyecto` (trackId, clipId, gainDb…), sin traducción intermedia.
 */

import type { Clip, Project, Track } from "./types.ts";
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
  const partes = [`${clip.id} «${clip.name}» compás ${redondear(desde)} · ${redondear(compases)} compás(es)`];
  if (clip.notes.length > 0) {
    const alturas = clip.notes.map((nota) => nota.pitch);
    partes.push(
      `${clip.notes.length} notas ${nombreDeNota(Math.min(...alturas))}-${nombreDeNota(Math.max(...alturas))}`,
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
  // Con `archivo` suena el instrumento de la biblioteca, no el programa GM.
  const instrumento = track.instrument.archivo
    ? `biblioteca «${track.instrument.preset ?? track.instrument.archivo}»`
    : (track.instrument.preset ? `${track.instrument.type}:${track.instrument.preset}` : track.instrument.type) +
      (track.instrument.program !== undefined ? ` GM ${track.instrument.program}` : "");
  const lineas = [`${indice + 1}. ${track.id} «${track.name}» [${track.kind}, ${instrumento}] ${estado.join(" · ")}`];
  for (const device of track.devices) {
    const params = Object.entries(device.params)
      .map(([clave, valor]) => `${clave}=${redondear(valor, 3)}`)
      .join(" ");
    lineas.push(`    fx ${device.id} ${device.type}${device.enabled ? "" : " (apagado)"}: ${params}`);
  }
  for (const clip of track.clips) lineas.push(lineaClip(clip, barBeats));
  return lineas;
}

/**
 * Sólo un clip: su pista, dónde está y sus notas. Medido el 27-oct: con `clip`
 * se devolvía el resumen entero (6 pistas, 50 clips) MÁS las notas; pasaba de 4000
 * caracteres, se recortaba y el agente gastaba otro paso en leer el resto.
 */
function resumenDeClip(project: Project, clipId: string, maxNotas: number): string {
  const barBeats = beatsPerBar(project);
  const pista = project.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
  const clip = pista?.clips.find((candidato) => candidato.id === clipId);
  if (!pista || !clip) {
    const ids = project.tracks.flatMap((track) => track.clips.map((c) => c.id)).slice(0, 60).join(", ");
    return `No hay ningún clip con id ${clipId}. Clips: ${ids || "ninguno"}.`;
  }
  const lineas = [
    `${project.key.tonic} ${project.key.mode} · ${project.bpm} BPM · ${project.timeSignature.numerator}/${project.timeSignature.denominator}`,
    `Pista ${pista.id} «${pista.name}» · ${lineaClip(clip, barBeats)}`,
  ];
  if (clip.notes.length === 0) {
    lineas.push("(sin notas)");
    return lineas.join("\n");
  }
  // En la misma notación compacta con la que escribe escribir_notas, si se puede:
  // ocupa una fracción y el modelo la lee como una partitura.
  const compacta = aNotacion(clip.notes);
  if (compacta !== null) {
    lineas.push("Notas en notación compacta (negras desde el inicio del clip):", compacta);
    return lineas.join("\n");
  }
  lineas.push("Notas (pitch, start, duration, velocity; tiempos en negras desde el inicio del clip):");
  const notas = [...clip.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  for (const nota of notas.slice(0, maxNotas)) {
    lineas.push(`${nota.pitch} ${nombreDeNota(nota.pitch)} ${redondear(nota.start, 3)} ${redondear(nota.duration, 3)} ${nota.velocity}`);
  }
  if (notas.length > maxNotas) lineas.push(`… y ${notas.length - maxNotas} más.`);
  return lineas.join("\n");
}

/**
 * Resumen del proyecto. Con `clipId`, SÓLO ese clip y sus notas (hasta `maxNotas`),
 * que es lo que hace falta para reescribirlo.
 */
export function resumenParaAgente(project: Project, opciones: { clipId?: string; maxNotas?: number } = {}): string {
  if (opciones.clipId) return resumenDeClip(project, opciones.clipId, opciones.maxNotas ?? 400);
  const barBeats = beatsPerBar(project);
  const stats = projectStats(project);
  const minutos = Math.floor(stats.seconds / 60);
  const segundos = String(Math.round(stats.seconds % 60)).padStart(2, "0");
  const lineas = [
    `«${project.name}» · ${project.bpm} BPM · ${project.timeSignature.numerator}/${project.timeSignature.denominator} · ` +
      `${project.key.tonic} ${project.key.mode} · ${project.lengthBars} compases (${minutos}:${segundos}) · ` +
      `master ${project.master.gainDb} dB`,
    `Pistas (${project.tracks.length}). Tiempos en compases desde 1; en las ops, startBar empieza en 0 y las notas van en negras.`,
  ];
  project.tracks.forEach((track, indice) => lineas.push(...lineaPista(track, indice, barBeats)));
  if (project.tracks.length === 0) lineas.push("(sin pistas)");

  const usados = new Set(project.tracks.flatMap((track) => track.devices.map((device) => device.type)));
  if (usados.size > 0) {
    lineas.push("Rangos de los fx usados (sufijo Ms/Hz/Db = esa unidad; sin sufijo, 0..1 o lo indicado):");
    for (const tipo of usados) {
      const rangos = Object.entries(DEVICE_PARAMS[tipo])
        .map(([clave, [min, max]]) => `${clave} ${min}..${max}`)
        .join(", ");
      lineas.push(`  ${tipo}: ${rangos}`);
    }
  }

  return lineas.join("\n");
}
