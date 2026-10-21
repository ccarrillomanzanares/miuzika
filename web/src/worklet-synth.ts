/** Carga y control del sintetizador AudioWorklet. */

const MODULE_URL = "/worklets/synth-processor.js?v=3";
const loaded = new WeakSet<BaseAudioContext>();

export type SynthPreset = "bass" | "lead" | "pad" | "arp" | "synth";

export interface WorkletNote {
  note: number;
  velocity: number;
  startAt: number;
  duration: number;
}

export async function prepareSynth(context: BaseAudioContext): Promise<boolean> {
  if (loaded.has(context)) return true;
  try {
    await context.audioWorklet.addModule(MODULE_URL);
    loaded.add(context);
    return true;
  } catch (error) {
    console.warn("[synth] AudioWorklet no disponible; se usa el sintetizador de respaldo", error);
    return false;
  }
}

export interface WorkletOptions {
  notes?: WorkletNote[];
  /** Variación de timbre determinista por canción/pista. */
  variant?: number;
}

export class WorkletInstrument {
  readonly node: AudioWorkletNode;

  constructor(context: BaseAudioContext, preset: SynthPreset, options: WorkletOptions = {}) {
    this.node = new AudioWorkletNode(context, "miuzika-synth", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        preset,
        variant: options.variant ?? 0,
        ...(options.notes ? { notes: options.notes } : {}),
      },
    });
  }

  connect(destination: AudioNode): void {
    this.node.connect(destination);
  }

  note(pitch: number, velocity: number, startAt: number, duration: number): void {
    this.node.port.postMessage({
      type: "note",
      note: pitch,
      velocity: velocity / 127,
      startAt,
      duration,
    });
  }

  dispose(): void {
    try {
      this.node.port.postMessage({ type: "allOff" });
      this.node.disconnect();
    } catch {
      /* noop */
    }
  }
}

export function presetFor(type: string): SynthPreset {
  switch (type) {
    case "bass":
      return "bass";
    case "pad":
      return "pad";
    case "arp":
      return "arp";
    case "lead":
      return "lead";
    default:
      return "synth";
  }
}
