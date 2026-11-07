/**
 * Is `ruta` the folder `raiz` itself or something under it? With the separator, so that
 * "proyectos/hard-copia" is not inside "proyectos/hard".
 *
 * Why: the 3-Nov review (§4) found the check written inline six times; the copy in
 * lambda.ts (files brought back from the instance) compared without the separator and
 * against workspace/ instead of the project, so a remote name like "../hard/proyecto.json"
 * would have overwritten another project.
 */

import { resolve, sep } from "node:path";

export function dentroDe(raiz: string, ruta: string, opciones: { incluirRaiz?: boolean } = {}): boolean {
  const base = resolve(raiz);
  const destino = resolve(ruta);
  if (destino === base) return opciones.incluirRaiz === true;
  return destino.startsWith(base.endsWith(sep) ? base : base + sep);
}
