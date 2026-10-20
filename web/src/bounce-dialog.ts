/** Diálogo para elegir qué pistas MIDI se convierten a audio. */

import type { Track } from "../../src/core/types.ts";

export interface BounceDialogOptions {
  tracks: Track[];
  onConvert: (trackIds: string[]) => void;
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

export function openBounceDialog(options: BounceDialogOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";

  const rows = options.tracks
    .map((track) => {
      return `<label class="bounce-row">
        <input type="checkbox" value="${escape(track.id)}" checked />
        <span>${escape(track.name)}</span>
        <small>${escape(track.instrument.type)}</small>
      </label>`;
    })
    .join("");

  overlay.innerHTML = `
    <div class="modal-card bounce-card">
      <header>
        <div><strong>Convertir a samples</strong><span>Cada pista se renderiza con sus FX y se sustituye por un clip de audio.</span></div>
        <button class="close" title="Cerrar">×</button>
      </header>
      <div class="bounce-body">
        <div class="bounce-toolbar">
          <button type="button" class="select-all">Todas</button>
          <button type="button" class="select-none">Ninguna</button>
        </div>
        <div class="bounce-list">${rows}</div>
        <div class="bounce-status"></div>
        <div class="bounce-actions">
          <button class="cancel">Cancelar</button>
          <button class="convert">Convertir seleccionadas</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const boxes = () =>
    [...overlay.querySelectorAll<HTMLInputElement>('.bounce-row input[type="checkbox"]')];
  const status = overlay.querySelector<HTMLElement>(".bounce-status")!;
  const updateCount = () => {
    const selected = boxes().filter((box) => box.checked).length;
    status.textContent = `${selected} de ${boxes().length} pistas seleccionadas. Las no marcadas siguen en MIDI.`;
  };
  boxes().forEach((box) => box.addEventListener("change", updateCount));
  updateCount();

  overlay.querySelector(".select-all")?.addEventListener("click", () => {
    boxes().forEach((box) => (box.checked = true));
    updateCount();
  });
  overlay.querySelector(".select-none")?.addEventListener("click", () => {
    boxes().forEach((box) => (box.checked = false));
    updateCount();
  });

  const close = () => overlay.remove();
  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.querySelector(".cancel")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  overlay.querySelector(".convert")?.addEventListener("click", () => {
    const ids = boxes()
      .filter((input) => input.checked)
      .map((input) => input.value);
    if (ids.length === 0) {
      status.textContent = "Marca al menos una pista.";
      return;
    }
    close();
    options.onConvert(ids);
  });
}
