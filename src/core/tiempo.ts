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
 * How many bars the project needs for a clip that starts at `startBar` and lasts
 * `lengthBeats`. Used to grow `lengthBars` without overshooting.
 */
export function compasesNecesarios(startBar: number, lengthBeats: number, barBeats: number): number {
  if (!(barBeats > 0)) return Math.max(1, Math.ceil(startBar + 1));
  return Math.max(1, startBar + Math.ceil(lengthBeats / barBeats - 1e-6));
}
