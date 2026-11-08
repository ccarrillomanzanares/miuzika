/** What is selected in the timeline and what can be done with it: mute, solo, delete, copy, paste. */

import { beatsPerBar } from "../../src/core/types.ts";
import { applyOps } from "../../src/core/ops.ts";
import type { Op } from "../../src/core/ops.ts";
import type { TimelineView } from "./timeline.ts";
import type { Sesion } from "./sesion.ts";
import type { Avisos } from "./avisos.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const mensajeDe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class Seleccion {
  private pistas: string[] = [];
  private clips: string[] = [];
  /** References copied with Ctrl+C (they are pasted by duplicating the original). */
  private portapapeles: { trackId: string; clipId: string; start: number }[] = [];
  private readonly sesion: Sesion;
  private readonly timeline: TimelineView;
  private readonly avisos: Avisos;
  private readonly beatActual: () => number;

  constructor(d: { sesion: Sesion; timeline: TimelineView; avisos: Avisos; beatActual: () => number }) {
    this.sesion = d.sesion;
    this.timeline = d.timeline;
    this.avisos = d.avisos;
    this.beatActual = d.beatActual;
    d.timeline.onToggleMute = (trackId) => this.alternar([trackId], "muted");
    d.timeline.onToggleSolo = (trackId) => this.alternar([trackId], "solo");
    d.timeline.onSelectionChange = (ids) => {
      this.pistas = ids;
      this.pintarBarra();
    };
    d.timeline.onClipSelectionChange = (ids) => {
      this.clips = ids;
      this.pintarBarra();
    };
    d.timeline.onClipsDrop = (movimientos, copiar) => {
      if (!this.sesion.project || movimientos.length === 0) return;
      const ops: Op[] = movimientos.map((mov) => ({
        op: (copiar ? "duplicate_clip" : "move_clip") as "duplicate_clip" | "move_clip",
        trackId: mov.trackId,
        clipId: mov.clipId,
        startBeat: mov.startBeat,
        ...(mov.trackDestinoId ? { trackDestinoId: mov.trackDestinoId } : {}),
      }));
      this.aplicarOpsClips(ops, `${copiar ? "Copied" : "Moved"} ${ops.length} clip(s).`, copiar);
    };
    $("clip-copy").addEventListener("click", () => this.copiar());
    $("clip-paste").addEventListener("click", () => this.pegar());
    $("clip-dup").addEventListener("click", () => this.duplicar());
    $("sel-mute").addEventListener("click", () => this.alternar(this.pistas, "muted"));
    $("sel-solo").addEventListener("click", () => this.alternar(this.pistas, "solo"));
    $("sel-delete").addEventListener("click", () => this.borrarPistas());
    $("sel-all").addEventListener("click", () => d.timeline.selectAll());
    $("sel-clear").addEventListener("click", () => d.timeline.clearSelection());
  }

  /** Delete/Backspace: the clips if there are any selected, the tracks otherwise. */
  borrar(): boolean {
    if (this.clips.length > 0) {
      this.borrarClips();
      return true;
    }
    if (this.pistas.length === 0) return false;
    this.borrarPistas();
    return true;
  }

  pintarBarra(): void {
    const { project, ready, busy } = this.sesion;
    const elegidas = project?.tracks.filter((track) => this.pistas.includes(track.id)) ?? [];
    const clips = this.clips.length;
    const bar = $<HTMLElement>("selection-bar");
    bar.hidden = elegidas.length === 0 && clips === 0;
    const partes: string[] = [];
    if (elegidas.length > 0) partes.push(elegidas.length === 1 ? "1 track" : `${elegidas.length} tracks`);
    if (clips > 0) partes.push(clips === 1 ? "1 clip" : `${clips} clips`);
    $("selection-count").textContent = partes.join(" · ") || "0";
    const enabled = ready && !busy;
    $<HTMLButtonElement>("sel-mute").disabled = !enabled || elegidas.length === 0;
    $<HTMLButtonElement>("sel-solo").disabled = !enabled || elegidas.length === 0;
    $<HTMLButtonElement>("sel-delete").disabled = !enabled || elegidas.length === 0;
    $<HTMLButtonElement>("sel-all").disabled = !enabled || !project || project.tracks.length === 0;
    $<HTMLButtonElement>("sel-clear").disabled = elegidas.length === 0 && clips === 0;
    $<HTMLButtonElement>("clip-copy").disabled = !enabled || clips === 0;
    $<HTMLButtonElement>("clip-paste").disabled = !enabled || this.portapapeles.length === 0;
    $<HTMLButtonElement>("clip-dup").disabled = !enabled || clips === 0;
    // To MIDI (8-Nov): one audio track at a time.
    const aMidi = $<HTMLButtonElement>("sel-midi");
    const unaDeAudio = elegidas.length === 1 && elegidas[0]!.kind === "audio";
    aMidi.hidden = !unaDeAudio;
    aMidi.disabled = !enabled || !unaDeAudio;
  }

  /** The selected tracks' ids, in the timeline's order of selection. */
  pistasElegidas(): string[] {
    return [...this.pistas];
  }

  copiar(): void {
    const clips = this.clipsSeleccionados();
    if (clips.length === 0) return;
    this.portapapeles = clips.map(({ trackId, clipId, start }) => ({ trackId, clipId, start }));
    this.avisos.info(`Copied ${clips.length} clip(s). Ctrl+V pastes at the cursor.`);
    this.pintarBarra();
  }

  pegar(): void {
    const project = this.sesion.project;
    if (!project || this.portapapeles.length === 0) return;
    const base = Math.min(...this.portapapeles.map((item) => item.start));
    // sixteenth-note snap, same as dragging
    const destino = Math.round(this.beatActual() / 0.25) * 0.25;
    const ops: Op[] = this.portapapeles.map((item) => ({
      op: "duplicate_clip" as const,
      trackId: item.trackId,
      clipId: item.clipId,
      startBeat: Math.max(0, destino + (item.start - base)),
    }));
    this.aplicarOpsClips(ops, `Pasted ${ops.length} clip(s) at bar ${Math.floor(destino / beatsPerBar(project)) + 1}.`, true);
  }

  duplicar(): void {
    const clips = this.clipsSeleccionados();
    if (clips.length === 0) return;
    const ops: Op[] = clips.map((item) => ({
      op: "duplicate_clip" as const,
      trackId: item.trackId,
      clipId: item.clipId,
      startBeat: item.start + item.length,
    }));
    this.aplicarOpsClips(ops, `Duplicated ${ops.length} clip(s) right after.`, true);
  }

  private alternar(ids: string[], flag: "muted" | "solo"): void {
    const { project, busy } = this.sesion;
    if (!project || busy) return;
    const tracks = project.tracks.filter((track) => ids.includes(track.id));
    if (tracks.length === 0) return;
    const value = !tracks.every((track) => track[flag]);
    const ops: Op[] = tracks.map((track) =>
      flag === "muted" ? { op: "set_track", trackId: track.id, muted: value } : { op: "set_track", trackId: track.id, solo: value },
    );
    try {
      this.sesion.commitLive(applyOps(project, ops).project);
    } catch (error) {
      this.avisos.error(`Could not change ${flag}: ${mensajeDe(error)}`);
    }
  }

  private clipsSeleccionados(): { trackId: string; clipId: string; start: number; length: number }[] {
    const salida: { trackId: string; clipId: string; start: number; length: number }[] = [];
    for (const track of this.sesion.project?.tracks ?? []) {
      for (const clip of track.clips) {
        if (this.clips.includes(clip.id)) salida.push({ trackId: track.id, clipId: clip.id, start: clip.start, length: clip.length });
      }
    }
    return salida;
  }

  /** Applies clip ops and leaves whatever remains selected (the copies, if any). */
  private aplicarOpsClips(ops: Op[], mensaje: string, seleccionarNuevas: boolean): void {
    const project = this.sesion.project;
    if (!project || ops.length === 0) return;
    try {
      const antes = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
      const siguiente = applyOps(project, ops).project;
      this.sesion.commitLive(siguiente, true);
      if (seleccionarNuevas) {
        const nuevas = siguiente.tracks.flatMap((track) => track.clips.map((clip) => clip.id)).filter((id) => !antes.has(id));
        if (nuevas.length > 0) this.timeline.selectClips(nuevas);
      }
      this.avisos.info(mensaje);
    } catch (error) {
      this.avisos.error(`Could not: ${mensajeDe(error)}`);
    }
  }

  private borrarClips(): void {
    const ops: Op[] = this.clipsSeleccionados().map((item) => ({ op: "remove_clip" as const, trackId: item.trackId, clipId: item.clipId }));
    if (ops.length > 0) this.aplicarOpsClips(ops, `Deleted ${ops.length} clip(s).`, false);
  }

  private borrarPistas(): void {
    const { project, busy } = this.sesion;
    if (!project || busy) return;
    const tracks = project.tracks.filter((track) => this.pistas.includes(track.id));
    if (tracks.length === 0) return;
    const label = tracks.length === 1 ? `“${tracks[0]!.name}”` : `${tracks.length} tracks`;
    if (!confirm(`Delete ${label}?`)) return;
    const ops: Op[] = tracks.map((track) => ({ op: "remove_track", trackId: track.id }));
    try {
      this.sesion.setProject(applyOps(project, ops).project);
      this.avisos.info(`Deleted ${tracks.length} track(s): ${tracks.map((track) => `“${track.name}”`).join(", ")}.`);
    } catch (error) {
      this.avisos.error(`Could not delete: ${mensajeDe(error)}`);
    }
  }
}
