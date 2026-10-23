"""plan_final.py - cuando suena cada cosa en 'final' (puro numpy, sin torch).

Todo el material musical sale de cancion.py: tempo, estructura de 140 compases,
armonia, letra y melodias. Aqui solo se decide la orquestacion y el momento de
cada evento, para que el script de MIDI (CPU) y el de audio (GPU) usen
exactamente los mismos datos.
"""

import os
import sys

import numpy as np


def _raiz():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(8):
        if os.path.isdir(os.path.join(d, "codigo")) and os.path.isdir(os.path.join(d, "gpu")):
            return d
        padre = os.path.dirname(d)
        if padre == d:
            break
        d = padre
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


RAIZ = _raiz()
for _sub in ("codigo", "gpu"):
    _p = os.path.join(RAIZ, _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import cancion as C  # noqa: E402

SPB = C.SPB
BAR = C.BAR
NB = C.TOTAL_BARS

# compas donde todo cae de golpe (5:10) y queda solo el piano
FIN_BEAT = 116

# semicorcheas: acentos fijos, identicos en cada compas. Sin fills, sin variacion.
ACENTOS_CHARLES = [1.00, 0.34, 0.52, 0.34, 0.78, 0.34, 0.52, 0.40,
                   0.92, 0.34, 0.52, 0.34, 0.78, 0.40, 0.58, 0.44]

# golpes de la muestra invertida y del resto de fx: (tipo, segundo, ganancia)
FX_PUNTOS = [
    ("siseo", 0.0, 1.0),
    ("squelch", 11 * BAR, 0.85),
    ("eco", 34 * BAR, 1.0),
    ("squelch", 60 * BAR, 1.0),
    ("growl", 90 * BAR, 1.0),
    ("inv", 92 * BAR, 1.0),
    ("granular", 96 * BAR, 0.9),
    ("inv", 100 * BAR, 0.85),
    ("growl", 104 * BAR, 0.9),
    ("siseo", 116 * BAR, 0.7),
]


def eventos():
    """Devuelve un dict de listas de eventos por pista."""
    ev = {k: [] for k in ("bombo", "caja", "charles", "plato", "metal", "bajo",
                          "drone", "organo", "guitarra", "sint_break",
                          "voz_lead", "voz_dobles", "fx", "piano")}

    # ------------------------------------------------------------ bateria
    for bar in range(FIN_BEAT):
        t0 = bar * BAR
        # bombo a negras; en la intro solo 1 y 3 (beat seco y escaso)
        beats = (0.0, 2.0) if bar < 11 else (0.0, 1.0, 2.0, 3.0)
        for b in beats:
            ev["bombo"].append((t0 + b * SPB, 1.0 if b in (0.0, 2.0) else 0.80))
        # caja en 2 y 4, desde el primer compas
        for b in (1.0, 3.0):
            ev["caja"].append((t0 + b * SPB, 1.0 if b == 3.0 else 0.90))
        # charles/plato en semicorcheas desde 0:30
        if bar >= 11:
            for k in range(16):
                ev["charles"].append((t0 + k * SPB / 4.0, ACENTOS_CHARLES[k]))
            ev["plato"].append((t0, 0.85))
        # percusion metalica desde 1:30
        if bar >= 34:
            for (b, v) in C.METAL_PAT:
                ev["metal"].append((t0 + b * SPB, v))

    # ------------------------------------------------------------ bajo
    for bar in range(11, FIN_BEAT):
        root = C.ACORDES[C.acorde_de(bar)][0]
        for i, off in enumerate(C.PATRON_BAJO):
            if off is None:
                continue
            ev["bajo"].append((bar * BAR + i * SPB / 2.0,
                               C.DUR_BAJO[i] * SPB,
                               root + off,
                               1.0 if i % 2 == 0 else 0.84))

    # ------------------------------------------------------------ drone
    for bar in range(0, FIN_BEAT):
        root = C.ACORDES[C.acorde_de(bar)][0] + 12
        vel = 0.55 if bar < 11 else 0.80
        ev["drone"].append((bar * BAR, BAR * 1.20, root, vel))

    # ------------------------------------------------------------ organo
    for bar in range(34, FIN_BEAT):
        voces = C.ACORDES[C.acorde_de(bar)][1]
        ev["organo"].append((bar * BAR, BAR * 1.15, voces, 0.90))

    # ------------------------------------------------------------ guitarra
    for bar in range(34, FIN_BEAT):
        if bar < 60:
            if bar % 4 != 0:
                continue
        elif bar % 2 != 0:
            continue
        for (b, d, m, v, mute) in C.GUITARRA:
            dur = d * SPB * (0.45 if mute else 1.0)
            ev["guitarra"].append((bar * BAR + b * SPB, dur, m,
                                   v * (0.55 if mute else 1.0)))

    # ------------------------------------------------------------ bucles nuevos del breakdown
    for bar in range(90, FIN_BEAT):
        voces = C.ACORDES[C.acorde_de(bar)][1]
        for k, b in enumerate((0.0, 0.75, 1.5, 2.25, 3.0, 3.5)):
            ev["sint_break"].append((bar * BAR + b * SPB, 0.44 * SPB,
                                     voces, 0.70 + 0.10 * (k % 2)))

    # ------------------------------------------------------------ voz
    sil = C.silabas_voz()
    ev["voz_lead"] = list(sil)
    dobles = []
    for (t, d, m, v_, c_, vel) in sil:
        dobles.append((t + 0.013, d * 0.98, m, v_, c_, vel * 0.55))
    # respuestas de fondo en el estribillo, medio compas detras del lead
    for (k, bar, beats, cont, vel) in C.LINEAS:
        if not k.startswith("C"):
            continue
        for (t, d, m, v_, c_, vv) in C.linea(C.LETRA[k], bar + 0.5, beats, cont, vel * 0.5):
            dobles.append((t, d, m, v_, c_, vv))
    ev["voz_dobles"] = dobles

    # ------------------------------------------------------------ fx
    ev["fx"] = list(FX_PUNTOS)

    # ------------------------------------------------------------ piano final
    rng = np.random.default_rng(7)
    for i, m in enumerate(C.PIANO_MEL):
        t = FIN_BEAT * BAR + i * 1.5 * BAR + float(rng.normal(0.0, 0.045))
        dur = 1.25 * BAR
        vel = 0.85 * (1.0 - 0.55 * i / len(C.PIANO_MEL))
        ev["piano"].append((max(t, FIN_BEAT * BAR), dur, m, vel))

    return ev


def resumen(ev=None):
    ev = ev or eventos()
    for k in sorted(ev):
        print(f"  {k:<12} {len(ev[k]):5d} eventos")
    return ev


if __name__ == "__main__":
    print(f"plan_final: {NB} compases, {C.DUR:.2f} s, {C.BPM} BPM")
    resumen()
