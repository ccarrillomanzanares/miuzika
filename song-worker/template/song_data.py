#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""song_data.py -- DISENO MUSICAL de "Filament" (industrial/electro sucio, estilo Closer, 1994).

Solo DATOS: tempo, armonia, secciones y patrones. La sintesis vive en los modulos del motor
(../dm-song/voices_*.py, ../dm-song/dsp_core.py, ../dm-song/mix_master.py) y en voices_extras.py;
el montaje, los stems y el MIDI en render.py.

Direccion: se construye ACUMULANDO capas, no por contraste de secciones.
Tonalidad: Do menor, con descenso cromatico lento (C -> B -> Bb -> Ab -> G) como motivo hipnotico
y prestamo a Fa menor en el estribillo (mismo material, otro centro: el "giro" pequeno pedido).

Titulo: Filament | Tono: Cm | Tempo: 90 BPM | Compases: 140 (~6:13)
"""

from __future__ import annotations

TITLE = "Filament"
KEY = "C minor"
BPM = 90
BEATS_PER_BAR = 4
BEAT = 60.0 / BPM                  # 0.6666... s
BAR = BEATS_PER_BAR * BEAT         # 2.6666... s
STEPS_PER_BAR = 16                 # semicorcheas
STEP = BAR / STEPS_PER_BAR         # 0.16666... s
SONG_BARS = 140
TAIL_S = 6.0                       # cola para reverb/delay y el fade del piano

# --------------------------------------------------------------------------
# Armonia
# --------------------------------------------------------------------------
CHORDS = {
    "Cm":    {"bass": "C2",  "organ": ["C3", "Eb3", "G3", "C4"],  "gtr": ["C3", "Eb3"]},
    "Cm/B":  {"bass": "B1",  "organ": ["B2", "Eb3", "G3"],        "gtr": ["B2", "Eb3"]},
    "Cm/Bb": {"bass": "Bb1", "organ": ["Bb2", "Eb3", "G3"],       "gtr": ["Bb2", "D3"]},
    "Ab":    {"bass": "Ab1", "organ": ["Ab2", "C3", "Eb3", "Ab3"], "gtr": ["Ab2", "C3"]},
    "G":     {"bass": "G1",  "organ": ["G2", "B2", "D3", "G3"],   "gtr": ["G2", "B2"]},
    "Fm":    {"bass": "F2",  "organ": ["F2", "Ab2", "C3", "F3"],  "gtr": ["F2", "Ab2"]},
    "Fm/E":  {"bass": "E2",  "organ": ["E2", "Ab2", "C3"],        "gtr": ["E2", "G2"]},
    "Fm/Eb": {"bass": "Eb2", "organ": ["Eb2", "G2", "C3"],        "gtr": ["Eb2", "G2"]},
    "Db":    {"bass": "Db2", "organ": ["Db3", "F3", "Ab3", "Db4"], "gtr": ["Db3", "F3"]},
}


def cyc(pattern, n, offset=0):
    """Repite `pattern` n compases, empezando en `offset` (para enlazar secciones)."""
    return [pattern[(offset + i) % len(pattern)] for i in range(n)]


VERSE = ["Cm", "Cm", "Cm/B", "Cm/Bb", "Ab", "Ab", "G", "G"]
CHORUS = ["Fm", "Fm", "Fm/E", "Fm/Eb", "Db", "Db", "Cm", "Cm"]
BREAK = ["Cm", "Cm", "Cm/B", "Cm/Bb", "Ab", "G", "Cm", "Cm"]

PROG = {
    "intro":  ["Cm"] * 12,
    "build1": cyc(VERSE, 22, 0),
    "build2": cyc(VERSE, 26, 22 % 8),
    "chorus": cyc(CHORUS, 30, 0),
    "break":  cyc(BREAK, 26, 0),
    "outro":  ["Cm"] * 24,
}

# --------------------------------------------------------------------------
# Secciones: se acumulan capas, nunca se quitan salvo el desplome final
# --------------------------------------------------------------------------
SECTIONS = [
    {"name": "intro",  "bars": (1, 12),   "prog": "intro",  "energy": 0.40, "cyc_off": 0, "layers": [
        "kick", "snare", "drone", "vinyl"]},
    {"name": "build1", "bars": (13, 34),  "prog": "build1", "energy": 0.55, "cyc_off": 0, "layers": [
        "kick", "snare", "hats", "bass", "drone", "vinyl"]},
    {"name": "build2", "bars": (35, 60),  "prog": "build2", "energy": 0.70, "cyc_off": 6, "layers": [
        "kick", "snare", "hats", "bass", "drone", "vinyl", "guitar", "organ", "perc_metal"]},
    {"name": "chorus", "bars": (61, 90),  "prog": "chorus", "energy": 0.95, "cyc_off": 0, "layers": [
        "kick", "snare", "hats", "bass", "sub", "drone", "vinyl", "guitar", "organ",
        "perc_metal", "lead", "squelch", "reverse_swell"]},
    {"name": "break",  "bars": (91, 116), "prog": "break",  "energy": 0.80, "cyc_off": 0, "layers": [
        "kick", "snare", "hats", "bass", "sub", "drone", "vinyl", "guitar", "perc_metal",
        "growl", "lead_loop", "squelch", "reverse_swell"]},
    {"name": "outro",  "bars": (117, 140), "prog": "outro", "energy": 0.25, "cyc_off": 0, "layers": [
        "piano", "vinyl", "reverse_swell"]},
]

# --------------------------------------------------------------------------
# Bateria: patrones (paso, velocidad), 16 pasos = 1 compas
# --------------------------------------------------------------------------
DRUMS = {
    "base": {                                  # cuatro a la negra + caja en 2 y 4
        "kick": [(0, 1.0), (4, 0.90), (8, 1.0), (12, 0.92)],
        "snare": [(4, 1.0), (12, 1.0)],
    },
    "chorus": {                                # la caja gana fantasmas: el beat martillea mas
        "snare_ghost": [(7, 0.30), (15, 0.35)],
    },
    "hats": [                                  # EL gancho: semicorcheas, sin fills ni variacion
        (i, 0.62 if i % 4 == 0 else 0.42) for i in range(16)
    ],
    "perc_metal": [(14, 0.50)],                # acento metalico cada 4 compases
    "perc_metal_break": [(0, 0.55), (6, 0.40), (10, 0.48)],
}

# --------------------------------------------------------------------------
# Bajo: (paso, semitonos sobre la fundamental, duracion en pasos, velocidad)
# --------------------------------------------------------------------------
BASS_PATTERN = [
    (0, 0, 3, 1.00), (3, 12, 1, 0.70), (4, 0, 2, 0.85), (6, 7, 1, 0.62),
    (8, 0, 3, 0.95), (11, 12, 1, 0.72), (12, 10, 1, 0.80), (14, 7, 2, 0.68),
]

# --------------------------------------------------------------------------
# Guitarra: figura crujiente loopeada (paso, velocidad), duracion = 1 paso
# --------------------------------------------------------------------------
GUITAR_PATTERN = [(0, 1.00), (3, 0.60), (6, 0.75), (8, 0.90), (11, 0.55), (14, 0.70)]

# --------------------------------------------------------------------------
# Lead: (desplazamiento de compas, paso, nota, duracion en pasos, velocidad)
# Frases largas y escasas: el medio queda libre para la voz del usuario.
# --------------------------------------------------------------------------
LEAD = {
    "chorus": [(0, 0, "C4", 12, 0.62), (4, 0, "Bb3", 12, 0.58),
               (8, 0, "Ab3", 12, 0.60), (12, 0, "G3", 12, 0.56)],
}

# --------------------------------------------------------------------------
# GUIA DE VOZ (solo MIDI, no se sintetiza audio): frases y registro sugeridos.
# Registro de baritono/tenor; el lead se queda por debajo para no chocar.
# (desplazamiento de compas dentro del ciclo, paso, nota, duracion en pasos)
# --------------------------------------------------------------------------
VOX_VERSE = [
    (0, 0, "C4", 6, 90), (0, 8, "Eb4", 6, 85),
    (1, 0, "G4", 10, 95),
    (2, 8, "F4", 6, 85),
    (3, 0, "Eb4", 10, 90),
    (4, 0, "Ab4", 6, 95), (4, 8, "G4", 6, 85),
    (5, 0, "F4", 10, 90),
    (6, 0, "Eb4", 8, 85),
    (7, 0, "D4", 12, 88),
]
VOX_CHORUS = [
    (0, 0, "F4", 8, 100), (0, 8, "Ab4", 6, 95),
    (1, 0, "C5", 12, 110),
    (2, 0, "Eb5", 6, 100), (2, 8, "C5", 6, 95),
    (3, 0, "Db5", 12, 108),
    (4, 0, "C5", 6, 100), (4, 8, "Ab4", 6, 95),
    (5, 0, "F4", 12, 105),
    (6, 0, "Eb4", 6, 95), (6, 8, "G4", 6, 95),
    (7, 0, "C4", 14, 100),
]
VOX_BREAK = [
    (0, 0, "C4", 14, 70),
    (4, 0, "Ab3", 14, 68),
    (8, 0, "G3", 14, 66),
    (12, 0, "C4", 16, 72),
]
# "nuevos bucles de sintetizador" del breakdown: semicorcheas cortas, mecanicas
LEAD_LOOP_PATTERN = [(0, 0), (2, 0), (4, 12), (6, 0), (8, 7), (10, 0), (12, 12), (14, 7)]

# --------------------------------------------------------------------------
# Piano final: cromatismo descendente SIN CUANTIZAR (el render mete el jitter)
# (paso de 2 tiempos, nota, duracion en tiempos)
# --------------------------------------------------------------------------
PIANO_OUTRO = [
    (0, "C5", 2), (2, "C5", 2), (4, "B4", 2), (6, "Bb4", 2),
    (8, "Ab4", 2), (10, "Ab4", 2), (12, "G4", 2), (14, "G4", 2),
    (16, "F4", 2), (18, "F4", 2), (20, "Eb4", 2), (22, "Eb4", 2),
    (24, "C4", 3), (27, "Ab3", 3), (30, "G3", 4), (34, "C3", 12),
]

# --------------------------------------------------------------------------
# One-shots de arreglo (compas ABSOLUTO): squelch de transicion y swell invertido
# --------------------------------------------------------------------------
EXTRAS = [
    {"bar": 61,  "kind": "squelch",      "gain": 0.55, "pan": -0.35},
    {"bar": 91,  "kind": "squelch",      "gain": 0.60, "pan":  0.35},
    {"bar": 99,  "kind": "squelch",      "gain": 0.40, "pan":  0.40},
    {"bar": 107, "kind": "squelch",      "gain": 0.42, "pan": -0.40},
    {"bar": 115, "kind": "squelch",      "gain": 0.45, "pan":  0.30},
    {"bar": 61,  "kind": "reverse_swell", "gain": 0.50, "pan":  0.0, "len_s": 5.0},
    {"bar": 91,  "kind": "reverse_swell", "gain": 0.55, "pan": -0.15, "len_s": 6.0},
    {"bar": 117, "kind": "reverse_swell", "gain": 0.45, "pan":  0.0, "len_s": 7.0},
]


# --------------------------------------------------------------------------
# Autocomprobacion del diseno: python song_data.py
# --------------------------------------------------------------------------
def validate() -> None:
    bars = []
    for s in SECTIONS:
        a, b = s["bars"]
        assert b >= a, f"seccion {s['name']}: rango invalido"
        n = b - a + 1
        assert len(PROG[s["prog"]]) == n, (
            f"seccion {s['name']}: {n} compases pero la progresion '{s['prog']}' "
            f"tiene {len(PROG[s['prog']])}")
        bars.extend(range(a, b + 1))
    assert bars == list(range(1, SONG_BARS + 1)), "las secciones no cubren 1..140 sin huecos"
    for name, pat in DRUMS.items():
        if isinstance(pat, list):
            pat = {name: pat}
        for inst, evs in pat.items():
            for step, vel in evs:
                assert 0 <= step < STEPS_PER_BAR, f"{name}/{inst}: paso {step} fuera de rango"
                assert 0.0 < vel <= 1.0, f"{name}/{inst}: velocidad {vel} fuera de rango"
    for step, semi, dur, vel in BASS_PATTERN:
        assert 0 <= step < STEPS_PER_BAR and step + dur <= STEPS_PER_BAR, f"bajo: {step}+{dur}"
    for step, vel in GUITAR_PATTERN:
        assert 0 <= step < STEPS_PER_BAR, f"guitarra: {step}"
    for e in EXTRAS:
        assert 1 <= e["bar"] <= SONG_BARS, f"extra fuera de cancion: {e}"
        assert e["kind"] in ("squelch", "reverse_swell"), e
    for c, v in CHORDS.items():
        assert len(v["organ"]) >= 3 and len(v["gtr"]) == 2, c
    for bo, step, nt, dur, vel in LEAD["chorus"]:
        assert 0 < dur and 0 <= step < STEPS_PER_BAR, f"lead: {bo}/{step}"


if __name__ == "__main__":
    validate()
    print(f"{TITLE}  |  {KEY}  |  {BPM} BPM  |  {SONG_BARS} compases")
    print(f"compas = {BAR:.4f} s   cancion = {SONG_BARS * BAR:.1f} s + cola {TAIL_S:.0f} s "
          f"-> {(SONG_BARS * BAR + TAIL_S) / 60:.2f} min")
    print("\nlinea de tiempo:")
    for s in SECTIONS:
        a, b = s["bars"]
        print(f"  {a:>3}-{b:<3} {s['name']:<8} prog={s['prog']:<7} energia={s['energy']:.2f}  "
              f"t={(a-1)*BAR:6.1f}s-{b*BAR:6.1f}s  capas={','.join(s['layers'])}")
    print(f"\nextras: {len(EXTRAS)} one-shots " +
          str(sorted({e['kind'] for e in EXTRAS})))
    print("ciclo estrofa:", " ".join(VERSE))
    print("ciclo estribillo:", " ".join(CHORUS))
    print("ciclo break:", " ".join(BREAK))
    print("\nDISENO OK")
