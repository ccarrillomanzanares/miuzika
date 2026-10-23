"""Prueba de calidad: cuanto ruido de aliasing mete cada motor.

Tres versiones de la MISMA nota:
  A) motor numpy existente (sin sobremuestreo), tal como suena hoy
  B) motor GPU con el mismo diseno y sin sobremuestreo (veces=1)
  C) motor GPU con 16x

B contra C aisla el efecto del sobremuestreo: mismo oscilador, mismo filtro,
mismo drive. A contra C es motor contra motor.

Metrica: energia NO armonica (aliasing) respecto al fundamental, y energia por
encima de 15 kHz, que en un bajo no deberia existir.
"""

import math
import os
import sys

import numpy as np
import torch

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "..", "codigo"))
sys.path.insert(0, os.path.join(AQUI, "..", "proyectos", "vitrina"))

import base as V          # noqa: E402
import motor_gpu as M     # noqa: E402

SALIDA = os.path.join(AQUI, "..", "proyectos", "vitrina", "salida")
NOTA = 33
DUR = 4.0


def metricas(x, f0, sr=M.SR):
    """Aliasing: energia que no cae en armonicos de f0. Mas bajo = mas limpio."""
    v = x.detach().cpu().numpy().astype(np.float64)
    if v.ndim > 1:
        v = v.mean(axis=0)
    n = 1 << int(np.ceil(np.log2(len(v))))
    P = np.abs(np.fft.rfft(v * np.hanning(len(v)), n)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    fundamental = P[(f > f0 * 0.9) & (f < f0 * 1.1)].sum() or 1e-20
    armonicos = np.zeros_like(f, dtype=bool)
    k = 1
    while k * f0 < sr / 2:
        armonicos |= (f > k * f0 * 0.97) & (f < k * f0 * 1.03)
        k += 1
    resto = P[(~armonicos) & (f > 30)].sum()
    agudos = P[(f > 15000)].sum()
    total = P.sum() or 1e-20
    return {
        "aliasing_db": 10 * math.log10(max(resto, 1e-20) / fundamental),
        "agudos_db": 10 * math.log10(max(agudos, 1e-20) / total),
        "pico": float(np.max(np.abs(v))),
        "rms": float(np.sqrt(np.mean(v ** 2))),
    }


def main():
    print(f"motor GPU: {M.DISPOSITIVO}")
    f0 = V.hz(NOTA)

    # A) motor numpy de verdad
    import instruments

    a_np = instruments.bass_note(NOTA, DUR, vel=0.9, seed=7, squelch=0.5, bright=1.0)
    a = torch.from_numpy(np.asarray(a_np, dtype=np.float32))

    # B y C) el mismo diseno en GPU, sin y con sobremuestreo
    versiones = {}
    for veces in (1, 16):
        # voz_bajo acepta el sobremuestreo por argumento (sat): mismo diseno,
        # unica diferencia el factor. Nada de tocar __defaults__.
        salida, largo = V.voz_bajo([NOTA], [DUR], [0.9], sat=veces)
        versiones[veces] = salida[0]

    resultados = {}
    for nombre, senal in (("A numpy", a), ("B GPU 1x", versiones[1]), ("C GPU 16x", versiones[16])):
        m = metricas(senal, f0)
        resultados[nombre] = m
        print(f"  {nombre:<10} aliasing {m['aliasing_db']:7.1f} dB | >15 kHz {m['agudos_db']:7.1f} dB "
              f"| pico {m['pico']:.3f}")

    # WAV para escuchar
    M.escribir_wav(os.path.join(SALIDA, "calidad_A_numpy.wav"), torch.stack([a, a]), pico_db=-1.0)
    M.escribir_wav(os.path.join(SALIDA, "calidad_B_gpu1x.wav"), torch.stack([versiones[1], versiones[1]]), pico_db=-1.0)
    M.escribir_wav(os.path.join(SALIDA, "calidad_C_gpu16x.wav"), torch.stack([versiones[16], versiones[16]]), pico_db=-1.0)

    print(f"\nsobremuestreo (B -> C): {resultados['B GPU 1x']['aliasing_db'] - resultados['C GPU 16x']['aliasing_db']:+.1f} dB menos aliasing")
    print(f"motor numpy -> GPU 16x: {resultados['A numpy']['aliasing_db'] - resultados['C GPU 16x']['aliasing_db']:+.1f} dB menos aliasing")
    print(f"WAV en {SALIDA}")


if __name__ == "__main__":
    main()
