/**
 * The global zones of a SoundFont, spread across its zones.
 *
 * An SF2 can store in the first zone of a preset or an instrument (the "global
 * zone") whatever applies to all of them: loop, envelope, pan… The openDAW engine
 * (`simplifySoundfont` in studio-core-wasm) only reads the normal zones and throws
 * away the global one. Measured on Oct 28 with GeneralUser GS: 113 of the 128
 * presets in bank 0 store the loop there (`sampleModes`), so their samples played
 * once and ended. "Saw Lead" (81) is a wave lasting milliseconds: every note was a
 * click, with peaks that clipped and −50 dB average level in the "Hard" choir.
 *
 * Here every generator from the global zone is copied to the zones that do not
 * have it (as the specification says: the zone's own value wins). This is done on
 * the already parsed SF2, before handing it to the engine.
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

/** Instrument (41) and sample (53) point to something else: they are never inherited. */
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

/** Spreads the global zones (from presets and instruments). Returns how many generators it copied. */
export function repartirZonasGlobales(soundfont: { presets: PresetSf2[]; instruments?: InstrumentoSf2[] }): number {
  let copiados = 0;
  // Instruments are traversed once even if several presets use them; repeating would
  // change nothing (only what is missing gets filled in), but it would overcount.
  const instrumentos = new Set<InstrumentoSf2>(soundfont.instruments ?? []);
  for (const preset of soundfont.presets) {
    copiados += heredar(preset.globalZone, preset.zones);
    for (const zona of preset.zones) if (zona.instrument) instrumentos.add(zona.instrument);
  }
  for (const instrumento of instrumentos) copiados += heredar(instrumento.globalZone, instrumento.zones);
  return copiados;
}
