/**
 * A notice in a small window with "Don't show this again" (8-Nov-2026, Carlos on the MIDI export that leaves audio tracks
 * out: "tiene que informar… y un check de no volver a aparecer"). Ticked, the window does not open again for that notice in
 * this browser; the caller still writes the Log line, so nothing goes unsaid.
 */

const CLAVE = "miuzika-avisos-ocultos";

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function ocultos(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function avisoOculto(id: string): boolean {
  return ocultos().has(id);
}

/** Opens the notice unless it was hidden; resolves when it is closed. */
export function mostrarAviso(id: string, titulo: string, texto: string): Promise<void> {
  if (avisoOculto(id)) return Promise.resolve();
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo";
    dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>${esc(titulo)}</strong></div>
      <p>${esc(texto)}</p>
      <div class="dialogo-acciones" style="justify-content: space-between; align-items: center">
        <label style="display:flex; gap:6px; align-items:center"><input type="checkbox" data-ocultar> Don't show this again</label>
        <button type="button" class="primario" data-cerrar>OK</button>
      </div>`;
    document.body.append(dialogo);
    dialogo.addEventListener("close", () => {
      if (dialogo.querySelector<HTMLInputElement>("[data-ocultar]")?.checked) {
        const s = ocultos();
        s.add(id);
        try {
          localStorage.setItem(CLAVE, JSON.stringify([...s]));
        } catch {
          // Full storage: the notice will simply show again.
        }
      }
      dialogo.remove();
      resolver();
    });
    dialogo.querySelector("[data-cerrar]")!.addEventListener("click", () => dialogo.close());
    dialogo.showModal();
  });
}
