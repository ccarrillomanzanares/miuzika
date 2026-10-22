"""Sample one-shot de 1.5 s con el bajo del motor (instruments.bass_note)."""

import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import dsp          # noqa: E402
import instruments  # noqa: E402

# ── PARAMS ────────────────────────────────────────────────────────────────
MIDI = 38            # D2
DUR = 1.5            # segundos exactos
VEL = 1.0
SEED = 0
SQUELCH = 0.35
BRIGHT = 1.0
SALIDA = os.path.join(AQUI, "..", "salida", "sample2.wav")
PEAK_DBFS = -1.0
FADE_MS = 20.0
# ───────────────────────────────────────────────────────────────────────────


def render_bajo():
    x = np.asarray(
        instruments.bass_note(MIDI, DUR, vel=VEL, seed=SEED,
                               squelch=SQUELCH, bright=BRIGHT),
        dtype=float,
    )
    if x.ndim > 1:
        x = x.mean(axis=1)
    n_obj = int(round(DUR * dsp.SR))
    if len(x) < n_obj:
        x = np.pad(x, (0, n_obj - len(x)))
    else:
        x = x[:n_obj]
    x = x - float(np.mean(x))
    n = max(int(dsp.SR * FADE_MS / 1000.0), 2)
    x[-n:] *= np.linspace(1.0, 0.0, n)
    x *= (10.0 ** (PEAK_DBFS / 20.0)) / max(float(np.max(np.abs(x))), 1e-9)
    return x


def escribir_wav(path, mono):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    est = np.stack([mono, mono], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(dsp.SR)
        w.writeframes(pcm.tobytes())


def principal():
    x = render_bajo()
    escribir_wav(SALIDA, x)
    pico = 20 * np.log10(max(float(np.max(np.abs(x))), 1e-12))
    rms = 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))
    print(f"escrito {SALIDA}")
    print(f"midi={MIDI} ({dsp.note_hz(MIDI):.2f} Hz)  dur={len(x) / dsp.SR:.3f}s  "
          f"pico={pico:.2f} dBFS  rms={rms:.2f} dBFS  crest={pico - rms:.2f} dB")


if __name__ == "__main__":
    principal()
