"""Demuestra que el banco General MIDI ya esta disponible.

Coge el MIDI de una toma y renderiza la MISMA musica con varios instrumentos
del banco, cambiando solo el numero de programa. No hay que descargar nada:
MuseScore_General.sf3 es un soundfont General MIDI con 128 instrumentos, y
render.py solo tenia mapeados 10 a mano.

Uso: python scripts/probar_banco.py <midi> [segundos] [programa ...]
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pretty_midi

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import render  # noqa: E402

# nombres GM de los que vamos a probar, para leerlo en el informe
NOMBRES = {
    0: "piano", 4: "piano electrico", 19: "organo de iglesia",
    24: "guitarra española", 29: "guitarra overdrive", 30: "guitarra distorsion",
    33: "bajo pulsado", 38: "bajo sintetico", 48: "cuerdas", 52: "coro",
    56: "trompeta", 80: "sine lead", 89: "warm pad", 118: "bateria de sintetizador",
}


def trocear(origen: Path, segundos: float) -> pretty_midi.PrettyMIDI:
    """Se queda con los primeros `segundos` del MIDI."""
    pm = pretty_midi.PrettyMIDI(str(origen))
    for inst in pm.instruments:
        inst.notes = [n for n in inst.notes if n.start < segundos]
        for n in inst.notes:
            n.end = min(n.end, segundos)
    return pm


def main() -> int:
    origen = Path(sys.argv[1] if len(sys.argv) > 1
                  else ROOT / "cache" / "motores" / "bp.mid")
    segundos = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    programas = [int(x) for x in sys.argv[3:]] or [4, 29, 38, 52, 89]

    salida = ROOT / "cache" / "banco"
    salida.mkdir(parents=True, exist_ok=True)

    for prog in programas:
        pm = trocear(origen, segundos)
        for inst in pm.instruments:
            inst.program = prog
        midi = salida / f"prog_{prog:03d}.mid"
        wav = salida / f"prog_{prog:03d}.wav"
        mp3 = salida / f"prog_{prog:03d}.mp3"
        pm.write(str(midi))
        render.midi_to_wav(str(midi), str(wav))
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-af", f"afade=t=out:st={segundos - 1.2:.1f}:d=1.2",
             "-b:a", "192k", str(mp3)],
            check=True)
        nombre = NOMBRES.get(prog, "?")
        print(f"  programa {prog:3d}  {nombre:26} -> {mp3.name}")
        wav.unlink(missing_ok=True)

    print(f"\nficheros en {salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
