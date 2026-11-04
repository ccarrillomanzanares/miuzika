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

/**
 * Tuning the openDAW engine ignores, moved into the root key, the one thing it reads.
 *
 * `simplifySoundfont` builds each region with only `rootKey` (overridingRootKey or the
 * sample's originalPitch) and plays key k transposed by k - rootKey semitones. It
 * ignores scaleTuning (56) and coarseTune (51). Measured on 4-Nov with GeneralUser GS,
 * GM kit 0, key 38: "Standard Snare 1" has scaleTuning 0 (do not transpose) and its
 * samples have root 60, so the engine played it 22 semitones down: the hit lasted
 * 2.35 s instead of 0.68 s and its main frequency was 60 Hz instead of ~206 Hz (the
 * "bomb" snare Carlos heard). The "1gate" layer, root 28, went 10 semitones up.
 *
 * The SF2 pitch of key k is (k - root) * scaleTuning/100 + coarseTune semitones. With
 * scaleTuning 100 that is the same for every key, so the root key just moves by
 * -coarseTune. Otherwise the zone is split into one zone per key, each with the root
 * that gives that key its pitch. Rounded to whole semitones: the blob stores the root
 * as an integer, and fineTune (52, cents) cannot be expressed; it is left as it is.
 * Preset-level tuning (added on top) is not handled: an instrument can be shared by
 * presets with different values. Run after `repartirZonasGlobales`, so tuning stored
 * in the global zone is seen.
 */
type ZonaInstrumento = ZonaSf2 & {
  keyRange?: { lo: number; hi: number };
  sample?: { header?: { originalPitch?: number } };
};

const valor = (zona: ZonaSf2, tipo: number): number | undefined =>
  (zona.generators[tipo] as { value?: number } | undefined)?.value;

function raizDe(zona: ZonaInstrumento): number {
  const propia = valor(zona, 58);
  if (propia !== undefined && propia >= 0 && propia <= 127) return propia;
  return zona.sample?.header?.originalPitch ?? 60;
}

function conRaiz(zona: ZonaInstrumento, raiz: number, teclas?: { lo: number; hi: number }): ZonaInstrumento {
  // The blob stores the root as an unsigned integer: never below 0.
  const generators: Generadores = { ...zona.generators, 58: { id: 58, value: Math.max(0, raiz) } };
  // Already applied: scale back to 100 and coarse to 0, so a second pass changes nothing.
  if (generators[56] !== undefined) generators[56] = { id: 56, value: 100 };
  if (generators[51] !== undefined) generators[51] = { id: 51, value: 0 };
  if (!teclas) return { ...zona, generators };
  generators[43] = { id: 43, range: { ...teclas } };
  return { ...zona, generators, keyRange: { ...teclas } };
}

/** Returns how many instrument zones it retuned (a split zone counts once). */
export function afinarZonas(soundfont: { presets: PresetSf2[]; instruments?: InstrumentoSf2[] }): number {
  const instrumentos = new Set<InstrumentoSf2>(soundfont.instruments ?? []);
  for (const preset of soundfont.presets) for (const z of preset.zones) if (z.instrument) instrumentos.add(z.instrument);
  let afinadas = 0;
  for (const instrumento of instrumentos) {
    const nuevas: ZonaSf2[] = [];
    for (const zona of instrumento.zones as ZonaInstrumento[]) {
      const escala = valor(zona, 56) ?? 100;
      const gruesa = valor(zona, 51) ?? 0;
      if (escala === 100 && gruesa === 0) {
        nuevas.push(zona);
        continue;
      }
      afinadas++;
      const raiz = raizDe(zona);
      if (escala === 100) {
        nuevas.push(conRaiz(zona, raiz - gruesa));
        continue;
      }
      const rango = (zona.generators[43] as { range?: { lo: number; hi: number } } | undefined)?.range ?? { lo: 0, hi: 127 };
      for (let k = rango.lo; k <= rango.hi; k++) {
        const semitonos = Math.round(((k - raiz) * escala) / 100 + gruesa);
        nuevas.push(conRaiz(zona, k - semitonos, { lo: k, hi: k }));
      }
    }
    instrumento.zones = nuevas;
  }
  return afinadas;
}
