/**
 * Safe names for folders, files, and ids.
 *
 * ONE single rule for the whole app (there used to be seven copies, with different
 * separators, lengths, and defaults). And for any alphabet: the old copies removed
 * everything outside `[a-z0-9]`, so "夜の歌", "Песня" or "أغنية" produced the
 * default slug and all those projects ended up in the SAME folder, overwriting
 * each other.
 *
 * What it does:
 *  - it removes Latin accents ("canción" → "cancion"), but NOT marks from other
 *    scripts (in Devanagari or Arabic they are part of the letter);
 *  - it lowercases (in the scripts that have case);
 *  - anything that is not a letter, number, or mark in any language becomes a
 *    separator.
 *
 * The result never contains `/`, `\`, `.`, `:` or anything that would allow
 * escaping a folder, so it works as a directory name as-is.
 */

export interface OpcionesSlug {
  /** Separator between words. Defaults to "-". */
  separador?: "-" | "_";
  /** Maximum length in characters (not bytes). Defaults to 48. */
  max?: number;
  /** What is returned if nothing remains. Defaults to "sin-nombre". */
  defecto?: string;
}

/** Removes Latin diacritics (U+0300..U+036F) and leaves the rest untouched. */
export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

/** Text for comparison: no Latin accents, lowercase, and single spaces. */
export function normalizarTexto(texto: string): string {
  return sinTildes(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

export function slugDe(texto: string, opciones: OpcionesSlug = {}): string {
  const separador = opciones.separador ?? "-";
  const max = opciones.max ?? 48;
  const limpio = normalizarTexto(texto)
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, separador)
    .replace(new RegExp(`\\${separador}{2,}`, "g"), separador)
    .replace(new RegExp(`^\\${separador}+|\\${separador}+$`, "g"), "");
  // Cut by code points, not UTF-16 units: it does not split an emoji or an
  // ideogram outside the basic plane.
  const cortado = Array.from(limpio).slice(0, max).join("").replace(new RegExp(`\\${separador}+$`), "");
  return cortado || (opciones.defecto ?? "sin-nombre");
}
