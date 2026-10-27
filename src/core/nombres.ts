/**
 * Nombres seguros para carpetas, ficheros e ids.
 *
 * UNA sola regla para toda la app (antes había siete copias, con separadores,
 * longitudes y valores por defecto distintos). Y para cualquier alfabeto: las
 * copias viejas quitaban todo lo que no fuera `[a-z0-9]`, así que «夜の歌»,
 * «Песня» o «أغنية» daban el slug por defecto y todos esos proyectos acababan en
 * la MISMA carpeta, pisándose.
 *
 * Qué se hace:
 *  - se quitan las tildes latinas («canción» → «cancion»), pero NO las marcas de
 *    otras escrituras (en devanagari o árabe forman parte de la letra);
 *  - se pasa a minúsculas (en las escrituras que las tienen);
 *  - todo lo que no sea letra, número o marca de cualquier idioma pasa a separador.
 *
 * El resultado nunca lleva `/`, `\`, `.`, `:` ni nada que permita salir de una
 * carpeta, así que sirve tal cual como nombre de directorio.
 */

export interface OpcionesSlug {
  /** Separador entre palabras. Por defecto "-". */
  separador?: "-" | "_";
  /** Longitud máxima en caracteres (no en bytes). Por defecto 48. */
  max?: number;
  /** Lo que se devuelve si no queda nada. Por defecto "sin-nombre". */
  defecto?: string;
}

/** Quita los diacríticos latinos (U+0300..U+036F) y deja el resto intacto. */
export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

/** Texto para comparar: sin tildes latinas, minúsculas y espacios simples. */
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
  // Cortar por puntos de código, no por unidades UTF-16: no parte un emoji ni un
  // ideograma de fuera del plano básico.
  const cortado = Array.from(limpio).slice(0, max).join("").replace(new RegExp(`\\${separador}+$`), "");
  return cortado || (opciones.defecto ?? "sin-nombre");
}
