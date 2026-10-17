"""Transcripcion audio->notas con Basic Pitch (Spotify, Apache-2.0).

Por que esto y no nuestro analizador propio:

    El analizador propio sacaba 4 alturas distintas de una toma con 7, porque
    tomaba la MEDIANA de la altura de cada nota y borraba todo movimiento
    dentro de la nota. Basic Pitch saca las 7 alturas y ademas 1.000 curvas
    de deslizamiento (pitch bends) que nosotros tirábamos a la basura.

    Numeros medidos sobre la misma toma (cache/tomas/toma_20261016_104442):
        nuestro  -> 62 notas, 4 alturas, rango D#2-B2, 0 deslizamientos
        BasicPitch -> 68 notas, 7 alturas, rango D#2-G3, 1.000 deslizamientos

Basic Pitch vive en su propio entorno (necesita tensorflow<2.15, que no tiene
ruedas para Python 3.12). Aqui se le llama como subproceso, asi que da igual
que este en el portatil o en el VPS: se busca el ejecutable en varios sitios.
"""
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pretty_midi

# Basic Pitch corre en el VPS: 20 s por toma, contra 100 s en este portatil.
# El audio viaja por SSH en una sola peticion y no se abre ningun puerto.
HOST = os.environ.get("BP_HOST", "vps")
PY_REMOTO = os.environ.get("BP_PY_REMOTO", "~/transcribe/.venv/bin/python")
SCRIPT_REMOTO = os.environ.get("BP_SCRIPT_REMOTO", "~/transcribe/one_shot.py")


@dataclass
class Transcripcion:
    """Notas + el MIDI ORIGINAL de Basic Pitch.

    El MIDI se guarda tal cual porque trae lo que nuestro modelo de notas no
    representa: los tiempos reales (no cuantizados) y los deslizamientos de
    tono. Cuantizar las notas a una rejilla movia los ataques 543 ms de
    mediana: se oia distinto a lo tarareado. Para oir hay que usar este MIDI.
    """

    notas: list[dict]
    midi: bytes


def transcribir(wav: str | Path, timeout: int = 600) -> Transcripcion:
    """Transcribe en el VPS.

    El WAV entra por la entrada estandar de SSH y el MIDI vuelve por la salida
    en base64: una sola peticion, sin subir ficheros ni abrir puertos.
    """
    datos = Path(wav).read_bytes()
    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
         HOST, f"{PY_REMOTO} {SCRIPT_REMOTO}"],
        input=datos, capture_output=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"transcripcion en el VPS fallo (rc={proc.returncode}): "
            f"{proc.stderr.decode(errors='replace')[-500:]}")
    try:
        midi = base64.b64decode(proc.stdout.decode().strip(), validate=True)
    except Exception as exc:
        raise RuntimeError(
            f"el VPS no devolvio un MIDI valido: {proc.stdout[:200]!r}") from exc
    with tempfile.TemporaryDirectory() as tmp:
        ruta = Path(tmp) / "bp.mid"
        ruta.write_bytes(midi)
        return Transcripcion(notas=leer_midi(ruta), midi=midi)


def leer_midi(path: str | Path) -> list[dict]:
    """Notas de un MIDI como [{'pitch','start','dur'}], ordenadas por tiempo."""
    pm = pretty_midi.PrettyMIDI(str(path))
    notas: list[dict] = []
    for instrumento in pm.instruments:
        if instrumento.is_drum:
            continue
        for n in instrumento.notes:
            notas.append({
                "pitch": int(n.pitch),
                "start": float(n.start),
                "dur": max(float(n.end - n.start), 1e-3),
            })
    notas.sort(key=lambda n: n["start"])
    return notas


def deslizamientos(path: str | Path) -> int:
    """Cuantas curvas de pitch bend trae el MIDI (movimiento dentro de la nota)."""
    pm = pretty_midi.PrettyMIDI(str(path))
    return sum(len(i.pitch_bends) for i in pm.instruments)


def comparar(wav: str | Path) -> dict:
    """Deja por escrito las cifras del analizador propio frente a Basic Pitch."""
    import numpy as np
    from humseed import analyze

    seed = analyze.analyse(wav, motor="propio")
    propias = [(n.pitch, n.start, n.dur) for n in seed.notes]

    bp = transcribir(wav).notas
    alturas = [n["pitch"] for n in bp]
    return {
        "propias": {
            "notas": len(propias),
            "alturas_distintas": len({p for p, _, _ in propias}),
            "rango": (min(p for p, _, _ in propias), max(p for p, _, _ in propias)),
        },
        "basic_pitch": {
            "notas": len(bp),
            "alturas_distintas": len(set(alturas)),
            "rango": (min(alturas), max(alturas)) if alturas else None,
            "dur_mediana_ms": round(float(np.median([n["dur"] for n in bp])) * 1000),
        },
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("uso: python -m humseed.transcribir <wav>")
        raise SystemExit(2)
    for motor, datos in comparar(sys.argv[1]).items():
        print(f"{motor:12} {datos}")
