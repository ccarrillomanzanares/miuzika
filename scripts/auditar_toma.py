"""Auditoria independiente de una toma: mide el tarareo por su cuenta.

No usa analyze.py. Lee el WAV original, saca la F0 con pyin (parametros
distintos a los de la app) y la compara con lo que la app transcribio.

Uso:  python scripts/auditar_toma.py cache/tomas/toma_XXX_original.wav
"""
import sys
from pathlib import Path

import librosa
import numpy as np
import pretty_midi

SR = 22050
FMIN = librosa.note_to_hz("C2")   # 65 Hz
FMAX = librosa.note_to_hz("C6")   # 1046 Hz


def f0_pyin(wav):
    """F0 cruda con pyin. Devuelve tiempos, frecuencias y confianza."""
    y, sr = librosa.load(wav, sr=SR, mono=True)
    # quitar silencio de cabeza y cola
    y, _ = librosa.effects.trim(y, top_db=35)
    f0, voiced, vprob = librosa.pyin(
        y, fmin=FMIN, fmax=FMAX, sr=sr,
        frame_length=2048, hop_length=256,
        fill_na=np.nan, center=True,
    )
    t = librosa.times_like(f0, sr=sr, hop_length=256)
    return y, sr, t, f0, voiced, vprob


def segmentar(t, f0, voiced):
    """Trocea el contorno en notas estables (mediana + redondeo a semitono)."""
    idx = np.where(voiced & np.isfinite(f0))[0]
    if len(idx) == 0:
        return []
    notas = []
    ini = idx[0]
    prev = idx[0]
    for k in idx[1:]:
        if k - prev > 8:                 # hueco > ~90 ms -> nueva nota
            notas.append((ini, prev))
            ini = k
        prev = k
    notas.append((ini, prev))
    salida = []
    for a, b in notas:
        if b - a < 3:                    # menos de ~35 ms: ruido
            continue
        seg = f0[a:b + 1]
        seg = seg[np.isfinite(seg)]
        if len(seg) == 0:
            continue
        med = float(np.median(seg))
        midi = int(round(librosa.hz_to_midi(med)))
        cents = 1200 * np.log2(med / librosa.midi_to_hz(midi))
        salida.append({
            "t_ini": round(float(t[a]), 3),
            "t_fin": round(float(t[b]), 3),
            "dur": round(float(t[b] - t[a]), 3),
            "hz": round(med, 1),
            "midi": midi,
            "nota": librosa.midi_to_note(midi),
            "cents": round(float(cents), 1),
        })
    return salida


def main():
    wav = Path(sys.argv[1])
    nombre = wav.name.replace("_original.wav", "")
    midi_app = wav.with_name(nombre + ".mid")

    print(f"== auditoria: {wav.name} ==")
    y, sr, t, f0, voiced, vprob = f0_pyin(wav)
    print(f"audio util: {len(y)/sr:.2f} s   (tras recortar silencio)")
    print(f"frames con voz: {int(voiced.sum())} de {len(voiced)}")

    mia = segmentar(t, f0, voiced)
    print(f"\n-- mi lectura: {len(mia)} notas --")
    for n in mia:
        print(f"  {n['t_ini']:6.2f}s  {n['dur']:5.2f}s  {n['nota']:>4}  "
              f"{n['hz']:7.1f} Hz  desvio {n['cents']:+5.1f} cents")

    if midi_app.exists():
        pm = pretty_midi.PrettyMIDI(str(midi_app))
        app = []
        for ins in pm.instruments:
            app += [(round(n.start, 3), round(n.end - n.start, 3), n.pitch)
                    for n in ins.notes]
        app.sort()
        print(f"\n-- la app: {len(app)} notas --")
        for s, d, p in app:
            print(f"  {s:6.2f}s  {d:5.2f}s  {librosa.midi_to_note(p):>4}  midi {p}")

        print(f"\n-- comparacion --")
        print(f"  notas mias: {len(mia)}   notas app: {len(app)}   "
              f"diferencia: {len(mia) - len(app):+d}")
        # emparejar por orden temporal y ver desvio de tono
        n = min(len(mia), len(app))
        if n:
            difs = [mia[i]["midi"] - app[i][2] for i in range(n)]
            octavas = [d / 12 for d in difs if d % 12 == 0 and d != 0]
            print(f"  desvio de tono (semitonos): mediana {np.median(difs):+.1f}  "
                  f"max {max(difs, key=abs):+d}")
            if octavas:
                print(f"  AVISO: {len(octavas)} notas a distancia de octava exacta")


if __name__ == "__main__":
    main()
