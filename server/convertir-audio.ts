/**
 * Everything in a project is PCM WAV: the waveform (`picos.py`, Python's `wave`), the streaming
 * and the export read only that, so an MP3 failed on import with "could not read" (reproduced
 * 6-Nov) although the selector offers it. What is not PCM WAV is converted when it arrives.
 */

/** Format tag of a WAV (1 = PCM, 3 = float, 0xFFFE = extensible), or null if it is not a WAV. */
export function formatoWav(datos: Uint8Array): number | null {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const etiqueta = (pos: number): string => String.fromCharCode(...datos.subarray(pos, pos + 4));
  if (datos.byteLength < 12 || etiqueta(0) !== "RIFF" || etiqueta(8) !== "WAVE") return null;
  let pos = 12;
  while (pos + 8 <= datos.byteLength) {
    const tam = vista.getUint32(pos + 4, true);
    if (etiqueta(pos) === "fmt " && pos + 10 <= datos.byteLength) return vista.getUint16(pos + 8, true);
    pos += 8 + tam + (tam % 2);
  }
  return null;
}

export function debeConvertirse(nombre: string, datos: Uint8Array): boolean {
  if (/\.(mid|midi)$/i.test(nombre)) return false;
  return formatoWav(datos) !== 1;
}

/** 24 bits: a float or 24-bit source loses nothing audible, and `picos.py` reads it. */
export function argumentosAWav(origen: string, destino: string): string[] {
  return ["-y", "-hide_banner", "-loglevel", "error", "-i", origen, "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "pcm_s24le", "-f", "wav", destino];
}
