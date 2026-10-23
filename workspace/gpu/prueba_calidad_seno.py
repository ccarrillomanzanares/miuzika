"""Cuanto aliasing mete la saturacion con y sin sobremuestreo.

Prueba limpia: un seno puro a 997 Hz (frecuencia no divisora de la de muestreo,
para que los productos de aliasing caigan en sitios que NO son armonicos) pasado
por la misma saturacion a 1x, 4x y 16x.

Aviso aprendido: medir esto sobre el bajo del motor numpy no vale, porque ese
bajo lleva un oscilador desafinado (x1,006) y sus parciales no son armonicos
exactos; el medidor los confunde con aliasing. Con un seno puro no hay duda.
"""

import math
import os
import sys

import numpy as np
import torch

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import motor_gpu as M     # noqa: E402

SALIDA = os.path.join(AQUI, "..", "proyectos", "vitrina", "salida")
F0 = 997.0
SEGUNDOS = 2.0
DRIVE = 8.0


def medir(x, f0=F0, sr=M.SR):
    """Energia fuera de los armonicos de f0, en dB respecto al fundamental."""
    v = x.detach().cpu().numpy().astype(np.float64)
    n = 1 << int(np.ceil(np.log2(len(v))))
    P = np.abs(np.fft.rfft(v * np.hanning(len(v)), n)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    fundamental = P[(f > f0 * 0.9) & (f < f0 * 1.1)].sum() or 1e-20

    armonicos = np.zeros_like(f, dtype=bool)
    k = 1
    while k * f0 < sr / 2:
        armonicos |= (f > k * f0 * 0.995) & (f < k * f0 * 1.005)
        k += 1
    # los productos de aliasing caen en |k*f0 - m*fs|: casi nunca en k*f0
    resto = P[(~armonicos) & (f > 20)].sum()
    return {
        "aliasing_db": 10 * math.log10(max(resto, 1e-20) / fundamental),
        "armonicos_db": 10 * math.log10(max(float(P[armonicos].sum()), 1e-20) / fundamental),
    }


def main():
    print(f"motor GPU: {M.DISPOSITIVO} | seno {F0:.0f} Hz, drive {DRIVE}, {SEGUNDOS:.0f} s")
    n = int(SEGUNDOS * M.SR)
    t = M.segundos(n)
    seno = 0.9 * torch.sin(2 * torch.pi * F0 * t)

    resultados = {}
    for veces in (1, 4, 16):
        y = M.saturar(seno, drive=DRIVE, veces=veces)
        m = medir(y)
        resultados[veces] = m
        print(f"  {veces:>2}x: aliasing {m['aliasing_db']:7.1f} dB | "
              f"armonicos {m['armonicos_db']:6.1f} dB | pico {y.abs().max():.3f}")
        M.escribir_wav(os.path.join(SALIDA, f"calidad_seno_{veces}x.wav"), torch.stack([y, y]), pico_db=-1.0)

    print(f"\n1x -> 16x: {resultados[1]['aliasing_db'] - resultados[16]['aliasing_db']:+.1f} dB de aliasing menos")
    print(f"1x -> 4x : {resultados[1]['aliasing_db'] - resultados[4]['aliasing_db']:+.1f} dB")

    print("\nCoste del sobremuestreo:")
    import time

    for veces in (1, 16):
        torch.cuda.synchronize()
        t0 = time.time()
        for _ in range(20):
            M.saturar(seno, drive=DRIVE, veces=veces)
        torch.cuda.synchronize()
        print(f"  {veces:>2}x: {(time.time() - t0) / 20 * 1000:.1f} ms para {SEGUNDOS:.0f} s")


if __name__ == "__main__":
    main()
