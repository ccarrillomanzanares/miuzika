"""Cuenta los ataques (onsets) del tarareo con librosa, sin segmentador propio.

Si el usuario dice "16 + 16 + otra vuelta", aqui deberian salir ~64 ataques.
"""
import sys
import numpy as np
import librosa
import soundfile as sf


def main(path):
    d, sr = sf.read(path)
    mono = d[:, 0] if d.ndim > 1 else d
    mono = np.asarray(mono, dtype=np.float32)
    mono, _ = librosa.effects.trim(mono, top_db=35)

    # envolvente de energia en frames finos
    hop = 128
    rms = librosa.feature.rms(y=mono, frame_length=1024, hop_length=hop)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    rn = rms / (rms.max() or 1e-9)

    print(f"audio util: {len(mono)/sr:.2f} s")

    # onsets a varias sensibilidades
    for delta in (0.03, 0.05, 0.08):
        on = librosa.onset.onset_detect(
            y=mono, sr=sr, hop_length=hop, backtrack=False, delta=delta,
            units="time", pre_max=3, post_max=3, pre_avg=3, post_avg=3, wait=2,
        )
        print(f"  delta={delta:.2f}  ->  {len(on):3d} ataques")

    on = librosa.onset.onset_detect(
        y=mono, sr=sr, hop_length=hop, delta=0.05,
        units="time", pre_max=3, post_max=3, pre_avg=3, post_avg=3, wait=2,
    )
    print("\nlista de ataques (delta=0.05):")
    # imprimir en filas de 8
    for i in range(0, len(on), 8):
        fila = "  ".join(f"{x:6.2f}" for x in on[i:i + 8])
        print(f"  {fila}")

    # intervalos entre ataques consecutivos
    if len(on) > 1:
        difs = np.diff(on)
        print(f"\nintervalo mediano: {np.median(difs)*1000:.0f} ms")
        print(f"intervalo minimo : {difs.min()*1000:.0f} ms")
        print(f"intervalo maximo : {difs.max()*1000:.0f} ms")


if __name__ == "__main__":
    main(sys.argv[1])
