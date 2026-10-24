"""Mete un sample del catálogo en un proyecto: convierte, normaliza y lo deja listo.

    python codigo/importar_sample.py <origen> <slug> <nombre>

`origen` es la ruta dentro de `workspace/` (p.ej. catalogo/VCSL-.../Bass Drum 1/x.wav).
Escribe `proyectos/<slug>/samples/<nombre>.wav` en 44,1 kHz, 16 bits, estéreo y
normalizado a −1 dBFS, y devuelve un JSON con lo que ha hecho.

Tres decisiones que no son obvias:
  - Se convierte TODO a 44,1k/16b: la biblioteca trae 5 combinaciones distintas y el
    motor espera una. Convertir al entrar, no al usar.
  - Se normaliza a −1 dBFS de pico (la biblioteca viene de −85 a 0 dBFS), pero se
    guarda el pico original en el JSON: el fader necesita saber de dónde venía.
  - Mono se duplica a estéreo: un sample mono en una pista estéreo suena descentrado
    si el motor lo interpreta como canal izquierdo.
"""

import json
import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, ".."))
SR_DESTINO = 44100
PEAK_DBFS = -1.0


def leer_wav(ruta):
    with wave.open(ruta, "rb") as w:
        canales = w.getnchannels()
        ancho = w.getsampwidth()
        sr = w.getframerate()
        crudo = w.readframes(w.getnframes())
    if ancho == 2:
        datos = np.frombuffer(crudo, dtype="<i2").astype(np.float64) / 32768.0
    elif ancho == 3:
        b = np.frombuffer(crudo, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        entero = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        entero = np.where(entero >= 1 << 23, entero - (1 << 24), entero)
        datos = entero.astype(np.float64) / float(1 << 23)
    elif ancho == 4:
        datos = np.frombuffer(crudo, dtype="<i4").astype(np.float64) / float(1 << 31)
    else:
        datos = np.frombuffer(crudo, dtype=np.uint8).astype(np.float64) / 128.0 - 1.0
    if canales > 1:
        datos = datos.reshape(-1, canales)
    else:
        datos = datos.reshape(-1, 1)
    return datos, sr


def remuestrear(datos, sr_origen):
    """Remuestreo lineal por canal. Suficiente para entrar a 44,1k y no arrastrar
    dependencias; la alternativa (scipy) no está en el portátil."""
    if sr_origen == SR_DESTINO:
        return datos
    n_destino = int(round(datos.shape[0] * SR_DESTINO / sr_origen))
    x_viejo = np.arange(datos.shape[0])
    x_nuevo = np.linspace(0, datos.shape[0] - 1, n_destino)
    salida = np.empty((n_destino, datos.shape[1]), dtype=np.float64)
    for canal in range(datos.shape[1]):
        salida[:, canal] = np.interp(x_nuevo, x_viejo, datos[:, canal])
    return salida


def main(argv):
    if len(argv) < 3:
        print(json.dumps({"ok": False, "error": "uso: importar_sample.py <origen> <slug> <nombre>"}))
        return 1
    origen, slug, nombre = argv[0], argv[1], argv[2]
    ruta_origen = origen if os.path.isabs(origen) else os.path.join(RAIZ, origen)
    if not os.path.exists(ruta_origen):
        print(json.dumps({"ok": False, "error": f"no existe {origen}"}))
        return 1

    datos, sr = leer_wav(ruta_origen)
    pico_original = float(np.max(np.abs(datos))) if datos.size else 0.0
    datos = remuestrear(datos, sr)
    if datos.shape[1] == 1:
        datos = np.repeat(datos, 2, axis=1)
    elif datos.shape[1] > 2:
        datos = datos[:, :2]

    datos = datos - datos.mean(axis=0, keepdims=True)
    pico = float(np.max(np.abs(datos)))
    if pico > 0:
        datos = datos * (10.0 ** (PEAK_DBFS / 20.0)) / pico

    carpeta = os.path.join(RAIZ, "proyectos", slug, "samples")
    os.makedirs(carpeta, exist_ok=True)
    destino = os.path.join(carpeta, f"{nombre}.wav")
    pcm = np.clip(datos * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(destino, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR_DESTINO)
        w.writeframes(pcm.tobytes())

    print(
        json.dumps(
            {
                "ok": True,
                "ruta": f"samples/{nombre}.wav",
                "duracion_s": round(datos.shape[0] / SR_DESTINO, 3),
                "pico_original_dbfs": round(20 * np.log10(pico_original) if pico_original > 0 else -120, 2),
                "pico_final_dbfs": PEAK_DBFS,
                "canales": 2,
                "sr": SR_DESTINO,
                "bytes": os.path.getsize(destino),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
