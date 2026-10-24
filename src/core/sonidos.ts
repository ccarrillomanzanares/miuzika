/**
 * Sonidos: recetas y post-proceso.
 *
 * Un sonido es **una receta**, no un sintetizador: qué voz, con qué argumentos y
 * qué post-proceso. La lista de voces NO está aquí: la dicta el motor
 * (`/api/voces`, leída de `instruments.py`), para no tener dos verdades.
 *
 * El post-proceso es lo que hace que las palabras («más corto», «más brillante»)
 * funcionen en cualquier voz, incluso en las que no tienen ese parámetro.
 */

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
  /** Si está, la voz no se puede usar con números sueltos (patrón, sílabas…). */
  excluida?: string | null;
  aviso?: string;
}

/** Post-proceso universal: va después del timbre y funciona en todas las voces. */
export interface PostSonido {
  /** Pico al que se normaliza el render (dBFS). */
  peakDbfs: number;
  /** Fundido de salida, en ms. */
  fadeMs: number;
  /** Cuántas veces se repite el buffer. */
  repeticiones: number;
  /** Inclinación tonal: -1 oscuro … +1 brillante. */
  brillo: number;
  /** Saturación y ruido: 0 limpio … 1 sucio. */
  suciedad: number;
  /** Multiplicador de la cola: 0,5 la mitad … 2 el doble. */
  cola: number;
  /** Realce de graves: -1 hueco … +1 gordo. */
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
  /** Palabras con las que se pidió, para poder repetirlo en lenguaje humano. */
  palabras?: string[];
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

/** Nombre de fichero seguro a partir del nombre que escribe el usuario. */
export function nombreDeSonido(texto: string): string {
  const limpio = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return limpio === "" ? "sonido" : limpio;
}

export function vozPorClave(voces: VozSonido[], clave: string): VozSonido | undefined {
  return voces.find((voz) => voz.clave === clave);
}

/** Valores por defecto de una voz, tal como los declara el motor. */
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
    // El nombre es también el del fichero: se limpia aquí y no en cada uso.
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
 * Normaliza una receta contra el catálogo del motor: rellena lo que falte con los
 * valores declarados, recorta a rango y avisa. Lanza si la voz no existe o si la
 * voz necesita material de entrada (un patrón, sílabas…).
 */
export function normalizarReceta(
  datos: unknown,
  voces: VozSonido[],
): { receta: RecetaSonido; avisos: string[] } {
  if (typeof datos !== "object" || datos === null) throw new Error("La receta no es un objeto.");
  const bruto = datos as Partial<RecetaSonido>;
  const clave = String(bruto.voz ?? "");
  const voz = vozPorClave(voces, clave);
  if (!voz) {
    throw new Error(`Voz desconocida: "${clave}". Válidas: ${voces.map((v) => v.clave).join(", ")}`);
  }
  if (voz.excluida) throw new Error(`La voz "${clave}" no se puede usar así: ${voz.excluida}`);

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
      if (notas.length === 0) avisos.push(`${param.etiqueta}: sin notas, se deja el valor por defecto.`);
      else args[param.clave] = notas.slice(0, tope);
      continue;
    }
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
      avisos.push(`${param.etiqueta}: "${String(valor)}" no es un número, se deja el valor por defecto.`);
      continue;
    }
    const dentro = recortarNumero(numero, param);
    if (Math.abs(dentro - numero) > 1e-9) {
      avisos.push(
        `${param.etiqueta}: ${numero} fuera de rango, se ajusta a ${dentro}${param.unidad ? " " + param.unidad : ""}.`,
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

/** Literal de Python para un valor de JS (true → True, lista → [...]). */
export function literalPython(valor: number | boolean | number[] | string): string {
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "0.0";
  if (typeof valor === "string") return JSON.stringify(valor);
  return `[${valor.map((n) => literalPython(n)).join(", ")}]`;
}

/** Ruta del script generado, relativa a `workspace/`. */
export function rutaScriptDeSonido(receta: RecetaSonido): string {
  return `codigo/experimental/sonido_${receta.nombre}.py`;
}

/** Ruta del WAV, relativa a la carpeta del proyecto. */
export function rutaWavDeSonido(receta: RecetaSonido): string {
  return `sonidos/${receta.nombre}.wav`;
}

/**
 * Script de Python que renderiza la receta. Se ejecuta tal cual con
 * `/api/run/python` y escribe el WAV en la carpeta de sonidos del proyecto.
 *
 * El post-proceso va después del timbre para que las palabras («brillante»,
 * «sucio», «corto») funcionen igual en cualquier voz.
 */
export function scriptDeSonido(receta: RecetaSonido, opciones: { slug: string }): string {
  const salida = `proyectos/${opciones.slug}/sonidos/${receta.nombre}.wav`;
  const args = Object.entries(receta.args)
    .map(([clave, valor]) => `    ${JSON.stringify(clave)}: ${literalPython(valor)},`)
    .join("\n");
  return `"""Sonido «${receta.nombre}» — generado por miuzika desde una receta.

No editar a mano: se regenera desde proyectos/${opciones.slug}/sonidos/${receta.nombre}.json
Voz: ${receta.voz}${receta.palabras?.length ? ` · palabras: ${receta.palabras.join(", ")}` : ""}
"""
import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
sys.path.insert(0, os.path.join(RAIZ, "codigo"))

import dsp          # noqa: E402
import instruments  # noqa: E402

VOZ = ${literalPython(receta.voz)}
ARGS = {
${args}
}
REPETICIONES = ${receta.post.repeticiones}
SALIDA = os.path.join(RAIZ, ${literalPython(salida)})
PEAK_DBFS = ${literalPython(receta.post.peakDbfs)}
FADE_MS = ${literalPython(receta.post.fadeMs)}
BRILLO = ${literalPython(receta.post.brillo)}
SUCIEDAD = ${literalPython(receta.post.suciedad)}
COLA = ${literalPython(receta.post.cola)}
CUERPO = ${literalPython(receta.post.cuerpo)}


def postproceso(x):
    """Lo que piden las palabras: cuerpo, brillo, cola y suciedad."""
    x = np.asarray(x, dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if REPETICIONES > 1:
        x = np.tile(x, REPETICIONES)
    x = x - x.mean()
    n = len(x)
    # Cuerpo: realce (o corte) de graves.
    if abs(CUERPO) > 1e-6:
        x = x + CUERPO * 1.2 * dsp.lp(x, 180.0, 0.7)
    # Brillo: agudos arriba (brillante) o abajo (oscuro).
    if abs(BRILLO) > 1e-6:
        x = x + BRILLO * 1.1 * dsp.hp(x, 2200.0, 0.7)
    # Cola: alarga o acorta el decaimiento siguiendo la envolvente.
    if abs(COLA - 1.0) > 1e-6 and n > 2:
        ventana = max(int(0.005 * dsp.SR), 1)
        suave = np.convolve(np.abs(x), np.ones(ventana) / ventana, mode="same")
        referencia = max(float(np.max(suave)), 1e-9)
        factor = (np.maximum(suave, 1e-9) / referencia) ** ((1.0 / COLA) - 1.0)
        x = x * np.clip(factor, 0.0, 4.0)
    # Suciedad: saturación EN PARALELO (no aplasta el transitorio) más un poco de
    # ruido con semilla fija. Mezclar en seco conserva el crest: medido, saturar en
    # serie bajaba el bombo de 6,9 a 1,4 dB de crest y sonaba a caja de ritmos rota.
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
    fn = getattr(instruments, VOZ, None)
    if fn is None:
        raise SystemExit(f"VOZ desconocida: {VOZ}")
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
    print(f"escrito {SALIDA}")
    print(f"voz={VOZ}  dur={len(x) / dsp.SR:.3f}s  pico={p:.2f} dBFS  rms={r:.2f} dBFS  crest={p - r:.2f} dB")


if __name__ == "__main__":
    main()
`;
}
