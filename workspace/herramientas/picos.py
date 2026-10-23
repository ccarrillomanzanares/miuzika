"""Calcula los picos de un WAV para dibujar la onda sin decodificarlo en el cliente.

Uso: python herramientas/picos.py <ruta.wav> [cubos]

Imprime JSON: {"cubos": N, "picos": [0..1, ...]}. Vectorizado con numpy: un stem
de 6 minutos (99 MB, 24 bit) tarda ~2 s en vez de 40.
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
    raise SystemExit(f"profundidad no soportada: {ancho} bytes")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("uso: python herramientas/picos.py <ruta.wav> [cubos]")
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

    magnitud = np.abs(muestras)  # entrelazado: el canal da igual para la onda
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
