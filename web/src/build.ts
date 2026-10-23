/**
 * Aviso de «bundle viejo».
 *
 * Cuando el servidor de dev se reinicia (o se edita código con la pestaña
 * abierta) el HMR se desconecta y la página sigue ejecutando el JavaScript
 * antiguo **sin decirlo**: el 23-oct eso hizo que el agente llamara a
 * `crear_proyecto` contra una versión que ya no existía, doce veces seguidas.
 *
 * El servidor publica un id (`mtime` más nuevo de web/), la pestaña lo compara
 * cada 20 s y, si cambia, avisa. No recarga sola: un turno en marcha se
 * perdería.
 */

const CADA_MS = 20_000;

async function idDelServidor(): Promise<string> {
  const res = await fetch("/api/build", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const datos = (await res.json()) as { id?: string };
  return String(datos.id ?? "");
}

/**
 * Vigila el id del servidor y llama a `alCambiar` una sola vez si detecta otro.
 * Devuelve la función para dejar de vigilar.
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
      // Sin servidor no hay nada que comparar; se reintenta al siguiente tick.
    }
  };

  void comprobar();
  const temporizador = window.setInterval(() => void comprobar(), cadaMs);
  return () => {
    parado = true;
    window.clearInterval(temporizador);
  };
}
