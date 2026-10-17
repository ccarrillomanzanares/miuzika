"""Volcado crudo del tarareo: tono (f0) y energia por frame, sin segmentar.

Objetivo: ver con los ojos cuantas notas hay de verdad, sin que opine
ni nuestro segmentador ni la app. Solo librosa.pyin + RMS.
"""
import sys
import numpy as np
import librosa
import soundfile as sf


def main(path):
    d, sr = sf.read(path)
    mono = d[:, 0] if d.ndim > 1 else d
    mono = np.asarray(mono, dtype=np.float32)

    # recortar silencio igual que el analizador
    mono, _ = librosa.effects.trim(mono, top_db=35)

    hop = 256
    f0, voiced, vprob = librosa.pyin(
        mono, fmin=65.0, fmax=1046.0, sr=sr,
        frame_length=2048, hop_length=hop, fill_na=np.nan,
    )
    rms = librosa.feature.rms(y=mono, frame_length=2048, hop_length=hop)[0]
    t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)

    # energia relativa
    rmax = rms.max() or 1e-9
    rn = rms / rmax

    # detectar "dips" de energia = posibles fronteras de nota
    # una nota corta = subida y bajada de energia
    # contamos cuantos minimos locales bajan por debajo de 0.35 tras pico
    print(f"audio util: {len(mono)/sr:.2f} s   frames: {len(f0)}")
    print(f"{'t(s)':>6} {'f0(Hz)':>8} {'nota':>5} {'rms':>6}  contorno")
    print("-" * 60)

    paso = 8  # cada ~46 ms
    for i in range(0, len(f0), paso):
        f = f0[i]
        nombre = "-"
        if not np.isnan(f) and voiced[i]:
            m = int(round(librosa.hz_to_midi(f)))
            nombre = librosa.midi_to_note(m)
        barra = "#" * int(rn[i] * 30)
        print(f"{t[i]:6.2f} {f if not np.isnan(f) else 0:8.1f} {nombre:>5} {rn[i]:6.2f}  {barra}")

    # resumen de energia: contar cuantos "valles" claros hay
    # suavizar rms
    k = 5
    rs = np.convolve(rn, np.ones(k) / k, mode="same")
    valles = 0
    for i in range(2, len(rs) - 2):
        if rs[i] < 0.35 and rs[i] <= rs[i - 1] and rs[i] <= rs[i + 1]:
            if rs[i - 1] > 0.45 or rs[i + 1] > 0.45:
                valles += 1
    print("-" * 60)
    print(f"posibles cortes por energia (valles): {valles}")
    print(f"-> eso sugeriria ~{valles+1} notas con separacion clara")


if __name__ == "__main__":
    main(sys.argv[1])
