"""Verificacion end-to-end del pipeline tarareo->semilla con audio sintetico.

Genera un tarareo de prueba (melodia conocida en Do mayor, 120 BPM, con vibrato
y envolventes) y comprueba que el analizador recupera tempo, tonalidad y notas.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from humseed.analyze import SR, analyse, seed_to_conditioning  # noqa: E402

# Melodia de prueba: Do mayor, negras/corcheas, C4-E4-G4-C5-G4-E4-C4
MELODY = [("C4", 1.0), ("E4", 1.0), ("G4", 1.0), ("C5", 1.0),
          ("G4", 0.5), ("F4", 0.5), ("E4", 1.0), ("D4", 1.0), ("C4", 2.0)]
TEMPO = 120.0


def hum_synth(path: Path) -> None:
    spb = 60.0 / TEMPO
    sr = 44100
    out = np.zeros(0, dtype=np.float32)
    for name, beats in MELODY:
        dur = beats * spb
        n = int(dur * sr)
        t = np.arange(n) / sr
        f0 = 440.0 * 2 ** ((_parse(name) - 69) / 12)
        # vibrato humano
        vib = 1.0 + 0.012 * np.sin(2 * np.pi * 5.2 * t)
        phase = 2 * np.pi * np.cumsum(f0 * vib) / sr
        tone = np.sin(phase) + 0.35 * np.sin(2 * phase) + 0.12 * np.sin(3 * phase)
        # envolvente ataque/relajacion
        env = np.minimum(t / 0.06, 1.0) * np.minimum((dur - t) / 0.12, 1.0)
        env = np.clip(env, 0, 1)
        out = np.concatenate([out, (tone * env * 0.5).astype(np.float32)])
        out = np.concatenate([out, np.zeros(int(0.03 * sr), dtype=np.float32)])
    # ruido de fondo suave, como un micro real
    out += np.random.default_rng(0).normal(0, 0.002, out.shape).astype(np.float32)
    sf.write(str(path), out, sr)
    print(f"[gen] {path}  {len(out)/sr:.2f}s  {TEMPO:g} BPM  melodia {len(MELODY)} notas")


def _parse(name: str) -> int:
    import librosa

    return int(librosa.note_to_midi(name))


def main() -> int:
    tmp = Path(__file__).resolve().parents[1] / "cache"
    tmp.mkdir(exist_ok=True)
    wav = tmp / "hum_test.wav"
    hum_synth(wav)

    seed = analyse(wav)
    print(f"[seed] duration={seed.duration}s tempo={seed.tempo_bpm} key={seed.key} "
          f"mode={seed.mode} conf={seed.confidence_key}")
    print(f"[seed] notas detectadas={len(seed.notes)}  rhythm={seed.has_rhythm}")
    print(f"[seed] primeras notas: {[n.name for n in seed.notes[:9]]}")
    print(f"[cond] {seed_to_conditioning(seed)[:220]}...")

    fails = []
    if not (110 <= seed.tempo_bpm <= 130):
        fails.append(f"tempo {seed.tempo_bpm} fuera de 110-130")
    if seed.key != "C":
        fails.append(f"tonalidad {seed.key} != C")
    if len(seed.notes) < 6:
        fails.append(f"solo {len(seed.notes)} notas detectadas")
    expected = [_parse(p) for p, _ in MELODY[:6]]
    got = [n.pitch for n in seed.notes[:6]]
    if got and expected:
        off = [abs(g - e) for g, e in zip(got, expected)]
        if max(off) > 1:
            fails.append(f"pitch desviado: got={got} expected={expected}")

    if fails:
        print("\nFALLOS:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nOK: tempo, tonalidad y melodia recuperados")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
