/**
 * The file in generado/ a run named `nombre` could overwrite, or null. A run writes `<name>.wav` or, with several outputs,
 * `<name>-1.wav`, `<name>-2.wav` (ACE-Step, Stable Audio), `<name>-drums.wav`… (Demucs), `<name>-midi/` (MuLaCover), plus
 * `<name>.lineage.json`. Compared without case: NTFS does not tell `Toma.wav` from `toma.wav`. Code review of 9-Nov: the
 * exact, case-sensitive test let a run named `bajo` with 2 takes overwrite an existing take `bajo-1`. Stricter than
 * needed (an unrelated `bajo-final` also blocks `bajo`), which costs a rename, never a paid take.
 */
export function choqueDeNombre(ficheros: readonly string[], nombre: string): string | null {
  const base = nombre.toLowerCase();
  return ficheros.find((f) => {
    const n = f.toLowerCase();
    return n === `${base}.wav` || n === `${base}.lineage.json` || n.startsWith(`${base}-`);
  }) ?? null;
}
