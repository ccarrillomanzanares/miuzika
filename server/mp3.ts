/**
 * WAV → MP3 with ffmpeg (libmp3lame), and the measurement that the MP3 holds what the WAV
 * held.
 *
 * Decided by the user on 3-Nov: 320 kbps CBR (widest compatibility, ~2.4 MB per minute) and
 * the project title as the ID3 title. ffmpeg 9.0.2 "full_build" was already on the laptop's
 * PATH (it is used by analizar_referencia), so no new dependency.
 *
 * Why the measurement: house rule 4. The MP3 is decoded again with `volumedetect` and its
 * duration and peak are compared with the WAV's; a silent or truncated file is reported, not
 * announced as done. It still has to be heard.
 */

export const KBPS_MP3 = 320;

/** ID3 text: no control characters (ffmpeg would pass them on) and a sane length. */
export function textoId3(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function argumentosMp3(origen: string, destino: string, metadatos: { titulo?: string; artista?: string } = {}): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-i", origen, "-vn", "-codec:a", "libmp3lame", "-b:a", `${KBPS_MP3}k`, "-id3v2_version", "3"];
  const titulo = textoId3(metadatos.titulo ?? "");
  const artista = textoId3(metadatos.artista ?? "");
  if (titulo !== "") args.push("-metadata", `title=${titulo}`);
  if (artista !== "") args.push("-metadata", `artist=${artista}`);
  args.push(destino);
  return args;
}

/** Decodes a file and measures it: `ffmpeg -i x -af volumedetect -f null -`. */
export function argumentosMedir(ruta: string): string[] {
  return ["-hide_banner", "-nostdin", "-i", ruta, "-af", "volumedetect", "-f", "null", "-"];
}

export interface MedidaAudio {
  /** From "Duration: hh:mm:ss.cc" (the container's) or null. */
  segundos: number | null;
  /** From volumedetect's max_volume, dBFS, or null. */
  picoDb: number | null;
  /** From volumedetect's mean_volume, dBFS, or null. */
  mediaDb: number | null;
}

/** Reads ffmpeg's stderr (that is where both lines go). */
export function leerMedida(stderr: string): MedidaAudio {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const pico = /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/.exec(stderr);
  const media = /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/.exec(stderr);
  const num = (t: string | undefined): number | null => (t === undefined ? null : t.endsWith("inf") ? -Infinity : Number(t));
  return {
    segundos: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    picoDb: num(pico?.[1]),
    mediaDb: num(media?.[1]),
  };
}

/**
 * What is wrong with the MP3 against its WAV, in words for the agent; [] when it is fine.
 * MP3 frames pad the end (an encoder delay of ~50 ms and up to one frame of 26 ms), so up to
 * 0.2 s longer is normal; shorter by more than 0.1 s means it was cut. A peak 1 dB above the
 * WAV's is the usual overshoot of a lossy codec; more than that is reported, as is silence.
 */
export function problemasMp3(wav: MedidaAudio, mp3: MedidaAudio): string[] {
  const problemas: string[] = [];
  if (mp3.segundos === null) problemas.push("ffmpeg could not read the MP3 back.");
  else if (wav.segundos !== null) {
    const diferencia = mp3.segundos - wav.segundos;
    if (diferencia < -0.1) problemas.push(`the MP3 is ${(-diferencia).toFixed(2)} s shorter than the WAV: it was cut.`);
    if (diferencia > 0.2) problemas.push(`the MP3 is ${diferencia.toFixed(2)} s longer than the WAV.`);
  }
  if (mp3.picoDb === null || mp3.picoDb === -Infinity || mp3.picoDb < -70) problemas.push("the MP3 is silent.");
  else if (wav.picoDb !== null && wav.picoDb > -70 && mp3.picoDb > wav.picoDb + 1)
    problemas.push(`the MP3 peaks at ${mp3.picoDb.toFixed(1)} dBFS, ${(mp3.picoDb - wav.picoDb).toFixed(1)} dB above the WAV.`);
  if (mp3.picoDb !== null && mp3.picoDb > 0) problemas.push("the MP3 clips (peak above 0 dBFS): lower the master and export again.");
  return problemas;
}
