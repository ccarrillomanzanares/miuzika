"""MIDI multitrack -> nuestro dialecto ABC + semilla de condicionamiento.

Por que existe: los estilos que queremos (industrial, gotico, metal, stoner)
no vienen en ningun corpus de ABC. Vienen en MIDI de banda completa. Este
modulo convierte ese MIDI al mismo formato que emite el modelo, para poder
entrenar con material real en vez de con arreglos sinteticos.

Que hace con cada pista:
  1. Clasifica por programa General MIDI + nombre de pista -> papel
     (lead / armonia / bajo / bateria).
  2. Cuantiza a semicorchea y valida que la pieza sea utilizable.
  3. Empareja la pista de bateria con uno de NUESTROS patrones con nombre,
     porque el modelo elige patron, no escribe notas de bateria.
  4. Estima tonalidad (Kruskal-Schmuckler sobre histograma de clases) y modo.
  5. Emite el ABC en nuestro dialecto + la linea <seed>.

Uso:
    python -m humseed.midi2abc entrada.mid [-o salida.abc]
    python -m humseed.midi2abc carpeta/ --lote salida.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi

from humseed import abcmini, corpus, drums

# ------------------------------------------------------------- clasificacion

# rangos de programa GM -> papel instrumental
GM_BASS = set(range(32, 40))            # acoustic..synth bass
GM_GUITAR = {24, 25, 26, 27, 28, 29, 30, 31}
GM_KEYS = set(range(0, 8)) | {16, 17, 18, 19, 20, 21, 22, 23}
GM_PAD = set(range(88, 96))
GM_STRINGS = set(range(40, 52))
GM_BRASS = set(range(56, 64))
GM_REED = set(range(64, 72))
GM_LEAD = set(range(80, 88))

NOMBRE_PISTA = [
    (re.compile(r"drum|perc|bater", re.I), "drums"),
    (re.compile(r"bass|bajo", re.I), "bass"),
    (re.compile(r"gtr|guit|guitarra|dist|lead\s*guit", re.I), "guitar"),
    (re.compile(r"pad|synth|string|cuerda", re.I), "pad"),
    (re.compile(r"piano|keys|organ|teclado", re.I), "keys"),
    (re.compile(r"vocal|voz", re.I), "vocal"),
]


@dataclass
class Pista:
    idx: int
    papel: str
    program: int
    nombre: str
    n_notas: int
    pitch_medio: float
    densidad: float          # notas por negra
    notas: list[tuple[float, float, int]]


def clasificar(inst: pretty_midi.Instrument, tempo: float) -> str:
    nombre = (inst.name or "").strip()
    for patron, papel in NOMBRE_PISTA:
        if patron.search(nombre):
            return papel
    if inst.is_drum:
        return "drums"
    p = inst.program
    if p in GM_BASS or (30 <= p < 40):
        return "bass"
    if p in GM_GUITAR:
        return "guitar"
    if p in GM_LEAD:
        return "lead_synth"
    if p in GM_PAD:
        return "pad"
    if p in GM_STRINGS:
        return "strings"
    if p in GM_BRASS:
        return "brass"
    if p in GM_REED:
        return "reed"
    if p in GM_KEYS:
        return "keys"
    return "other"


# ---------------------------------------------------------------- tonalidad

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimar_tonalidad(pitches: list[int]) -> tuple[str, str]:
    if not pitches:
        return "C", "major"
    hist = np.zeros(12)
    for p in pitches:
        hist[p % 12] += 1
    hist /= max(hist.sum(), 1e-9)
    mejor = ("C", "major", -np.inf)
    for shift in range(12):
        for perfil, modo in ((MAJOR_PROFILE, "major"), (MINOR_PROFILE, "minor")):
            score = float(np.dot(np.roll(perfil, shift), hist))
            if score > mejor[2]:
                mejor = (PITCH_NAMES[shift], modo, score)
    return mejor[0], mejor[1]


# ------------------------------------------------------------- bateria -> patron

def emparejar_patron(inst: pretty_midi.Instrument, tempo: float,
                     max_compases: int = 8) -> str:
    """Elige el patron NUESTRO que mejor encaja con la bateria real.

    Puntua con Jaccard (interseccion / union), NO con recall. Con recall puro
    un patron denso como d_beat_metal (bombo en cada corchea) "explica"
    cualquier bateria y se lo lleva todo: eso produjo 896 piezas etiquetadas
    d_beat_metal y 1 rock_standard en un corpus de rock. Jaccard penaliza al
    patron que golpea de mas, que es justo lo que queremos.

    Se comparan los primeros `max_compases` compases, y el bombo y la caja
    pesan mas que el hi-hat porque definen el groove.
    """
    if not inst.notes:
        return "none"
    spb = 60.0 / tempo
    dur_compas = 4 * spb

    # Alturas por pieza, con lo que de verdad usan los MIDI de rock:
    #  - hi-hat 42/44/46, pero tambien RIDE 51/59 y CRASH 49/52/55/57, porque
    #    muchas piezas llevan ride en vez de hi-hat. Si solo se miraba el
    #    hi-hat, esas baterias no llegaban al minimo de golpes y la pieza
    #    acababa con patron "none" (el 29% del corpus, en la primera pasada).
    #  - el crash pesa poco: es un acento, no el pulso.
    piezas = {
        "kick":  (set(range(35, 37)), 1.0),
        "snare": (set(range(37, 41)), 1.0),
        "hat":   ({42, 44, 46, 51, 59}, 0.5),
        "crash": ({49, 52, 55, 57}, 0.2),
        "tom":   ({41, 43, 45, 47, 48, 50}, 0.3),
    }
    real: dict[str, set[tuple[int, int]]] = {k: set() for k in piezas}
    total_hits = 0
    for n in inst.notes:
        if n.start >= max_compases * dur_compas:
            continue
        compas = int(n.start / dur_compas)
        paso = int(round((n.start - compas * dur_compas) / (spb / 4))) % 16
        total_hits += 1                    # cualquier golpe cuenta para el minimo
        for nombre, (alturas, _) in piezas.items():
            if n.pitch in alturas:
                real[nombre].add((compas, paso))

    if total_hits < 12:
        return "none"

    mejor, mejor_score = "rock_standard", -1.0
    for nombre in drums.list_patterns():
        pat = drums.PATTERNS.get(nombre) or {}
        if not pat:
            continue
        score, peso_total = 0.0, 0.0
        for pieza, (_, peso) in piezas.items():
            r = real[pieza]
            peso_total += peso
            if not r or pieza not in pat:
                continue
            pasos = drums._split_bar(pat[pieza])
            esperado = {(c, ps) for c, _ in r for ps, ch in enumerate(pasos) if ch in "xo"}
            union = r | esperado
            if union:
                score += peso * (len(r & esperado) / len(union))
        if peso_total <= 0:
            continue
        j = score / peso_total
        if j > mejor_score:
            mejor, mejor_score = nombre, j
    return mejor


# ------------------------------------------------------------------ voz -> ABC

def cuantizar(notas: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
    out = []
    for b, d, p in notas:
        qb = round(b / corpus.GRID) * corpus.GRID
        qd = max(corpus.GRID, round(d / corpus.GRID) * corpus.GRID)
        out.append((round(qb, 6), round(qd, 6), int(p)))
    return sorted(out, key=lambda n: (n[0], n[2]))


def construir_pistas(pm: pretty_midi.PrettyMIDI, tempo: float) -> list[Pista]:
    spb = 60.0 / tempo
    pistas: list[Pista] = []
    for i, inst in enumerate(pm.instruments):
        if not inst.notes:
            continue
        papel = clasificar(inst, tempo)
        notas = []
        for n in inst.notes:
            b = n.start / spb
            d = max(0.05, (n.end - n.start) / spb)
            notas.append((b, d, n.pitch))
        notas = cuantizar(notas)
        if len(notas) < 4:
            continue
        fin = max(b + d for b, d, _ in notas)
        pistas.append(Pista(
            idx=i, papel=papel, program=inst.program,
            nombre=inst.name or f"pista{i}",
            n_notas=len(notas),
            pitch_medio=float(np.mean([p for _, _, p in notas])),
            densidad=len(notas) / max(fin, 1e-6),
            notas=notas,
        ))
    return pistas


def elegir_voces(pistas: list[Pista]) -> dict[str, Pista] | None:
    """lead + armonia + bajo, con preferencia por guitarra/sintetizador lead."""
    mel = [p for p in pistas if p.papel in ("guitar", "lead_synth", "keys", "vocal", "reed", "brass", "strings", "other")]
    arm = [p for p in pistas if p.papel in ("pad", "keys", "strings", "guitar", "brass", "reed", "other")]
    baj = [p for p in pistas if p.papel == "bass"]

    if not mel or not baj:
        return None

    # lead: el registro mas agudo y con mas notas de las candidatas melodicamente utiles
    lead = max(mel, key=lambda p: p.pitch_medio + 3 * math.log1p(p.n_notas))

    resto_arm = [p for p in arm if p.idx != lead.idx]
    armonia = None
    if resto_arm:
        armonia = max(resto_arm, key=lambda p: p.n_notas)

    bajo = max(baj, key=lambda p: p.n_notas)
    return {"lead": lead, "armonia": armonia, "bajo": bajo}


# ---------------------------------------------------------------- conversion

@dataclass
class Resultado:
    abc: str
    seed: str
    estilo: str
    patron: str
    tempo: float
    key: str
    mode: str
    n_notas: int
    densidad_lead: float


ESTILOS_POR_RASGO = [
    # respaldo: se usa solo cuando la pieza NO trae etiqueta de genero
    # (nombre, patron de bateria, tempo min, tempo max, densidad lead min)
    ("thrash metal gallop",      "gallop",               150, 230, 2.0),
    ("melodic death metal",      "d_beat_metal",         150, 210, 1.6),
    ("heavy metal",              "d_beat_metal",         130, 200, 1.0),
    ("hard rock riff",           "rock_standard",         95, 145, 0.6),
    ("punk rock drive",          "post_punk_drive",      140, 200, 0.8),
    ("alternative rock",         "rock_standard",         90, 145, 0.4),
    ("stoner desert rock",       "stoner_groove",         65, 100, 0.4),
    ("doom sludge half-time",    "half_time_dark",        55,  85, 0.3),
    ("classic rock",             "rock_standard",         95, 135, 0.5),
]


# Etiqueta de GigaMIDI -> como se le describe al modelo.
# Se describe el SONIDO, nunca el nombre de un grupo: eso evita el problema
# legal y ademas funciona mejor como condicionamiento.
DESCRIPTOR_POR_ETIQUETA = {
    "heavy_metal":       "heavy metal, palm-muted down-tuned riffs, driving double bass, tight drums",
    "alternative_rock":  "alternative rock, distorted guitars, mid-tempo groove, live drums",
    "punk":              "punk rock, fast power chords, driving beat, raw energy",
    "rock":              "classic hard rock, riff-driven, live drums, overdriven guitars",
}


def patron_por_tempo(tempo: float, etiqueta: str) -> str:
    """Patron de respaldo coherente con tempo y etiqueta."""
    if etiqueta == "heavy_metal":
        return "gallop" if tempo >= 160 else ("d_beat_metal" if tempo >= 125 else "half_time_dark")
    if etiqueta == "punk":
        return "post_punk_drive" if tempo >= 150 else "rock_standard"
    if etiqueta == "alternative_rock":
        return "stoner_groove" if tempo < 105 else "rock_standard"
    return "stoner_groove" if tempo < 100 else "rock_standard"


def elegir_estilo(tempo: float, densidad_lead: float, tiene_synth: bool) -> tuple[str, str]:
    """Estilo por rasgos medibles, no por etiqueta de genero.

    Es lo unico honesto: no hay corpus etiquetado como industrial/gotico, pero
    si hay canciones con la instrumentacion y el tempo de esos estilos.
    """
    candidatos = [
        (nombre, pat) for nombre, pat, tmin, tmax, dmin in ESTILOS_POR_RASGO
        if tmin <= tempo <= tmax and densidad_lead >= dmin
    ]
    if not candidatos:
        # sin coincidencia por tempo: nos quedamos con el mas cercano en tempo
        ordenados = sorted(ESTILOS_POR_RASGO,
                           key=lambda e: abs(tempo - (e[2] + e[3]) / 2))
        nombre, pat = ordenados[0][0], ordenados[0][1]
        return nombre, pat
    if tiene_synth:
        for nombre, pat in candidatos:
            if "synth" in nombre or "industrial" in nombre or "wave" in nombre:
                return nombre, pat
    return candidatos[0]


def midi_a_abc(pm: pretty_midi.PrettyMIDI, min_notas: int = 40,
               max_notas: int = 6000, etiqueta: str | None = None,
               diagnostico: dict | None = None,
               max_compases: int = 16) -> Resultado | None:
    def descartar(motivo: str):
        if diagnostico is not None:
            diagnostico[motivo] = diagnostico.get(motivo, 0) + 1
        return None

    tempos, valores = pm.get_tempo_changes()
    if len(valores) == 0:
        return descartar("sin tempo")
    # tempo dominante por duracion; si hay muchos, el primero suele ser el bueno
    tempo = float(valores[0])
    if not (30 <= tempo <= 280):
        return descartar("tempo fuera de rango")
    # el tempo de la rejilla manda: sin el, la cuantizacion a 1/16 no significa nada
    tempo = float(np.clip(tempo, 40, 260))

    pistas = construir_pistas(pm, tempo)
    total = sum(p.n_notas for p in pistas)
    if total < min_notas or total > max_notas:
        return descartar("pocas o demasiadas notas")

    voces = elegir_voces(pistas)
    if voces is None:
        return descartar("sin lead o sin bajo")

    lead, bajo = voces["lead"], voces["bajo"]
    armonia = voces["armonia"]

    bpb = 4.0
    fin = max(max(b + d for b, d, _ in lead.notas),
              max(b + d for b, d, _ in bajo.notas))
    if fin < 4 * bpb:
        return descartar("demasiado corta")

    # Recorte a max_compases. Sin esto las piezas salen de cientos de compases
    # y el ABC se va a 6.000-21.000 tokens, muy por encima de lo que cabe en
    # entrenamiento: el 98,7% de los ejemplos quedaba cortado a la mitad.
    # Ademas es lo que el usuario quiere: tarareas un trozo, recibes un trozo.
    tope = max_compases * bpb
    if fin > tope:
        lead.notas = [(b, d, p) for b, d, p in lead.notas if b < tope]
        bajo.notas = [(b, d, p) for b, d, p in bajo.notas if b < tope]
        if armonia is not None:
            armonia.notas = [(b, d, p) for b, d, p in armonia.notas if b < tope]
        if not lead.notas or not bajo.notas:
            return descartar("el recorte dejo la pieza vacia")
        fin = min(fin, tope)

    n_bars = max(1, int(math.ceil(fin / bpb)))
    total_beats = n_bars * bpb

    tiene_synth = any(p.papel in ("pad", "lead_synth", "keys") for p in pistas)
    if etiqueta and etiqueta in DESCRIPTOR_POR_ETIQUETA:
        # la etiqueta del dataset manda: es un dato, no una suposicion
        estilo = DESCRIPTOR_POR_ETIQUETA[etiqueta]
        patron = patron_por_tempo(tempo, etiqueta)
    else:
        estilo, patron = elegir_estilo(tempo, lead.densidad, tiene_synth)

    # bateria real -> nombre de patron nuestro
    baterias = [p for p in pistas if p.papel == "drums"]
    if baterias:
        inst_bat = pm.instruments[max(baterias, key=lambda p: p.n_notas).idx]
        patron = emparejar_patron(inst_bat, tempo)

    lead_line, l_total = corpus.notes_to_voice(lead.notas, total_beats, bpb)
    bajo_line, b_total = corpus.notes_to_voice(bajo.notas, total_beats, bpb)
    if armonia is not None:
        arm_line, a_total = corpus.notes_to_voice(armonia.notas, total_beats, bpb)
    else:
        arm_line, a_total = corpus.notes_to_voice(
            [(b, d, p - 12) for b, d, p in lead.notas], total_beats, bpb)

    key, mode = estimar_tonalidad([p for _, _, p in lead.notas])

    abc = (
        f"X:1\n"
        f"T:{estilo}\n"
        f"M:4/4\n"
        f"L:1/16\n"
        f"Q:1/4={int(round(tempo))}\n"
        f"K:{key}{'m' if mode == 'minor' else ''}\n"
        f"%%humseed drums {patron}\n"
        f'V:1 name="Lead"   clef=treble program={lead.program if lead.papel != "bass" else 30}\n'
        f'V:2 name="Rhythm" clef=treble program=29\n'
        f'V:3 name="Bass"   clef=bass   program=33\n'
        f"[V:1] {lead_line}\n"
        f"[V:2] {arm_line}\n"
        f"[V:3] {bajo_line}\n"
    )

    # --- validacion con NUESTRO motor: si no renderiza, el ejemplo no sirve ---
    try:
        score = abcmini.parse_abc(abc)
    except Exception:
        return descartar("ABC no parsea")
    if not score.voices or sum(len(v.notes) for v in score.voices) < 20:
        return descartar("ABC demasiado vacio")
    if not drums.PATTERNS.get(drums.resolve(patron)) and patron != "none":
        return descartar("patron desconocido")

    ctx = corpus.Contexto(style=estilo, drum_pattern=patron, tempo=tempo)
    tune = corpus.Tune(origen="midi", abc=abc, key=key, mode=mode, meter="4/4",
                       tempo=tempo, notes=lead.notas)
    seed = corpus.seed_from_tune(tune, ctx)

    return Resultado(abc=abc, seed=seed, estilo=estilo, patron=patron, tempo=tempo,
                     key=key, mode=mode, n_notas=sum(len(v.notes) for v in score.voices),
                     densidad_lead=lead.densidad)


def convertir_fichero(path: str | Path, etiqueta: str | None = None,
                      max_compases: int = 16) -> Resultado | None:
    try:
        pm = pretty_midi.PrettyMIDI(str(path))
    except Exception:
        return None
    return midi_a_abc(pm, etiqueta=etiqueta, max_compases=max_compases)


# ---------------------------------------------------------------------- CLI

def main() -> None:
    ap = argparse.ArgumentParser(description="MIDI multitrack -> ABC humseed")
    ap.add_argument("entrada", help="fichero .mid o carpeta")
    ap.add_argument("-o", "--out", help="salida .abc o .jsonl para --lote")
    ap.add_argument("--lote", action="store_true", help="procesar carpeta entera")
    ap.add_argument("--limite", type=int, default=0)
    args = ap.parse_args()

    src = Path(args.entrada)
    if args.lote or src.is_dir():
        if not src.is_dir():
            print(f"{src} no es una carpeta")
            return
        ficheros = sorted(src.rglob("*.mid")) + sorted(src.rglob("*.midi"))
        if args.limite:
            ficheros = ficheros[: args.limite]
        print(f"ficheros MIDI: {len(ficheros)}")
        ok, fallos, estilos = 0, 0, {}
        out = Path(args.out or "midi_corpus.jsonl")
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as fh:
            for f in ficheros:
                r = convertir_fichero(f)
                if r is None:
                    fallos += 1
                    continue
                ok += 1
                estilos[r.estilo] = estilos.get(r.estilo, 0) + 1
                ejemplo = {
                    "origen": "midi",
                    "style": r.estilo,
                    "seed": r.seed,
                    "abc": r.abc,
                    "n_notas": r.n_notas,
                    "beats": None,
                }
                fh.write(json.dumps(corpus.to_chat(ejemplo, corpus.PROMPT_SISTEMA),
                                    ensure_ascii=False) + "\n")
        print(f"validos: {ok}  descartados: {fallos}")
        for e, n in sorted(estilos.items(), key=lambda kv: -kv[1]):
            print(f"  {e:28s} {n}")
        print(f"escrito {out}")
    else:
        r = convertir_fichero(src)
        if r is None:
            print("no ha podido convertirse")
            return
        if args.out:
            Path(args.out).write_text(r.abc, encoding="utf-8")
            print(f"escrito {args.out}")
        else:
            print(r.seed)
            print(f"style={r.estilo}  patron={r.patron}  tempo={r.tempo:.0f}  {r.key} {r.mode}")
            print(r.abc)


if __name__ == "__main__":
    main()
