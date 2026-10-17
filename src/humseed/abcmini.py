"""Mini-motor ABC multivotz: ABC -> MIDI (pretty_midi).

Por que existe: el parser ABC de music21 funciona con una sola voz (folk,
classical) pero desplaza y pierde voces cuando hay varias, y no respeta
%%MIDI program/channel. Para rock/industrial necesitamos guitarra + bajo +
bateria simultaneos, asi que parseamos nosotros el subconjunto de ABC que
emitira el LLM.

Subconjunto soportado
---------------------
Cabecera:   X: T: M: L: Q: K:  V: (name/clef/program/channel)
Directivas: %%MIDI program N | %%MIDI channel N | %%humseed drums <patron>
Notas:      A-G a-g con , y ' para octava, ^ _ = accidentales, duraciones
            (digitos, /, //, /N), z/Z silencios, [ ] acordes, - ligaduras,
            | barras, |: :| repeticiones simples, w: letra (ignorada)

Duraciones en negras (quarter notes). L:1/8 => unidad = 0.5 negras.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pretty_midi

# ---------------------------------------------------------------- tonalidades

SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"]

MAJOR_KEYS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
              "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
MINOR_KEYS = {"A": 0, "E": 1, "B": 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
              "D": -1, "G": -2, "C": -3, "F": -4, "Bb": -5, "Eb": -6, "Ab": -7}

LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def key_signature(key_field: str) -> dict[str, int]:
    """Devuelve {letra: alteracion} implicita por la armadura."""
    m = re.match(r"\s*([A-Ga-g][#b]?)\s*(m|min|minor|maj|major)?", key_field or "C")
    tonic, mode = (m.group(1), m.group(2)) if m else ("C", None)
    tonic = tonic[0].upper() + tonic[1:]
    is_minor = bool(mode and mode.lower().startswith("m") and not mode.lower().startswith("maj"))
    table = MINOR_KEYS if is_minor else MAJOR_KEYS
    n = table.get(tonic, 0)
    sig: dict[str, int] = {}
    if n > 0:
        for letter in SHARP_ORDER[:n]:
            sig[letter] = 1
    elif n < 0:
        for letter in FLAT_ORDER[: -n]:
            sig[letter] = -1
    return sig


# ------------------------------------------------------------------- modelo

@dataclass
class MNote:
    start: float      # en negras desde el inicio de la pieza
    dur: float
    midi: int
    velocity: int = 90


@dataclass
class Voice:
    name: str = ""
    channel: int = 0
    program: int = 0
    clef: str = "treble"
    is_drums: bool = False
    notes: list[MNote] = field(default_factory=list)


@dataclass
class Score:
    title: str = ""
    tempo: float = 120.0
    meter: str = "4/4"
    unit: float = 0.5        # duracion de una nota sin modificador, en negras
    key: str = "C"
    voices: list[Voice] = field(default_factory=list)
    drums_pattern: str = ""

    def total_beats(self) -> float:
        end = 0.0
        for v in self.voices:
            for n in v.notes:
                end = max(end, n.start + n.dur)
        return end


# ------------------------------------------------------------- parser ABC

NOTE_RE = re.compile(
    r"""
    (?P<acc>\^{1,2}|_{1,2}|=)?                      # accidental
    (?P<letter>[A-Ga-g])                            # nota
    (?P<oct>[,']*)                                  # octava
    (?P<len>(?:\d+)?(?:/{1,2}\d*)?)?                # duracion
    (?P<rest>z|Z|x)?                                # (no usado, ver REST_RE)
    """,
    re.VERBOSE,
)
REST_RE = re.compile(r"(?P<rest>[zZx])(?P<len>(?:\d+)?(?:/{1,2}\d*)?)?")
TIE_RE = re.compile(r"^\s*-\s*")


def _duration(spec: str | None, unit: float) -> float:
    """Convierte un modificador de duracion ABC a multiplo de la unidad."""
    if not spec:
        return unit
    mult = 1.0
    m = re.match(r"^(\d+)?(/{1,2}(\d+)?)?$", spec)
    if not m:
        return unit
    if m.group(1):
        mult *= int(m.group(1))
    if m.group(2):
        frac = m.group(2)
        if frac == "/":
            mult *= 0.5
        elif frac == "//":
            mult *= 0.25
        elif m.group(3):
            mult *= 1.0 / int(m.group(3))
        else:
            mult *= 0.5
    return unit * mult


def _pitch(letter: str, oct_marks: str, acc: str | None, key_sig: dict[str, int]) -> int:
    base = LETTER_PC[letter.upper()]
    octave = 4  # ABC: C = do central (MIDI 60)
    if letter.islower():
        octave += 1
    for ch in oct_marks:
        octave += 1 if ch == "'" else -1
    if acc == "^":
        base += 1
    elif acc == "^^":
        base += 2
    elif acc == "_":
        base -= 1
    elif acc == "__":
        base -= 2
    elif acc == "=":
        pass  # natural: sin alteracion
    else:
        base += key_sig.get(letter.upper(), 0)
    return 12 * (octave + 1) + (base % 12)


def _expand_repeats(body: str) -> str:
    """Expande |: ... :| una vez (y :| sin inicio = repetir desde el principio)."""
    if ":|" not in body:
        return body
    out: list[str] = []
    start = 0
    for m in re.finditer(r"\|:", body):
        seg_start = m.end()
        end_m = re.search(r":\|", body[seg_start:])
        if not end_m:
            break
        seg_end = seg_start + end_m.start()
        out.append(body[start:seg_start])       # antes del |:
        seg = body[seg_start:seg_end]
        out.append(seg * 2)                     # el |: ... :| suena dos veces
        start = seg_end + 2
    out.append(body[start:])
    body = "".join(out)
    # :| sin |: previo -> repetir todo lo anterior
    if ":|" in body:
        before, after = body.split(":|", 1)
        body = before + before + after
    return body.replace(":|", "").replace("|:", "")


def parse_abc(text: str) -> Score:
    header: dict[str, str] = {}
    directives: list[str] = []
    body_lines: list[str] = []
    cur_voice: str | None = None

    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.strip()
        if not s:
            continue
        if s.startswith("%%MIDI") or s.startswith("%%humseed"):
            directives.append(s)
            continue
        if s.startswith("%"):
            continue
        if re.match(r"^[wW]:", s):              # letra: ignorada
            continue
        if s.startswith("V:") or s.startswith("[V:"):
            vm = re.match(r"^\[?V:\s*([^\s\]]+)\]?\s*(.*)$", s)
            if not vm:
                continue
            vid, rest = vm.group(1), vm.group(2).strip()
            body_lines.append(f"[V:{vid}]")
            if rest:
                # V:1 puede llevar el nombre y a continuacion la musica en la misma linea
                rest_clean = re.sub(r"\b\w+\s*=\s*(\"[^\"]*\"|\S+)", "", rest).strip()
                if rest_clean:
                    body_lines.append(rest_clean)
            cur_voice = vid
            continue
        m = re.match(r"^([A-Za-z]):\s*(.*)$", s)
        if m and m.group(1) in ("X", "T", "M", "L", "Q", "K"):
            header[m.group(1)] = m.group(2).strip()
            continue
        body_lines.append(s)

    unit = _duration(header.get("L", "1/8"), 1.0) if False else 0.5
    lm = re.match(r"^(\d+)\s*/\s*(\d+)$", header.get("L", "1/8"))
    if lm:
        unit = 4.0 * int(lm.group(1)) / int(lm.group(2))

    # Q:n/d=BPM  significa "n/d nota = BPM"; normalizamos siempre a negras.
    #   Q:1/4=132 -> 132   Q:1/2=60 -> 120
    tempo = 120.0
    qfield = header.get("Q", "")
    qm = re.search(r"=\s*([\d.]+)", qfield)
    if qm:
        bpm = float(qm.group(1))
        num = re.match(r"^\s*(\d+)\s*/\s*(\d+)", qfield)
        if num:
            tempo = bpm * 4.0 * int(num.group(1)) / int(num.group(2))
        else:
            tempo = bpm   # "Q:132" se interpreta como negras

    key_field = header.get("K", "C")
    sig = key_signature(key_field)
    key_name = (key_field.split()[0] if key_field else "C")

    score = Score(title=header.get("T", ""), tempo=tempo,
                  meter=header.get("M", "4/4"), unit=unit, key=key_name)

    # --- voces desde la cabecera V: ---
    # metadatos de voz desde las lineas V: originales (name=, clef=, program=, channel=)
    meta: dict[str, dict] = {}
    voice_order: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not (s.startswith("V:") or s.startswith("[V:")):
            continue
        m = re.match(r"^\s*\[?V:\s*([^\s\]]+)\s*(.*)$", s)
        if not m:
            continue
        vid = m.group(1)
        if vid not in voice_order:
            voice_order.append(vid)
        d = meta.setdefault(vid, {})
        for fm in re.finditer(r"(\w+)\s*=\s*(\"[^\"]*\"|\S+)", m.group(2)):
            d[fm.group(1).lower()] = fm.group(2).strip('"')

    # directivas globales
    drums = ""
    for d in directives:
        if d.startswith("%%humseed drums"):
            drums = d.split(None, 2)[-1].strip()
    score.drums_pattern = drums

    # --- parseo del cuerpo por voz ---
    current: Voice | None = None
    pos = 0.0
    accidental_state: dict[str, int] = {}
    measure_pos = 0.0
    pending_ties: dict[str, int] = {}

    def new_voice(vid: str) -> Voice:
        d = meta.get(vid, {})
        v = Voice(
            name=d.get("name", vid),
            clef=d.get("clef", "treble"),
        )
        return v

    voices_by_vid: dict[str, Voice] = {}
    pos_by_vid: dict[str, float] = {}
    current_vid: str | None = None
    for line in body_lines:
        m = re.match(r"^\[V:(\S+)\]$", line)
        if m:
            vid = m.group(1)
            if vid not in voices_by_vid:
                if vid not in meta:
                    meta[vid] = {}
                current = new_voice(vid)
                voices_by_vid[vid] = current
                pos_by_vid[vid] = 0.0
                score.voices.append(current)
            current = voices_by_vid[vid]
            current_vid = vid
            pos = pos_by_vid[vid]
            accidental_state = {}
            continue
        if current is None:
            continue

        body = _expand_repeats(line)
        i = 0
        while i < len(body):
            ch = body[i]
            if ch == "[":
                # acorde
                end = body.find("]", i)
                if end == -1:
                    break
                inner = body[i + 1 : end]
                j = end + 1
                lm2 = re.match(r"(\d+)?(/|//)?(\d+)?", body[j:])
                len_spec = lm2.group(0) if lm2 else ""
                if len_spec:
                    j += len(len_spec)
                dur = _duration(len_spec or None, unit)
                pitches = []
                for nm in NOTE_RE.finditer(inner):
                    if not nm.group("letter"):
                        continue
                    pitches.append(_pitch(nm.group("letter"), nm.group("oct"),
                                          nm.group("acc"), sig))
                for p in pitches:
                    current.notes.append(MNote(pos, dur, p))
                pos += dur
                i = j
                continue
            rm = REST_RE.match(body, i)
            if rm and rm.group("rest"):
                dur = _duration(rm.group("len"), unit)
                if rm.group("rest") == "Z":
                    nbeats = 4.0
                    if mm := re.match(r"^(\d+)\s*/\s*(\d+)$", score.meter):
                        nbeats = 4.0 * int(mm.group(1)) / int(mm.group(2))
                    dur = nbeats
                pos += dur if dur > 0 else unit
                i = rm.end()
                continue
            nm = NOTE_RE.match(body, i)
            if nm and nm.group("letter"):
                # duracion: adyacente o dentro de corchetes de union ^^ etc.
                j = nm.end()
                # si lo siguiente es un '-' de ligadura, unir duraciones iguales
                dur = _duration(nm.group("len"), unit)
                # ligadura: A2- A2 -> una nota de duracion 2*dur
                rest_of = body[j:]
                ties = 0
                k = j
                while True:
                    tm = re.match(r"^\s*-\s*([A-Ga-g][,']*)", body[k:])
                    if not tm:
                        break
                    k += tm.end()
                    ties += 1
                pitch = _pitch(nm.group("letter"), nm.group("oct"),
                               nm.group("acc"), sig)
                if nm.group("acc"):
                    accidental_state[nm.group("letter").upper()] = pitch
                current.notes.append(MNote(pos, dur * (1 + ties), pitch))
                pos += dur * (1 + ties)
                i = k
                continue
            i += 1
        pos_by_vid[current_vid] = pos

    # --- canales y programas ---
    for idx, v in enumerate(score.voices):
        v.channel = idx
        d = meta.get(voice_order[idx], {}) if idx < len(voice_order) else {}
        if d.get("name"):
            v.name = d["name"]
        if v.clef.startswith("perc") or "drum" in v.name.lower():
            v.channel = 9
            v.is_drums = True
            v.program = 0
            continue
        if "program" in d:
            try:
                v.program = int(d["program"])
            except ValueError:
                v.program = 29
        elif "channel" in d:
            try:
                v.channel = int(d["channel"])
            except ValueError:
                pass
        else:
            low = v.name.lower()
            v.program = 33 if (v.clef.startswith("bass") or "bass" in low) else 29
    return score


# --------------------------------------------------------------- a MIDI

def to_midi(score: Score, out_path: str | Path, drums=None) -> Path:
    pm = pretty_midi.PrettyMIDI(initial_tempo=score.tempo)
    spb = 60.0 / score.tempo

    for v in score.voices:
        inst = pretty_midi.Instrument(program=v.program, is_drum=v.is_drums, name=v.name)
        for n in v.notes:
            if n.dur <= 0:
                continue
            inst.notes.append(
                pretty_midi.Note(
                    velocity=int(max(1, min(127, n.velocity))),
                    pitch=int(max(0, min(127, n.midi))),
                    start=n.start * spb,
                    end=(n.start + n.dur) * spb,
                )
            )
        pm.instruments.append(inst)

    if drums is not None and score.drums_pattern:
        drum_inst = drums.pattern_to_instrument(score.drums_pattern, score.total_beats(),
                                               score.tempo, score.meter)
        if drum_inst.notes:
            pm.instruments.append(drum_inst)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(out_path))
    return out_path


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="ABC (subset) -> MIDI")
    ap.add_argument("abc")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()
    text = Path(args.abc).read_text(encoding="utf-8")
    score = parse_abc(text)
    out = Path(args.out) if args.out else Path(args.abc).with_suffix(".mid")
    to_midi(score, out)
    print(f"voces={len(score.voices)} tempo={score.tempo} beats={score.total_beats()} -> {out}")


if __name__ == "__main__":
    main()
