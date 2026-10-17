"""Motor de bateria determinista.

Por que no dejamos que el LLM escriba la bateria nota a nota: un patron de
bateria son 200+ eventos por compas y el modelo los degrada enseguida. Es
mucho mas fiable (y muchisimo mas barato) que el LLM elija un NOMBRE de
patron y que este motor lo expanda a MIDI con fills y acentos.

Notacion de patron: 16 pasos por compas (semicorcheas).
    x = golpe      o = golpe acentuado      . = silencio
Cada patron mapea piezas a GM: kick 36, snare 38, hat 42, open hat 46,
crash 49, ride 51, tom 45/47/50, floor tom 41.
"""

from __future__ import annotations

import re

import pretty_midi

KICK, SNARE, RIM, CLAP = 36, 38, 37, 39
HAT, PEDAL, OPEN, CRASH, RIDE, CHINA = 42, 44, 46, 49, 51, 52
TOM_L, TOM_M, TOM_H, FLOOR = 45, 47, 50, 41

PIECES = {
    "kick": KICK, "snare": SNARE, "rim": RIM, "clap": CLAP,
    "hat": HAT, "pedal": PEDAL, "open": OPEN, "crash": CRASH,
    "ride": RIDE, "china": CHINA,
    "tom": TOM_M, "toml": TOM_L, "tomh": TOM_H, "floor": FLOOR,
}

PATTERNS: dict[str, dict[str, str]] = {
    # --- rock / post-punk ---
    "gothic_rock": {
        "kick":  "x.x.....x.x.....",
        "snare": "....x.......x...",
        "hat":   "x.x.x.x.x.x.x.x.",
    },
    "post_punk_drive": {
        "kick":  "x...x...x...x...",
        "snare": "....x.......x...",
        "hat":   "x.x.x.x.x.x.x.x.",
        "ride":  "..x...x...x...x.",
    },
    "half_time_dark": {
        "kick":  "x.......x.......",
        "snare": "........x.......",
        "hat":   "x...x...x...x...",
        "floor": "..............x.",
    },
    # --- industrial ---
    "industrial_machine": {
        "kick":  "x..x..x.x..x..x.",
        "snare": "....x.......x...",
        "clap":  "....o.......o...",
        "hat":   "x.xxx.xxx.xxx.xx",
    },
    "industrial_stomp": {
        "kick":  "x...x...x...x...",
        "snare": "....x...x...x...",
        "hat":   "..x...x...x...x.",
        "china": "x...............",
    },
    # --- metal ---
    "d_beat_metal": {
        "kick":  "x.x.x.x.x.x.x.x.",
        "snare": "....x.......x...",
        "hat":   "x.x.x.x.x.x.x.x.",
    },
    "gallop": {
        "kick":  "x.xx x.xx x.xx x.xx".replace(" ", ""),
        "snare": "....x.......x...",
        "ride":  "x.x.x.x.x.x.x.x.",
    },
    "double_kick_driving": {
        "kick":  "xxxxxxxxxxxxxxxx",
        "snare": "....x.......x...",
        "china": "x...............",
        "ride":  "..x...x...x...x.",
    },
    "blast_beat": {
        "kick":  "x.x.x.x.x.x.x.x.",
        "snare": ".x.x.x.x.x.x.x.x",
        "china": "x...............",
    },
    # --- rock / stoner ---
    "rock_standard": {
        "kick":  "x.......x...x...",
        "snare": "....x.......x...",
        "hat":   "x.x.x.x.x.x.x.x.",
    },
    "stoner_groove": {
        "kick":  "x.....x.x.......",
        "snare": "....x.......x..x",
        "hat":   "x...x...x...x...",
        "tom":   "............x...",
    },
    # --- electronic / synth-driven ---
    "four_on_floor": {
        "kick":  "x...x...x...x...",
        "clap":  "....x.......x...",
        "hat":   "..x...x...x...x.",
        "open":  "......x.......x.",
    },
    "electro_break": {
        "kick":  "x.....x...x.....",
        "snare": "....x...x...x.x.",
        "hat":   "x.xxx.xxx.xxx.xx",
    },
    # --- baladas / limpio ---
    "sparse_ballad": {
        "kick":  "x...............",
        "snare": "........x.......",
        "hat":   "x...x...x...x...",
    },
    "none": {},
}

ALIASES = {
    "gothic": "gothic_rock", "postpunk": "post_punk_drive", "post_punk": "post_punk_drive",
    "industrial": "industrial_machine", "metal": "d_beat_metal", "thrash": "gallop",
    "dbeat": "d_beat_metal", "d-beat": "d_beat_metal", "blast": "blast_beat",
    "rock": "rock_standard", "stoner": "stoner_groove", "qotsa": "stoner_groove",
    "electronic": "four_on_floor", "edm": "four_on_floor", "darkwave": "four_on_floor",
    "doom": "half_time_dark", "sludge": "half_time_dark", "ballad": "sparse_ballad",
    "industrial_rock": "industrial_stomp",
}


def resolve(name: str) -> str:
    n = (name or "").strip().lower().replace(" ", "_")
    n = ALIASES.get(n, n)
    return n if n in PATTERNS else "rock_standard"


def list_patterns() -> list[str]:
    return sorted(k for k in PATTERNS if k != "none")


def _split_bar(pattern: str) -> list[str]:
    """Acepta 'xxxxxxxxxxxxxxxx' o 'x.x.|x.x.' -> lista de 16 pasos."""
    pattern = pattern.replace("|", "")
    return list(pattern.ljust(16, ".")[:16])


def _stem(step: int) -> str:
    """Un silencio en el ultimo 16avo se rellena con el bombo si es la caja."""
    return ""


def pattern_to_instrument(
    name: str,
    total_beats: float,
    tempo: float = 120.0,
    meter: str = "4/4",
    velocity: int = 100,
) -> pretty_midi.Instrument:
    """Expande un nombre de patron a un instrumento de bateria (canal 10)."""
    key = resolve(name)
    pat = PATTERNS.get(key, {})
    inst = pretty_midi.Instrument(program=0, is_drum=True, name=f"drums:{key}")
    if not pat:
        return inst

    m = re.match(r"^(\d+)\s*/\s*(\d+)$", meter or "4/4")
    beats_per_bar = 4.0
    if m:
        beats_per_bar = 4.0 * int(m.group(1)) / int(m.group(2))
    spb = 60.0 / tempo
    step_beats = beats_per_bar / 16.0
    n_bars = max(1, int(round(total_beats / beats_per_bar)))

    bars: list[dict[str, list[str]]] = []
    for _ in range(n_bars):
        bars.append({p: _split_bar(s) for p, s in pat.items()})

    # fills: en el ultimo compas de cada grupo de 4, la caja hace un redoble simple
    for bi in range(3, n_bars, 4):
        snare = bars[bi].get("snare")
        if snare:
            bars[bi]["snare"] = list(".x.x.x.x") + ["x"] * 8   # 16 pasos
    # acento de crash al inicio de cada grupo de 4 compases
    for bi in range(0, n_bars, 4):
        if "crash" in pat or "china" in pat:
            piece = "crash" if "crash" in pat else "china"
            bars[bi][piece] = ["o"] + list(bars[bi][piece][1:])

    for bi, bar in enumerate(bars):
        for piece, steps in bar.items():
            pitch = PIECES.get(piece)
            if pitch is None:
                continue
            for si, ch in enumerate(steps):
                if ch not in "xo":
                    continue
                start = (bi * beats_per_bar + si * step_beats) * spb
                vel = min(127, velocity + 18) if ch == "o" else velocity
                # pequeño humanize deterministico en el hi-hat
                if piece in ("hat", "pedal") and si % 2 == 1:
                    vel = max(1, vel - 22)
                inst.notes.append(
                    pretty_midi.Note(velocity=vel, pitch=pitch,
                                     start=start, end=start + 0.05)
                )
    inst.notes.sort(key=lambda n: n.start)
    return inst
