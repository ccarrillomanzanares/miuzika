/**
 * Kit de batería sampleado (generado en scripts/make-drums.ts).
 * Capas de velocidad + ligera variación de pitch por golpe.
 */

export interface DrumVoice {
  stop: () => void;
}

const FILES: Record<string, string[]> = {
  kick: ["kick-soft", "kick-hard"],
  snare: ["snare-soft", "snare-hard"],
  clap: ["clap-soft", "clap-hard"],
  hat: ["hat-soft", "hat-mid", "hat-hard"],
  hatOpen: ["hat-open"],
  tomLow: ["tom-low"],
  tomMid: ["tom-mid"],
  tomHigh: ["tom-high"],
  crash: ["crash"],
  ride: ["ride"],
  rim: ["rim"],
  cowbell: ["cowbell"],
};

const PITCH_TO_KEY: Record<number, string> = {
  35: "kick",
  36: "kick",
  37: "rim",
  38: "snare",
  40: "snare",
  39: "clap",
  42: "hat",
  44: "hat",
  46: "hatOpen",
  45: "tomLow",
  47: "tomMid",
  48: "tomHigh",
  49: "crash",
  57: "crash",
  51: "ride",
  59: "ride",
  56: "cowbell",
};

let kit: Map<string, AudioBuffer[]> | null = null;
let loading: Promise<void> | null = null;
let decodeContext: AudioContext | null = null;

export function isDrumKitReady(): boolean {
  return kit !== null;
}

export async function loadDrumKit(): Promise<void> {
  if (kit) return;
  if (loading) return loading;
  loading = (async () => {
    decodeContext ??= new AudioContext();
    const map = new Map<string, AudioBuffer[]>();
    for (const [key, names] of Object.entries(FILES)) {
      const buffers: AudioBuffer[] = [];
      for (const name of names) {
        try {
          const response = await fetch(`/drums/${name}.wav`);
          if (!response.ok) throw new Error(String(response.status));
          buffers.push(await decodeContext.decodeAudioData(await response.arrayBuffer()));
        } catch (error) {
          console.warn(`[drum-kit] no se pudo cargar ${name}.wav`, error);
        }
      }
      if (buffers.length > 0) map.set(key, buffers);
    }
    kit = map;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function playDrum(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  when: number,
  velocity: number,
): DrumVoice | null {
  const key = PITCH_TO_KEY[pitch];
  const buffers = key ? kit?.get(key) : undefined;
  if (!buffers || buffers.length === 0) return null;

  const level = Math.max(0.03, Math.min(1, velocity / 127));
  const index = Math.min(buffers.length - 1, Math.floor(level * buffers.length));
  const buffer = buffers[index]!;

  const source = context.createBufferSource();
  source.buffer = buffer;
  // Variación mínima para que no suene idéntico en cada golpe.
  source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.014;

  const gain = context.createGain();
  gain.gain.value = 0.18 + level * 0.82;
  source.connect(gain).connect(destination);

  source.onended = () => {
    try {
      gain.disconnect();
      source.disconnect();
    } catch {
      /* noop */
    }
  };
  source.start(when);
  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        /* ya parada */
      }
    },
  };
}
