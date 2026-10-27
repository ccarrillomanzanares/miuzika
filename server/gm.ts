/**
 * Lista de presets de un SoundFont (.sf2), leyendo sólo su tabla `phdr`.
 *
 * Es lo que el agente necesita para elegir instrumento por programa General MIDI
 * («29 Overdrive Guitar», «33 Finger Bass»). Sin esta lista se puso a buscar
 * guitarras escribiendo scripts que recorrían el catálogo de samples.
 *
 * Formato (SoundFont 2.04): RIFF 'sfbk' → LIST 'pdta' → 'phdr', registros de 38
 * bytes: nombre[20], preset u16, banco u16, y 14 bytes que aquí no hacen falta. El
 * último registro («EOP») marca el final y no es un preset.
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
    throw new Error("no es un SoundFont 2 (falta la cabecera RIFF sfbk)");
  }
  /** Busca un sub-trozo dentro de [inicio, fin), entrando en las LIST. */
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
  if (!phdr) throw new Error("el SoundFont no tiene tabla de presets (phdr)");
  const presets: PresetSf2[] = [];
  for (let r = phdr.pos; r + 38 <= phdr.pos + phdr.tam; r += 38) {
    const crudo = datos.subarray(r, r + 20);
    const fin = crudo.indexOf(0);
    const nombre = new TextDecoder("latin1").decode(fin >= 0 ? crudo.subarray(0, fin) : crudo).trim();
    presets.push({ nombre, programa: vista.getUint16(r + 20, true), banco: vista.getUint16(r + 22, true) });
  }
  return presets.slice(0, -1); // fuera el «EOP»
}

/** Texto compacto para el agente: instrumentos (banco 0) y kits de batería (banco 128). */
export function textoDePresets(presets: readonly PresetSf2[]): string {
  const de = (banco: number): string =>
    presets
      .filter((p) => p.banco === banco)
      .sort((a, b) => a.programa - b.programa)
      .map((p) => `${p.programa} ${p.nombre}`)
      .join(" · ");
  return (
    `Instrumentos General MIDI (programa → nombre; úsalo como programa=N):\n${de(0)}\n\n` +
    `Kits de batería (programa=N con instrumento drumkit):\n${de(128)}`
  );
}
