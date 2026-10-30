/**
 * Stale bundle warning.
 *
 * When the dev server restarts (or code is edited with the tab open) HMR
 * disconnects and the page keeps running the old JavaScript **without saying
 * so**: on Oct 23 that made the agent call `crear_proyecto` against a version
 * that no longer existed, twelve times in a row.
 *
 * The server publishes an id (the newest `mtime` under web/), the tab compares it
 * every 20 s and, if it changes, warns. It does not reload on its own: a turn in
 * progress would be lost.
 */

const CADA_MS = 20_000;

async function idDelServidor(): Promise<string> {
  const res = await fetch("/api/build", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const datos = (await res.json()) as { id?: string };
  return String(datos.id ?? "");
}

/**
 * Watches the server id and calls `alCambiar` once if it detects a different one.
 * Returns the function to stop watching.
 */
export function vigilarVersion(alCambiar: () => void, cadaMs = CADA_MS): () => void {
  let inicial = "";
  let avisado = false;
  let parado = false;

  const comprobar = async (): Promise<void> => {
    if (parado || avisado) return;
    try {
      const id = await idDelServidor();
      if (id === "") return;
      if (inicial === "") {
        inicial = id;
        return;
      }
      if (id !== inicial) {
        avisado = true;
        alCambiar();
      }
    } catch {
      // Without a server there is nothing to compare; it retries on the next tick.
    }
  };

  void comprobar();
  const temporizador = window.setInterval(() => void comprobar(), cadaMs);
  return () => {
    parado = true;
    window.clearInterval(temporizador);
  };
}
