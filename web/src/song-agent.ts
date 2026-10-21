/** UI del agente de canción: crea un job, sigue el log y abre el bundle. */

export interface SongJobLog {
  at: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface SongJobView {
  id: string;
  status: "running" | "done" | "error";
  prompt: string;
  createdAt: string;
  updatedAt: string;
  logs: SongJobLog[];
  finalText: string;
  error?: string;
  bundle?: string;
  artifacts: Array<{ path: string; bytes: number }>;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(`Respuesta inválida del servidor (${response.status})`);
  }
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export async function startSongJob(prompt: string): Promise<SongJobView> {
  const response = await fetch("/api/song/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return readJson<SongJobView>(response);
}

export async function getSongJob(id: string): Promise<SongJobView> {
  const response = await fetch(`/api/song/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return readJson<SongJobView>(response);
}

export async function fetchSongArtifact(id: string, relative: string): Promise<Blob> {
  const response = await fetch(
    `/api/song/jobs/${encodeURIComponent(id)}/file?path=${encodeURIComponent(relative)}`,
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `No se pudo descargar ${relative}`);
  }
  return response.blob();
}

export interface SongAgentDialogOptions {
  onOpen: (job: SongJobView) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function openSongAgent(options: SongAgentDialogOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card song-agent-card">
      <header>
        <div><strong>Canción completa</strong><span>El agente escribe la composición y el worker Python la renderiza</span></div>
        <button class="close" title="Cerrar">×</button>
      </header>
      <div class="song-agent-body">
        <label>Qué quieres componer
          <textarea class="song-agent-prompt" rows="3" placeholder="industrial oscuro en do menor, 90 BPM, 140 compases, sin voz..."></textarea>
        </label>
        <div class="song-agent-row">
          <button class="start">Componer</button>
          <span class="song-agent-status">Listo para empezar.</span>
        </div>
        <div class="song-agent-artifacts"></div>
        <pre class="song-agent-log" aria-live="polite"></pre>
      </div>
      <footer>
        <span class="hint">El render completo tarda varios minutos y puede ocupar ~1 GB de stems en disco. No cierres la app.</span>
        <button class="open" disabled>Abrir proyecto</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);

  const promptInput = overlay.querySelector<HTMLTextAreaElement>(".song-agent-prompt")!;
  const startButton = overlay.querySelector<HTMLButtonElement>(".start")!;
  const openButton = overlay.querySelector<HTMLButtonElement>(".open")!;
  const status = overlay.querySelector<HTMLElement>(".song-agent-status")!;
  const log = overlay.querySelector<HTMLElement>(".song-agent-log")!;
  const artifacts = overlay.querySelector<HTMLElement>(".song-agent-artifacts")!;
  let job: SongJobView | null = null;
  let timer: number | null = null;
  let closed = false;

  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const close = () => {
    closed = true;
    stop();
    overlay.remove();
  };
  overlay.querySelector(".close")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  const render = (next: SongJobView): void => {
    job = next;
    status.textContent =
      next.status === "running"
        ? "Trabajando…"
        : next.status === "done"
          ? next.finalText || "Canción terminada."
          : `Error: ${next.error ?? next.finalText}`;
    log.textContent = next.logs
      .slice(-12)
      .map((entry) => `[${entry.ok ? "ok" : "err"}] ${entry.name}\n${entry.content}`)
      .join("\n\n");
    log.scrollTop = log.scrollHeight;
    artifacts.innerHTML = next.artifacts
      .filter((artifact) => /\.(wav|mid|zip)$/i.test(artifact.path))
      .slice(0, 12)
      .map(
        (artifact) =>
          `<span>${artifact.path} · ${formatBytes(artifact.bytes)}</span>`,
      )
      .join("");
    openButton.disabled = next.status !== "done" || !next.bundle;
    openButton.textContent = next.status === "done" ? "Abrir proyecto" : "Abrir proyecto";
  };

  const poll = async (id: string): Promise<void> => {
    if (closed) return;
    try {
      const next = await getSongJob(id);
      render(next);
      if (next.status === "running") {
        timer = window.setTimeout(() => void poll(id), 2_000);
      }
    } catch (error) {
      status.textContent = `Error consultando el job: ${error instanceof Error ? error.message : String(error)}`;
      timer = window.setTimeout(() => void poll(id), 4_000);
    }
  };

  startButton.addEventListener("click", async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      status.textContent = "Describe la canción.";
      return;
    }
    startButton.disabled = true;
    status.textContent = "Creando workspace…";
    log.textContent = "";
    artifacts.innerHTML = "";
    openButton.disabled = true;
    try {
      const created = await startSongJob(prompt);
      render(created);
      void poll(created.id);
    } catch (error) {
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
      startButton.disabled = false;
    }
  });

  openButton.addEventListener("click", async () => {
    if (!job?.bundle) return;
    openButton.disabled = true;
    status.textContent = "Abriendo proyecto…";
    try {
      await options.onOpen(job);
      status.textContent = "Proyecto abierto.";
      close();
    } catch (error) {
      status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
      openButton.disabled = false;
    }
  });
}
