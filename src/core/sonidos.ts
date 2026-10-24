/**
 * Creación de sonidos: recetas.
 *
 * Un sonido es **una receta y un WAV**, no un sintetizador nuevo. Los timbres ya
 * existen en `workspace/codigo/instruments.py`; aquí sólo se describen sus
 * parámetros con nombre, rango y unidad para que la UI y el agente puedan tocarlos
 * sin escribir Python a mano, y se genera el script que los renderiza.
 *
 * Misma receta + misma semilla = mismo WAV. Eso es lo que hace el sonido
 * reproducible y guardable en el proyecto (`proyectos/<slug>/sonidos/`).
 */

export const FORMATO_SONIDO = "miuzika-sonido";
export const VERSION_SONIDO = 1;

export type TipoParametro = "num" | "enteros" | "bool";

export interface ParametroSonido {
  clave: string;
  etiqueta: string;
  tipo: TipoParametro;
  defecto: number | boolean | number[];
  min?: number;
  max?: number;
  paso?: number;
  unidad?: string;
  /** Sólo para `enteros`: cuántos valores admite la lista. */
  maximoElementos?: number;
}

export type FamiliaSonido = "percusión" | "tonal" | "textura" | "ruido";

export interface VozSonido {
  /** Nombre de la función en instruments.py. */
  clave: string;
  etiqueta: string;
  familia: FamiliaSonido;
  /** Descripción corta, para el catálogo del panel y para el prompt. */
  descripcion: string;
  /** Duración habitual del render, en segundos (orientativa). */
  duracion: [number, number];
  params: ParametroSonido[];
}

const SEMILLA: ParametroSonido = {
  clave: "seed",
  etiqueta: "Semilla",
  tipo: "num",
  defecto: 0,
  min: 0,
  max: 9999,
  paso: 1,
  unidad: "nº",
};

const VELOCIDAD: ParametroSonido = {
  clave: "vel",
  etiqueta: "Intensidad",
  tipo: "num",
  defecto: 1,
  min: 0.05,
  max: 1,
  paso: 0.01,
};

const NOTA: ParametroSonido = {
  clave: "midi",
  etiqueta: "Nota MIDI",
  tipo: "num",
  defecto: 40,
  min: 21,
  max: 108,
  paso: 1,
  unidad: "midi",
};

/** Catálogo de voces del motor con sus parámetros reales. */
export const VOCES: VozSonido[] = [
  {
    clave: "kick",
    etiqueta: "Bombo",
    familia: "percusión",
    descripcion: "Bombo sintético: seno con caída de tono rápida y un golpe de aire.",
    duracion: [0.3, 0.9],
    params: [VELOCIDAD, SEMILLA],
  },
  {
    clave: "snare",
    etiqueta: "Caja",
    familia: "percusión",
    descripcion: "Caja: cuerpo tonal corto más ruido filtrado con cola.",
    duracion: [0.2, 0.5],
    params: [VELOCIDAD, SEMILLA],
  },
  {
    clave: "hat",
    etiqueta: "Charles",
    familia: "percusión",
    descripcion: "Charles de ruido metálico filtrado. Abierto o cerrado.",
    duracion: [0.07, 0.4],
    params: [
      VELOCIDAD,
      { clave: "open_", etiqueta: "Abierto", tipo: "bool", defecto: false },
      SEMILLA,
    ],
  },
  {
    clave: "metal_hit",
    etiqueta: "Golpe metálico",
    familia: "percusión",
    descripcion: "Chapa metálica con parciales inarmónicos: el «clang» industrial.",
    duracion: [0.2, 3],
    params: [
      VELOCIDAD,
      { clave: "pitch", etiqueta: "Tono", tipo: "num", defecto: 1, min: 0.4, max: 2.5, paso: 0.01, unidad: "×" },
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 0.9, min: 0.05, max: 4, paso: 0.01, unidad: "s" },
      SEMILLA,
    ],
  },
  {
    clave: "shaker",
    etiqueta: "Cascabel",
    familia: "ruido",
    descripcion: "Ruido corto con envolvente suave, tipo shaker.",
    duracion: [0.1, 0.3],
    params: [VELOCIDAD, SEMILLA],
  },
  {
    clave: "bass_note",
    etiqueta: "Bajo",
    familia: "tonal",
    descripcion: "Bajo sintético con filtro: del seno limpio al squelch ácido.",
    duracion: [0.2, 4],
    params: [
      NOTA,
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 0.5, min: 0.05, max: 8, paso: 0.01, unidad: "s" },
      VELOCIDAD,
      { clave: "squelch", etiqueta: "Squelch", tipo: "num", defecto: 0, min: 0, max: 1, paso: 0.01 },
      { clave: "bright", etiqueta: "Brillo", tipo: "num", defecto: 1, min: 0.2, max: 3, paso: 0.01, unidad: "×" },
      SEMILLA,
    ],
  },
  {
    clave: "drone_note",
    etiqueta: "Drone",
    familia: "textura",
    descripcion: "Zumbido sostenido de dientes de sierra filtrados.",
    duracion: [1, 16],
    params: [
      NOTA,
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 4, min: 0.1, max: 16, paso: 0.1, unidad: "s" },
      VELOCIDAD,
      { clave: "cutoff", etiqueta: "Corte", tipo: "num", defecto: 320, min: 40, max: 8000, paso: 10, unidad: "Hz" },
      SEMILLA,
    ],
  },
  {
    clave: "organ_chord",
    etiqueta: "Acorde de órgano",
    familia: "tonal",
    descripcion: "Acorde de órgano con registro de dientes y vibrato.",
    duracion: [0.4, 16],
    params: [
      { clave: "midis", etiqueta: "Notas", tipo: "enteros", defecto: [40, 47, 52], min: 21, max: 108, maximoElementos: 8 },
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 2, min: 0.1, max: 16, paso: 0.1, unidad: "s" },
      VELOCIDAD,
      SEMILLA,
    ],
  },
  {
    clave: "piano_note",
    etiqueta: "Piano",
    familia: "tonal",
    descripcion: "Piano sintético con parciales y desafinado ajustable.",
    duracion: [0.3, 8],
    params: [
      NOTA,
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 1, min: 0.05, max: 12, paso: 0.01, unidad: "s" },
      VELOCIDAD,
      { clave: "detune", etiqueta: "Desafinado", tipo: "num", defecto: 0, min: -0.05, max: 0.05, paso: 0.001 },
      SEMILLA,
    ],
  },
  {
    clave: "squelch",
    etiqueta: "Squelch",
    familia: "ruido",
    descripcion: "Barrido de resonancia con subida de tono: el «blip» del techno.",
    duracion: [0.1, 2],
    params: [
      VELOCIDAD,
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 0.35, min: 0.05, max: 2, paso: 0.01, unidad: "s" },
      { clave: "f_lo", etiqueta: "Frecuencia baja", tipo: "num", defecto: 180, min: 40, max: 2000, paso: 5, unidad: "Hz" },
      { clave: "f_hi", etiqueta: "Frecuencia alta", tipo: "num", defecto: 1800, min: 200, max: 12000, paso: 10, unidad: "Hz" },
      SEMILLA,
    ],
  },
  {
    clave: "feedback_growl",
    etiqueta: "Rugido",
    familia: "textura",
    descripcion: "Rugido de realimentación con formantes: cola industrial.",
    duracion: [0.4, 8],
    params: [
      VELOCIDAD,
      { clave: "dur", etiqueta: "Duración", tipo: "num", defecto: 1.6, min: 0.1, max: 8, paso: 0.05, unidad: "s" },
      { clave: "f0", etiqueta: "Fundamental", tipo: "num", defecto: 196, min: 30, max: 2000, paso: 1, unidad: "Hz" },
      SEMILLA,
    ],
  },
];

export function vozPorClave(clave: string): VozSonido | undefined {
  return VOCES.find((voz) => voz.clave === clave);
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

export interface PostSonido {
  /** Pico al que se normaliza el render (dBFS). */
  peakDbfs: number;
  /** Fundido de salida, en ms. */
  fadeMs: number;
  /** Cuántas veces se repite el buffer (para bucles cortos). */
  repeticiones: number;
}

export type ArgsSonido = Record<string, number | boolean | number[]>;

export interface RecetaSonido {
  formato: typeof FORMATO_SONIDO;
  version: typeof VERSION_SONIDO;
  nombre: string;
  voz: string;
  args: ArgsSonido;
  post: PostSonido;
}

export const POST_POR_DEFECTO: PostSonido = { peakDbfs: -1, fadeMs: 25, repeticiones: 1 };

/** Valores por defecto de una voz (lo que ve el panel al elegirla). */
export function argsPorDefecto(voz: string): ArgsSonido {
  const v = vozPorClave(voz);
  if (!v) return {};
  const args: ArgsSonido = {};
  for (const param of v.params) {
    args[param.clave] = Array.isArray(param.defecto) ? [...param.defecto] : param.defecto;
  }
  return args;
}

export function recetaNueva(nombre: string, voz = "kick"): RecetaSonido {
  return {
    formato: FORMATO_SONIDO,
    version: VERSION_SONIDO,
    // El nombre es también el del fichero: se limpia aquí y no en cada uso.
    nombre: nombreDeSonido(nombre),
    voz,
    args: argsPorDefecto(voz),
    post: { ...POST_POR_DEFECTO },
  };
}

function recortarNumero(valor: number, param: ParametroSonido): number {
  const min = param.min ?? -Infinity;
  const max = param.max ?? Infinity;
  return Math.min(max, Math.max(min, valor));
}

/**
 * Normaliza una receta: rellena lo que falte con los valores por defecto de la
 * voz, recorta lo que se salga de rango y devuelve los avisos. Lanza si la voz no
 * existe: un sonido sin timbre no es un sonido.
 */
export function normalizarReceta(datos: unknown): { receta: RecetaSonido; avisos: string[] } {
  if (typeof datos !== "object" || datos === null) throw new Error("La receta no es un objeto.");
  const bruto = datos as Partial<RecetaSonido>;
  const voz = vozPorClave(String(bruto.voz ?? ""));
  if (!voz) {
    throw new Error(
      `Voz desconocida: "${String(bruto.voz ?? "")}". Válidas: ${VOCES.map((v) => v.clave).join(", ")}`,
    );
  }
  const avisos: string[] = [];
  const args: ArgsSonido = argsPorDefecto(voz.clave);
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
      const tope = param.maximoElementos ?? 8;
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
    peakDbfs: Math.min(0, Math.max(-24, Number(postBruto.peakDbfs ?? POST_POR_DEFECTO.peakDbfs))),
    fadeMs: Math.min(500, Math.max(0, Number(postBruto.fadeMs ?? POST_POR_DEFECTO.fadeMs))),
    repeticiones: Math.min(64, Math.max(1, Math.round(Number(postBruto.repeticiones ?? 1)))),
  };

  const nombre = nombreDeSonido(String(bruto.nombre ?? voz.clave));
  return {
    receta: { formato: FORMATO_SONIDO, version: VERSION_SONIDO, nombre, voz: voz.clave, args, post },
    avisos,
  };
}

/** Literal de Python para un valor de JS (true → True, lista → [...]). */
export function literalPython(valor: number | boolean | number[] | string): string {
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return "0.0";
    return Number.isInteger(valor) ? String(valor) : String(valor);
  }
  if (typeof valor === "string") return JSON.stringify(valor);
  return `[${valor.map((n) => literalPython(n)).join(", ")}]`;
}

/**
 * Script de Python que renderiza la receta. Se ejecuta tal cual con
 * `/api/run/python`; escribe el WAV en la carpeta de sonidos del proyecto.
 *
 * Rutas: los scripts viven en `workspace/codigo/experimental/`, así que la raíz
 * del workspace está dos niveles arriba.
 */
export function scriptDeSonido(
  receta: RecetaSonido,
  opciones: { slug: string; ruta?: string },
): string {
  const salida = `proyectos/${opciones.slug}/sonidos/${receta.nombre}.wav`;
  const args = Object.entries(receta.args)
    .map(([clave, valor]) => `    ${JSON.stringify(clave)}: ${literalPython(valor)},`)
    .join("\n");
  return `"""Sonido «${receta.nombre}» — generado por miuzika desde una receta.

No editar a mano: se regenera desde proyectos/${opciones.slug}/sonidos/${receta.nombre}.json
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


def render():
    fn = getattr(instruments, VOZ, None)
    if fn is None:
        raise SystemExit(f"VOZ desconocida: {VOZ}")
    x = np.asarray(fn(**ARGS), dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if REPETICIONES > 1:
        x = np.tile(x, REPETICIONES)
    x = x - x.mean()
    if FADE_MS > 0:
        n = max(int(dsp.SR * FADE_MS / 1000.0), 2)
        n = min(n, len(x))
        x[-n:] *= np.linspace(1.0, 0.0, n)
    pico = max(float(np.max(np.abs(x))), 1e-9)
    x *= (10.0 ** (PEAK_DBFS / 20.0)) / pico
    return x


def main():
    x = render()
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

/** Ruta del script generado, relativa a `workspace/`. */
export function rutaScriptDeSonido(receta: RecetaSonido): string {
  return `codigo/experimental/sonido_${receta.nombre}.py`;
}

/** Ruta del WAV, relativa a la carpeta del proyecto. */
export function rutaWavDeSonido(receta: RecetaSonido): string {
  return `sonidos/${receta.nombre}.wav`;
}
