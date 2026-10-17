"""Mide la ALTURA nota a nota con resolucion fina, sin aplanar con la mediana.

Sospecha: el analizador toma la mediana de la altura de cada nota. Si cada
nota se mueve (sube o baja) o si el tarareo tiene mas alturas de las que
creemos, la mediana las aplana y sale todo G2/E2 repetido.

Aqui, para cada nota: altura al principio, en medio y al final, y el rango.
Tambien compara pyin con ventana de 2048 (93 ms, lo de ahora) contra 1024
(46 ms, el doble de resolucion) sobre el mismo audio.
"""
import sys

import librosa
import numpy as np
from humseed import analyze

PATH = sys.argv[1] if len(sys.argv) > 1 else \
    "cache/tomas/toma_20261016_104442_original.wav"


def f0_con(y, frame_length, hop=128):
    f0, voiced, _ = librosa.pyin(
        y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"),
        sr=analyze.SR, hop_length=hop, frame_length=frame_length, fill_na=np.nan)
    t = librosa.times_like(f0, sr=analyze.SR, hop_length=hop)
    return t, f0, voiced


def main():
    y = analyze.load_audio(PATH)
    print(f"audio: {len(y)/analyze.SR:.2f} s\n")

    for fl in (2048, 1024):
        t, f0, v = f0_con(y, fl)
        ok = v & np.isfinite(f0)
        if not ok.any():
            print(f"ventana {fl}: sin voz"); continue
        mid = librosa.hz_to_midi(f0[ok])
        # dispersion de altura EN CENTESIMAS DE SEMITONO
        print(f"--- ventana {fl} ({fl/analyze.SR*1000:.0f} ms, "
              f"{len(t)} frames) ---")
        print(f"    altura: mediana {np.median(mid):.2f}  "
              f"p5 {np.percentile(mid,5):.2f}  p95 {np.percentile(mid,95):.2f}  "
              f"rango {np.percentile(mid,95)-np.percentile(mid,5):.2f} semitonos")
        # cuantas alturas distintas hay de verdad (histograma a 0,25 semitonos)
        hist, bordes = np.histogram(mid, bins=np.arange(mid.min(), mid.max()+0.25, 0.25))
        picos = hist > (0.02 * hist.sum())
        print(f"    alturas con peso >2%: {int(picos.sum())} cubos de 0,25 semitonos")
        print()

    # --- notas detectadas y su movimiento interno ---
    t, f0, v = f0_con(y, 1024)
    on = analyze.detect_onsets(y)
    print(f"notas (ataques): {len(on)}")
    print(f"{'n':>3} {'t':>6} {'dur':>5} {'inicio':>7} {'medio':>7} {'final':>7} "
          f"{'rango':>6}  {'nombre mediana':>14}")
    print("-" * 74)
    import librosa as lb
    for i in range(len(on) - 1):
        a = int(np.searchsorted(t, on[i]))
        b = int(np.searchsorted(t, on[i + 1]))
        seg = f0[a:b]
        seg = seg[np.isfinite(seg)]
        if len(seg) < 3:
            continue
        m = lb.hz_to_midi(seg)
        ini, med, fin = float(m[:max(1, len(m)//4)].mean()), float(np.median(m)), float(m[-max(1, len(m)//4):].mean())
        rango = float(np.percentile(m, 95) - np.percentile(m, 5))
        nota = lb.midi_to_note(int(round(med)))
        marca = "  <<< se mueve" if rango >= 1.5 else ""
        print(f"{i:3d} {on[i]:6.2f} {on[i+1]-on[i]:5.2f} {ini:7.2f} {med:7.2f} "
              f"{fin:7.2f} {rango:6.2f}  {nota:>14}{marca}")

    # alturas medianas de todas las notas, para ver cuantos valores distintos
    meds = []
    for i in range(len(on) - 1):
        a = int(np.searchsorted(t, on[i])); b = int(np.searchsorted(t, on[i + 1]))
        seg = f0[a:b]; seg = seg[np.isfinite(seg)]
        if len(seg) >= 3:
            meds.append(float(np.median(lb.hz_to_midi(seg))))
    if meds:
        print(f"\nalturas medianas de las {len(meds)} notas:")
        print("   " + " ".join(f"{x:.1f}" for x in meds))
        redondeadas = [int(round(x)) for x in meds]
        import collections
        print("   valores distintos (redondeados):",
              dict(collections.Counter(redondeadas).most_common()))


if __name__ == "__main__":
    main()
