/**
 * `npm run notas`            prints the notes left from the app that have not been read yet
 * `npm run notas -- --leidas` marks everything in the file as read
 *
 * Two steps on purpose: a note is marked only after what it says has been taken to ESTADO.md.
 */

import { FICHERO_NOTAS, leerNotas, marcarLeidas, notaLegible } from "../server/notas.ts";

if (process.argv.includes("--leidas")) {
  console.log(`${marcarLeidas()} note(s) marked as read (${FICHERO_NOTAS}).`);
} else {
  const { nuevas, total } = leerNotas();
  console.log(`${nuevas.length} new note(s) of ${total} (${FICHERO_NOTAS}).`);
  for (const linea of nuevas) console.log(`\n${notaLegible(linea)}`);
}
