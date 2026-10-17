"""Compara herramientas de transcripcion sobre la misma toma.

Objetivo: dejar de opinar. Se pasa la misma grabacion por cada motor y se
miran las notas que saca cada uno: cuantas, que alturas, que duraciones.

Uso:  python scripts/comparar_motores.py <wav>
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pretty_midi  # noqa: E402
from humseed import analyze  # noqa: E402


def notas_de_midi(path: Path):
    pm = pretty_midi.PrettyMIDI(str(path))
    return sorted((round(n.start, 3), round(n.end - n.start, 3), n.pitch)
                  for i in pm.instruments for n in i.notes)


def resumen(nombre, notas, segundos=None):
    if not notas:
        print(f"  {nombre:38} SIN NOTAS")
        return
    alturas = [p for _, _, p in notas]
    durs = [d for _, d, _ in notas]
    nombre_notas = sorted({pretty_midi.note_number_to_name(p) for p in alturas})
    print(f"  {nombre:38} {len(notas):4d} notas  "
          f"alturas distintas {len(set(alturas)):2d}  "
          f"dur med {np.median(durs)*1000:4.0f} ms")
    print(f"  {'':38} alturas: {' '.join(nombre_notas[:20])}")
    if segundos:
        print(f"  {'':38} ({segundos:.1f} s de proceso)")


def main():
    wav = Path(sys.argv[1] if len(sys.argv) > 1 else
               "cache/tomas/toma_20261016_104442_original.wav")
    out = ROOT / "cache" / "motores"
    out.mkdir(parents=True, exist_ok=True)
    base = wav.stem.replace("_original", "")

    print(f"=== comparacion sobre {wav.name} ===\n")

    # --- 1. el nuestro ---
    import time
    t0 = time.time()
    seed = analyze.analyse(wav)
    abc = analyze.melodia_a_abc(seed)
    from humseed import render
    midi_nuestro = out / f"{base}_nuestro.mid"
    render.abc_to_midi(abc, midi_nuestro)
    resumen("humseed (pyin + ataques, lo mio)",
            notas_de_midi(midi_nuestro), time.time() - t0)

    # --- 2. basic pitch ---
    bp_py = ROOT / "tools" / "bp-venv" / "Scripts" / "python.exe"
    if bp_py.exists():
        t0 = time.time()
        r = subprocess.run(
            [str(bp_py), "-m", "basic_pitch", str(wav),
             "-o", str(out), "-s", "0.3", "-f", "0.5", "-m", "0.3"],
            capture_output=True, text=True, cwd=str(ROOT))
        candidatos = list(out.glob(f"{wav.stem}*.mid")) + \
            list(out.glob(f"{wav.stem}_basic_pitch.mid"))
        if candidatos:
            resumen("basic-pitch (Spotify)",
                    notas_de_midi(candidatos[0]), time.time() - t0)
        else:
            print(f"  basic-pitch: fallo -> {(r.stderr or r.stdout)[-300:]}")
    else:
        print("  basic-pitch: no instalado")

    # --- 3. aubio ---
    try:
        r = subprocess.run(["aubionotes", str(wav)], capture_output=True, text=True)
        eventos = []
        for linea in r.stdout.splitlines():
            partes = linea.split()
            if len(partes) == 3:
                try:
                    eventos.append((float(partes[0]), float(partes[1]), float(partes[2])))
                except ValueError:
                    pass
        if eventos:
            print(f"\n  aubio (aubionotes)  {len(eventos)} eventos "
                  f"sin duracion explicita; alturas MIDI: "
                  f"{sorted({round(e[2]) for e in eventos})[:20]}")
        else:
            print(f"\n  aubio: sin salida ({(r.stderr or '')[:150]})")
    except FileNotFoundError:
        print("\n  aubio: no instalado")

    print(f"\nMIDIs en {out}")


if __name__ == "__main__":
    main()
