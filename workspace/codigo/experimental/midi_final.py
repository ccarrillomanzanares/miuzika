"""midi_final.py - escribe los .mid de 'final' a partir de plan_final (CPU, numpy).

Un .mid por pista mas un multitrack. Los tiempos salen de los mismos eventos que
usa el render de audio, asi que MIDI y WAV cuadran muestra a muestra.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import plan_final as P  # noqa: E402
import cancion as C      # noqa: E402
import midi              # noqa: E402

SPB = C.SPB
SALIDA = os.path.join(P.RAIZ, "proyectos", "final", "salida")

# nombre de pista -> (canal, programa GM, nota fija o None)
PISTAS = {
    "bombo":       (9, 0, 36),
    "caja":        (9, 0, 38),
    "charles":     (9, 0, 42),
    "plato":       (9, 0, 49),
    "metal":       (9, 0, 51),
    "bajo":        (0, 38, None),
    "drone":       (1, 89, None),
    "organo":      (2, 16, None),
    "guitarra":    (3, 30, None),
    "sint_break":  (4, 81, None),
    "voz_lead":    (5, 53, None),
    "voz_dobles":  (6, 53, None),
    "fx":          (7, 96, None),
    "piano":       (8, 0, None),
}

NOMBRES = {
    "bombo": "Bombo", "caja": "Caja", "charles": "Charles", "plato": "Plato",
    "metal": "Percusion metal", "bajo": "Bajo", "drone": "Drone",
    "organo": "Organo", "guitarra": "Guitarra", "sint_break": "Sint breakdown",
    "voz_lead": "Voz lead", "voz_dobles": "Voz dobles", "fx": "FX", "piano": "Piano",
}


def notas_de(nombre, lista):
    canal, prog, fija = PISTAS[nombre]
    out = []
    for e in lista:
        if nombre in ("bombo", "caja", "charles", "plato", "metal"):
            t, vel = e
            out.append((t / SPB, 0.25, fija, vel))
        elif nombre == "organo":
            t, dur, voces, vel = e
            for m in voces:
                out.append((t / SPB, dur / SPB, m, vel))
        elif nombre == "sint_break":
            t, dur, voces, vel = e
            for m in voces:
                out.append((t / SPB, dur / SPB, m, vel))
        elif nombre == "fx":
            tipo, t, vel = e
            out.append((t / SPB, 1.0, 60, vel))
        elif nombre == "voz_lead" or nombre == "voz_dobles":
            t, dur, m, v_, c_, vel = e
            out.append((t / SPB, dur / SPB, m, vel))
        else:
            t, dur, m, vel = e
            out.append((t / SPB, dur / SPB, m, vel))
    return out


def main():
    os.makedirs(SALIDA, exist_ok=True)
    ev = P.eventos()
    multitrack = []
    for nombre in PISTAS:
        canal, prog, _ = PISTAS[nombre]
        notas = notas_de(nombre, ev[nombre])
        notas.sort()
        pista = {"name": NOMBRES[nombre], "channel": canal, "program": prog, "notes": notas}
        multitrack.append(pista)
        ruta = os.path.join(SALIDA, f"final_{nombre}.mid")
        midi.write_midi(ruta, [pista], bpm=C.BPM, name=NOMBRES[nombre])
        print(f"  {ruta}  {len(notas):5d} notas")
    ruta = os.path.join(SALIDA, "final_multitrack.mid")
    midi.write_midi(ruta, multitrack, bpm=C.BPM, name="final")
    print(f"  {ruta}  {sum(len(p['notes']) for p in multitrack)} notas, {len(multitrack)} pistas")


if __name__ == "__main__":
    main()
