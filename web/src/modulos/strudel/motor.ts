/**
 * Offline rendering with the real Strudel engine (superdough + its sample packs), in the browser: no GPU, no server.
 * Brought from miuzika (web/src/strudel-audio.ts, built 21-Oct) on 8-Nov, the user: "hay que añadir el módulo de strudel
 * que estaba en la versión antigua". The code is the same; only the WAV helper's path changed.
 */

import { expandLabeledPatterns, stripVisualMethods } from "./strudel-source.ts";
import { audioBufferToWav } from "../../wav.ts";

export interface StrudelRenderizado {
  blob: Blob;
  buffer: AudioBuffer;
  durationSeconds: number;
  /** Highest absolute sample, in dBFS: a silent render is said, not added. */
  picoDb: number;
  warnings: string[];
}

let dirtySamplesLoaded = false;
let soundfontsLoaded = false;
const CDN = "https://strudel.b-cdn.net";

const hapValue = (hap: any): Record<string, unknown> => {
  hap.ensureObjectValue();
  return hap.value;
};

export async function renderStrudelAudio(code: string, bars: number, bpm: number, beatsPerBar: number): Promise<StrudelRenderizado> {
  const source = stripVisualMethods(expandLabeledPatterns(code.trim()));
  if (!source) throw new Error("The Strudel code is empty.");
  if (!(bars >= 1 && bars <= 64)) throw new Error("The number of bars must be between 1 and 64.");

  const core: any = await import("@strudel/core");
  const mini: any = await import("@strudel/mini");
  const tonal: any = await import("@strudel/tonal");
  const webaudio: any = await import("@strudel/webaudio");
  const transpiler: any = await import("@strudel/transpiler");

  await core.evalScope(core, mini, tonal, webaudio);
  const warnings: string[] = [];

  // Same default sample maps as the Strudel REPL.
  if (!dirtySamplesLoaded) {
    const maps: Array<[string, string]> = [
      [`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`],
      [`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`],
      [`${CDN}/vcsl.json`, `${CDN}/VCSL/`],
      [`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`],
      [`${CDN}/piano.json`, `${CDN}/piano/`],
    ];
    const results = await Promise.allSettled(maps.map(([json, base]) => webaudio.samples(json, base)));
    for (const result of results) {
      if (result.status === "rejected") warnings.push(`A default sample map failed to load: ${String(result.reason)}`);
    }
    dirtySamplesLoaded = true;
  }
  if (!soundfontsLoaded) {
    try {
      const soundfonts: any = await import("@strudel/soundfonts");
      soundfonts.registerSoundfonts?.();
      soundfontsLoaded = true;
    } catch (error) {
      warnings.push(`Could not load the GM soundfonts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The transpiler treats samples() URLs as mini-notation and fails: the plain URL calls are preloaded and removed.
  const sampleCalls = [...source.matchAll(/samples\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
  let renderSource = source;
  for (const match of sampleCalls) {
    const url = match[2]!;
    try {
      await webaudio.samples(url);
    } catch (error) {
      warnings.push(`Could not load the sample pack "${url}": ${error instanceof Error ? error.message : String(error)}`);
    }
    renderSource = renderSource.replace(match[0]!, "");
  }

  const evaluated = await transpiler.evaluate(renderSource, transpiler.transpiler);
  const pattern = evaluated?.pattern;
  if (!pattern || typeof pattern.queryArc !== "function") throw new Error("The code does not return a Strudel pattern.");

  const cps = bpm / (60 * beatsPerBar);
  const durationSeconds = bars / cps;
  const sampleRate = 48_000;
  const frames = Math.ceil(durationSeconds * sampleRate);
  const context = new OfflineAudioContext(2, frames, sampleRate);

  webaudio.registerSynthSounds?.();
  webaudio.setAudioContext(context);
  // Measured 8-Nov: the old code built the controller from `superdough/superdoughoutput.mjs`, a second copy of the library
  // (webaudio uses the bundled dist/index.mjs) whose own audio context was never set, so room, delay and distort failed with
  // "cannot connect to an AudioNode belonging to a different audio context" and an arpeggio with delay came out silent.
  // With null, the library builds its controller itself, on the context just set.
  webaudio.setSuperdoughAudioController(null);
  // superdough keeps finished filters, compressors and oscillators in private pools (nodePools.mjs) and reuses them: the
  // ones from an earlier render belong to its dead OfflineAudioContext. While this render runs, a pooled node of another
  // offline context reads as collected, so the pool builds a new one. The realtime context (openDAW's) is not affected.
  const derefOriginal = WeakRef.prototype.deref;
  WeakRef.prototype.deref = function (this: WeakRef<object>) {
    const v = derefOriginal.call(this);
    return v instanceof AudioNode && v.context instanceof OfflineAudioContext && v.context !== context ? undefined : v;
  } as typeof derefOriginal;

  try {
    await webaudio.initAudio({ maxPolyphony: 64, multiChannelOrbits: false });
    const haps = pattern.queryArc(0, bars, { _cps: cps }).sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    for (const hap of haps) {
      if (!hap.hasOnset()) continue;
      try {
        await webaudio.superdough(hapValue(hap), hap.whole.begin.valueOf() / cps, hap.duration / cps, cps, hap.whole.begin.valueOf() / cps);
      } catch (error) {
        warnings.push(`Strudel event skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const rendered = await context.startRendering();
    let pico = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const datos = rendered.getChannelData(c);
      for (let i = 0; i < datos.length; i++) pico = Math.max(pico, Math.abs(datos[i]!));
    }
    // Measured 8-Nov: a 909 kit peaked at +6.6 dBFS and the industrial example at +4.5 (the REPL plays float, which the
    // browser output limits); a 16/24-bit WAV would clip them. Above -1 dBFS the whole render is scaled down to -1 dBFS.
    const TECHO = 10 ** (-1 / 20);
    let picoFinal = pico;
    if (pico > TECHO) {
      const g = TECHO / pico;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const datos = rendered.getChannelData(c);
        for (let i = 0; i < datos.length; i++) datos[i]! *= g;
      }
      warnings.unshift(`It peaked at ${(20 * Math.log10(pico)).toFixed(1)} dBFS: the whole render was turned down to -1 dBFS so the WAV does not clip.`);
      picoFinal = TECHO;
    }
    const wav = audioBufferToWav(rendered);
    return {
      blob: new Blob([wav], { type: "audio/wav" }),
      buffer: rendered,
      durationSeconds,
      picoDb: picoFinal > 0 ? 20 * Math.log10(picoFinal) : -Infinity,
      warnings,
    };
  } finally {
    WeakRef.prototype.deref = derefOriginal;
    webaudio.setAudioContext(null);
    webaudio.setSuperdoughAudioController(null);
    webaudio.resetGlobalEffects();
  }
}
