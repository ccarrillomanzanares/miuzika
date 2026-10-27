/**
 * Reproductor de stems largos por streaming.
 *
 * openDAW necesita el audio entero en memoria (AudioData), asi que con 10 stems
 * de 6 minutos se van ~1,3 GB. Aqui cada stem es un <audio> que el navegador lee
 * del servidor por trozos (Range): la RAM se queda plana y caben muchos stems.
 *
 * Se usa solo para assets sin AudioBuffer decodificado; los cortos siguen por
 * openDAW. El transporte lo manda main.ts (play/stop/seek).
 */

export interface StemDef {
  /** Clave unica del clip (asset + clip), para no duplicar el elemento. */
  clave: string;
  /** URL que sirve el WAV (/api/audio?path=...). */
  url: string;
  /** Inicio del clip en beats. */
  startBeat: number;
  /** Duracion del clip en beats. */
  lengthBeat: number;
  /** Desplazamiento dentro del fichero, en beats. */
  offsetBeat: number;
  /** Ganancia del clip en dB. */
  gainDb: number;
}

interface Voz {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  def: StemDef;
}

export class StemPlayer {
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  private voces = new Map<string, Voz>();
  private bpm = 100;
  private sonando = false;

  constructor() {}

  /** Crea el contexto de audio (hay que llamarlo tras un gesto del usuario). */
  private asegurarContexto(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.maestro = this.ctx.createGain();
      this.maestro.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get vocesActivas(): number {
    return this.voces.size;
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  /** Reemplaza la lista de stems (se llama al cambiar de proyecto o de assets). */
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
        continue;
      }
      const ctx = this.asegurarContexto();
      const el = new Audio();
      // Ojo: crossOrigin DESPUES de src reinicia la carga en modo CORS y el
      // elemento se queda en readyState 0. Es mismo origen: no hace falta.
      el.preload = "auto";
      el.src = def.url;
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = Math.pow(10, def.gainDb / 20);
      src.connect(gain).connect(this.maestro!);
      this.voces.set(def.clave, { el, src, gain, def });
    }
  }

  /** Arranca todos los stems en el beat indicado. */
  async reproducir(beat: number): Promise<void> {
    if (this.voces.size === 0) return;
    this.asegurarContexto();
    this.sonando = true;
    const spb = 60 / this.bpm;
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
        /* el navegador aun no tiene metadatos */
      }
      if (beat >= startBeat) {
        void voz.el.play().catch(() => {});
      } else {
        // aun no le toca: se arranca cuando llegue (lo hace el tick de main.ts)
        voz.el.pause();
      }
    }
  }

  /** Sincroniza el estado con el beat actual (lo llama el bucle de reproduccion). */
  sincronizar(beat: number): void {
    if (!this.sonando) return;
    const spb = 60 / this.bpm;
    for (const voz of this.voces.values()) {
      const { startBeat, lengthBeat, offsetBeat } = voz.def;
      const fin = startBeat + lengthBeat;
      const debe = beat >= startBeat && beat < fin;
      if (debe && voz.el.paused) {
        try {
          voz.el.currentTime = Math.max(0, (beat - startBeat + offsetBeat) * spb);
        } catch {
          /* sin metadatos todavia */
        }
        void voz.el.play().catch(() => {});
      } else if (!debe && !voz.el.paused) {
        voz.el.pause();
      }
      if (debe && !voz.el.paused) {
        // corrige deriva si se va mas de 120 ms
        const esperado = (beat - startBeat + offsetBeat) * spb;
        if (Math.abs(voz.el.currentTime - esperado) > 0.12) {
          try {
            voz.el.currentTime = esperado;
          } catch {
            /* nada */
          }
        }
      }
    }
  }

  detener(): void {
    this.sonando = false;
    for (const voz of this.voces.values()) voz.el.pause();
  }

  /** Cambia la ganancia de un clip (para los faders). */
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
