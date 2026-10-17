"""Busca los parametros de deteccion de ataques que mejor describen el tarareo.

Criterio: si el usuario canta un pulso regular, los intervalos entre notas
deben ser parecidos entre si. Medimos la dispersion relativa (coef. de
variacion) y buscamos el minimo con un numero de notas razonable.
"""
import sys
import numpy as np
import librosa
import soundfile as sf


def main(path):
    d, sr = sf.read(path)
    m = d[:, 0] if d.ndim > 1 else d
    m, _ = librosa.effects.trim(np.asarray(m, dtype=np.float32), top_db=35)
    print(f"audio util: {len(m)/sr:.2f} s")
    print(f"{'wait':>5} {'delta':>6} {'ataques':>8} {'iv.med(ms)':>11} "
          f"{'cv':>6}  valoracion")
    print("-" * 62)

    hop = 128
    mejores = []
    for wait in (10, 15, 20, 25, 30):
        for delta in (0.02, 0.03, 0.04, 0.05):
            on = librosa.onset.onset_detect(
                y=m, sr=sr, hop_length=hop, delta=delta, units="time",
                pre_max=3, post_max=3, pre_avg=3, post_avg=3, wait=wait)
            if len(on) < 8:
                continue
            iv = np.diff(on)
            med = float(np.median(iv))
            cv = float(np.std(iv) / med) if med > 0 else 9.9
            # penalizamos tanto el desorden como alejarse de 64 notas
            pen = abs(len(on) - 64) / 64
            nota = cv + pen
            mejores.append((nota, wait, delta, len(on), med, cv))
    mejores.sort()
    for nota, wait, delta, n, med, cv in sorted(
            mejores, key=lambda x: (x[1], x[2])):
        print(f"{wait:5d} {delta:6.2f} {n:8d} {med*1000:11.0f} {cv:6.2f}")

    print("\nlos 5 mejores (menos desorden y mas cerca de 64 notas):")
    for nota, wait, delta, n, med, cv in mejores[:5]:
        print(f"  wait={wait:3d} delta={delta:.2f}  ->  {n:3d} notas, "
              f"intervalo {med*1000:.0f} ms, dispersion {cv:.2f}  "
              f"(puntuacion {nota:.3f})")


if __name__ == "__main__":
    main(sys.argv[1])
