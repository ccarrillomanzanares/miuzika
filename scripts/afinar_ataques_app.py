"""Afina los parametros de deteccion de ataques SOBRE EL AUDIO REAL DE LA APP.

Aviso de escarmiento: los parametros hay que afinarlos con el mismo audio y
el mismo sample rate que usa el analizador. Antes los afinamos leyendo el
fichero con soundfile a 44.100 Hz y luego la app analiza a 22.050 Hz, asi que
`wait=15` frames significaba 43 ms en un sitio y 87 ms en el otro, y la cuenta
de notas pasaba de 64 a 23 sin que nada avisara. hop y wait son en FRAMES:
siempre hay que mirarlos en milisegundos.

Uso: python scripts/afinar_ataques_app.py cache/tomas/toma_X_original.wav [objetivo]
"""
import sys

import librosa
import numpy as np
from humseed import analyze


def main(path, objetivo=64):
    y = analyze.load_audio(path)          # exactamente lo que ve el analizador
    sr = analyze.SR
    print(f"audio: {len(y)/sr:.2f} s a {sr} Hz (via load_audio, sin recortar)")
    print(f"objetivo: {objetivo} notas\n")
    print(f"{'hop':>4} {'ms/frame':>9} {'wait':>5} {'wait(ms)':>9} {'delta':>6} "
          f"{'ataques':>8} {'iv.med(ms)':>11} {'disp':>6}")
    print("-" * 72)

    filas = []
    for hop in (64, 128, 256):
        ms = hop / sr * 1000
        for wait in (5, 8, 10, 12, 15, 20, 25):
            for delta in (0.008, 0.012, 0.02, 0.03, 0.04):
                on = librosa.onset.onset_detect(
                    y=y, sr=sr, hop_length=hop, delta=delta, wait=wait,
                    pre_max=3, post_max=3, pre_avg=3, post_avg=3, units="time")
                if len(on) < 10:
                    continue
                iv = np.diff(on)
                med = float(np.median(iv))
                disp = float(np.std(iv) / med) if med > 0 else 9.9
                filas.append((abs(len(on) - objetivo) / objetivo + disp,
                              hop, ms, wait, wait * ms, delta, len(on), med, disp))
    filas.sort()
    for _, hop, ms, wait, wms, delta, n, med, disp in filas[:18]:
        print(f"{hop:4d} {ms:9.1f} {wait:5d} {wms:9.1f} {delta:6.3f} {n:8d} "
              f"{med*1000:11.0f} {disp:6.2f}")

    print("\n=== el mejor ===")
    _, hop, ms, wait, wms, delta, n, med, disp = filas[0]
    print(f"hop={hop} ({ms:.1f} ms/frame)  wait={wait} ({wms:.0f} ms)  delta={delta}")
    print(f"-> {n} notas, intervalo {med*1000:.0f} ms, dispersion {disp:.2f}")
    print(f"\npara pegar en analyze.detect_onsets:")
    print(f"    hop_length={hop}, delta={delta}, wait={wait}")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 64)
