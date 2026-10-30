/**
 * Sounds: recipes and post-processing.
 *
 * A sound is **a recipe**, not a synthesizer: which voice, with which arguments, and
 * which post-processing. The voice list is NOT here: the engine defines it
 * (`/api/voces`, read from `instruments.py`), so there are not two sources of truth.
 *
 * Post-processing is what makes the words ("shorter", "brighter") work on any voice,
 * even those that do not have that parameter.
 */

import { slugDe } from "./nombres.ts";

export const FORMATO_SONIDO = "miuzika-sonido";
export const VERSION_SONIDO = 1;

export type TipoParametro = "num" | "enteros" | "bool" | "texto";

export interface ParametroSonido {
  clave: string;
  etiqueta: string;
  tipo: TipoParametro;
  defecto: number | boolean | number[] | null;
  obligatorio?: boolean;
  min?: number;
  max?: number;
  unidad?: string;
  maximo_elementos?: number;
}

export interface VozSonido {
  clave: string;
  etiqueta: string;
  familia: string;
  descripcion: string;
  documentada?: boolean;
  params: ParametroSonido[];
  /** If present, the voice cannot be used with bare numbers (pattern, syllables…). */
  excluida?: string | null;
  aviso?: string;
}

/** Universal post-processing: it comes after the timbre and works on all voices. */
export interface PostSonido {
  /** Peak the render is normalized to (dBFS). */
  peakDbfs: number;
  /** Fade-out, in ms. */
  fadeMs: number;
  /** How many times the buffer is repeated. */
  repeticiones: number;
  /** Tonal tilt: -1 dark … +1 bright. */
  brillo: number;
  /** Saturation and noise: 0 clean … 1 dirty. */
  suciedad: number;
  /** Tail multiplier: 0.5 half … 2 double. */
  cola: number;
  /** Bass emphasis: -1 hollow … +1 fat. */
  cuerpo: number;
}

export type ArgsSonido = Record<string, number | boolean | number[]>;

export interface RecetaSonido {
  formato: typeof FORMATO_SONIDO;
  version: typeof VERSION_SONIDO;
  nombre: string;
  voz: string;
  args: ArgsSonido;
  post: PostSonido;
  /** Words it was requested with, so it can be repeated in human language. */
  palabras?: string[];
  /** Where it is rendered: on the laptop (cpu) or on Lambda (gpu). */
  destino?: "cpu" | "gpu";
}

export const POST_POR_DEFECTO: PostSonido = {
  peakDbfs: -1,
  fadeMs: 25,
  repeticiones: 1,
  brillo: 0,
  suciedad: 0,
  cola: 1,
  cuerpo: 0,
};

function acotar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/** Safe file name from the name the user writes. */
export function nombreDeSonido(texto: string): string {
  return slugDe(texto, { max: 40, defecto: "sonido" });
}

export function vozPorClave(voces: VozSonido[], clave: string): VozSonido | undefined {
  return voces.find((voz) => voz.clave === clave);
}

/** Default values of a voice, as declared by the engine. */
export function argsPorDefecto(voz: VozSonido | undefined): ArgsSonido {
  if (!voz) return {};
  const args: ArgsSonido = {};
  for (const param of voz.params) {
    if (param.defecto === null || param.defecto === undefined) continue;
    args[param.clave] = Array.isArray(param.defecto) ? [...param.defecto] : param.defecto;
  }
  return args;
}

export function recetaNueva(nombre: string, vozClave: string, voces: VozSonido[]): RecetaSonido {
  return {
    formato: FORMATO_SONIDO,
    version: VERSION_SONIDO,
    // The name is also the file name: it is cleaned here and not on every use.
    nombre: nombreDeSonido(nombre),
    voz: vozClave,
    args: argsPorDefecto(vozPorClave(voces, vozClave)),
    post: { ...POST_POR_DEFECTO },
  };
}

function recortarNumero(valor: number, param: ParametroSonido): number {
  const min = param.min ?? -Infinity;
  const max = param.max ?? Infinity;
  return Math.min(max, Math.max(min, valor));
}

/**
 * Normalizes a recipe against the engine catalog: fills in what is missing with the
 * declared values, clamps to range, and warns. It throws if the voice does not exist
 * or if the voice needs input material (a pattern, syllables…).
 */
export function normalizarReceta(
  datos: unknown,
  voces: VozSonido[],
): { receta: RecetaSonido; avisos: string[] } {
  if (typeof datos !== "object" || datos === null) throw new Error("The recipe is not an object.");
  const bruto = datos as Partial<RecetaSonido>;
  const clave = String(bruto.voz ?? "");
  const voz = vozPorClave(voces, clave);
  if (!voz) {
    throw new Error(`Unknown voice: "${clave}". Valid: ${voces.map((v) => v.clave).join(", ")}`);
  }
  if (voz.excluida) throw new Error(`The voice "${clave}" cannot be used like this: ${voz.excluida}`);

  const avisos: string[] = [];
  const args: ArgsSonido = argsPorDefecto(voz);
  const entrada = (bruto.args ?? {}) as Record<string, unknown>;

  for (const param of voz.params) {
    if (!(param.clave in entrada)) continue;
    const valor = entrada[param.clave];
    if (param.tipo === "bool") {
      args[param.clave] = valor === true || valor === "true" || valor === 1;
      continue;
    }
    if (param.tipo === "enteros") {
      const lista = Array.isArray(valor) ? valor : [valor];
      const notas = lista
        .map((n) => Math.round(Number(n)))
        .filter((n) => Number.isFinite(n))
        .map((n) => recortarNumero(n, param));
      const tope = param.maximo_elementos ?? 8;
      if (notas.length === 0) avisos.push(`${param.etiqueta}: no notes, the default value is kept.`);
      else args[param.clave] = notas.slice(0, tope);
      continue;
    }
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
      avisos.push(`${param.etiqueta}: "${String(valor)}" is not a number, the default value is kept.`);
      continue;
    }
    const dentro = recortarNumero(numero, param);
    if (Math.abs(dentro - numero) > 1e-9) {
      avisos.push(
        `${param.etiqueta}: ${numero} out of range, adjusted to ${dentro}${param.unidad ? " " + param.unidad : ""}.`,
      );
    }
    args[param.clave] = dentro;
  }

  const postBruto = (bruto.post ?? {}) as Partial<PostSonido>;
  const post: PostSonido = {
    peakDbfs: acotar(Number(postBruto.peakDbfs ?? POST_POR_DEFECTO.peakDbfs), -24, 0),
    fadeMs: acotar(Number(postBruto.fadeMs ?? POST_POR_DEFECTO.fadeMs), 0, 500),
    repeticiones: Math.round(acotar(Number(postBruto.repeticiones ?? 1), 1, 64)),
    brillo: acotar(Number(postBruto.brillo ?? 0), -1, 1),
    suciedad: acotar(Number(postBruto.suciedad ?? 0), 0, 1),
    cola: acotar(Number(postBruto.cola ?? 1), 0.25, 4),
    cuerpo: acotar(Number(postBruto.cuerpo ?? 0), -1, 1),
  };

  return {
    receta: {
      formato: FORMATO_SONIDO,
      version: VERSION_SONIDO,
      nombre: nombreDeSonido(String(bruto.nombre ?? voz.clave)),
      voz: voz.clave,
      args,
      post,
      ...(Array.isArray(bruto.palabras) ? { palabras: bruto.palabras.map(String) } : {}),
    },
    avisos,
  };
}

/** Python literal for a JS value (true → True, list → [...]). */
export function literalPython(valor: number | boolean | number[] | string): string {
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "0.0";
  if (typeof valor === "string") return JSON.stringify(valor);
  return `[${valor.map((n) => literalPython(n)).join(", ")}]`;
}

/**
 * Path of the generated script, relative to the project folder: next to its WAV and
 * its metadata. It used to go to `codigo/experimental/`, inside the SHARED engine:
 * every sound of every project dirtied the library and regenerated the manifest.
 */
export function rutaScriptDeSonido(receta: RecetaSonido): string {
  return `sonidos/${receta.nombre}.py`;
}

/** WAV path, relative to the project folder. */
export function rutaWavDeSonido(receta: RecetaSonido): string {
  return `sonidos/${receta.nombre}.wav`;
}

/**
 * Python script that renders the recipe. It runs as-is with `/api/run/python` and
 * writes the WAV into the project's sounds folder.
 *
 * Post-processing comes after the timbre so the words ("bright", "dirty", "short")
 * work the same on any voice.
 */
export function scriptDeSonido(receta: RecetaSonido, opciones: { slug: string }): string {
  const args = Object.entries(receta.args)
    .map(([clave, valor]) => `    ${JSON.stringify(clave)}: ${literalPython(valor)},`)
    .join("\n");
  return `"""Sound "${receta.nombre}" — generated by miuzika from a recipe.

Do not edit by hand: it is regenerated from proyectos/${opciones.slug}/sonidos/${receta.nombre}.json
Voice: ${receta.voz} (${receta.destino ?? "cpu"})${receta.palabras?.length ? ` · words: ${receta.palabras.join(", ")}` : ""}
"""
import os
import sys
import wave

import numpy as np

# The script lives in proyectos/<slug>/sonidos/: workspace/ is three levels up.
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", "..", ".."))
sys.path.insert(0, os.path.join(RAIZ, "codigo"))
sys.path.insert(0, os.path.join(RAIZ, "gpu"))

import dsp  # noqa: E402

DESTINO = ${literalPython(receta.destino ?? "cpu")}
VOZ = ${literalPython(receta.voz)}
ARGS = {
${args}
}
REPETICIONES = ${receta.post.repeticiones}
SALIDA = os.path.join(AQUI, ${literalPython(`${receta.nombre}.wav`)})
PEAK_DBFS = ${literalPython(receta.post.peakDbfs)}
FADE_MS = ${literalPython(receta.post.fadeMs)}
BRILLO = ${literalPython(receta.post.brillo)}
SUCIEDAD = ${literalPython(receta.post.suciedad)}
COLA = ${literalPython(receta.post.cola)}
CUERPO = ${literalPython(receta.post.cuerpo)}


def postproceso(x):
    """What the words ask for: body, brightness, tail, and dirt."""
    x = np.asarray(x, dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if REPETICIONES > 1:
        x = np.tile(x, REPETICIONES)
    x = x - x.mean()
    n = len(x)
    # Body: bass boost (or cut).
    if abs(CUERPO) > 1e-6:
        x = x + CUERPO * 1.2 * dsp.lp(x, 180.0, 0.7)
    # Brightness: highs up (bright) or down (dark).
    if abs(BRILLO) > 1e-6:
        x = x + BRILLO * 1.1 * dsp.hp(x, 2200.0, 0.7)
    # Tail: lengthens or shortens the decay following the envelope.
    if abs(COLA - 1.0) > 1e-6 and n > 2:
        ventana = max(int(0.005 * dsp.SR), 1)
        suave = np.convolve(np.abs(x), np.ones(ventana) / ventana, mode="same")
        referencia = max(float(np.max(suave)), 1e-9)
        factor = (np.maximum(suave, 1e-9) / referencia) ** ((1.0 / COLA) - 1.0)
        x = x * np.clip(factor, 0.0, 4.0)
    # Dirt: IN-PARALLEL saturation (it does not squash the transient) plus a little
    # noise with a fixed seed. Dry mixing preserves the crest: measured, saturating in
    # series lowered the kick from 6.9 to 1.4 dB crest and sounded like a broken drum machine.
    if SUCIEDAD > 1e-6:
        pico_seco = max(float(np.max(np.abs(x))), 1e-9)
        seco = x / pico_seco
        sucio = dsp.soft_clip(seco * (1.0 + 2.0 * SUCIEDAD), drive=2.0)
        sucio = sucio / max(float(np.max(np.abs(sucio))), 1e-9)
        x = ((1.0 - 0.7 * SUCIEDAD) * seco + 0.7 * SUCIEDAD * sucio) * pico_seco
        x = x + SUCIEDAD * 0.02 * np.random.default_rng(12345).standard_normal(n)
    x = x - x.mean()
    if FADE_MS > 0:
        m = min(max(int(dsp.SR * FADE_MS / 1000.0), 2), len(x))
        x[-m:] *= np.linspace(1.0, 0.0, m)
    pico = max(float(np.max(np.abs(x))), 1e-9)
    return x * (10.0 ** (PEAK_DBFS / 20.0)) / pico


def main():
    # GPU voices live in gpu/voces_gpu.py and only run there (torch). The explicit
    # import is also the signal the server uses to allow the GPU.
    if DESTINO == "gpu":
        import voces_gpu as modulo
    else:
        import instruments as modulo
    fn = getattr(modulo, VOZ, None)
    if fn is None:
        raise SystemExit(f"Unknown VOICE: {VOZ} ({DESTINO})")
    x = postproceso(fn(**ARGS))
    est = np.stack([x, x], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with wave.open(SALIDA, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(dsp.SR)
        w.writeframes(pcm.tobytes())
    p = 20 * np.log10(max(float(np.max(np.abs(x))), 1e-12))
    r = 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))
    print(f"wrote {SALIDA}")
    print(f"voice={VOZ}  dur={len(x) / dsp.SR:.3f}s  peak={p:.2f} dBFS  rms={r:.2f} dBFS  crest={p - r:.2f} dB")


if __name__ == "__main__":
    main()
`;
}
