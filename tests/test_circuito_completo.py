"""Prueba de INTEGRACION: circuito completo tarareo -> MIDI.

Necesita el VPS accesible por SSH (alias `vps`) con el modelo servido en el
puerto 8091. Es un test de integracion, no unitario: si el VPS no responde,
falla con un mensaje claro en vez de dar un falso OK.

    tarareo (sintetico) -> analyze -> semilla -> [VPS: modelo 3B] -> ABC -> MIDI -> WAV
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import abcmini, remoto  # noqa: E402
from humseed.analyze import analyse, seed_to_conditioning  # noqa: E402

# Melodia en Mi menor, aire de riff: E G A B A G E D E
MELODIA = [("E4", 1.0), ("G4", 0.5), ("A4", 0.5), ("B4", 1.0),
           ("A4", 0.5), ("G4", 0.5), ("E4", 1.0), ("D4", 1.0),
           ("E4", 2.0)]
TEMPO = 132.0


def sintetizar_tarareo(path: Path, sr: int = 44100) -> None:
    """Tarareo humano sintetico: vibrato, armonicos y ruido de fondo."""
    import librosa

    spb = 60.0 / TEMPO
    trozos = []
    for nombre, negras in MELODIA:
        dur = negras * spb
        n = int(dur * sr)
        t = np.arange(n) / sr
        midi = int(librosa.note_to_midi(nombre))
        f0 = 440.0 * 2 ** ((midi - 69) / 12)
        vib = 1.0 + 0.012 * np.sin(2 * np.pi * 5.2 * t)
        fase = 2 * np.pi * np.cumsum(f0 * vib) / sr
        tono = np.sin(fase) + 0.35 * np.sin(2 * fase) + 0.12 * np.sin(3 * fase)
        env = np.clip(np.minimum(t / 0.06, 1.0) * np.minimum((dur - t) / 0.12, 1.0), 0, 1)
        trozos.append((tono * env * 0.5).astype(np.float32))
        trozos.append(np.zeros(int(0.03 * sr), dtype=np.float32))
    audio = np.concatenate(trozos)
    audio += np.random.default_rng(0).normal(0, 0.002, audio.shape).astype(np.float32)
    sf.write(str(path), audio, sr)


def main() -> int:
    cache = ROOT / "cache"
    cache.mkdir(exist_ok=True)
    wav = cache / "tarareo_sintetico.wav"
    sintetizar_tarareo(wav)
    print(f"[1] tarareo sintetico: {wav.name}  ({TEMPO:g} BPM, Mi menor)")

    semilla = seed_to_conditioning(analyse(wav))
    print(f"[2] semilla extraida: {semilla[:160]}...")
    if "key=E" not in semilla:
        print(f"    AVISO: se esperaba key=E, salio {semilla[:40]}")
    if "mode=minor" not in semilla:
        print(f"    AVISO: se esperaba mode=minor, salio {semilla[:60]}")

    print("[3] mandando al modelo del VPS...")
    res = remoto.generar_tema(semilla, "classic hard rock, riff-driven, live drums, "
                                       "overdriven guitars", cache, "ciclo_completo")
    for a in res["avisos"]:
        print(f"    aviso del reparador: {a}")
    if not res["valido"]:
        print(f"    FALLO: el modelo devolvio algo no valido -> {res['error']}")
        print(res["bruto"][:600])
        return 1

    s = abcmini.parse_abc(res["abc"])
    voces = sum(1 for v in s.voices if v.notes)
    print(f"[4] ABC valido: {voces} voces con notas, "
          f"{sum(len(v.notes) for v in s.voices)} notas, {s.total_beats():.0f} negras")
    print(f"[5] MIDI: {res['midi']}")
    print(f"[5] WAV:  {res['wav']}")

    if voces < 3:
        print(f"    FALLO: solo {voces} voces con notas")
        return 1
    print("\nOK: tarareo -> semilla -> modelo del VPS -> ABC -> MIDI -> WAV")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
