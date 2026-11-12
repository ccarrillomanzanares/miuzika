/**
 * Player for long stems via streaming.
 *
 * openDAW needs the whole audio in memory (AudioData), so with 10 six-minute
 * stems that is ~1.3 GB. Here each stem is an <audio> element that the browser
 * reads from the server in chunks (Range): RAM stays flat and many stems fit.
 *
 * It is only used for assets without a decoded AudioBuffer; short ones still go
 * through openDAW. The transport is driven by main.ts (play/stop/seek).
 */

import { segundosPorTiempo } from "../../src/core/tiempo.ts";

export interface StemDef {
  /** Unique key of the clip (asset + clip), so the element is not duplicated. */
  clave: string;
  /** URL that serves the WAV (/api/audio?path=...). */
  url: string;
  /** Clip start in beats. */
  startBeat: number;
  /** Clip length in beats. */
  lengthBeat: number;
  /** Offset inside the file, in beats. */
  offsetBeat: number;
  /** Clip + track gain in dB. */
  gainDb: number;
  /** -1..1, the track's. */
  pan: number;
}

interface Voz {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
  def: StemDef;
}

export class StemPlayer {
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  private voces = new Map<string, Voz>();
  private bpm = 100;
  private sonando = false;
  private masterDb = 0;

  constructor() {}

  /** Creates the audio context (must be called after a user gesture). */
  private asegurarContexto(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.maestro = this.ctx.createGain();
      this.maestro.gain.value = Math.pow(10, this.masterDb / 20);
      this.maestro.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Started and not stopped: the stems follow the beat they are given. */
  get activo(): boolean {
    return this.sonando;
  }

  get vocesActivas(): number {
    return this.voces.size;
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  /** The project's master gain: without it long stems sounded louder than the rest of the mix. */
  setMaster(gainDb: number): void {
    this.masterDb = gainDb;
    if (this.maestro) this.maestro.gain.value = Math.pow(10, gainDb / 20);
  }

  /** Replaces the list of stems (called when changing project or assets). */
  definir(stems: StemDef[]): void {
    for (const id of [...this.voces.keys()]) {
      if (!stems.some((def) => def.clave === id)) {
        this.quitar(id);
      }
    }
    for (const def of stems) {
      const voz = this.voces.get(def.clave);
      if (voz) {
        voz.def = def;
        voz.gain.gain.value = Math.pow(10, def.gainDb / 20);
        voz.panner.pan.value = def.pan;
        continue;
      }
      const ctx = this.asegurarContexto();
      const el = new Audio();
      // Note: crossOrigin AFTER src restarts the load in CORS mode and the
      // element stays at readyState 0. It is same-origin: not needed.
      el.preload = "auto";
      el.src = def.url;
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = Math.pow(10, def.gainDb / 20);
      const panner = ctx.createStereoPanner();
      panner.pan.value = def.pan;
      src.connect(gain).connect(panner).connect(this.maestro!);
      this.voces.set(def.clave, { el, src, gain, panner, def });
    }
  }

  /** Starts all the stems at the given beat. */
  async reproducir(beat: number): Promise<void> {
    if (this.voces.size === 0) return;
    this.asegurarContexto();
    this.sonando = true;
    const spb = segundosPorTiempo(this.bpm);
    for (const voz of this.voces.values()) {
      const { startBeat, lengthBeat, offsetBeat } = voz.def;
      const fin = startBeat + lengthBeat;
      if (beat >= fin) {
        voz.el.pause();
        continue;
      }
      const dentro = beat - startBeat;
      const desde = beat >= startBeat ? dentro + offsetBeat : offsetBeat;
      const limite = voz.el.duration || Infinity;
      const t = Math.min(Math.max(0, desde * spb), Math.max(0, limite - 0.01));
      try {
        voz.el.currentTime = t;
      } catch {
        /* the browser does not have metadata yet */
      }
      if (beat >= startBeat) {
        void voz.el.play().catch(() => {});
      } else {
        // not its turn yet: it starts when it is due (done by main.ts's tick)
        voz.el.pause();
      }
    }
  }

  /** Syncs the state with the current beat (called by the playback loop). */
  sincronizar(beat: number): void {
    if (!this.sonando) return;
    const spb = segundosPorTiempo(this.bpm);
    for (const voz of this.voces.values()) {
      const { startBeat, lengthBeat, offsetBeat } = voz.def;
      const fin = startBeat + lengthBeat;
      const debe = beat >= startBeat && beat < fin;
      if (debe && voz.el.paused) {
        try {
          voz.el.currentTime = Math.max(0, (beat - startBeat + offsetBeat) * spb);
        } catch {
          /* no metadata yet */
        }
        void voz.el.play().catch(() => {});
      } else if (!debe && !voz.el.paused) {
        voz.el.pause();
      }
      if (debe && !voz.el.paused) {
        // corrects drift if it goes over 120 ms
        const esperado = (beat - startBeat + offsetBeat) * spb;
        if (Math.abs(voz.el.currentTime - esperado) > 0.12) {
          try {
            voz.el.currentTime = esperado;
          } catch {
            /* nothing */
          }
        }
      }
    }
  }

  detener(): void {
    this.sonando = false;
    for (const voz of this.voces.values()) voz.el.pause();
  }

  /** Changes a clip's gain (for the faders). */
  setGanancia(clave: string, gainDb: number): void {
    const voz = this.voces.get(clave);
    if (voz) voz.gain.gain.value = Math.pow(10, gainDb / 20);
  }

  private quitar(clave: string): void {
    const voz = this.voces.get(clave);
    if (!voz) return;
    voz.el.pause();
    voz.el.src = "";
    voz.gain.disconnect();
    voz.panner.disconnect();
    voz.src.disconnect();
    this.voces.delete(clave);
  }

  liberar(): void {
    for (const id of [...this.voces.keys()]) this.quitar(id);
    void this.ctx?.close();
    this.ctx = null;
    this.maestro = null;
  }
}
