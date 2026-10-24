"""midi_stahl.py - escribe los .mid de Stahl desde salida/stahl_eventos.json.

Los eventos del json ya estan en pulsos (beats) y son los mismos que se usaron
para renderizar los WAV, asi que MIDI y audio cuadran. Un .mid por pista mas un
multitrack. No toca el motor: solo usa midi.write_midi.
"""

import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, os.path.join(RAIZ, "codigo"))

import midi  # noqa: E402

SALIDA = os.path.join(RAIZ, "proyectos", "stahl", "salida")
EVENTOS = os.path.join(SALIDA, "stahl_eventos.json")

# pista del json -> (nombre visible, canal, programa GM)
MAPA = {
    "Bombo":            ("Bombo",            9, 0),
    "Caja":             ("Caja",             9, 0),
    "Charles":          ("Charles",          9, 0),
    "Metal":            ("Metal",            9, 0),
    "Bajo":             ("Bajo",             0, 38),
    "Drone":            ("Drone",            1, 89),
    "Sint":             ("Sint",             2, 81),
    "Guitarra Riff L":  ("Guitarra Riff L",  3, 30),
    "Guitarra Riff R":  ("Guitarra Riff R",  4, 30),
    "Guitarra Acordes": ("Guitarra Acordes", 5, 27),
}


def _vel(v):
    v = float(v)
    if v > 1.0:          # algunas pistas traen la velocidad en 0..127
        v /= 127.0
    return max(1, min(127, int(round(v * 127))))


def main():
    d = json.load(open(EVENTOS, encoding="utf-8"))
    bpm = float(d["bpm"])
    multitrack = []
    total = 0
    for clave, ev in d["pistas"].items():
        if clave not in MAPA:
            print("  (sin mapear, se omite):", clave)
            continue
        nombre, canal, prog = MAPA[clave]
        notas = [(float(t), float(dur), int(p), _vel(v)) for t, dur, p, v in ev]
        notas.sort()
        pista = {"name": nombre, "channel": canal, "program": prog, "notes": notas}
        multitrack.append(pista)
        ruta = os.path.join(SALIDA, "stahl_%s.mid" % nombre.lower().replace(" ", "_"))
        midi.write_midi(ruta, [pista], bpm=bpm, name=nombre)
        total += len(notas)
        print("  %-42s %5d notas" % (os.path.basename(ruta), len(notas)))

    ruta = os.path.join(SALIDA, "stahl_multitrack.mid")
    midi.write_midi(ruta, multitrack, bpm=bpm, name="Stahl")
    print("  %-42s %5d notas, %d pistas" % (os.path.basename(ruta), total, len(multitrack)))
    print("bpm %.1f  compases %s" % (bpm, d.get("compases")))


if __name__ == "__main__":
    main()
