/**
 * Render offline con el motor real de Strudel (superdough + sample packs).
 * No usa las notas MIDI: produce un WAV para insertarlo como pista de audio.
 */

import { expandLabeledPatterns, stripVisualMethods } from "./strudel-compiler.ts";
import { audioBufferToWav } from "./wav.ts";

export interface RenderedStrudelAudio {
  blob: Blob;
  buffer: AudioBuffer;
  durationSeconds: number;
  warnings: string[];
}

let dirtySamplesLoaded = false;
let soundfontsLoaded = false;
const CDN = "https://strudel.b-cdn.net";

const hapValue = (hap: any): Record<string, unknown> => {
  hap.ensureObjectValue();
  return hap.value;
};

export async function renderStrudelAudio(
  code: string,
  bars: number,
  bpm: number,
  beatsPerBar: number,
): Promise<RenderedStrudelAudio> {
  const source = stripVisualMethods(expandLabeledPatterns(code.trim()));
  if (!source) throw new Error("El código Strudel está vacío.");
  if (!(bars >= 1 && bars <= 64)) throw new Error("Los compases deben estar entre 1 y 64.");

  const core: any = await import("@strudel/core");
  const mini: any = await import("@strudel/mini");
  const tonal: any = await import("@strudel/tonal");
  const webaudio: any = await import("@strudel/webaudio");
  const transpiler: any = await import("@strudel/transpiler");
  const controllerModule: any = await import("superdough/superdoughoutput.mjs");

  await core.evalScope(core, mini, tonal, webaudio);
  const warnings: string[] = [];

  // Mismos sample maps por defecto que el REPL de Strudel.
  if (!dirtySamplesLoaded) {
    const maps: Array<[string, string]> = [
      [`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`],
      [`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`],
      [`${CDN}/vcsl.json`, `${CDN}/VCSL/`],
      [`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`],
      [`${CDN}/piano.json`, `${CDN}/piano/`],
    ];
    const results = await Promise.allSettled(
      maps.map(([json, base]) => webaudio.samples(json, base)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        warnings.push(
          `No se cargó un sample map por defecto: ${String(result.reason)}`,
        );
      }
    }
    dirtySamplesLoaded = true;
  }
  if (!soundfontsLoaded) {
    try {
      const soundfonts: any = await import("@strudel/soundfonts");
      soundfonts.registerSoundfonts?.();
      soundfontsLoaded = true;
    } catch (error) {
      warnings.push(
        `No se cargaron los soundfonts GM: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // El transpiler trata las URLs de samples() como mini-notation y falla.
  // Extraemos las llamadas de URL simple, las precargamos y las quitamos.
  const sampleCalls = [
    ...source.matchAll(/samples\s*\(\s*(['"])([^'"]+)\1\s*\)/g),
  ];
  let renderSource = source;
  for (const match of sampleCalls) {
    const url = match[2]!;
    try {
      await webaudio.samples(url);
    } catch (error) {
      warnings.push(
        `No se pudo cargar el sample pack "${url}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    renderSource = renderSource.replace(match[0]!, "");
  }

  const evaluated = await transpiler.evaluate(renderSource, transpiler.transpiler);
  const pattern = evaluated?.pattern;
  if (!pattern || typeof pattern.queryArc !== "function") {
    throw new Error("El código no devuelve un patrón Strudel.");
  }

  const cps = bpm / (60 * beatsPerBar);
  const durationSeconds = bars / cps;
  const sampleRate = 48_000;
  const frames = Math.ceil(durationSeconds * sampleRate);
  const context = new OfflineAudioContext(2, frames, sampleRate);

  webaudio.registerSynthSounds?.();
  webaudio.setAudioContext(context);
  webaudio.setSuperdoughAudioController(
    new controllerModule.SuperdoughAudioController(context),
  );
  await webaudio.initAudio({ maxPolyphony: 64, multiChannelOrbits: false });

  try {
    const haps = pattern
      .queryArc(0, bars, { _cps: cps })
      .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    for (const hap of haps) {
      if (!hap.hasOnset()) continue;
      try {
        await webaudio.superdough(
          hapValue(hap),
          hap.whole.begin.valueOf() / cps,
          hap.duration / cps,
          cps,
          hap.whole.begin.valueOf() / cps,
        );
      } catch (error) {
        warnings.push(
          `Evento Strudel omitido: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const rendered = await context.startRendering();
    const wav = audioBufferToWav(rendered);
    return {
      blob: new Blob([wav], { type: "audio/wav" }),
      buffer: rendered,
      durationSeconds,
      warnings,
    };
  } finally {
    webaudio.setAudioContext(null);
    webaudio.setSuperdoughAudioController(null);
    webaudio.resetGlobalEffects();
  }
}
