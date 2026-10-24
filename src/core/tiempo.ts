/**
 * Aritmética de tiempo de la timeline.
 *
 * Los clips MIDI acaban donde acaba su última nota (y se redondean al compás, ver
 * `add_notes`). Los de audio, en cambio, duran lo que dura el fichero: un stem de
 * 336,667 beats dejaba el clip a mitad de compás mientras el proyecto iba por 85
 * compases. Aquí se decide cuánto dura un clip de audio, en compases enteros.
 */

/**
 * Duración de un clip de audio en la timeline.
 *
 * Los stems (2 compases o más) se redondean HACIA ARRIBA al compás: nunca dejan
 * el clip a mitad de compás, y nunca ganan un compás cuando el fichero ya acaba
 * justo en el borde. Los one-shots (un bombo de 2 s) se quedan con su duración
 * exacta: estirarlos a un compás entero sería dibujar aire que no suena.
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
 * Cuántos compases necesita el proyecto para un clip que empieza en `startBar` y
 * dura `lengthBeats`. Se usa para crecer `lengthBars` sin pasarse.
 */
export function compasesNecesarios(startBar: number, lengthBeats: number, barBeats: number): number {
  if (!(barBeats > 0)) return Math.max(1, Math.ceil(startBar + 1));
  return Math.max(1, startBar + Math.ceil(lengthBeats / barBeats - 1e-6));
}
