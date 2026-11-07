/**
 * What a chosen file is. MIDI is asked FIRST: Chrome types a .mid as "audio/...", so asking
 * "is it audio?" first sent every .mid to the WAV path (reproduced 6-Nov: "could not read").
 */

interface FicheroElegido {
  name: string;
  type: string;
}

export function esMidi(file: FicheroElegido): boolean {
  return /\.(mid|midi)$/i.test(file.name) || /midi/i.test(file.type);
}

export function esAudio(file: FicheroElegido): boolean {
  if (esMidi(file)) return false;
  return file.type.startsWith("audio/") || /\.(wav|mp3|ogg|oga|flac|aif|aiff|m4a)$/i.test(file.name);
}
