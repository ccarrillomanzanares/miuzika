/**
 * General MIDI program names (GM 1, programs 0-127) and how a MIDI track is named.
 *
 * Why: MIDI-LLM writes unnamed tracks, so the reader called them "Track 1", "Track 2".
 * On 2-Nov in "Stahl" the agent could not tell which was the drum kit, re-read the
 * files with its own scripts, called the channel-10 drums "a piano" and rendered them
 * as piano. The program says what each track is; channel 10 (index 9) is always the kit.
 */
export const PROGRAMAS_GM: readonly string[] = [
  "acoustic grand piano", "bright acoustic piano", "electric grand piano", "honky-tonk piano",
  "electric piano 1", "electric piano 2", "harpsichord", "clavinet",
  "celesta", "glockenspiel", "music box", "vibraphone", "marimba", "xylophone", "tubular bells", "dulcimer",
  "drawbar organ", "percussive organ", "rock organ", "church organ", "reed organ", "accordion", "harmonica",
  "tango accordion",
  "acoustic guitar (nylon)", "acoustic guitar (steel)", "electric guitar (jazz)", "electric guitar (clean)",
  "electric guitar (muted)", "overdriven guitar", "distortion guitar", "guitar harmonics",
  "acoustic bass", "electric bass (finger)", "electric bass (pick)", "fretless bass", "slap bass 1",
  "slap bass 2", "synth bass 1", "synth bass 2",
  "violin", "viola", "cello", "contrabass", "tremolo strings", "pizzicato strings", "orchestral harp", "timpani",
  "string ensemble 1", "string ensemble 2", "synth strings 1", "synth strings 2", "choir aahs", "voice oohs",
  "synth choir", "orchestra hit",
  "trumpet", "trombone", "tuba", "muted trumpet", "french horn", "brass section", "synth brass 1", "synth brass 2",
  "soprano sax", "alto sax", "tenor sax", "baritone sax", "oboe", "english horn", "bassoon", "clarinet",
  "piccolo", "flute", "recorder", "pan flute", "blown bottle", "shakuhachi", "whistle", "ocarina",
  "lead 1 (square)", "lead 2 (sawtooth)", "lead 3 (calliope)", "lead 4 (chiff)", "lead 5 (charang)",
  "lead 6 (voice)", "lead 7 (fifths)", "lead 8 (bass + lead)",
  "pad 1 (new age)", "pad 2 (warm)", "pad 3 (polysynth)", "pad 4 (choir)", "pad 5 (bowed)", "pad 6 (metallic)",
  "pad 7 (halo)", "pad 8 (sweep)",
  "fx 1 (rain)", "fx 2 (soundtrack)", "fx 3 (crystal)", "fx 4 (atmosphere)", "fx 5 (brightness)",
  "fx 6 (goblins)", "fx 7 (echoes)", "fx 8 (sci-fi)",
  "sitar", "banjo", "shamisen", "koto", "kalimba", "bagpipe", "fiddle", "shanai",
  "tinkle bell", "agogo", "steel drums", "woodblock", "taiko drum", "melodic tom", "synth drum", "reverse cymbal",
  "guitar fret noise", "breath noise", "seashore", "bird tweet", "telephone ring", "helicopter", "applause",
  "gunshot",
];

/** What a track of a .mid is, from its program and channel: "distortion guitar", "drums (GM kit)". */
export function instrumentoGm(program: number | undefined, channel: number | undefined): string {
  if (channel === 9) return "drums (GM kit)";
  const p = Math.min(127, Math.max(0, Math.trunc(program ?? 0)));
  return PROGRAMAS_GM[p] ?? `program ${p}`;
}

/** Placeholder names the MIDI reader gives to unnamed tracks (workspace/herramientas/midi_lector.py). */
export function esNombreGenerico(nombre: string | undefined): boolean {
  const n = (nombre ?? "").trim();
  return n === "" || /^track \d+$/i.test(n);
}

/** Name for a track imported from a .mid: its own if it has one, otherwise the instrument. */
export function nombrePistaMidi(pista: { name?: string; program?: number; channel?: number }): string {
  if (!esNombreGenerico(pista.name)) return (pista.name ?? "").trim();
  const gm = pista.channel === 9 ? "drums" : instrumentoGm(pista.program, pista.channel);
  return gm.charAt(0).toUpperCase() + gm.slice(1);
}
