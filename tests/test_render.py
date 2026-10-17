"""Verificacion de la cadena ABC -> MIDI -> WAV (multivotz + bateria)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pretty_midi
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import abcmini, drums, render  # noqa: E402

ABC = (ROOT / "examples" / "test_riff.abc").read_text(encoding="utf-8")


def main() -> int:
    fails: list[str] = []

    # --- 1. parser ---
    score = abcmini.parse_abc(ABC)
    print(f"[abc] tempo={score.tempo} key={score.key} meter={score.meter} "
          f"unit={score.unit} beats={score.total_beats()} drums={score.drums_pattern!r}")
    if abs(score.tempo - 132.0) > 0.01:
        fails.append(f"tempo {score.tempo} != 132")
    if score.key != "Em":
        fails.append(f"key {score.key} != Em")
    if len(score.voices) != 3:
        fails.append(f"voces {len(score.voices)} != 3")
    for v in score.voices:
        print(f"  voz {v.name:8s} prog={v.program:3d} canal={v.channel} notas={len(v.notes)} "
              f"pitch {min((n.midi for n in v.notes), default=0)}-{max((n.midi for n in v.notes), default=0)}")
        if not v.notes:
            fails.append(f"voz {v.name} sin notas")
    if abs(score.total_beats() - 16.0) > 0.01:
        fails.append(f"beats {score.total_beats()} != 16 (4 compases de 4/4)")

    # armadura: en Em el F debe ser sostenido
    bass = score.voices[2]
    bass_pcs = sorted({n.midi % 12 for n in bass.notes})
    print(f"[abc] clases de altura del bajo: {bass_pcs}")
    if 5 in bass_pcs and 6 not in bass_pcs:
        fails.append("armadura de Em no aplicada (F natural en el bajo)")

    # --- 2. bateria ---
    inst = drums.pattern_to_instrument(score.drums_pattern, score.total_beats(), score.tempo, score.meter)
    by_pitch: dict[int, int] = {}
    for n in inst.notes:
        by_pitch[n.pitch] = by_pitch.get(n.pitch, 0) + 1
    print(f"[drums] patron={score.drums_pattern} notas={len(inst.notes)} piezas={by_pitch}")
    if len(inst.notes) < 40:
        fails.append(f"bateria con solo {len(inst.notes)} golpes en 4 compases")
    if drums.KICK not in by_pitch or drums.SNARE not in by_pitch:
        fails.append("faltan bombo o caja en la bateria")

    # --- 3. MIDI completo ---
    midi = ROOT / "cache" / "test_riff.mid"
    wav = ROOT / "cache" / "test_riff.wav"
    render.abc_to_midi(ABC, midi)
    pm = pretty_midi.PrettyMIDI(str(midi))
    print(f"[midi] instrumentos={len(pm.instruments)} dur={pm.get_end_time():.2f}s "
          f"tempo={pm.get_tempo_changes()[1][0]:.1f}")
    if len(pm.instruments) != 4:
        fails.append(f"MIDI con {len(pm.instruments)} instrumentos, esperados 4")
    expected_dur = 16 * 60.0 / 132.0
    if abs(pm.get_end_time() - expected_dur) > 0.5:
        fails.append(f"duracion MIDI {pm.get_end_time():.2f}s != {expected_dur:.2f}s")

    # --- 4. WAV ---
    render.midi_to_wav(midi, wav)
    d, sr = sf.read(str(wav))
    mono = d[:, 0] if d.ndim > 1 else d
    rms = float(np.sqrt((mono**2).mean()))
    peak = float(np.abs(mono).max())
    print(f"[wav] dur={len(mono)/sr:.2f}s sr={sr} pico={peak:.3f} rms={rms:.4f}")
    # fluidsynth anade cola de relajacion del soundfont, asi que el WAV puede
    # ser algo mas largo que el MIDI, pero nunca mas corto.
    wav_dur = len(mono) / sr
    if wav_dur < expected_dur - 0.1 or wav_dur > expected_dur + 4.0:
        fails.append(f"duracion WAV {wav_dur:.2f}s fuera de [{expected_dur:.2f}, {expected_dur+4:.2f}]")
    if rms < 0.005:
        fails.append("WAV practicamente silencioso")

    # energia en graves (bombo + bajo) debe existir
    spec = np.abs(np.fft.rfft(mono))
    freqs = np.fft.rfftfreq(len(mono), 1 / sr)
    low = spec[(freqs >= 40) & (freqs < 150)].sum() / max(spec.sum(), 1e-9)
    print(f"[wav] energia 40-150 Hz: {low*100:.1f}%")
    if low < 0.02:
        fails.append("sin energia en graves: bombo/bajo no suenan")

    if fails:
        print("\nFALLOS:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nOK: ABC multivotz + bateria -> MIDI -> WAV verificado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
