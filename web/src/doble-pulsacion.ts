/**
 * Space plays or pauses; twice in a row stops (the user, 6-Nov). The first press acts at once
 * instead of waiting to see whether a second one comes: a pause that lags 350 ms feels broken.
 * So a double press does both things, and stopping undoes the first one.
 */

const VENTANA_MS = 350;

/** Returns a function to call on each press with the time in ms: true if it completes a double. */
export function crearDetectorDoble(ventanaMs = VENTANA_MS): (ahora: number) => boolean {
  let anterior = -Infinity;
  return (ahora) => {
    const doble = ahora - anterior <= ventanaMs;
    // After a double the next press starts over: a third one is a new single, not another double.
    anterior = doble ? -Infinity : ahora;
    return doble;
  };
}
