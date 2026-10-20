/** Timeline + piano roll en canvas con cabeceras fijas. */

import type { Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { audioAssets } from "./audio-store.ts";

const RULER = 26;
const ROW = 56;
const MIN_PX_PER_BEAT = 8;
const MAX_PX_PER_BEAT = 90;

const COLORS: Record<string, string> = {
  drumkit: "#e06c75",
  bass: "#61afef",
  pad: "#c678dd",
  chords: "#98c379",
  lead: "#e5c07b",
  arp: "#56b6c2",
  synth: "#98c379",
  soundfont: "#56b6c2",
  sampler: "#98c379",
};

const colorOf = (track: Track): string => COLORS[track.instrument.type] ?? "#8a8f9c";

export class TimelineView {
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly heads: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private project: Project | null = null;
  private width = 0;
  private height = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private pxPerBeat = 24;
  private beat = 0;
  private lastPlayheadX: number | null = null;
  private selected = new Set<string>();
  private anchor: string | null = null;

  onSeek: (beat: number) => void = () => {};
  onToggleMute: (trackId: string) => void = () => {};
  onToggleSolo: (trackId: string) => void = () => {};
  onSelectionChange: (trackIds: string[]) => void = () => {};
  onEditClip: (trackId: string, clipId: string) => void = () => {};

  constructor(canvas: HTMLCanvasElement, wrap: HTMLElement, heads: HTMLElement) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.heads = heads;
    this.ctx = canvas.getContext("2d")!;
    this.staticCanvas = document.createElement("canvas");
    this.staticCtx = this.staticCanvas.getContext("2d")!;

    this.canvas.addEventListener("click", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      this.onSeek(Math.max(0, x / this.pxPerBeat));
    });

    this.canvas.addEventListener("dblclick", (event) => {
      if (!this.project) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const index = Math.floor((y - RULER) / ROW);
      const track = this.project.tracks[index];
      if (!track) return;
      const beat = x / this.pxPerBeat;
      const clip = track.clips.find(
        (candidate) => !candidate.audio && beat >= candidate.start && beat < candidate.start + candidate.length,
      );
      if (clip) this.onEditClip(track.id, clip.id);
    });

    this.heads.addEventListener("click", (event) => {
      const element = event.target as HTMLElement;
      const target = element.closest("[data-track]") as HTMLElement | null;
      if (!target?.dataset.track) {
        this.clearSelection();
        return;
      }
      const trackId = target.dataset.track;
      if (element.closest(".mute")) {
        this.onToggleMute(trackId);
        return;
      }
      if (element.closest(".solo")) {
        this.onToggleSolo(trackId);
        return;
      }
      if (!this.project) return;
      const ids = this.project.tracks.map((track) => track.id);
      const index = ids.indexOf(trackId);
      if (index < 0) return;

      if (event.shiftKey && this.anchor) {
        const anchorIndex = ids.indexOf(this.anchor);
        if (anchorIndex >= 0) {
          const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
          this.selected = new Set(ids.slice(from, to + 1));
        }
      } else if (event.ctrlKey || event.metaKey) {
        if (this.selected.has(trackId)) this.selected.delete(trackId);
        else this.selected.add(trackId);
        this.anchor = trackId;
      } else {
        this.selected = new Set([trackId]);
        this.anchor = trackId;
      }
      this.emitSelection();
      this.renderHeads();
      this.renderStatic();
      this.draw(this.beat);
    });

    this.wrap.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const next = this.pxPerBeat * (event.deltaY > 0 ? 0.9 : 1.1);
        this.pxPerBeat = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, next));
        this.resize();
        this.renderStatic();
        this.draw(this.beat);
      },
      { passive: false },
    );

    new ResizeObserver(() => {
      this.resize();
      this.renderStatic();
      this.draw(this.beat);
    }).observe(this.wrap);
  }

  setProject(project: Project): void {
    this.project = project;
    this.beat = 0;
    this.pruneSelection();
    this.resize();
    this.renderHeads();
    this.renderStatic();
    this.draw(0);
    this.emitSelection();
  }

  /** Actualiza el proyecto sin resetear el playhead ni la selección (mute/solo en vivo). */
  refresh(project?: Project): void {
    if (project) this.project = project;
    this.pruneSelection();
    this.renderHeads();
    this.renderStatic();
    this.draw(this.beat);
    this.emitSelection();
  }

  getSelected(): string[] {
    return [...this.selected];
  }

  selectAll(): void {
    if (!this.project) return;
    this.selected = new Set(this.project.tracks.map((track) => track.id));
    this.anchor = this.project.tracks.at(-1)?.id ?? null;
    this.emitSelection();
    this.renderHeads();
    this.renderStatic();
    this.draw(this.beat);
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.anchor = null;
    this.emitSelection();
    this.renderHeads();
    this.renderStatic();
    this.draw(this.beat);
  }

  private pruneSelection(): void {
    if (!this.project) {
      this.selected.clear();
      this.anchor = null;
      return;
    }
    const ids = new Set(this.project.tracks.map((track) => track.id));
    for (const id of [...this.selected]) {
      if (!ids.has(id)) this.selected.delete(id);
    }
    if (this.anchor && !ids.has(this.anchor)) this.anchor = null;
  }

  private emitSelection(): void {
    this.onSelectionChange([...this.selected]);
  }

  draw(beat: number): void {
    this.beat = beat;
    const { ctx } = this;
    const x = Math.round(beat * this.pxPerBeat);

    if (this.lastPlayheadX === null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.staticCanvas, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    } else {
      this.restoreStrip(this.lastPlayheadX);
    }
    // Limpia también la posición nueva por si el salto es grande.
    this.restoreStrip(x);
    this.lastPlayheadX = x;

    ctx.fillStyle = "#ff5f6d";
    ctx.fillRect(x - 1, 0, 2, this.height);
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x + 6, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  /** Restaura solo la franja del playhead desde el canvas estático. */
  private restoreStrip(x: number): void {
    const left = Math.max(0, x - 10);
    const width = 22;
    const dpr = this.dpr;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(left * dpr, 0, width * dpr, this.canvas.height);
    ctx.drawImage(
      this.staticCanvas,
      left * dpr,
      0,
      width * dpr,
      this.canvas.height,
      left * dpr,
      0,
      width * dpr,
      this.canvas.height,
    );
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private resize(): void {
    const bars = this.project?.lengthBars ?? 16;
    const tracks = this.project?.tracks.length ?? 0;
    this.width = Math.max(this.wrap.clientWidth - 2, Math.ceil(bars * this.pxPerBeat * 4) + 32);
    this.height = RULER + Math.max(1, tracks) * ROW;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    for (const canvas of [this.canvas, this.staticCanvas]) {
      canvas.width = Math.floor(this.width * this.dpr);
      canvas.height = Math.floor(this.height * this.dpr);
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.staticCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private renderHeads(): void {
    if (!this.project) {
      this.heads.innerHTML = "";
      return;
    }
    const rows = this.project.tracks
      .map((track) => {
        const notes = track.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
        const classes = ["track-head"];
        if (track.muted) classes.push("muted");
        if (track.solo) classes.push("soloed");
        if (this.selected.has(track.id)) classes.push("selected");
        return `<div class="${classes.join(" ")}" data-track="${track.id}">
          <span class="dot" style="background:${colorOf(track)}"></span>
          <span class="track-meta">
            <strong>${escapeHtml(track.name)}</strong>
            <small>${track.instrument.type} · ${notes} n · ${track.devices.length} fx</small>
          </span>
          <span class="track-buttons">
            <span class="solo" title="Solo">S</span>
            <span class="mute" title="Mute">M</span>
          </span>
        </div>`;
      })
      .join("");
    this.heads.innerHTML = `<div class="ruler-spacer"></div>${rows}`;
  }

  private renderStatic(): void {
    const ctx = this.staticCtx;
    const project = this.project;
    this.lastPlayheadX = null;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#12141a";
    ctx.fillRect(0, 0, this.width, this.height);

    if (!project) {
      ctx.fillStyle = "#5d6270";
      ctx.font = "13px ui-sans-serif, system-ui";
      ctx.fillText("Sin proyecto. Pide una canción en el chat.", 20, RULER + 30);
      return;
    }

    const barBeats = beatsPerBar(project);
    const pxPerBar = this.pxPerBeat * barBeats;

    // Filas
    project.tracks.forEach((track, index) => {
      const top = RULER + index * ROW;
      ctx.fillStyle = this.selected.has(track.id)
        ? "#1a2030"
        : index % 2 === 0
          ? "#161922"
          : "#141720";
      ctx.fillRect(0, top, this.width, ROW);
      ctx.fillStyle = track.muted ? "#2a2d38" : "#1e2230";
      ctx.fillRect(0, top + ROW - 1, this.width, 1);
    });

    // Rejilla
    const totalBeats = project.lengthBars * barBeats;
    for (let beat = 0; beat <= totalBeats; beat++) {
      const x = beat * this.pxPerBeat;
      const isBar = beat % barBeats === 0;
      if (!isBar && pxPerBar < 48) continue;
      ctx.fillStyle = isBar ? "#2c3140" : "#20242e";
      ctx.fillRect(x, RULER, 1, this.height - RULER);
    }

    // Regla
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, 0, this.width, RULER);
    const barStep = pxPerBar >= 64 ? 1 : pxPerBar >= 32 ? 2 : 4;
    for (let bar = 0; bar <= project.lengthBars; bar += barStep) {
      const x = bar * pxPerBar + 3;
      ctx.fillStyle = "#7d8394";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(String(bar + 1), x, 17);
      ctx.fillStyle = "#2c3140";
      ctx.fillRect(bar * pxPerBar, 0, 1, RULER);
    }

    // Clips y notas
    project.tracks.forEach((track, index) => {
      const top = RULER + index * ROW;
      const color = colorOf(track);
      for (const clip of track.clips) {
        const x = clip.start * this.pxPerBeat;
        const width = Math.max(2, clip.length * this.pxPerBeat);
        ctx.fillStyle = withAlpha(color, track.muted ? 0.06 : 0.16);
        ctx.strokeStyle = withAlpha(color, track.muted ? 0.2 : 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 0.5, top + 4.5, width - 1, ROW - 9, 4);
        ctx.fill();
        ctx.stroke();

        if (width > 74) {
          ctx.fillStyle = withAlpha(color, 0.85);
          ctx.font = "10px ui-monospace, monospace";
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 4, top + 5, width - 8, 12);
          ctx.clip();
          ctx.fillText(clip.name, x + 5, top + 15);
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 1, top + 18, width - 2, ROW - 22);
        ctx.clip();

        if (clip.audio) {
          const asset = audioAssets.get(clip.audio.assetId);
          if (asset && asset.durationBeats > 0) {
            const areaTop = top + 18;
            const areaHeight = ROW - 22;
            const center = areaTop + areaHeight / 2;
            const half = areaHeight / 2 - 2;
            const startFraction = Math.max(0, clip.audio.offset / asset.durationBeats);
            const endFraction = Math.min(
              1,
              (clip.audio.offset + clip.length) / asset.durationBeats,
            );
            ctx.fillStyle = withAlpha(color, track.muted ? 0.25 : 0.75);
            const step = width > 600 ? 2 : 1;
            for (let pixel = 0; pixel < width; pixel += step) {
              const fraction =
                startFraction + (endFraction - startFraction) * (pixel / Math.max(1, width));
              const peak =
                asset.peaks[
                  Math.min(
                    asset.peaks.length - 1,
                    Math.max(0, Math.floor(fraction * asset.peaks.length)),
                  )
                ] ?? 0;
              const height = Math.max(1, peak * half);
              ctx.fillRect(x + pixel, center - height, step, height * 2);
            }
          }
        } else {
          ctx.fillStyle = withAlpha(color, track.muted ? 0.15 : 0.9);
          for (const note of clip.notes) {
            const noteX = (clip.start + note.start) * this.pxPerBeat;
            const noteWidth = Math.max(1.5, note.duration * this.pxPerBeat - 0.5);
            const pitch = Math.max(30, Math.min(96, note.pitch));
            const noteY = top + ROW - 6 - ((pitch - 30) / 66) * (ROW - 26);
            ctx.fillRect(noteX, noteY, noteWidth, 2.6);
          }
        }
        ctx.restore();
      }
    });
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
