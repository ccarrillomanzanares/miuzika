/** Write a file, check it and, if the check fails, leave the disk exactly as it was. */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Comprobacion = { ok: boolean; detalle: string };

/**
 * One copy of the "write, check, roll back" rule for the engine (smoke test) and gpu/
 * (ast.parse). The previous content is read whenever the file exists: on 3-Nov the
 * review found that gpu/ read it only for the four engine names, so a gpu/ edit that
 * did not parse wrote "" and then deleted generar_audio.py or proponer_midi.py.
 */
export async function escribirComprobando(
  destino: string,
  contenido: string,
  comprobar: () => Promise<Comprobacion>,
): Promise<Comprobacion> {
  const previo = existsSync(destino) ? readFileSync(destino, "utf8") : null;
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido, "utf8");
  let resultado: Comprobacion;
  try {
    resultado = await comprobar();
  } catch (error) {
    resultado = { ok: false, detalle: error instanceof Error ? error.message : String(error) };
  }
  if (!resultado.ok) {
    if (previo !== null) writeFileSync(destino, previo, "utf8");
    else if (existsSync(destino)) unlinkSync(destino);
  }
  return resultado;
}
