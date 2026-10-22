# -*- coding: utf-8 -*-
"""Sample de 2 s con metal_hit del motor. No define motor: solo lo usa."""
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import dsp as D                      # noqa: E402
import instruments as I              # noqa: E402
from render import place, write_wav  # noqa: E402

DUR = 2.0
SALIDA = os.path.join(AQUI, "..", "salida", "sample_agente.wav")

# (t, pitch, pan, ganancia) - mismos pitches que usa render.gen_bateria
GOLPES = [
    (0.000, 1.00, -0.75, 0.90),
    (0.280, 1.19, 0.75, 0.70),
    (0.560, 0.84, -0.55, 0.80),
    (0.840, 1.41, 0.55, 0.62),
    (1.120, 0.71, -0.35, 0.72),
    (1.400, 1.58, 0.35, 0.58),
]


def construir_sample():
    n = int(round(DUR * D.SR))
    buf = np.zeros((n, 2), np.float32)
    for i, (t, pitch, p, g) in enumerate(GOLPES):
        y = I.metal_hit(vel=1.0, seed=i, pitch=pitch, dur=0.9)
        place(buf, y, t, g, p)

    # cola de reverb corta para que no corte seco
    ir_l = D.reverb_ir(0.9, 0.30, seed=31, lp_hz=6000.0)
    ir_r = D.reverb_ir(0.9, 0.30, seed=32, lp_hz=6000.0)
    wet = np.stack([D.reverb(buf[:, 0], ir_l)[:n],
                     D.reverb(buf[:, 1], ir_r)[:n]], axis=1)
    buf = buf * 0.82 + wet * 0.18

    buf = buf - buf.mean(axis=0, keepdims=True)
    buf = D.normalize_peak(buf, -1.0)
    k = int(0.040 * D.SR)
    buf[-k:] *= np.linspace(1.0, 0.0, k)[:, None]
    return buf.astype(np.float32)


def ejecutar_sample():
    x = construir_sample()
    os.makedirs(os.path.dirname(os.path.abspath(SALIDA)), exist_ok=True)
    write_wav(SALIDA, x, width=3)
    print("escrito", os.path.abspath(SALIDA))
    print("dur=%.3fs  pico=%.2f dBFS  rms=%.2f dBFS  crest=%.2f dB  lufs=%.1f"
          % (len(x) / D.SR, D.lin2db(np.max(np.abs(x))), D.rms_db(x),
             D.crest_db(x), D.lufs_integrated(x)))


if __name__ == "__main__":
    ejecutar_sample()
