"""Computes the peaks of a WAV to draw the waveform without decoding it on the client.

Usage: python herramientas/picos.py <path.wav> [buckets]

Prints JSON: {"cubos": N, "picos": [0..1, ...]}. Vectorized with numpy: a 6-minute
stem (99 MB, 24 bit) takes ~2 s instead of 40.
"""

import json
import sys
import wave

import numpy as np

CUBOS_POR_DEFECTO = 1024


def leer_muestras(bruto: bytes, ancho: int) -> np.ndarray:
    if ancho == 2:
        return np.frombuffer(bruto, dtype="<i2").astype(np.float32) / 32768.0
    if ancho == 4:
        return np.frombuffer(bruto, dtype="<i4").astype(np.float32) / 2147483648.0
    if ancho == 3:
        b = np.frombuffer(bruto, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ent = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        ent = np.where(ent & 0x800000, ent - 0x1000000, ent)
        return ent.astype(np.float32) / 8388608.0
    raise SystemExit(f"unsupported bit depth: {ancho} bytes")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python herramientas/picos.py <path.wav> [buckets]")
    ruta = sys.argv[1]
    cubos = max(16, min(8192, int(sys.argv[2]) if len(sys.argv) > 2 else CUBOS_POR_DEFECTO))

    with wave.open(ruta, "rb") as w:
        ancho = w.getsampwidth()
        total = w.getnframes()
        canales = w.getnchannels()
        sr = w.getframerate()
        bruto = w.readframes(total)

    muestras = leer_muestras(bruto, ancho)
    del bruto
    if muestras.size == 0:
        print(json.dumps({"cubos": 0, "picos": [], "duracionSeg": 0.0, "sr": sr, "canales": canales, "bits": ancho * 8}))
        return

    magnitud = np.abs(muestras)  # interleaved: the channel does not matter for the waveform
    cubos = min(cubos, magnitud.size)
    por_cubo = max(1, magnitud.size // cubos)
    recortado = magnitud[: por_cubo * cubos].reshape(cubos, por_cubo)
    picos = recortado.max(axis=1)

    print(
        json.dumps(
            {
                "cubos": int(picos.size),
                "picos": [round(float(p), 5) for p in picos],
                "duracionSeg": round(total / sr, 4),
                "sr": sr,
                "canales": canales,
                "bits": ancho * 8,
            }
        )
    )


if __name__ == "__main__":
    main()
