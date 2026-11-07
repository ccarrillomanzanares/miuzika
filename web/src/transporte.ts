/**
 * Play and stop: openDAW for what is decoded, <audio> for the long stems that do not fit
 * its memory budget, both following the same clock.
 */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { audioAssets, hidratarAssets, rutaEnProyecto } from "./audio-store.ts";
import { cargarGm, cargarSoundfontsDelProyecto } from "./sonidos-proyecto.ts";
import { StemPlayer } from "./stem-player.ts";
import { stemsDeProyecto } from "./stems.ts";
import type { OpenDawPlaybackHandle } from "./opendaw-engine.ts";
import type { TimelineView } from "./timeline.ts";
import type { Sesion } from "./sesion.ts";
import type { Avisos } from "./avisos.ts";

export class Transporte {
  readonly stems = new StemPlayer();
  private handle: OpenDawPlaybackHandle | null = null;
  private generation = 0;
  /** Tracks already warned about, so that each Play does not repeat it. */
  private avisadosSinEfectos = new Set<string>();
  private readonly sesion: Sesion;
  private readonly timeline: TimelineView;
  private readonly avisos: Avisos;
  private readonly pintarPlay: (sonando: boolean) => void;
  private readonly avisarFaltan: (faltan: string[]) => void;

  constructor(d: {
    sesion: Sesion;
    timeline: TimelineView;
    avisos: Avisos;
    pintarPlay: (sonando: boolean) => void;
    avisarFaltan: (faltan: string[]) => void;
  }) {
    this.sesion = d.sesion;
    this.timeline = d.timeline;
    this.avisos = d.avisos;
    this.pintarPlay = d.pintarPlay;
    this.avisarFaltan = d.avisarFaltan;
  }

  get beat(): number {
    return this.handle?.beat ?? this.timeline.currentBeat;
  }

  get sonando(): boolean {
    return this.handle?.isPlaying === true;
  }

  /** For debugging from the console. */
  get motor(): OpenDawPlaybackHandle | null {
    return this.handle;
  }

  seek(beat: number): void {
    this.handle?.seek(beat);
  }

  syncMix(view: Project): void {
    this.handle?.syncMix(view);
  }

  /** The project was replaced: nothing that was sounding can keep sounding. */
  detenerPorCambio(): void {
    if (this.handle) this.detener();
    else this.generation++;
    this.pintarPlay(false);
  }

  detener(): void {
    this.stems.detener();
    this.generation++;
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      try {
        handle.stop();
      } catch {
        /* already stopped */
      }
    }
    this.pintarPlay(false);
  }

  /** Prepares the streaming stems of the project (the ones that do not go through openDAW). */
  sincronizarStems(vista: Project | null): void {
    if (!vista) {
      this.stems.definir([]);
      return;
    }
    this.stems.setBpm(vista.bpm);
    this.stems.setMaster(vista.master.gainDb);
    const slug = carpetaDeProyecto(vista);
    const stems = stemsDeProyecto(vista, audioAssets);
    this.stems.definir(stems.map((stem) => ({ ...stem, url: `/api/audio?path=${encodeURIComponent(rutaEnProyecto(stem.src, slug))}` })));
    for (const stem of stems) {
      if (!stem.sinSusEfectos || this.avisadosSinEfectos.has(stem.nombrePista)) continue;
      this.avisadosSinEfectos.add(stem.nombrePista);
      this.avisos.error(`“${stem.nombrePista}” is too long for the engine's memory: it plays and exports with its gain and pan, but without its effects and sends.`);
    }
  }

  /** From the cursor; from the start if the cursor is at the end, where the last Play stopped. */
  async reproducir(view: Project): Promise<void> {
    const endBeat = view.lengthBars * beatsPerBar(view);
    const cursor = this.beat;
    const desdeBeat = cursor >= endBeat - 0.05 ? 0 : cursor;
    if (this.handle) this.detener();
    this.timeline.draw(desdeBeat);
    const generation = ++this.generation;
    this.sesion.setBusy(true, "Loading WAVs and starting openDAW…");
    try {
      const { faltan } = await hidratarAssets(view, carpetaDeProyecto(view));
      this.avisarFaltan(faltan);
      const { playWithOpenDaw } = await import("./opendaw-engine.ts");
      // openDAW only receives what is decoded; long stems are handled separately.
      const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
      for (const [id, asset] of audioAssets) {
        if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
      }
      const soundfonts = await cargarSoundfontsDelProyecto(view);
      const gm = await cargarGm(view, (t) => this.avisos.info(t), (t) => this.sesion.setBusy(true, t));
      const handle = await playWithOpenDaw(
        view,
        (beat) => {
          // An engine that was stopped while starting has no say over the cursor.
          if (generation !== this.generation) return;
          this.timeline.draw(beat);
          this.stems.sincronizar(beat);
          if (this.handle && beat >= endBeat - 0.05) this.detener();
        },
        paraEngine,
        soundfonts,
        gm,
        { desdeBeat, cancelado: () => generation !== this.generation },
      );
      if (generation !== this.generation) {
        handle.stop();
        return;
      }
      this.handle = handle;
      this.pintarPlay(true);
      await this.stems.reproducir(desdeBeat);
    } catch (error) {
      if (generation !== this.generation) return;
      this.pintarPlay(false);
      this.avisos.error(`Could not start the openDAW engine: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sesion.setBusy(false);
    }
  }
}
