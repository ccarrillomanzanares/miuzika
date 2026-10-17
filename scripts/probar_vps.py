"""Prueba el modelo servido: genera desde varias semillas y guarda el resultado.

Se ejecuta EN EL VPS (necesita hablar con el llama-server local).

Uso:
    python probar.py <puerto> <etiqueta>
"""

import json
import sys
import time
import urllib.request

SEMILLAS = [
    "<seed> key=E mode=minor tempo=132 register=low "
    "contour=[40 43 45 46 43 40 46 43 40 40 43 45 40 43 45 52] "
    "rhythm=[0 0.5 1 1.5 2 2.5 3 3.5] "
    "notes=[E:0:0.5 G:0.5:0.5 B:1:0.5 E:1.5:0.5 A:2:0.5 G:2.5:0.5 B:3:0.5 E:3.5:0.5] </seed>",

    "<seed> key=A mode=minor tempo=140 register=mid "
    "contour=[57 0 60 62 64 0 65 64 62 60 0 57 0 55 57 0] "
    "rhythm=[0 1 2 3 4 5 6 7] "
    "notes=[A:0:1 C:1:1 E:2:1 A:3:1 G:4:1 E:5:1 C:6:1 A:7:1] </seed>",

    "<seed> key=D mode=major tempo=155 register=high "
    "contour=[62 0 66 0 69 67 66 0 64 62 0 0 66 69 71 0] "
    "rhythm=[0 0.5 1 1.5 2 3 4 4.5 5 6 7] "
    "notes=[D:0:0.5 F#:0.5:0.5 A:1:0.5 D:1.5:1 A:3:1 G:4:0.5 F#:4.5:0.5 E:5:1 D:6:1] </seed>",
]

SYS = (
    "Eres un compositor. Recibes una semilla musical extraida de un tarareo "
    "(tonalidad, tempo, contorno melodico, ritmo y notas) y una paleta de estilo. "
    "Devuelves la pieza completa en notacion ABC con tres voces: V:1 Lead "
    "(la melodia), V:2 Rhythm (armonia) y V:3 Bass (bajo), mas la directiva "
    "%%humseed drums con el patron de bateria. No anadas explicaciones."
)
ESTILO = "classic hard rock, riff-driven, live drums, overdriven guitars"


def main() -> None:
    puerto = sys.argv[1]
    etiqueta = sys.argv[2]
    muestras = []

    for i, semilla in enumerate(SEMILLAS):
        cuerpo = json.dumps({
            "messages": [
                {"role": "system", "content": SYS},
                {"role": "user", "content": semilla + "\nstyle=" + ESTILO},
            ],
            "temperature": 0.8,
            "top_p": 0.95,
            "max_tokens": 1400,
        }).encode()

        req = urllib.request.Request(
            "http://127.0.0.1:%s/v1/chat/completions" % puerto,
            data=cuerpo, headers={"Content-Type": "application/json"})

        t0 = time.time()
        with urllib.request.urlopen(req, timeout=280) as r:
            d = json.load(r)
        dt = time.time() - t0

        eleccion = d["choices"][0]
        texto = eleccion["message"]["content"]
        uso = d.get("usage") or {}
        nb_tok = uso.get("completion_tokens")

        muestras.append({
            "i": i, "semilla": semilla, "abc": texto,
            "fin": eleccion.get("finish_reason"),
            "tok": nb_tok, "seg": round(dt, 1),
        })
        print("  [%s] semilla %d: %d chars, %s tok, %.0fs, fin=%s" % (
            etiqueta, i, len(texto), nb_tok, dt, eleccion.get("finish_reason")),
            flush=True)

    with open("salida_%s.json" % etiqueta, "w") as fh:
        json.dump(muestras, fh)
    print("guardado salida_%s.json" % etiqueta)


if __name__ == "__main__":
    main()
