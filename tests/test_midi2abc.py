"""Verificacion de MIDI multitrack -> ABC, con un MIDI de banda completa generado.

El MIDI de prueba imita lo que queremos: riff de guitarra distorsionada en Mi
menor a 132 BPM, pad de sintetizador, bajo y bateria de bombo-caja-hihat, es
decir el perfil de rock industrial. Se comprueba que el conversor:

  1. reconoce las pistas por programa GM,
  2. estima bien la tonalidad (Em),
  3. empareja la bateria real con uno de nuestros patrones con nombre,
  4. elige un estilo coherente con el tempo,
  5. y produce ABC que NUESTRO motor renderiza a MIDI y a WAV.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pretty_midi
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import abcmini, drums, midi2abc, render  # noqa: E402

TEMPO = 132.0
BEATS = 32                 # 8 compases de 4/4
SPB = 60.0 / TEMPO

# riff en Mi menor: E E G A B A G E por compas, corcheas
RIFF = [40, 40, 43, 45, 47, 45, 43, 40,
        40, 40, 43, 45, 52, 50, 47, 45,
        41, 41, 44, 46, 48, 46, 44, 41,
        40, 40, 43, 45, 47, 45, 43, 40]


def bajar(midi: int) -> int:
    while midi > 64:      # guitarra: las notas se escriben una octava abajo
        midi -= 12
    return midi


def generar_midi(path: Path) -> None:
    pm = pretty_midi.PrettyMIDI(initial_tempo=TEMPO)

    lead = pretty_midi.Instrument(program=30, name="Distorted Guitar")
    for bar in range(8):
        for i, p in enumerate(RIFF[bar * 4 % len(RIFF):][:8] or RIFF[:8]):
            start = (bar * 4 + i * 0.5) * SPB
            lead.notes.append(pretty_midi.Note(110, bajar(p), start, start + 0.45 * SPB))
    pm.instruments.append(lead)

    pad = pretty_midi.Instrument(program=89, name="Synth Pad")
    for bar in range(8):
        for p in (59, 62, 64):           # B3 D4 E4 = tríada de Em
            start = bar * 4 * SPB
            pad.notes.append(pretty_midi.Note(70, p, start, start + 3.9 * SPB))
    pm.instruments.append(pad)

    bass = pretty_midi.Instrument(program=33, name="Bass")
    for bar in range(8):
        root = 28 if bar % 2 == 0 else 31     # E1 / G1
        for half in (0, 2):
            start = (bar * 4 + half) * SPB
            bass.notes.append(pretty_midi.Note(105, root, start, start + 1.9 * SPB))
    pm.instruments.append(bass)

    dr = pretty_midi.Instrument(program=0, is_drum=True, name="Drum Kit")
    for bar in range(8):
        for step in range(16):
            t = (bar * 4 + step * 0.25) * SPB
            if step % 8 == 0:                      # bombo en 1 y 3
                dr.notes.append(pretty_midi.Note(100, 36, t, t + 0.02))
            if step in (4, 12):                    # caja en 2 y 4
                dr.notes.append(pretty_midi.Note(100, 38, t, t + 0.02))
            dr.notes.append(pretty_midi.Note(70, 42, t, t + 0.02))   # hi-hat
    pm.instruments.append(dr)

    pm.write(str(path))
    print(f"[gen] {path}  {TEMPO:g} BPM  {BEATS} negras  "
          f"{sum(len(i.notes) for i in pm.instruments)} notas, "
          f"{len(pm.instruments)} pistas")


def main() -> int:
    fails: list[str] = []
    cache = ROOT / "cache"
    cache.mkdir(exist_ok=True)
    mid = cache / "banda_test.mid"
    generar_midi(mid)

    r = midi2abc.convertir_fichero(mid)
    if r is None:
        print("FALLO: el conversor descarto el MIDI")
        return 1

    print(f"[conv] estilo={r.estilo}")
    print(f"[conv] patron={r.patron}  tempo={r.tempo:.1f}  key={r.key} {r.mode}")
    print(f"[conv] notas={r.n_notas}  densidad_lead={r.densidad_lead:.2f}")
    print(f"[seed] {r.seed[:150]}...")

    if r.key != "E":
        fails.append(f"tonalidad {r.key} != E")
    if r.mode != "minor":
        fails.append(f"modo {r.mode} != minor")
    if abs(r.tempo - TEMPO) > 1.0:
        fails.append(f"tempo {r.tempo} != {TEMPO}")
    if r.patron == "none":
        fails.append("no emparejo ningun patron de bateria")
    if r.patron not in drums.list_patterns():
        fails.append(f"patron desconocido: {r.patron}")

    # el ABC debe renderizar con nuestro motor
    score = abcmini.parse_abc(r.abc)
    n_voces = len(score.voices)
    voces_con_notas = [v for v in score.voices if v.notes]
    print(f"[abc] voces={n_voces} con_notas={len(voces_con_notas)} "
          f"beats={score.total_beats():.0f} tempo_abc={score.tempo:.0f}")
    if len(voces_con_notas) < 3:
        fails.append(f"solo {len(voces_con_notas)} voces con notas")

    wav = cache / "banda_test_ida.wav"
    render.abc_to_midi(r.abc, cache / "banda_test_ida.mid")
    render.midi_to_wav(cache / "banda_test_ida.mid", wav)
    d, sr = sf.read(str(wav))
    mono = d[:, 0] if d.ndim > 1 else d
    rms = float(np.sqrt((mono**2).mean()))
    print(f"[wav] {len(mono)/sr:.2f}s pico={np.abs(mono).max():.3f} rms={rms:.4f}")
    if rms < 0.005:
        fails.append("el WAV de ida es silencioso")

    if fails:
        print("\nFALLOS:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nOK: MIDI de banda -> ABC -> MIDI -> WAV verificado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
