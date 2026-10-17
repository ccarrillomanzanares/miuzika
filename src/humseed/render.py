"""Render: ABC notation -> MIDI -> WAV (soundfont).

Cadena verificada en Windows sin GPU:
    ABC (texto)  --music21-->  MIDI  --fluidsynth-->  WAV

El modelo entrenado (LoRA) escupe ABC; esto lo convierte en algo audible.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FLUIDSYNTH = ROOT / "tools" / "fluidsynth-v2.6.1-win10-x64-cpp11" / "bin" / "fluidsynth.exe"
DEFAULT_SOUNDFONT = ROOT / "tools" / "MuseScore_General.sf3"

# GM: programas utiles para el palo rock/industrial
GM = {
    "lead": 29,       # overdriven guitar
    "dist": 30,       # distortion guitar
    "clean": 27,      # electric clean
    "bass": 33,       # fingered bass
    "synthbass": 38,  # synth bass 1
    "pad": 89,        # warm pad
    "strings": 48,    # string ensemble
    "organ": 19,      # church organ
    "piano": 0,
    "choir": 52,
}


def find_fluidsynth() -> str:
    if env := os.environ.get("FLUIDSYNTH_BIN"):
        return env
    if DEFAULT_FLUIDSYNTH.exists():
        return str(DEFAULT_FLUIDSYNTH)
    if found := shutil.which("fluidsynth"):
        return found
    raise FileNotFoundError(
        "fluidsynth no encontrado. Descarga el build de Windows en "
        "https://github.com/FluidSynth/fluidsynth/releases o define FLUIDSYNTH_BIN."
    )


def find_soundfont() -> str:
    if env := os.environ.get("SOUNDFONT"):
        return env
    for cand in (DEFAULT_SOUNDFONT, ROOT / "tools" / "MuseScore_General.sf2"):
        if cand.exists():
            return str(cand)
    raise FileNotFoundError(
        "Soundfont no encontrado. Pon un .sf2/.sf3 en tools/ o define SOUNDFONT."
    )


def _is_multivoice(abc_text: str) -> bool:
    """True solo si hay mas de una voz o lleva directiva nuestra.

    Con una sola voz se deja a music21, que es como se genero la transcripcion
    que el usuario valido: el motor propio daba notas identicas pero otra
    articulacion, y el usuario noto la diferencia.
    """
    voices = {m.group(1) for m in re.finditer(r"(?m)^\s*\[?V:\s*([^\s\]]+)", abc_text)}
    return len(voices) > 1 or "%%humseed" in abc_text


def abc_to_midi(abc_text: str, out_midi: str | Path) -> Path:
    """ABC -> MIDI. Multivoz usa abcmini; una voz usa music21."""
    out_midi = Path(out_midi)
    out_midi.parent.mkdir(parents=True, exist_ok=True)

    if _is_multivoice(abc_text):
        from humseed import abcmini, drums

        score = abcmini.parse_abc(abc_text)
        abcmini.to_midi(score, out_midi, drums=drums)
        return out_midi

    from music21 import converter

    score = converter.parse(abc_text, format="abc")
    score.write("midi", fp=str(out_midi))
    return out_midi


def midi_to_wav(
    midi_path: str | Path,
    out_wav: str | Path,
    soundfont: str | None = None,
    samplerate: int = 44100,
    gain: float = 0.7,
) -> Path:
    """Sintetiza el MIDI a WAV con fluidsynth (render offline -F)."""
    fluid = find_fluidsynth()
    sf = soundfont or find_soundfont()
    out_wav = Path(out_wav)
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        fluid,
        "-ni",                      # sin audio en tiempo real
        "-g", str(gain),            # ganancia
        "-r", str(samplerate),
        "-F", str(out_wav),         # fichero de salida
        "-O", "s16",                # formato de muestra
        sf,
        str(midi_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not out_wav.exists():
        raise RuntimeError(
            f"fluidsynth fallo (rc={proc.returncode})\nSTDOUT:\n{proc.stdout[-2000:]}\n"
            f"STDERR:\n{proc.stderr[-2000:]}"
        )
    return out_wav


def abc_to_wav(abc_text: str, out_wav: str | Path, workdir: str | Path | None = None,
               samplerate: int = 44100, gain: float = 0.7) -> tuple[Path, Path]:
    """Atajo ABC -> (wav, midi). El MIDI se guarda junto al WAV."""
    out_wav = Path(out_wav)
    midi = (Path(workdir) / (out_wav.stem + ".mid")) if workdir else out_wav.with_suffix(".mid")
    abc_to_midi(abc_text, midi)
    midi_to_wav(midi, out_wav, samplerate=samplerate, gain=gain)
    return out_wav, midi


def main() -> None:
    ap = argparse.ArgumentParser(description="ABC -> MIDI -> WAV")
    ap.add_argument("abc", help="fichero .abc de entrada")
    ap.add_argument("-o", "--out", default=None, help="WAV de salida")
    ap.add_argument("--midi-only", action="store_true")
    args = ap.parse_args()

    abc_text = Path(args.abc).read_text(encoding="utf-8")
    out = Path(args.out) if args.out else Path(args.abc).with_suffix(".wav")

    if args.midi_only:
        print(abc_to_midi(abc_text, out.with_suffix(".mid")))
        return

    wav, midi = abc_to_wav(abc_text, out)
    size = wav.stat().st_size
    print(f"WAV:  {wav}  ({size/1024:.0f} KB)")
    print(f"MIDI: {midi}")


if __name__ == "__main__":
    main()
