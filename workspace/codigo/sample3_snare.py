"""One-shot de caja (snare) del motor, recortado/rellenado a exactamente 1.0 s.

Usa instruments.snare y dsp del motor; no reimplementa nada.
Salida: salida/sample3.wav
"""

import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import dsp          # noqa: E402
import instruments  # noqa: E402

# ── PARAMS ────────────────────────────────────────────────────────────────
VEL = 1.0
SEED = 0
DUR_S = 1.0
SALIDA = os.path.join(AQUI, "..", "salida", "sample3.wav")
PEAK_DBFS = -1.0
FADE_MS = 15.0
# ───────────────────────────────────────────────────────────────────────────


def render():
    x = np.asarray(instruments.snare(vel=VEL, seed=SEED), dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = x - float(np.mean(x))

    n = int(round(dsp.SR * DUR_S))
    if len(x) >= n:
        x = x[:n].copy()
    else:
        x = np.concatenate([x, np.zeros(n - len(x))])

    # fade-out corto al final para no cortar en seco
    nf = max(int(dsp.SR * FADE_MS / 1000.0), 2)
    x[-nf:] *= np.linspace(1.0, 0.0, nf)

    x *= (10.0 ** (PEAK_DBFS / 20.0)) / max(float(np.max(np.abs(x))), 1e-9)
    return x


def escribir(path, mono):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    est = np.stack([mono, mono], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(dsp.SR)
        w.writeframes(pcm.tobytes())


def main():
    x = render()
    escribir(SALIDA, x)
    pico = 20 * np.log10(max(float(np.max(np.abs(x))), 1e-12))
    rms = 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))
    print(f"escrito {SALIDA}")
    print(f"voz=snare  sr={dsp.SR}  dur={len(x) / dsp.SR:.4f}s  "
          f"pico={pico:.2f} dBFS  rms={rms:.2f} dBFS  crest={pico - rms:.2f} dB")


if __name__ == "__main__":
    main()
