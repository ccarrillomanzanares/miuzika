/**
 * List of presets in a SoundFont (.sf2), reading only its `phdr` table.
 *
 * It is what the agent needs to choose an instrument by General MIDI program
 * ("29 Overdrive Guitar", "33 Finger Bass"). Without this list it started searching
 * for guitars by writing scripts that walked the sample catalog.
 *
 * Format (SoundFont 2.04): RIFF 'sfbk' → LIST 'pdta' → 'phdr', records of 38
 * bytes: name[20], preset u16, bank u16, and 14 bytes that are not needed here. The
 * last record ("EOP") marks the end and is not a preset.
 */

export interface PresetSf2 {
  nombre: string;
  programa: number;
  banco: number;
}

export function presetsDeSf2(datos: Uint8Array): PresetSf2[] {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const etiqueta = (pos: number): string => String.fromCharCode(...datos.subarray(pos, pos + 4));
  if (datos.byteLength < 12 || etiqueta(0) !== "RIFF" || etiqueta(8) !== "sfbk") {
    throw new Error("not a SoundFont 2 (missing the RIFF sfbk header)");
  }
  /** Searches for a sub-chunk inside [inicio, fin), entering LIST chunks. */
  const buscar = (inicio: number, fin: number, id: string): { pos: number; tam: number } | null => {
    let pos = inicio;
    while (pos + 8 <= fin) {
      const nombre = etiqueta(pos);
      const tam = vista.getUint32(pos + 4, true);
      if (nombre === id) return { pos: pos + 8, tam };
      if (nombre === "LIST") {
        const dentro = buscar(pos + 12, Math.min(fin, pos + 8 + tam), id);
        if (dentro) return dentro;
      }
      pos += 8 + tam + (tam % 2);
    }
    return null;
  };
  const phdr = buscar(12, datos.byteLength, "phdr");
  if (!phdr) throw new Error("the SoundFont has no preset table (phdr)");
  const presets: PresetSf2[] = [];
  for (let r = phdr.pos; r + 38 <= phdr.pos + phdr.tam; r += 38) {
    const crudo = datos.subarray(r, r + 20);
    const fin = crudo.indexOf(0);
    const nombre = new TextDecoder("latin1").decode(fin >= 0 ? crudo.subarray(0, fin) : crudo).trim();
    presets.push({ nombre, programa: vista.getUint16(r + 20, true), banco: vista.getUint16(r + 22, true) });
  }
  return presets.slice(0, -1); // drop the "EOP"
}

/** Compact text for the agent: instruments (bank 0) and drum kits (bank 128). */
export function textoDePresets(presets: readonly PresetSf2[]): string {
  const de = (banco: number): string =>
    presets
      .filter((p) => p.banco === banco)
      .sort((a, b) => a.programa - b.programa)
      .map((p) => `${p.programa} ${p.nombre}`)
      .join(" · ");
  return (
    `General MIDI instruments (program → name; use it as program=N):\n${de(0)}\n\n` +
    `Drum kits (program=N with drumkit instrument):\n${de(128)}`
  );
}
