/**
 * Text for a child process that failed without printing anything.
 *
 * Why: on 2-Nov night the dev server had been started from a shell whose Python children
 * all died with Windows exit 0xC0000142 (DLL init failed) and empty stderr. The routes pass
 * stderr on as the error, so the agent saw "Could not convert: " with nothing after it and
 * guessed. With the exit code it would have been obvious that Python itself did not start.
 */
export function explicarFalloMudo(codigo: number | null, salida: string, errores: string): string {
  if (codigo === 0 || errores.trim() !== "" || salida.trim() !== "") return errores;
  if (codigo === null) return "[miuzika] the process was cut off and printed nothing";
  const hex = `0x${(codigo >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  const pista =
    hex === "0xC0000142"
      ? ": Python could not start (Windows DLL init failed). Restart `npm run dev` from a normal terminal."
      : "";
  return `[miuzika] the process exited with code ${codigo} (${hex}) and printed nothing${pista}`;
}
