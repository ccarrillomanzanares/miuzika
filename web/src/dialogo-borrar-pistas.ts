/**
 * The question before tracks are deleted, and with it whether their audio goes from disk too (bug 45: it was never
 * asked, and discarded takes piled up in the project folder). Audio, and the .mid a MIDI track was read from.
 *
 * Only the files that belong to those tracks alone are offered: one another track still plays is not in the list.
 * The box starts unticked, so Enter deletes the tracks and keeps the files, as before this question existed.
 */

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const tamano = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const MAX_LISTA = 12;

/** Resolves to null on Cancel or Esc; otherwise whether the files go too. */
export function preguntarBorrarPistas(d: { pistas: string[]; ficheros: { ruta: string; bytes: number }[] }): Promise<{ conFicheros: boolean } | null> {
  return new Promise((resolver) => {
    const una = d.pistas.length === 1;
    const bytes = d.ficheros.reduce((n, f) => n + f.bytes, 0);
    const resto = d.ficheros.length - MAX_LISTA;
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo proyectos-borrado";
    dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>Delete ${una ? `“${esc(d.pistas[0]!)}”` : `${d.pistas.length} tracks`}?</strong></div>
      ${una ? "" : `<ul>${d.pistas.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`}
      ${
        d.ficheros.length > 0
          ? `<label><input type="checkbox" data-con-ficheros><span>Also delete ${una ? "its" : "their"} files from disk: ${d.ficheros.length} file(s), ${tamano(bytes)}
               <small>Unticked, the files stay in the project folder and Ctrl+Z brings ${una ? "the track" : "the tracks"} back. Ticked, it cannot be undone: the files are gone and the undo history is cleared.</small></span></label>
             <ul>${d.ficheros.slice(0, MAX_LISTA).map((f) => `<li>${esc(f.ruta)} · ${tamano(f.bytes)}</li>`).join("")}${resto > 0 ? `<li>and ${resto} more</li>` : ""}</ul>`
          : `<p><small>No file on disk is known to belong to ${una ? "this track" : "these tracks"} alone: nothing to delete from the folder.</small></p>`
      }
      <div class="dialogo-acciones"><button type="button" data-no>Cancel</button><button type="button" class="primario" data-si>Delete</button></div>`;
    document.body.append(dialogo);
    let respuesta: { conFicheros: boolean } | null = null;
    dialogo.querySelector("[data-no]")!.addEventListener("click", () => dialogo.close());
    dialogo.querySelector("[data-si]")!.addEventListener("click", () => {
      respuesta = { conFicheros: dialogo.querySelector<HTMLInputElement>("[data-con-ficheros]")?.checked === true };
      dialogo.close();
    });
    dialogo.addEventListener("close", () => {
      dialogo.remove();
      resolver(respuesta);
    });
    dialogo.showModal();
    dialogo.querySelector<HTMLButtonElement>("[data-si]")!.focus();
  });
}
