/**
 * Timeline time arithmetic.
 *
 * MIDI clips end where their last note ends (and are rounded to the bar, see
 * `add_notes`). Audio clips, on the other hand, last as long as the file: a
 * 336.667-beat stem left the clip halfway through a bar while the project ran
 * for 85 bars. This decides how long an audio clip lasts, in whole bars.
 */

/**
 * Duration of an audio clip on the timeline.
 *
 * Stems (2 bars or more) are rounded UP to the bar: they never leave the clip
 * halfway through a bar, and they never gain a bar when the file already ends
 * exactly on the edge. One-shots (a 2-second kick) keep their exact duration:
 * stretching them to a whole bar would be drawing silence that does not play.
 */
export function compasesDeAudio(
  durationBeats: number,
  barBeats: number,
  compasesMinimos = 2,
): number {
  if (!(durationBeats > 0) || !(barBeats > 0)) return barBeats > 0 ? barBeats : 4;
  if (durationBeats < barBeats * compasesMinimos) return durationBeats;
  const compases = Math.ceil(durationBeats / barBeats - 1e-6);
  return Math.max(1, compases) * barBeats;
}

/**
 * The clip of a generated take: the asked bars when given, never longer than the file. The
 * model is asked for a margin beyond them because, measured 7-Nov, lego takes asked for 8 bars
 * stopped sounding at 6.2-7.1; the WAV keeps the margin, the clip ends where it was asked.
 * Null = the whole file, as `compasesDeAudio` places it.
 */
export function largoDeClip(durationBeats: number, barBeats: number, compases: number | null): number {
  const entero = compasesDeAudio(durationBeats, barBeats);
  if (compases === null || !(compases > 0)) return entero;
  return Math.min(entero, compases * barBeats);
}

/**
 * The last bar (from 1) any of these clips reaches: where "to the end" stops for a source. The
 * render runs past it (bug 24, 7-Nov: 0.27 s of tail after an 8-bar drum clip), and rounding the
 * render up made the next take's clip 9 bars. Null when there are no clips.
 */
export function ultimoCompasDeClips(clips: readonly { start: number; length: number }[], barBeats: number): number | null {
  if (clips.length === 0 || !(barBeats > 0)) return null;
  const fin = Math.max(...clips.map((c) => c.start + c.length));
  return Math.max(1, Math.ceil(fin / barBeats - 1e-6));
}

/**
 * How many bars the project needs for a clip that starts at `startBar` and lasts
 * `lengthBeats`. Used to grow `lengthBars` without overshooting.
 */
export function compasesNecesarios(startBar: number, lengthBeats: number, barBeats: number): number {
  if (!(barBeats > 0)) return Math.max(1, Math.ceil(startBar + 1));
  return Math.max(1, startBar + Math.ceil(lengthBeats / barBeats - 1e-6));
}

/**
 * Seconds of one beat (a quarter note: the timeline counts in quarter notes) at `bpm`.
 * One place for 60/bpm (review of 3-Nov: nine inline copies across core, host and web).
 */
export function segundosPorTiempo(bpm: number): number {
  return 60 / bpm;
}

/** Seconds → beats at `bpm`. */
export function tiemposDeSegundos(segundos: number, bpm: number): number {
  return (segundos * bpm) / 60;
}
