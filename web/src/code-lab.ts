/** Editor Strudel: convierte un patrón en un WAV con el motor real. */

import { slugDe } from "../../src/core/nombres.ts";
import type { CodeSource, Project } from "../../src/core/types.ts";

export interface CodeAudioRequest {
  sourceId: string;
  name: string;
  code: string;
  bars: number;
}

interface CodeLabOptions {
  project: Project;
  onRenderAudio: (request: CodeAudioRequest) => Promise<void>;
}

const DEFAULT_CODE = `stack(
  s("bd ~ sd ~"),
  note("c2 e2 g2").s("sawtooth").slow(2)
)`;

const escapeAttr = (value: string): string =>
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

function slug(value: string): string {
  return slugDe(value, { separador: "_", max: 24, defecto: "strudel" });
}

export function openCodeLab(options: CodeLabOptions): void {
  const sources = options.project.codeSources ?? [];
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card code-card">
      <header>
        <div><strong>Strudel → WAV</strong><span>1 cycle = 1 bar · rendered with samples and effects</span></div>
        <button class="close" title="Close">×</button>
      </header>
      <div class="code-body">
        <div class="code-row">
          <label>Source
            <select class="code-source">
              <option value="">New source</option>
              ${sources.map((source) => `<option value="${escapeAttr(source.id)}">${escapeAttr(source.name)}</option>`).join("")}
            </select>
          </label>
          <label>Name
            <input class="code-name" maxlength="40" value="Strudel" />
          </label>
          <label>Bars
            <input class="code-bars" type="number" min="1" max="64" value="8" />
          </label>
        </div>
        <textarea class="code-editor" rows="12" spellcheck="false"></textarea>
        <div class="code-row code-help">
          <span>Example: <button class="code-example">load example</button></span>
          <span class="code-status">Write a pattern and press Render to WAV.</span>
        </div>
      </div>
      <footer>
        <span class="hint">The result is inserted as an audio track in the timeline.</span>
        <button class="render-audio">Render to WAV</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const sourceSelect = overlay.querySelector<HTMLSelectElement>(".code-source")!;
  const nameInput = overlay.querySelector<HTMLInputElement>(".code-name")!;
  const barsInput = overlay.querySelector<HTMLInputElement>(".code-bars")!;
  const editor = overlay.querySelector<HTMLTextAreaElement>(".code-editor")!;
  const status = overlay.querySelector<HTMLElement>(".code-status")!;
  const renderAudio = overlay.querySelector<HTMLButtonElement>(".render-audio")!;
  const example = overlay.querySelector<HTMLButtonElement>(".code-example")!;

  const fill = (source?: CodeSource): void => {
    nameInput.value = source?.name ?? "Strudel";
    barsInput.value = String(source?.bars ?? 8);
    editor.value = source?.code ?? DEFAULT_CODE;
    status.textContent = source
      ? "Saved source. Rendering replaces its audio track."
      : "Write a pattern and press Render to WAV.";
  };
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  sourceSelect.addEventListener("change", () => fill(sourceById.get(sourceSelect.value)));
  example.addEventListener("click", () => {
    editor.value = DEFAULT_CODE;
    status.textContent = "Example loaded.";
  });
  const lastSource = sources[sources.length - 1];
  fill(lastSource);
  if (lastSource) sourceSelect.value = lastSource.id;

  const close = () => overlay.remove();
  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  renderAudio.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const code = editor.value.trim();
    const bars = Number(barsInput.value);
    if (!name) {
      status.textContent = "Give the source a name.";
      return;
    }
    if (!Number.isInteger(bars) || bars < 1 || bars > 64) {
      status.textContent = "Bars must be a whole number between 1 and 64.";
      return;
    }
    if (!code) {
      status.textContent = "The code is empty.";
      return;
    }
    const sourceId = sourceSelect.value
      ? sourceSelect.value
      : `code_strudel_${slug(name)}`;
    renderAudio.disabled = true;
    status.textContent = "Rendering WAV with Strudel…";
    try {
      await options.onRenderAudio({ sourceId, name, code, bars });
      status.textContent = "WAV rendered and inserted as an audio track.";
    } catch (error) {
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      renderAudio.disabled = false;
    }
  });
}
