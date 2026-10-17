"""Construccion del corpus de entrenamiento.

Idea central: el modelo aprende un mapeo

    <seed> (lo que se tararea) + <style> (paleta)  ->  ABC completo (multivotz)

Para eso hacen falta pares. Los corpus folk (Nottingham, The Session) traen
melodia de una voz y licencia limpia; el arreglo (bajo + bateria) lo genera
este modulo de forma determinista. Asi:

  - todo el material de entrenamiento queda en NUESTRO dialecto ABC, que
    abcmini sabe renderizar sin sorpresas;
  - la licencia del corpus de entrenamiento es limpia;
  - el par seed->tema es exacto, porque la semilla se calcula del propio tema.

Uso:
    python -m humseed.corpus --stats
    python -m humseed.corpus --build data/corpus.jsonl
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
from dataclasses import dataclass
from pathlib import Path

from humseed import abcmini, drums

DATA = Path(__file__).resolve().parents[2] / "data"

# ------------------------------------------------------- extraccion de temas

def split_abc_file(text: str) -> list[str]:
    """Trocea un fichero ABC (varios temas) en temas sueltos."""
    tunes, cur = [], []
    for line in text.splitlines():
        if re.match(r"^X:\s*\d+", line.strip()) and cur:
            tunes.append("\n".join(cur))
            cur = []
        cur.append(line)
    if cur:
        tunes.append("\n".join(cur))
    return [t for t in tunes if t.strip() and "K:" in t]


def load_nottingham(root: Path) -> list[dict]:
    out: list[dict] = []
    for f in sorted(root.rglob("*.abc")):
        for i, tune in enumerate(split_abc_file(f.read_text(encoding="utf-8", errors="replace"))):
            out.append({"origen": "nottingham", "fichero": f.name, "idx": i, "abc": tune})
    return out


def load_thesession(csv_path: Path) -> list[dict]:
    csv.field_size_limit(10**7)
    out: list[dict] = []
    seen: set[str] = set()
    with csv_path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            abc = (row.get("abc") or "").strip()
            if not abc:
                continue
            clave = f"{row.get('name','')}|{row.get('mode','')}|{abc[:80]}"
            if clave in seen:
                continue
            seen.add(clave)
            header = (
                f"X:1\nT:{row.get('name','sin titulo')}\n"
                f"M:{row.get('meter','4/4')}\nL:1/8\n"
                f"K:{row.get('mode','Cmajor')}\n"
            )
            out.append({
                "origen": "thesession",
                "tipo": row.get("type", ""),
                "abc": header + abc,
            })
    return out


# ------------------------------------------------ ABC -> notas -> nuestro ABC

def _is_our_dialect(abc: str) -> bool:
    return "%%humseed" in abc or len({m.group(1) for m in
        re.finditer(r"(?m)^\s*\[?V:\s*([^\s\]]+)", abc)}) > 1


@dataclass
class Tune:
    origen: str
    abc: str
    key: str
    mode: str
    meter: str
    tempo: float
    notes: list[tuple[float, float, int]]   # (beat, dur_beats, midi)


AVAILABLE = re.compile(r"^[a-gA-G][,']*$")


def parse_tune(abc: str, tempo: float = 110.0) -> Tune | None:
    """Parsea un tema ABC de una voz con music21 y devuelve sus notas.

    music21 es mas tolerante que nuestro abcmini con ABC 'de la calle'
    (ornamentos {F}, u/v, ~, (3, < >, finales 1/2). Si falla, se descarta.
    Los temas que ya estan en nuestro dialecto se leen con abcmini para que
    el ciclo parse->emit no cambie nada.
    """
    from music21 import converter

    key_field = ""
    meter = "4/4"
    for line in abc.splitlines():
        if line.startswith("K:"):
            key_field = line[2:].strip()
        elif line.startswith("M:"):
            meter = line[2:].strip()

    key_m = re.match(r"([A-Ga-g][#b]?)\s*(.*)", key_field or "C")
    key = key_m.group(1)[0].upper() + key_m.group(1)[1:] if key_m else "C"
    rest = (key_m.group(2) if key_m else "").lower()
    mode = "minor" if rest.startswith("m") and not rest.startswith("maj") else "major"

    try:
        if _is_our_dialect(abc):
            score = abcmini.parse_abc(abc)
            notes = []
            for v in score.voices:
                if v.is_drums:
                    continue
                for n in v.notes:
                    notes.append((n.start, n.dur, n.midi))
                break
            if not notes:
                return None
            return Tune("dialecto", abc, key, mode, meter, score.tempo, notes)

        part = converter.parse(abc, format="abc")
        spb = 60.0 / tempo
        notes = []
        for n in part.recurse().notes:
            if n.isChord:
                continue
            off = float(n.getOffsetInHierarchy(part))
            dur = float(n.quarterLength)
            if dur <= 0 or dur > 8:
                continue
            notes.append((off, dur, int(n.pitch.midi)))
    except Exception:
        return None

    if len(notes) < 4:
        return None
    notes = _normalize_starts(notes)
    return Tune("music21", abc, key, mode, meter, tempo, notes)


def _normalize_starts(notes: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
    """Recorta silencios iniciales y garantiza orden temporal."""
    notes = sorted(notes, key=lambda n: n[0])
    t0 = notes[0][0]
    return [(round(b - t0, 4), round(d, 4), p) for b, d, p in notes]


# ------------------------------------------------------------- arreglo

MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# grados (0-indexados sobre la escala) de los acordes de triada en cada modo
TRIADS_MAJOR = [(0, 4, 7), (2, 5, 9), (4, 7, 11), (5, 9, 0), (7, 11, 2), (9, 0, 4), (11, 2, 5)]
TRIADS_MINOR = [(0, 3, 7), (2, 5, 8), (3, 6, 10), (5, 8, 0), (7, 10, 2), (8, 0, 3), (10, 1, 5)]


def key_root_midi(key: str, mode: str, octave: int = 4) -> int:
    pc = NOTE_NAMES.index(key) if key in NOTE_NAMES else 0
    return 12 * (octave + 1) + pc


def infer_chords(tune: Tune, beats_per_bar: float = 4.0) -> list[int]:
    """Estima un acorde por compas por coincidencia de clases de altura.

    Es tosco a proposito: un estimador honesto y simple es mejor linea base
    que uno complicado que no podemos verificar. Devuelve el indice de grado
    (0-6) por compas.
    """
    root = key_root_midi(tune.key, tune.mode, 3)
    triads = TRIADS_MAJOR if tune.mode == "major" else TRIADS_MINOR
    n_bars = max(1, math.ceil(max(b + d for b, d, _ in tune.notes) / beats_per_bar))

    per_bar: list[list[int]] = [[] for _ in range(n_bars)]
    for b, d, p in tune.notes:
        idx = min(n_bars - 1, int(b // beats_per_bar))
        per_bar[idx].append(p)

    out = []
    prev = 0
    for pcs in per_bar:
        if not pcs:
            out.append(prev)
            continue
        pcs_set = {(p - root) % 12 for p in pcs}
        best, best_score = 0, -1.0
        for gi, triad in enumerate(triads):
            score = sum(1.0 for t in triad if t in pcs_set)
            if gi == prev:
                score += 0.35          # la armonia se mueve menos que la melodia
            if score > best_score:
                best, best_score = gi, score
        out.append(best)
        prev = best
    return out


def midi_to_abc_name(midi: int) -> str:
    """MIDI -> nombre ABC (C = do central = MIDI 60)."""
    octave = midi // 12 - 1
    letter = NOTE_NAMES[midi % 12]
    base = letter[0]
    acc = "^" if letter.endswith("#") else ""
    # en ABC: C..B en la octava del do central; c..b una arriba
    if octave >= 5:
        return acc + base.lower() + "'" * (octave - 5)
    if octave == 4:
        return acc + base
    return acc + base + "," * (4 - octave)


GRID = 0.25          # semicorchea: la rejilla de cuantizacion, en negras
UNIT = 0.25          # L:1/16 -> una nota sin modificador dura 0.25 negras


def quantize_notes(notes: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
    """Ajusta inicios y duraciones a la rejilla de semicorchea.

    Sin esto, duraciones como 0.7 negras no tienen representacion exacta en ABC
    y el tiempo de la voz se desvia, desalineando las barras y las voces entre
    si. Cuantizar a 1/16 hace que TODO sea representable con un digito.
    """
    out = []
    for b, d, p in notes:
        qb = round(b / GRID) * GRID
        qd = max(GRID, round(d / GRID) * GRID)
        out.append((round(qb, 6), round(qd, 6), int(p)))
    # resolver solapamientos (una voz en ABC es monofonica o por acordes)
    out.sort(key=lambda n: (n[0], -n[2]))
    fixed: list[tuple[float, float, int]] = []
    start = None
    group: list[tuple[float, float, int]] = []

    def flush():
        if not group:
            return
        s = group[0][0]
        # el acorde dura hasta el siguiente ataque o su propia duracion, lo menor
        nxt = next((g[0] for g in out if g[0] > s + 1e-9), None)
        dur = min(min(g[1] for g in group), (nxt - s) if nxt else min(g[1] for g in group))
        for _, _, p in sorted(group, key=lambda g: g[2]):
            fixed.append((s, round(max(GRID, dur), 6), p))

    for n in out:
        if start is None or abs(n[0] - start) < 1e-9:
            start = n[0] if start is None else start
            group.append(n)
        else:
            flush()
            group = [n]
            start = n[0]
    flush()
    return sorted(fixed, key=lambda n: (n[0], n[2]))


def dur_to_abc(dur: float) -> str:
    """Duracion en negras -> modificador ABC (unidad L:1/16)."""
    n = dur / UNIT
    if n <= 0:
        return ""
    ni = int(round(n))
    if abs(n - ni) > 1e-6:
        ni = max(1, ni)          # ya cuantizado, pero no perdemos tiempo nunca
    return "" if ni == 1 else str(ni)


def notes_to_voice(notes: list[tuple[float, float, int]], beats: float,
                   beats_per_bar: float = 4.0) -> tuple[str, float]:
    """Notas simultaneas -> acordes ABC; barras cada `beats_per_bar`.

    Devuelve (linea ABC, total de negras emitidas) para poder comprobar que
    todas las voces duran lo mismo.
    """
    notes = quantize_notes(notes)
    # agrupar por inicio -> acordes
    por_inicio: dict[float, list[tuple[float, int]]] = {}
    for b, d, p in notes:
        por_inicio.setdefault(b, []).append((d, p))

    out: list[str] = []
    pos = 0.0
    bar = 0.0
    for b in sorted(por_inicio):
        if b > pos + 1e-6:
            gap = b - pos
            # partir el silencio en trozos que no crucen la barra
            restante = gap
            while restante > 1e-6:
                hasta_barra = beats_per_bar - bar
                trozo = min(restante, hasta_barra)
                out.append("z" + dur_to_abc(trozo))
                bar += trozo
                pos += trozo
                restante -= trozo
                if abs(bar - beats_per_bar) < 1e-6:
                    out.append("|")
                    bar = 0.0
        grupo = por_inicio[b]
        # un acorde solo si hay varias notas con la MISMA duracion y mismo inicio
        if len(grupo) > 1 and len({d for d, _ in grupo}) == 1:
            dur = grupo[0][0]
            nombres = "".join(midi_to_abc_name(p) for _, p in grupo)
            out.append(f"[{nombres}]" + dur_to_abc(dur))
        else:
            dur = max(d for d, _ in grupo)
            out.append(midi_to_abc_name(grupo[0][1]) + dur_to_abc(dur))
        pos = b + dur
        bar += dur
        while bar >= beats_per_bar - 1e-6:
            out.append("|")
            bar -= beats_per_bar

    # relleno final: si la melodia original acaba a media barra, la voz debe
    # llegar igualmente al final de la pieza para que todas cuadren.
    if beats is not None and pos < beats - 1e-6:
        restante = beats - pos
        while restante > 1e-6:
            trozo = min(restante, beats_per_bar - bar)
            out.append("z" + dur_to_abc(trozo))
            bar += trozo
            pos += trozo
            restante -= trozo
            if abs(bar - beats_per_bar) < 1e-6:
                out.append("|")
                bar = 0.0
    return " ".join(out), pos


def beats_per_bar(meter: str) -> float:
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", (meter or "4/4").strip())
    if not m:
        return 4.0
    return 4.0 * int(m.group(1)) / int(m.group(2))


def arrange(tune: Tune, ctx: "Contexto | None" = None) -> str | None:
    """Melodia (folk de 1 voz) -> ABC multivotz con armonia, bajo y bateria.

    Devuelve None si el resultado no es consistente: todas las voces deben
    durar lo mismo, o el MIDI saldra con voces desalineadas.
    """
    if len(tune.notes) < 8:
        return None
    bpb = beats_per_bar(tune.meter)
    beats = max(b + d for b, d, _ in tune.notes)
    if beats < 2 * bpb or beats > 64 * bpb:
        return None

    chords = infer_chords(tune, bpb)
    n_bars = len(chords)
    total = n_bars * bpb

    melody_line, m_total = notes_to_voice(tune.notes, beats, bpb)

    # --- bajo: fundamental en el tiempo 1; en el tiempo 3, quinta si el
    # acorde cambia, fundamental repetida si se mantiene (da sensacion de riff)
    root3 = key_root_midi(tune.key, tune.mode, 3)
    triads = TRIADS_MAJOR if tune.mode == "major" else TRIADS_MINOR
    bass: list[tuple[float, float, int]] = []
    for bi, gi in enumerate(chords):
        root = root3 + triads[gi][0] - 12
        half = bpb / 2
        bass.append((bi * bpb, half, root))
        if bi + 1 < n_bars and chords[bi + 1] == gi:
            bass.append((bi * bpb + half, half, root))
        else:
            nxt = triads[chords[bi + 1] if bi + 1 < n_bars else gi][0]
            bass.append((bi * bpb + half, half, root3 + nxt - 12))
    bass_line, b_total = notes_to_voice(bass, total, bpb)

    # --- armonia: triada entera, un acorde por compas (como acorde ABC [..])
    pad: list[tuple[float, float, int]] = []
    for bi, gi in enumerate(chords):
        for t in triads[gi]:
            pad.append((bi * bpb, bpb, root3 + t))
    pad_line, p_total = notes_to_voice(pad, total, bpb)

    # coherencia: las tres voces duran lo mismo
    if abs(m_total - total) > bpb * 0.5 or abs(b_total - total) > 1e-6 or abs(p_total - total) > 1e-6:
        return None

    c = ctx or Contexto()
    meter = tune.meter if re.match(r"^\d+/\d+$", tune.meter or "") else "4/4"
    return (
        f"X:1\n"
        f"T:{c.style}\n"
        f"M:{meter}\n"
        f"L:1/16\n"
        f"Q:1/4={int(c.tempo)}\n"
        f"K:{tune.key}{'m' if tune.mode == 'minor' else ''}\n"
        f"%%humseed drums {c.drum_pattern}\n"
        f'V:1 name="Lead"   clef=treble program=30\n'
        f'V:2 name="Rhythm" clef=treble program=29\n'
        f'V:3 name="Bass"   clef=bass   program=33\n'
        f"[V:1] {melody_line}\n"
        f"[V:2] {pad_line}\n"
        f"[V:3] {bass_line}\n"
    )


# ------------------------------------------------------------- contexto

ESTILOS = [
    ("industrial gothic rock", "industrial_machine"),
    ("gothic post-punk", "gothic_rock"),
    ("cold darkwave", "four_on_floor"),
    ("industrial stomp metal", "industrial_stomp"),
    ("driving post-punk", "post_punk_drive"),
    ("doom sludge half-time", "half_time_dark"),
    ("stoner desert rock", "stoner_groove"),
    ("thrash gallop", "gallop"),
    ("melodic death metal", "d_beat_metal"),
    ("dark electro", "electro_break"),
    ("sparse dark ballad", "sparse_ballad"),
    ("hard rock", "rock_standard"),
]


@dataclass
class Contexto:
    style: str = "industrial gothic rock"
    drum_pattern: str = "industrial_machine"
    tempo: float = 110.0


# ------------------------------------------------------------ semilla

def seed_from_tune(tune: Tune, ctx: Contexto, frac: float = 0.35) -> str:
    """Genera la linea <seed> que se supone viene de un tarareo.

    Se toma la primera fraccion del tema (lo que 'el usuario tararea'),
    se cualcula el contorno y el ritmo igual que analyze.py.
    """
    beats_total = max(b + d for b, d, _ in tune.notes)
    corte = beats_total * frac
    mel = [(b, d, p) for b, d, p in tune.notes if b < corte]
    if len(mel) < 3:
        mel = tune.notes[: max(3, len(tune.notes) // 3)]

    bins = 16
    buckets: list[list[int]] = [[] for _ in range(bins)]
    for b, d, p in mel:
        idx = min(bins - 1, int(b / max(corte, 1e-6) * bins))
        buckets[idx].append(p)
    contour = [int(round(sum(x) / len(x))) if x else 0 for x in buckets]

    onsets = [round(b, 3) for b, _, _ in mel][:24]
    notes_str = " ".join(
        f"{midi_to_abc_name(p)}:{b:g}:{d:g}" for b, d, p in mel[:32]
    )
    register = "low"
    med = sorted(p for _, _, p in mel)[len(mel) // 2]
    register = "low" if med < 55 else ("high" if med > 67 else "mid")

    return (
        f"<seed> key={tune.key} mode={tune.mode} tempo={ctx.tempo:g} "
        f"register={register} contour=[{' '.join(str(c) for c in contour)}] "
        f"rhythm=[{' '.join(f'{o:g}' for o in onsets)}] notes=[{notes_str}] </seed>"
    )


def make_example(tune: Tune, rng: random.Random) -> dict | None:
    style, pat = rng.choice(ESTILOS)
    ctx = Contexto(style=style, drum_pattern=pat,
                   tempo=float(rng.choice([92, 100, 110, 120, 128, 132, 140, 148])))
    abc = arrange(tune, ctx)
    if not abc:
        return None
    # validacion: el ejemplo debe renderizar con NUESTRO motor
    try:
        score = abcmini.parse_abc(abc)
    except Exception:
        return None
    if not score.voices or sum(len(v.notes) for v in score.voices) < 12:
        return None
    if not drums.PATTERNS.get(drums.resolve(pat)):
        return None

    return {
        "origen": tune.origen,
        "style": style,
        "seed": seed_from_tune(tune, ctx),
        "abc": abc,
        "n_notas": sum(len(v.notes) for v in score.voices),
        "beats": score.total_beats(),
    }


def to_chat(example: dict, sistema: str) -> dict:
    """Formatea el ejemplo como conversacion para el SFT."""
    return {
        "messages": [
            {"role": "system", "content": sistema},
            {"role": "user",
             "content": f"{example['seed']}\nstyle={example['style']}"},
            {"role": "assistant", "content": example["abc"]},
        ]
    }


PROMPT_SISTEMA = (
    "Eres un compositor. Recibes una semilla musical extraida de un tarareo "
    "(tonalidad, tempo, contorno melodico, ritmo y notas) y una paleta de estilo. "
    "Devuelves la pieza completa en notacion ABC con tres voces: V:1 Lead "
    "(la melodia), V:2 Rhythm (armonia) y V:3 Bass (bajo), mas la directiva "
    "%%humseed drums con el patron de bateria. No anadas explicaciones."
)


def main() -> None:
    ap = argparse.ArgumentParser(description="Corpus de entrenamiento humseed")
    ap.add_argument("--stats", action="store_true", help="solo contar y validar")
    ap.add_argument("--build", metavar="JSONL", help="escribir el corpus en JSONL")
    ap.add_argument("--limite", type=int, default=0, help="maximo de temas a procesar")
    ap.add_argument("--semilla", type=int, default=1337)
    args = ap.parse_args()

    tune_path = DATA / "nottingham.zip"
    nottingham_dir = DATA / "nottingham"
    if tune_path.exists() and not nottingham_dir.exists():
        import zipfile

        with zipfile.ZipFile(tune_path) as z:
            z.extractall(DATA)
        src = next(DATA.glob("nottingham-dataset-*"))
        src.rename(nottingham_dir)
    session_csv = DATA / "thesession_tunes.csv"

    fuentes: list[dict] = []
    if nottingham_dir.exists():
        fuentes += load_nottingham(nottingham_dir)
    if session_csv.exists():
        fuentes += load_thesession(session_csv)
    if not fuentes:
        print(f"No hay datos en {DATA}. Descarga nottingham.zip y thesession_tunes.csv.")
        return

    if args.limite:
        fuentes = fuentes[: args.limite]
    print(f"temas extraidos: {len(fuentes)}")

    rng = random.Random(args.semilla)
    parseados: list[tuple[dict, Tune]] = []
    fallos_parse = 0
    for f in fuentes:
        t = parse_tune(f["abc"])
        if t is None:
            fallos_parse += 1
            continue
        # Tune.origen dice con que parser se leyo; el corpus de procedencia es
        # el del fichero fuente, y es lo que interesa conservar.
        t.origen = f["origen"]
        parseados.append((f, t))
    print(f"parseados: {len(parseados)}  descartados: {fallos_parse} "
          f"({fallos_parse/max(len(fuentes),1)*100:.1f}%)")

    ejemplos: list[dict] = []
    fallos_arr = 0
    for f, t in parseados:
        e = make_example(t, rng)
        if e is None:
            fallos_arr += 1
            continue
        ejemplos.append(e)

    print(f"ejemplos validos: {len(ejemplos)}  descartados en arreglo: {fallos_arr}")
    if ejemplos:
        import statistics

        notas = [e["n_notas"] for e in ejemplos]
        beats = [e["beats"] for e in ejemplos]
        print(f"  notas por pieza: min={min(notas)} mediana={statistics.median(notas):.0f} max={max(notas)}")
        print(f"  duracion (negras): min={min(beats):.0f} mediana={statistics.median(beats):.0f} max={max(beats):.0f}")
        por_origen: dict[str, int] = {}
        for e in ejemplos:
            por_origen[e["origen"]] = por_origen.get(e["origen"], 0) + 1
        print(f"  por origen: {por_origen}")
        tokens = sum(len(e["abc"].split()) + len(e["seed"].split()) for e in ejemplos)
        print(f"  tokens estimados del corpus (aprox, por espacios): {tokens:,}")

    if args.build:
        out = Path(args.build)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as fh:
            for e in ejemplos:
                fh.write(json.dumps(to_chat(e, PROMPT_SISTEMA), ensure_ascii=False) + "\n")
        print(f"escrito {out}  ({len(ejemplos)} ejemplos)")

        # muestra legible del primer ejemplo, para inspeccion a ojo
        if ejemplos:
            print("\n--- EJEMPLO ---")
            print(ejemplos[0]["seed"])
            print(f"style={ejemplos[0]['style']}")
            print(ejemplos[0]["abc"])


if __name__ == "__main__":
    main()
