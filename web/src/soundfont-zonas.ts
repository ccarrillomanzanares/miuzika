/**
 * Las zonas globales de un SoundFont, repartidas en sus zonas.
 *
 * Un SF2 puede guardar en la primera zona de un preset o de un instrumento («zona
 * global») lo que vale para todas: bucle, envolvente, pan… El motor de openDAW
 * (`simplifySoundfont` en studio-core-wasm) sólo lee las zonas normales y tira la
 * global. Medido el 28-oct con GeneralUser GS: 113 de los 128 presets del banco 0
 * guardan ahí el bucle (`sampleModes`), así que sus muestras sonaban una vez y se
 * acababan. «Saw Lead» (81) es una onda de milisegundos: cada nota era un chasquido,
 * con picos que recortaban y −50 dB de nivel medio en el coro de «Hard».
 *
 * Aquí se copia cada generador de la zona global a las zonas que no lo tienen (lo
 * que dice la especificación: la zona propia manda). Se hace sobre el SF2 ya
 * parseado, antes de dárselo al motor.
 */

type Generadores = Record<number, unknown>;
interface ZonaSf2 {
  generators: Generadores;
}
interface InstrumentoSf2 {
  globalZone?: ZonaSf2;
  zones: ZonaSf2[];
}
interface PresetSf2 {
  globalZone?: ZonaSf2;
  zones: (ZonaSf2 & { instrument?: InstrumentoSf2 })[];
}

/** Instrumento (41) y muestra (53) apuntan a otra cosa: nunca se heredan. */
const NO_SE_HEREDAN = new Set([41, 53]);

function heredar(global: ZonaSf2 | undefined, zonas: ZonaSf2[]): number {
  if (!global) return 0;
  let copiados = 0;
  for (const [tipo, generador] of Object.entries(global.generators)) {
    if (NO_SE_HEREDAN.has(Number(tipo))) continue;
    for (const zona of zonas) {
      if (zona.generators[Number(tipo)] !== undefined) continue;
      zona.generators[Number(tipo)] = generador;
      copiados++;
    }
  }
  return copiados;
}

/** Reparte las zonas globales (de presets e instrumentos). Devuelve cuántos generadores copió. */
export function repartirZonasGlobales(soundfont: { presets: PresetSf2[]; instruments?: InstrumentoSf2[] }): number {
  let copiados = 0;
  // Los instrumentos se recorren una vez aunque los usen varios presets; repetir no
  // cambiaría nada (sólo se rellena lo que falta), pero contaría de más.
  const instrumentos = new Set<InstrumentoSf2>(soundfont.instruments ?? []);
  for (const preset of soundfont.presets) {
    copiados += heredar(preset.globalZone, preset.zones);
    for (const zona of preset.zones) if (zona.instrument) instrumentos.add(zona.instrument);
  }
  for (const instrumento of instrumentos) copiados += heredar(instrumento.globalZone, instrumento.zones);
  return copiados;
}
