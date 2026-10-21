/** Editor Strudel: compila patrones a pistas MIDI normales de miuzika. */

import type { CodeSource, Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { compileStrudelInWorker } from "./strudel-client.ts";
import type { StrudelCompileResult } from "./strudel-compiler.ts";

export interface CodeCompileRequest {
  sourceId: string;
  name: string;
  code: string;
  bars: number;
  result: StrudelCompileResult;
}

export interface CodeLabOptions {
  project: Project;
  onCompile: (request: CodeCompileRequest) => Promise<void>;
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
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "strudel"
  );
}

export function openCodeLab(options: CodeLabOptions): void {
  const sources = options.project.codeSources ?? [];
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card code-card">
      <header>
        <div><strong>Strudel → pistas</strong><span>1 ciclo = 1 compás · el código solo genera notas MIDI</span></div>
        <button class="close" title="Cerrar">×</button>
      </header>
      <div class="code-body">
        <div class="code-row">
          <label>Fuente
            <select class="code-source">
              <option value="">Nueva fuente</option>
              ${sources.map((source) => `<option value="${escapeAttr(source.id)}">${escapeAttr(source.name)}</option>`).join("")}
            </select>
          </label>
          <label>Nombre
            <input class="code-name" maxlength="40" value="Strudel" />
          </label>
          <label>Compases
            <input class="code-bars" type="number" min="1" max="64" value="8" />
          </label>
        </div>
        <textarea class="code-editor" rows="12" spellcheck="false"></textarea>
        <div class="code-row code-help">
          <span>Ejemplo: <button class="code-example">cargar ejemplo</button></span>
          <span class="code-status">Escribe un patrón y pulsa Compilar.</span>
        </div>
      </div>
      <footer>
        <span class="hint">Soporta note/n, s (bd/sd/sawtooth/square/sine…), gain, slow, fast, stack, seq, euclid. 1 ciclo = 1 compás.</span>
        <button class="compile apply">Compilar a pistas</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const sourceSelect = overlay.querySelector<HTMLSelectElement>(".code-source")!;
  const nameInput = overlay.querySelector<HTMLInputElement>(".code-name")!;
  const barsInput = overlay.querySelector<HTMLInputElement>(".code-bars")!;
  const editor = overlay.querySelector<HTMLTextAreaElement>(".code-editor")!;
  const status = overlay.querySelector<HTMLElement>(".code-status")!;
  const compile = overlay.querySelector<HTMLButtonElement>(".compile")!;
  const example = overlay.querySelector<HTMLButtonElement>(".code-example")!;

  const fill = (source?: CodeSource): void => {
    nameInput.value = source?.name ?? "Strudel";
    barsInput.value = String(source?.bars ?? 8);
    editor.value = source?.code ?? DEFAULT_CODE;
    status.textContent = source
      ? `Fuente guardada. Recompilar reemplaza sus pistas.`
      : "Escribe un patrón y pulsa Compilar.";
  };
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  sourceSelect.addEventListener("change", () => fill(sourceById.get(sourceSelect.value)));
  example.addEventListener("click", () => {
    editor.value = DEFAULT_CODE;
    status.textContent = "Ejemplo cargado.";
  });
  const lastSource = sources[sources.length - 1];
  fill(lastSource);
  if (lastSource) sourceSelect.value = lastSource.id;

  const close = () => overlay.remove();
  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  compile.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const code = editor.value.trim();
    const bars = Number(barsInput.value);
    if (!name) {
      status.textContent = "Pon un nombre a la fuente.";
      return;
    }
    if (!Number.isInteger(bars) || bars < 1 || bars > 64) {
      status.textContent = "Compases debe ser un entero entre 1 y 64.";
      return;
    }
    if (!code) {
      status.textContent = "El código está vacío.";
      return;
    }
    const sourceId = sourceSelect.value
      ? sourceSelect.value
      : `code_strudel_${slug(name)}`;
    compile.disabled = true;
    status.textContent = "Compilando en el worker…";
    try {
      const result = await compileStrudelInWorker(code, bars, beatsPerBar(options.project));
      if (result.groups.length === 0) {
        throw new Error(
          `No se generaron pistas. ${result.warnings.join(" ") || "¿Hay notas o sonidos reconocidos?"}`,
        );
      }
      await options.onCompile({ sourceId, name, code, bars, result });
      const notes = result.groups.reduce((sum, group) => sum + group.notes.length, 0);
      status.textContent = `Listo: ${result.groups.length} pista(s), ${notes} notas.`;
    } catch (error) {
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      compile.disabled = false;
    }
  });
}
