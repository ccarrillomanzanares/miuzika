/** Which workspace files the agent's file routes may not write or edit. */

import { relative, sep } from "node:path";

/** Files that make up the engine: rewriting them requires passing the smoke test. */
export const MOTOR = new Set(["dsp.py", "instruments.py", "render.py", "midi.py"]);

/**
 * herramientas/ and the non-engine files of codigo/ are run by the server itself
 * (smoke, manifest, peaks, voices, sfz_a_proyecto, analizar_referencia, the pad...).
 * Until 3-Nov the agent could edit them through /api/fs/write and /api/fs/edit and the
 * next server call ran its code outside the box (review 3-Nov, bug 2). The four engine
 * files stay editable: the smoke test guards them and since 3-Nov it runs in the box.
 * Checked on the resolved path, so "proyectos/x/../../herramientas" does not slip by.
 */
export function soloLecturaParaElAgente(destino: string, carpetaTrabajo: string): boolean {
  const rel = relative(carpetaTrabajo, destino).split(sep).join("/");
  if (rel.startsWith("../")) return false; // outside workspace: resolverEnTrabajo already refuses it
  if (rel === "herramientas" || rel.startsWith("herramientas/")) return true;
  if (rel.startsWith("codigo/")) {
    const resto = rel.slice("codigo/".length);
    return resto.includes("/") || !MOTOR.has(resto);
  }
  return false;
}
