#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""song_data.py -- DISENO MUSICAL de "Static Prayer" (dark synth-pop con toques industriales).

Solo DATOS: tempo, armonia, secciones y patrones. La sintesis y la mezcla viven en
voices_drums.py / voices_synths.py / mix_master.py, y el montaje en render_song.py.

Convenciones:
  - 1 compas = 4 tiempos de negra. Los patrones van en SEMICORCHEAS (16 pasos por compas, 0..15).
  - Los eventos son tuplas (paso, ...) con velocidad 0..1.
  - Direccion armonica: D menor (eolico) con prestamos (Gm, Eb, C7 implicito).
  - Cifras en semitonos relativos a la fundamental del acorde para el bajo.

Titulo: Static Prayer | Tono: Dm | Tempo: 92 BPM | Compases: 68 (~3:03)
"""

from __future__ import annotations

TITLE = "Static Prayer"
KEY = "D minor"
BPM = 92
BEATS_PER_BAR = 4
BEAT = 60.0 / BPM                # 0.6521739... s
BAR = BEATS_PER_BAR * BEAT       # 2.6086956... s
STEPS_PER_BAR = 16               # semicorcheas
STEP = BAR / STEPS_PER_BAR
SONG_BARS = 68
TAIL_S = 5.0                     # cola extra para reverb/delay (sin aire muerto al final)

# --------------------------------------------------------------------------
# Armonia: voicing de pad, coro, arpegio y nota de bajo por acorde
# --------------------------------------------------------------------------
CHORDS = {
    "Dm": {"pad": ["D3", "F3", "A3", "D4"], "choir": ["D4", "F4", "A4"],
           "arp": ["D3", "A3", "D4", "F4"], "bass": "D2"},
    "Bb": {"pad": ["Bb2", "D3", "F3", "Bb3"], "choir": ["D4", "F4", "Bb4"],
           "arp": ["Bb2", "F3", "Bb3", "D4"], "bass": "Bb1"},
    "F":  {"pad": ["F3", "A3", "C4", "F4"], "choir": ["F4", "A4", "C5"],
           "arp": ["F3", "C4", "F4", "A4"], "bass": "F2"},
    "C":  {"pad": ["C3", "E3", "G3", "C4"], "choir": ["E4", "G4", "C5"],
           "arp": ["C3", "G3", "C4", "E4"], "bass": "C2"},
    "Gm": {"pad": ["G2", "Bb2", "D3", "G3"], "choir": ["G4", "Bb4", "D5"],
           "arp": ["G2", "D3", "G3", "Bb3"], "bass": "G2"},
    "Eb": {"pad": ["Eb3", "G3", "Bb3", "Eb4"], "choir": ["G4", "Bb4", "Eb5"],
           "arp": ["Eb3", "Bb3", "Eb4", "G4"], "bass": "Eb2"},
}

# Progresion: una entrada por compas de la seccion
PROG = {
    "intro":  ["Dm", "Dm", "Bb", "Bb", "F", "F", "C", "C"],
    "verse":  ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "C"],
    "chorus": ["Bb", "C", "Dm", "Dm", "Bb", "C", "F", "C"],
    "bridge": ["Gm", "Eb", "Bb", "C", "Gm", "Eb", "F", "C"],
    "outro":  ["Dm", "Bb", "Dm", "Bb", "Dm", "Bb", "Dm", "Dm", "Dm", "Dm", "Dm", "Dm"],
}

# --------------------------------------------------------------------------
# Secciones (compases 1..68). 'layers' los interpreta render_song.py
# --------------------------------------------------------------------------
SECTIONS = [
    {"name": "intro",   "bars": (1, 8),   "prog": "intro",  "energy": 0.35, "layers": [
        "pad", "sub_pulse", "metal_pulse", "arp_soft"]},
    {"name": "verse1",  "bars": (9, 16),  "prog": "verse",  "energy": 0.55, "layers": [
        "pad", "bass", "drums_verse", "arp_soft", "choir_ooh", "lead_verse", "pluck"]},
    {"name": "chorus1", "bars": (17, 24), "prog": "chorus", "energy": 0.9, "layers": [
        "pad", "bass", "drums_chorus", "strings", "choir_ah", "lead_chorus", "pluck", "metal_acc"]},
    {"name": "verse2",  "bars": (25, 32), "prog": "verse",  "energy": 0.62, "layers": [
        "pad", "bass", "drums_verse", "arp_soft", "choir_ooh", "lead_verse2", "pluck", "metal_acc"]},
    {"name": "chorus2", "bars": (33, 40), "prog": "chorus", "energy": 0.95, "layers": [
        "pad", "bass", "drums_chorus", "strings", "choir_ah", "lead_chorus", "pluck", "metal_acc"]},
    {"name": "bridge",  "bars": (41, 48), "prog": "bridge", "energy": 0.5, "layers": [
        "pad", "bass_sparse", "drums_bridge", "choir_ah", "lead_bridge"]},
    {"name": "chorus3", "bars": (49, 56), "prog": "chorus", "energy": 1.0, "layers": [
        "pad", "bass", "drums_chorus", "strings", "choir_melody", "lead_chorus_hi", "pluck",
        "metal_acc", "arp_soft"]},
    {"name": "outro",   "bars": (57, 68), "prog": "outro",  "energy": 0.3, "layers": [
        "pad", "sub_pulse", "metal_pulse", "choir_ooh", "lead_outro"]},
]

# --------------------------------------------------------------------------
# Bateria: patrones por nombre (paso, velocidad). 16 pasos = 1 compas
# --------------------------------------------------------------------------
DRUMS = {
    "intro": {
        "kick": [(0, 0.75), (8, 0.7)],
        "hat": [(4, 0.3), (12, 0.28)],
    },
    "verse": {
        "kick": [(0, 1.0), (6, 0.62), (8, 1.0), (14, 0.6)],
        "snare": [(4, 1.0), (12, 1.0)],
        "hat": [(2, 0.55), (6, 0.42), (10, 0.55), (14, 0.42)],
        "hat_open": [(15, 0.4)],
    },
    "chorus": {
        "kick": [(0, 1.0), (3, 0.55), (8, 1.0), (11, 0.55), (14, 0.68)],
        "snare": [(4, 1.0), (12, 1.0), (7, 0.3), (15, 0.35)],
        "clap": [(4, 0.7), (12, 0.7)],
        "hat": [(i, 0.62 if i % 4 == 0 else 0.34) for i in range(16)],
        "hat_open": [(6, 0.45), (14, 0.5)],
    },
    "bridge": {
        "kick": [(0, 0.85), (8, 0.8)],
        "snare": [(4, 0.75), (12, 0.75)],
        "hat": [(2, 0.3), (6, 0.3), (10, 0.3), (14, 0.3)],
        "metal": [(0, 0.85), (6, 0.55), (10, 0.7)],
    },
    "outro": {
        "kick": [(0, 0.6), (8, 0.55)],
        "hat": [(4, 0.25), (12, 0.22)],
    },
}

# --------------------------------------------------------------------------
# Bajo: (paso, semitonos respecto a la fundamental, duracion en pasos, velocidad)
# --------------------------------------------------------------------------
BASS = {
    "intro": [(0, 0, 8, 0.9), (8, 0, 6, 0.75), (14, 12, 2, 0.55)],
    "verse": [(0, 0, 2, 1.0), (2, 0, 1, 0.62), (3, 0, 1, 0.8), (4, 0, 2, 0.75),
              (6, 0, 1, 0.6), (7, 0, 1, 0.82), (8, 0, 2, 0.95), (10, 0, 1, 0.6),
              (11, 0, 1, 0.8), (12, 0, 2, 0.75), (14, 12, 1, 0.72), (15, 0, 1, 0.68)],
    "chorus": [(0, 0, 2, 1.0), (2, 0, 2, 0.8), (4, 0, 2, 0.85), (6, 0, 2, 0.78),
               (8, 0, 2, 1.0), (10, 0, 2, 0.8), (12, 0, 1, 0.85), (13, 0, 1, 0.7),
               (14, 12, 1, 0.8), (15, 0, 1, 0.7)],
    "bridge": [(0, 0, 8, 0.9), (8, 0, 4, 0.7), (12, 12, 4, 0.65)],
    "outro": [(0, 0, 8, 0.8), (8, 0, 8, 0.7)],
}

# --------------------------------------------------------------------------
# Arpegio / pluck: 16 pasos, indice en CHORDS[c]["arp"] o None (silencio)
# --------------------------------------------------------------------------
ARP = {
    "intro":  [0, None, 2, None, 1, None, 2, None, 0, None, 2, None, 1, None, 3, None],
    "soft":   [0, None, 1, 2, None, 1, None, 3, 0, None, 1, 2, None, 3, 1, None],
    "drive":  [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 3, 2],
}

# --------------------------------------------------------------------------
# Melodias de lead: (desplazamiento de compas, paso, nota, duracion en pasos, velocidad)
# --------------------------------------------------------------------------
LEAD = {
    "verse1": [(4, 0, "A3", 8, 0.55), (6, 0, "G3", 6, 0.5), (6, 8, "F3", 8, 0.5)],
    "verse2": [(0, 0, "D4", 6, 0.6), (2, 0, "F4", 4, 0.6), (2, 8, "A4", 8, 0.55),
               (5, 0, "G4", 4, 0.55), (5, 8, "F4", 6, 0.5), (7, 0, "E4", 8, 0.5)],
    "chorus": [
        (0, 0, "F4", 4, 0.8), (0, 4, "D4", 4, 0.75), (0, 8, "F4", 2, 0.8), (0, 10, "G4", 2, 0.8), (0, 12, "F4", 4, 0.75),
        (1, 0, "G4", 6, 0.85), (1, 6, "E4", 2, 0.7), (1, 8, "G4", 8, 0.8),
        (2, 0, "A4", 4, 0.9), (2, 4, "G4", 2, 0.75), (2, 6, "F4", 2, 0.75), (2, 8, "D4", 8, 0.8),
        (3, 0, "F4", 8, 0.75), (3, 8, "A4", 4, 0.8), (3, 12, "C5", 4, 0.85),
        (4, 0, "D5", 6, 0.9), (4, 6, "C5", 2, 0.75), (4, 8, "Bb4", 8, 0.8),
        (5, 0, "A4", 4, 0.8), (5, 4, "G4", 4, 0.75), (5, 8, "E4", 8, 0.7),
        (6, 0, "F4", 4, 0.75), (6, 4, "A4", 4, 0.8), (6, 8, "C5", 5, 0.85), (6, 13, "A4", 3, 0.7),
        (7, 0, "G4", 8, 0.8), (7, 8, "A4", 8, 0.75),
    ],
    "bridge": [(0, 0, "G4", 12, 0.6), (2, 0, "Eb4", 12, 0.55), (4, 0, "D4", 16, 0.6)],
    "outro": [(0, 0, "D4", 16, 0.5), (2, 0, "F4", 16, 0.45), (4, 0, "A4", 24, 0.4)],
}

# --------------------------------------------------------------------------
# One-shots de arreglo (bar = compas ABSOLUTO 1..68)
# --------------------------------------------------------------------------
EXTRAS = [
    # barrido de apertura
    {"bar": 1,  "step": 0, "kind": "sweep",    "dur": 8.0, "pan": 0.0,  "gain": 0.55},
    # transiciones de seccion: riser + gong industrial + reverse cymbal
    {"bar": 8,  "step": 8, "kind": "sweep",    "dur": 2.6, "pan": -0.2, "gain": 0.5},
    {"bar": 9,  "step": 0, "kind": "impact",   "dur": 4.0, "pan": 0.0,  "gain": 0.7},
    {"bar": 16, "step": 8, "kind": "rev_cym",  "dur": 2.6, "pan": 0.15, "gain": 0.55},
    {"bar": 17, "step": 0, "kind": "impact",   "dur": 4.0, "pan": 0.0,  "gain": 0.9},
    {"bar": 17, "step": 0, "kind": "metal",    "dur": 2.4, "pan": -0.45, "gain": 0.55},
    {"bar": 21, "step": 0, "kind": "metal",    "dur": 2.4, "pan": 0.45, "gain": 0.5},
    {"bar": 24, "step": 8, "kind": "sweep",    "dur": 2.6, "pan": 0.2,  "gain": 0.4},
    {"bar": 32, "step": 8, "kind": "rev_cym",  "dur": 2.6, "pan": -0.15, "gain": 0.5},
    {"bar": 33, "step": 0, "kind": "impact",   "dur": 4.0, "pan": 0.0,  "gain": 0.95},
    {"bar": 33, "step": 0, "kind": "metal",    "dur": 2.4, "pan": 0.4,  "gain": 0.6},
    {"bar": 37, "step": 0, "kind": "metal",    "dur": 2.4, "pan": -0.4, "gain": 0.55},
    {"bar": 40, "step": 4, "kind": "sweep",    "dur": 4.0, "pan": 0.0,  "gain": 0.5},
    {"bar": 41, "step": 0, "kind": "impact",   "dur": 5.0, "pan": 0.0,  "gain": 0.6},
    {"bar": 41, "step": 0, "kind": "metal",    "dur": 3.0, "pan": 0.0,  "gain": 0.6},
    {"bar": 45, "step": 0, "kind": "metal",    "dur": 3.0, "pan": -0.3, "gain": 0.5},
    {"bar": 47, "step": 8, "kind": "metal",    "dur": 2.0, "pan": 0.3,  "gain": 0.5},
    {"bar": 48, "step": 0, "kind": "sweep",    "dur": 2.6, "pan": 0.0,  "gain": 0.6},
    {"bar": 49, "step": 0, "kind": "impact",   "dur": 4.5, "pan": 0.0,  "gain": 1.0},
    {"bar": 49, "step": 0, "kind": "metal",    "dur": 2.6, "pan": -0.5, "gain": 0.6},
    {"bar": 53, "step": 0, "kind": "metal",    "dur": 2.6, "pan": 0.5,  "gain": 0.55},
    {"bar": 56, "step": 8, "kind": "rev_cym",  "dur": 2.6, "pan": 0.0,  "gain": 0.45},
    {"bar": 57, "step": 0, "kind": "impact",   "dur": 6.0, "pan": 0.0,  "gain": 0.7},
    {"bar": 61, "step": 0, "kind": "metal",    "dur": 3.0, "pan": 0.35, "gain": 0.4},
    {"bar": 65, "step": 0, "kind": "impact",   "dur": 8.0, "pan": 0.0,  "gain": 0.5},
]

# --------------------------------------------------------------------------
# Letra (no se canta en el render: es la referencia del tema)
# --------------------------------------------------------------------------
LYRICS = """STATIC PRAYER

[Verse 1]
Another morning made of tin and rain
I count the wires that hold me in my shape
You whisper something that I can't explain
A frequency that no machine can tape

[Chorus]
I kneel down to the static
I pray into the noise
Everything is automatic
Everything's a voice
I kneel down to the static
And the static answers back
Love is just a signal
Coming through the crack

[Verse 2]
The factory of heaven runs all night
It stamps my name in steel and lets it rust
I traded every halo for a light
That flickers when I'm starting to trust

[Bridge]
Hold the circuit, hold the line
Nothing holy, nothing mine

[Chorus] (repetir)
"""


# --------------------------------------------------------------------------
# Autocomprobacion del diseno (re-ejecutable): python song_data.py
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
    assert bars == list(range(1, SONG_BARS + 1)), "las secciones no cubren 1..68 sin huecos"
    for name, pat in DRUMS.items():
        for inst, evs in pat.items():
            for step, vel in evs:
                assert 0 <= step < STEPS_PER_BAR, f"{name}/{inst}: paso {step} fuera de rango"
                assert 0.0 < vel <= 1.0, f"{name}/{inst}: velocidad {vel} fuera de rango"
    for name, evs in BASS.items():
        for step, semi, dur, vel in evs:
            assert 0 <= step < STEPS_PER_BAR and step + dur <= STEPS_PER_BAR, f"bajo {name}: {step}+{dur}"
    for sec, evs in LEAD.items():
        for bo, step, nt, dur, vel in evs:
            assert 0 <= step < STEPS_PER_BAR, f"lead {sec}: paso {step}"
    for e in EXTRAS:
        assert 1 <= e["bar"] <= SONG_BARS, f"extra fuera de cancion: {e}"
    for c, v in CHORDS.items():
        assert len(v["pad"]) >= 3 and len(v["choir"]) >= 3 and len(v["arp"]) == 4, c


if __name__ == "__main__":
    validate()
    print(f"{TITLE}  |  {KEY}  |  {BPM} BPM  |  {SONG_BARS} compases")
    print(f"compas = {BAR:.4f} s   cancion = {SONG_BARS * BAR:.1f} s + cola {TAIL_S:.0f} s "
          f"-> {(SONG_BARS * BAR + TAIL_S) / 60:.2f} min")
    print("\nlinea de tiempo:")
    for s in SECTIONS:
        a, b = s["bars"]
        print(f"  {a:>3}-{b:<3} {s['name']:<8} prog={s['prog']:<7} energia={s['energy']:.2f}  "
              f"t={((a-1)*BAR):6.1f}s  capas={','.join(s['layers'])}")
    print(f"\nextras: {len(EXTRAS)} one-shots")
    print("tipos de extra:", sorted({e['kind'] for e in EXTRAS}))
    print("\nDISE NO OK")
