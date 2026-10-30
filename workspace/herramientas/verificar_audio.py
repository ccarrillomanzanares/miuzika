"""Objective metrics for a WAV (numpy + wave, no external dependencies).

Usage: python herramientas/verificar_audio.py <path.wav>

Prints: format, duration, peak, RMS, crest, DC, clipped samples and stereo
correlation. This is what the agent should call instead of writing its own analyser.
"""

import sys
import wave

import numpy as np


def leer(path):
    with wave.open(path, "rb") as w:
        nch, sw, sr, nframes = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        bruto = w.readframes(nframes)
    if sw == 2:
        x = np.frombuffer(bruto, dtype="<i2").astype(np.float64) / 32768.0
    elif sw == 3:
        b = np.frombuffer(bruto, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ent = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        ent = np.where(ent & 0x800000, ent - 0x1000000, ent)
        x = ent.astype(np.float64) / 8388608.0
    elif sw == 4:
        x = np.frombuffer(bruto, dtype="<i4").astype(np.float64) / 2147483648.0
    else:
        raise SystemExit(f"unsupported bit depth: {sw} bytes")
    if nch > 1:
        x = x.reshape(-1, nch)
    return x, sr, nch, sw


def db(v):
    return 20.0 * np.log10(max(float(v), 1e-12))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python herramientas/verificar_audio.py <path.wav>")
    x, sr, nch, sw = leer(sys.argv[1])
    mono = x.mean(axis=1) if x.ndim > 1 else x
    pico = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(mono ** 2)))
    dur = len(mono) / sr
    clip = int(np.sum(np.abs(x) >= 0.99999))
    dc = float(np.mean(mono))
    crest = db(pico) - db(rms) if rms > 0 else 0.0
    corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1]) if x.ndim > 1 and nch >= 2 else float("nan")
    # useful tail: last instant above -60 dBFS
    ventana = max(int(sr * 0.01), 1)
    trozos = np.abs(mono[: len(mono) // ventana * ventana]).reshape(-1, ventana).max(axis=1)
    idx = np.where(trozos > 10 ** (-60 / 20))[0]
    cola = (idx[-1] + 1) * ventana / sr if len(idx) else 0.0

    print("== FORMAT ==")
    print(f"channels={nch}  bits={sw * 8}  sr={sr}  frames={len(mono)}  dur={dur:.3f}s")
    print("== LEVELS ==")
    print(f"peak={db(pico):.2f} dBFS  rms={db(rms):.2f} dBFS  crest={crest:.2f} dB")
    print(f"dc={dc * 1000:.3f} mL  clipped={clip}  correlation={corr:.3f}")
    print(f"useful tail up to t={cola:.2f}s")
    ok = clip == 0 and pico > 0.01 and abs(dc) < 0.01
    print("VERDICT:", "OK" if ok else "REVIEW")


if __name__ == "__main__":
    main()
