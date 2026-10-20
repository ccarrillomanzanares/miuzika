/** Piano roll mínimo: añadir, mover y borrar notas de un clip. */

import type { Clip, Note } from "../../src/core/types.ts";

const MIN_PITCH = 36;
const MAX_PITCH = 84;
const ROWS = MAX_PITCH - MIN_PITCH + 1;
const ROW_HEIGHT = 11;
const PX_PER_BEAT = 84;
const STEP = 0.25;

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const quantize = (beat: number) => Math.round(beat / STEP) * STEP;

export function openPianoRoll(clip: Clip, onApply: (notes: Note[]) => void): void {
  const notes: Note[] = structuredClone(clip.notes);
  const width = Math.max(640, Math.ceil(clip.length * PX_PER_BEAT));
  const height = ROWS * ROW_HEIGHT;

  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card">
      <header>
        <div><strong>${escape(clip.name)}</strong><span>${clip.notes.length} notas · ${clip.length} beats</span></div>
        <button class="close" title="Cerrar">×</button>
      </header>
      <div class="modal-scroll"><canvas class="pr-canvas" width="${width}" height="${height}"></canvas></div>
      <footer>
        <span class="hint">Clic: añadir · arrastrar: mover · clic derecho: borrar</span>
        <button class="cancel">Cancelar</button>
        <button class="apply">Aplicar</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector<HTMLCanvasElement>(".pr-canvas")!;
  const context = canvas.getContext("2d")!;
  let dragging: { note: Note; offset: number } | null = null;

  const beatAt = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(clip.length, (event.clientX - rect.left) / PX_PER_BEAT));
  };

  const pitchAt = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const row = Math.floor((event.clientY - rect.top) / ROW_HEIGHT);
    return Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - row));
  };

  const findNote = (beat: number, pitch: number): Note | undefined =>
    notes.find(
      (note) =>
        note.pitch === pitch && beat >= note.start - 0.05 && beat <= note.start + note.duration + 0.05,
    );

  const draw = () => {
    context.fillStyle = "#0f1117";
    context.fillRect(0, 0, width, height);

    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const y = (MAX_PITCH - pitch) * ROW_HEIGHT;
      const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
      context.fillStyle = isBlack ? "#141822" : "#181c26";
      context.fillRect(0, y, width, ROW_HEIGHT);
      if (pitch % 12 === 0) {
        context.fillStyle = "#4d5364";
        context.font = "9px ui-monospace, monospace";
        context.fillText(`C${Math.floor(pitch / 12) - 1}`, 3, y + 8);
      }
    }

    const steps = Math.ceil(clip.length / STEP);
    for (let step = 0; step <= steps; step++) {
      const x = step * STEP * PX_PER_BEAT;
      const isBeat = step % 4 === 0;
      const isBar = step % 16 === 0;
      context.fillStyle = isBar ? "#394052" : isBeat ? "#2a303d" : "#1e2330";
      context.fillRect(x, 0, 1, height);
    }

    for (const note of notes) {
      const x = note.start * PX_PER_BEAT;
      const y = (MAX_PITCH - note.pitch) * ROW_HEIGHT;
      const noteWidth = Math.max(3, note.duration * PX_PER_BEAT - 1);
      context.fillStyle = note === dragging?.note ? "#ff8b96" : "#61afef";
      context.beginPath();
      context.roundRect(x, y + 1, noteWidth, ROW_HEIGHT - 2, 2);
      context.fill();
      context.fillStyle = "#0c0e13";
      context.font = "8px ui-monospace, monospace";
      if (noteWidth > 20) context.fillText(String(note.velocity), x + 3, y + 8);
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const beat = beatAt(event);
    const pitch = pitchAt(event);
    const existing = findNote(beat, pitch);
    if (existing) {
      dragging = { note: existing, offset: beat - existing.start };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* pointer sintético */
      }
      draw();
      return;
    }
    const note: Note = {
      pitch,
      start: Math.max(0, Math.min(clip.length - STEP, quantize(beat))),
      duration: STEP,
      velocity: 100,
    };
    notes.push(note);
    dragging = { note, offset: 0 };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* pointer sintético */
    }
    draw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const beat = beatAt(event);
    const pitch = pitchAt(event);
    const note = dragging.note;
    note.start = Math.max(0, Math.min(clip.length - STEP, quantize(beat - dragging.offset)));
    note.pitch = pitch;
    draw();
  });

  const release = () => {
    dragging = null;
    draw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const note = findNote(beatAt(event), pitchAt(event));
    if (!note) return;
    const index = notes.indexOf(note);
    if (index >= 0) notes.splice(index, 1);
    draw();
  });

  const close = () => overlay.remove();
  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.querySelector(".cancel")?.addEventListener("click", close);
  overlay.querySelector(".apply")?.addEventListener("click", () => {
    onApply(notes);
    close();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  draw();
}
