/** Reproductor de previsualización: WebAudio puro, sin openDAW/WASM. */

import type { Clip, Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { audioAssets } from "./audio-store.ts";
import { buildBusChain, buildMasterChain, buildTrackChain } from "./fx.ts";
import type { BusChain, MasterChain, TrackChain } from "./fx.ts";
import { createNoiseBuffer, playInstrumentNote } from "./synth.ts";
import type { VoiceHandle } from "./synth.ts";
import { isSynthReady, prepareSynth, presetFor, WorkletInstrument } from "./worklet-synth.ts";
import { hashString } from "../../src/core/rng.ts";

interface Event {
  kind: "note" | "audio";
  beat: number;
  duration: number;
  pitch: number;
  velocity: number;
  track: Track;
  clip?: Clip;
  offsetBeats?: number;
}

const dbToGain = (db: number) => 10 ** (db / 20);

export class PreviewPlayer {
  private context: AudioContext | null = null;
  private events: Event[] = [];
  private index = 0;
  private startBeat = 0;
  private startTime = 0;
  private secondsPerBeat = 0.5;
  private endBeat = 0;
  private timer: number | null = null;
  private frame: number | null = null;
  private readonly voices = new Set<VoiceHandle>();
  private readonly pending: Array<{ endsAt: number; bus: GainNode; voice: VoiceHandle }> = [];
  private readonly muteGains = new Map<string, GainNode>();
  private readonly synths = new Map<string, WorkletInstrument>();
  private chains: Array<MasterChain | BusChain | TrackChain> = [];
  private noise: AudioBuffer | null = null;
  private playing = false;
  private lastBeat = 0;
  private readonly perTrack = new Map<string, AudioNode>();

  onTick: (beat: number) => void = () => {};
  onEnd: () => void = () => {};

  get isPlaying(): boolean {
    return this.playing;
  }

  get beat(): number {
    return this.playing ? this.currentBeat() : this.lastBeat;
  }

  /** Voces vivas: sirve para detectar fugas. */
  get activeVoices(): number {
    return this.voices.size;
  }

  /** Mute inmediato durante la reproducción (fade de 12 ms). */
  setTrackMuted(trackId: string, muted: boolean): void {
    const gain = this.muteGains.get(trackId);
    if (!gain || !this.context) return;
    gain.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.012);
  }

  /** Crea el contexto y carga el sintetizador en segundo plano. */
  async prepare(): Promise<void> {
    const context = (this.context ??= new AudioContext({ latencyHint: "balanced" }));
    await prepareSynth(context);
  }

  play(project: Project, fromBeat = 0): void {
    this.stop();
    const context = (this.context ??= new AudioContext({ latencyHint: "balanced" }));
    void context.resume();

    this.playing = true;
    this.perTrack.clear();
    this.muteGains.clear();
    this.voices.clear();
    this.pending.length = 0;
    this.chains = [];
    this.secondsPerBeat = 60 / project.bpm;

    const master = buildMasterChain(context, project.master.gainDb, context.destination);
    const drumBus = buildBusChain(context, master.input, "drums");
    const musicBus = buildBusChain(context, master.input, "music");
    this.chains.push(master, drumBus, musicBus);
    this.noise ??= createNoiseBuffer(context);
    const soloed = project.tracks.some((track) => track.solo);

    for (const track of project.tracks) {
      const bus = track.instrument.type === "drumkit" ? drumBus.input : musicBus.input;
      const mute = context.createGain();
      mute.gain.value = track.muted || (soloed && !track.solo) ? 0 : 1;
      mute.connect(bus);
      const chain = buildTrackChain(context, track, mute, this.secondsPerBeat);
      this.perTrack.set(track.id, chain.input);
      this.muteGains.set(track.id, mute);
      this.chains.push(chain, { input: mute, dispose: () => mute.disconnect() });
    }

    if (isSynthReady(context)) {
      for (const track of project.tracks) {
        if (track.instrument.type === "drumkit") continue;
        const input = this.perTrack.get(track.id);
        if (!input) continue;
        const synth = new WorkletInstrument(context, presetFor(track.instrument.type), {
          variant: hashString(`${project.seed}|${track.id}`) % 1000,
        });
        synth.connect(input);
        this.synths.set(track.id, synth);
      }
    }

    this.startBeat = Math.max(0, fromBeat);
    this.startTime = context.currentTime + 0.08;
    this.endBeat = project.lengthBars * beatsPerBar(project);

    this.events = [];
    for (const track of project.tracks) {
      if (!this.perTrack.has(track.id)) continue;
      for (const clip of track.clips) {
        if (clip.audio) {
          const end = clip.start + clip.length;
          if (end <= this.startBeat) continue;
          const from = Math.max(clip.start, this.startBeat);
          this.events.push({
            kind: "audio",
            beat: from,
            duration: end - from,
            pitch: 0,
            velocity: 127,
            track,
            clip,
            offsetBeats: from - clip.start,
          });
          continue;
        }
        for (const note of clip.notes) {
          const beat = clip.start + note.start;
          if (beat < this.endBeat && beat >= this.startBeat) {
            this.events.push({
              kind: "note",
              beat,
              duration: note.duration,
              pitch: note.pitch,
              velocity: note.velocity,
              track,
            });
          }
        }
      }
    }
    this.events.sort((a, b) => a.beat - b.beat);
    this.index = 0;

    this.scheduleAhead();
    this.timer = window.setInterval(() => this.scheduleAhead(), 100);
    const loop = () => {
      if (!this.playing) return;
      const beat = this.currentBeat();
      this.lastBeat = beat;
      this.onTick(beat);
      if (beat >= this.endBeat) {
        this.stop();
        this.onEnd();
        return;
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  seek(project: Project, beat: number): void {
    this.lastBeat = Math.max(0, Math.min(beat, project.lengthBars * beatsPerBar(project)));
    this.onTick(this.lastBeat);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = null;
    this.frame = null;
    for (const item of this.pending) {
      try {
        item.voice.stop();
      } catch {
        /* ya parada */
      }
      try {
        item.bus.disconnect();
      } catch {
        /* noop */
      }
    }
    this.pending.length = 0;
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* ya parada */
      }
    }
    for (const synth of this.synths.values()) synth.dispose();
    this.synths.clear();
    for (const chain of this.chains) {
      try {
        chain.dispose();
      } catch {
        /* ya desconectada */
      }
    }
    this.chains = [];
    this.muteGains.clear();
    this.voices.clear();
  }

  private currentBeat(): number {
    if (!this.context) return this.lastBeat;
    return this.startBeat + Math.max(0, this.context.currentTime - this.startTime) / this.secondsPerBeat;
  }

  private scheduleAhead(): void {
    const context = this.context;
    if (!context || !this.playing) return;
    this.cleanup(context);
    const horizon = this.currentBeat() + 3 / this.secondsPerBeat;
    let budget = 48;
    while (budget-- > 0 && this.index < this.events.length) {
      const event = this.events[this.index]!;
      if (event.beat > horizon) break;
      this.index++;
      const when = this.startTime + (event.beat - this.startBeat) * this.secondsPerBeat;
      if (when < context.currentTime - 0.05) continue;
      const destination = this.perTrack.get(event.track.id);
      if (!destination) continue;

      if (event.kind === "audio") {
        this.scheduleAudio(context, destination, event, when);
      } else {
        const synth = this.synths.get(event.track.id);
        if (synth) {
          synth.note(event.pitch, event.velocity, when, event.duration * this.secondsPerBeat);
          continue;
        }
        const bus = context.createGain();
        bus.connect(destination);
        const voice = playInstrumentNote(
          context,
          bus,
          event.track.instrument.type,
          event.pitch,
          when,
          event.duration * this.secondsPerBeat,
          event.velocity,
          this.noise!,
        );
        this.voices.add(voice);
        const instrument = event.track.instrument.type;
        const tail = instrument === "pad" ? 6 : instrument === "drumkit" ? 1.6 : 1.4;
        this.pending.push({
          endsAt: when + event.duration * this.secondsPerBeat + tail,
          bus,
          voice,
        });
      }
    }
  }

  /** Libera voces terminadas: sin esto el grafo crece y el audio se degrada. */
  private cleanup(context: AudioContext): void {
    const now = context.currentTime;
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const item = this.pending[index]!;
      if (item.endsAt > now) continue;
      try {
        item.voice.stop();
      } catch {
        /* ya parada */
      }
      try {
        item.bus.disconnect();
      } catch {
        /* noop */
      }
      this.voices.delete(item.voice);
      this.pending.splice(index, 1);
    }
  }

  private scheduleAudio(context: AudioContext, destination: AudioNode, event: Event, when: number): void {
    const clip = event.clip;
    if (!clip?.audio) return;
    const asset = audioAssets.get(clip.audio.assetId);
    if (!asset) return;
    const source = context.createBufferSource();
    source.buffer = asset.buffer;
    const gain = context.createGain();
    gain.gain.value = Math.max(0, Math.min(2, dbToGain(clip.audio.gainDb)));
    source.connect(gain).connect(destination);
    const offset = Math.max(0, (clip.audio.offset + (event.offsetBeats ?? 0)) * this.secondsPerBeat);
    const duration = Math.max(0.01, event.duration * this.secondsPerBeat);
    const handle: VoiceHandle = {
      stop: () => {
        try {
          source.stop();
        } catch {
          /* ya parada */
        }
      },
    };
    source.onended = () => {
      try {
        gain.disconnect();
        source.disconnect();
      } catch {
        /* noop */
      }
      this.voices.delete(handle);
    };
    source.start(when, offset, duration);
    this.voices.add(handle);
  }
}
