"""Plantilla neutra del song worker.

No es una canción de referencia: solo muestra el contrato mínimo que el agente
debe rellenar. Cambia TITLE, KEY, BPM, SONG_BARS, SECTIONS y patrones.
"""

TITLE = "Nueva canción"
KEY = "C minor"
BPM = 90
BEATS_PER_BAR = 4
BEAT = 60.0 / BPM
BAR = BEATS_PER_BAR * BEAT
STEPS_PER_BAR = 16
STEP = BAR / STEPS_PER_BAR
SONG_BARS = 8
TAIL_S = 2.0

CHORDS = {
    "Cm": {"bass": "C2", "organ": ["C3", "Eb3", "G3"], "gtr": ["C3", "Eb3"]},
}
PROG = {"base": ["Cm"] * SONG_BARS}

SECTIONS = [
    {
        "name": "intro",
        "bars": (1, SONG_BARS),
        "prog": "base",
        "energy": 0.5,
        "layers": ["kick", "snare", "hats", "bass", "organ"],
    },
]

DRUMS = {
    "base": {
        "kick": [(0, 1.0), (8, 0.9)],
        "snare": [(4, 1.0), (12, 1.0)],
    },
    "hats": [(i, 0.5 if i % 4 == 0 else 0.3) for i in range(16)],
    "perc_metal": [(14, 0.5)],
    "perc_metal_break": [(0, 0.5)],
}

BASS_PATTERN = [(0, 0, 3, 0.9), (8, 0, 3, 0.8)]
GUITAR_PATTERN = [(0, 0.8), (8, 0.7)]
LEAD = {"chorus": []}
VOX_VERSE = []
VOX_CHORUS = []
VOX_BREAK = []
LEAD_LOOP_PATTERN = []
PIANO_OUTRO = []
EXTRAS = []


def validate() -> None:
    covered = []
    for section in SECTIONS:
        start, end = section["bars"]
        assert end >= start
        covered.extend(range(start, end + 1))
        assert len(PROG[section["prog"]]) == end - start + 1
    assert covered == list(range(1, SONG_BARS + 1))


if __name__ == "__main__":
    validate()
    print(f"{TITLE} | {KEY} | {BPM} BPM | {SONG_BARS} compases | plantilla neutra OK")
