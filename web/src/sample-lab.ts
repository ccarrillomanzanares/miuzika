/** Panel para describir un sample, renderizarlo y escucharlo antes de insertarlo. */

import type { KeySignature } from "../../src/core/types.ts";
import type { SampleSpec } from "../../src/core/sample.ts";
import type { SampleResult } from "./sample-render.ts";
import { renderSample } from "./sample-render.ts";

export interface SampleInsert {
  result: SampleResult;
  trackName: string;
}

export interface SampleLabOptions {
  bpm: number;
  key: KeySignature;
  /** Nombres de pistas de audio existentes, para el desplegable. */
  tracks: string[];
  onInsert: (insert: SampleInsert) => void | Promise<void>;
}

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

export function openSampleLab(options: SampleLabOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card sample-card">
      <header>
        <div><strong>Sample Lab</strong><span>Describe el sonido; el motor lo renderiza.</span></div>
        <button class="close" title="Cerrar">×</button>
      </header>
      <div class="sample-body">
        <textarea class="sample-prompt" rows="2" placeholder="stab industrial metálico, kick oscuro para punk, riser de 2 compases, pad frío..."></textarea>
        <div class="sample-row">
          <select class="sample-kind" title="Formato del sample">
            <option value="one_shot">Sonido (one-shot)</option>
            <option value="loop">Loop</option>
          </select>
          <input class="sample-bars" type="number" min="1" max="8" value="2" title="Compases del loop" />
          <button class="design">Diseñar</button>
        </div>
        <div class="sample-row">
          <label class="sample-track-label">Pista
            <input class="sample-track" list="sample-track-list" value="Samples" title="Pista de destino (puedes escribir una nueva)" />
          </label>
          <datalist id="sample-track-list">
            ${options.tracks.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="sample-status">Escribe una idea y pulsa Diseñar.</div>
        <div class="sample-result" hidden>
          <div class="sample-name"></div>
          <audio class="sample-audio" controls></audio>
          <div class="sample-actions">
            <button class="download">Descargar WAV</button>
            <button class="insert">Insertar en el compás actual</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const prompt = overlay.querySelector<HTMLTextAreaElement>(".sample-prompt")!;
  const kind = overlay.querySelector<HTMLSelectElement>(".sample-kind")!;
  const bars = overlay.querySelector<HTMLInputElement>(".sample-bars")!;
  const trackInput = overlay.querySelector<HTMLInputElement>(".sample-track")!;
  const design = overlay.querySelector<HTMLButtonElement>(".design")!;
  const status = overlay.querySelector<HTMLElement>(".sample-status")!;
  const resultBox = overlay.querySelector<HTMLElement>(".sample-result")!;
  const nameEl = overlay.querySelector<HTMLElement>(".sample-name")!;
  const audio = overlay.querySelector<HTMLAudioElement>(".sample-audio")!;
  const download = overlay.querySelector<HTMLButtonElement>(".download")!;
  const insert = overlay.querySelector<HTMLButtonElement>(".insert")!;

  let current: SampleResult | null = null;
  let objectUrl: string | null = null;
  const controller = new AbortController();

  const close = () => {
    controller.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    overlay.remove();
  };

  const toggleBars = () => {
    bars.style.display = kind.value === "loop" ? "" : "none";
  };
  kind.addEventListener("change", toggleBars);
  toggleBars();

  design.addEventListener("click", async () => {
    const text = prompt.value.trim();
    if (!text) {
      status.textContent = "Escribe qué sonido quieres.";
      return;
    }
    design.disabled = true;
    insert.disabled = true;
    resultBox.hidden = true;
    status.textContent = "Diseñando…";

    try {
      const response = await fetch("/api/sample/design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          kind: kind.value,
          bars: Number(bars.value) || 2,
          bpm: options.bpm,
          key: options.key,
        }),
      });
      const data = (await response.json()) as { spec?: SampleSpec; model?: string; error?: string };
      if (!response.ok || !data.spec) throw new Error(data.error ?? `Error ${response.status}`);

      status.textContent = "Renderizando…";
      const rendered = await renderSample(data.spec, { projectBpm: options.bpm });
      current = rendered;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(rendered.blob);
      audio.src = objectUrl;
      const engine =
        rendered.spec.kind === "industrial"
          ? "macro impacto · "
          : rendered.spec.kind === "one_shot"
            ? "one-shot · "
            : "loop · ";
      nameEl.textContent = `${rendered.name} · ${engine}${rendered.durationBeats.toFixed(2)} beats · ${data.model ?? "LLM"}`;
      resultBox.hidden = false;
      insert.disabled = false;
      status.textContent = "Escúchalo. Si te vale, insértalo.";
    } catch (error) {
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      design.disabled = false;
    }
  });

  download.addEventListener("click", () => {
    if (!current || !objectUrl) return;
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${current.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "sample"}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });

  insert.addEventListener("click", async () => {
    if (!current) return;
    insert.disabled = true;
    status.textContent = "Insertando…";
    try {
      await options.onInsert({
        result: current,
        trackName: trackInput.value.trim() || "Samples",
      });
      close();
    } catch (error) {
      status.textContent = `Error al insertar: ${error instanceof Error ? error.message : String(error)}`;
      insert.disabled = false;
    }
  });

  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") close();
    },
    { signal: controller.signal },
  );
}
