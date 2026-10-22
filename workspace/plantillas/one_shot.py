"""PLANTILLA de one-shot: usa el motor, no escribas otro.

Copia este fichero a codigo/mi_sample.py, cambia PARAMS y ejecuta:
    python codigo/mi_sample.py

Los timbres viven en codigo/instruments.py; el DSP en codigo/dsp.py.
"""

import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "codigo"))

import dsp          # noqa: E402
import instruments  # noqa: E402

# ── PARAMS ────────────────────────────────────────────────────────────────
VOZ = "metal_hit"                                  # kick|snare|hat|metal_hit|bass_note|piano_note|drone_note
ARGS = {"vel": 1.0, "pitch": 0.85, "dur": 1.6}     # kwargs de esa voz (ver MANIFEST.md)
REPETICIONES = 1
SALIDA = os.path.join(AQUI, "..", "salida", "sample.wav")
PEAK_DBFS = -1.0
FADE_MS = 25.0
# ───────────────────────────────────────────────────────────────────────────


def render():
    fn = getattr(instruments, VOZ, None)
    if fn is None:
        raise SystemExit(f"VOZ desconocida: {VOZ}. Mira MANIFEST.md")
    x = np.asarray(fn(**ARGS), dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if REPETICIONES > 1:
        x = np.tile(x, REPETICIONES)
    x = x - x.mean()
    n = max(int(dsp.SR * FADE_MS / 1000.0), 2)
    x[-n:] *= np.linspace(1.0, 0.0, n)
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
    print(f"voz={VOZ}  dur={len(x) / dsp.SR:.3f}s  pico={pico:.2f} dBFS  rms={rms:.2f} dBFS  crest={pico - rms:.2f} dB")
    print("verifica con: python herramientas/verificar_audio.py " + SALIDA)


if __name__ == "__main__":
    main()
