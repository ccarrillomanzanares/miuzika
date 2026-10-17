"""Regresion: notas REPETIDAS a la misma altura no deben fusionarse en una.

Este es el fallo que costo una sesion entera. Si cantas 16 veces la misma nota
y luego 16 veces otra, la segmentacion por pitch no ve ninguna frontera (el
tono no cambia) y las une todas en una nota larguisima. El analizador decia 3
notas donde habia 64.

El test genera deliberadamente el caso dificil: cuatro grupos de 16 notas
(G2, E2, G2, E2), LEGATO (sin silencios entre notas) y con VIBRATO a 5,2 Hz.
El vibrato es la trampa: mueve el espectro, asi que un detector por flujo
espectral parte cada nota en trozos. Con envolvente de amplitud no.

Verdad conocida: 64 notas.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from humseed.analyze import analyse  # noqa: E402

SR_IO = 44100
NOTA_S = 0.23            # 230 ms por nota, como la toma real
GRUPOS = [("G2", 16), ("E2", 16), ("G2", 16), ("E2", 16)]
VIB_HZ = 5.2             # vibrato humano


def _hz(nombre: str) -> float:
    nombres = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    letra, octava = nombre[:-1], int(nombre[-1])
    midi = nombres.index(letra) + 12 * (octava + 1)
    return 440.0 * 2 ** ((midi - 69) / 12)


def hum_repetido(path: Path) -> int:
    """Genera el tarareo y devuelve cuantas notas canta de verdad."""
    total = sum(n for _, n in GRUPOS)
    out = []
    for nombre, cuantas in GRUPOS:
        for _ in range(cuantas):
            n = int(NOTA_S * SR_IO)
            t = np.arange(n) / SR_IO
            f0 = _hz(nombre)
            vib = 1.0 + 0.015 * np.sin(2 * np.pi * VIB_HZ * t)
            fase = 2 * np.pi * np.cumsum(f0 * vib) / SR_IO
            tono = np.sin(fase) + 0.35 * np.sin(2 * fase) + 0.12 * np.sin(3 * fase)
            # articulacion: ataque rapido y caida sostenida (legato, sin silencio)
            # SIN cola artificial: un bache extra antes de la nota siguiente
            # genera un ataque falso y el test mediria el artefacto, no el metodo
            env = np.minimum(t / 0.025, 1.0)
            caida = 1.0 - 0.55 * np.minimum(t / (NOTA_S * 0.7), 1.0)
            env = env * caida
            out.append(tono * env * 0.5)
    audio = np.concatenate(out).astype(np.float32)
    sf.write(str(path), audio, SR_IO)
    return total


def main() -> int:
    cache = Path(__file__).resolve().parents[1] / "cache"
    cache.mkdir(exist_ok=True)
    wav = cache / "hum_repetido.wav"

    verdaderas = hum_repetido(wav)
    seed = analyse(wav)
    halladas = len(seed.notes)

    print(f"[test] {wav.name}  cantadas={verdaderas}  detectadas={halladas}")
    print(f"[test] tonalidad={seed.key} {seed.mode}  {seed.tempo_bpm} BPM "
          f"registro={seed.register}")
    print(f"[test] notas: {[n.name for n in seed.notes[:14]]} ...")

    fallos = []
    # tolerancia: cuantizar a rejilla de semicorchea puede juntar alguna
    margen = int(verdaderas * 0.15)
    if not (verdaderas - margen <= halladas <= verdaderas + margen):
        fallos.append(
            f"notas repetidas fusionadas: detectadas={halladas} "
            f"esperadas={verdaderas}(+-{margen})")
    # la regresion concreta: antes daba 3, y menos de un tercio es el fallo
    if halladas < verdaderas * 0.6:
        fallos.append(f"fusion grave: {halladas} < 60% de {verdaderas}")
    # las notas son graves (G2/E2)
    if seed.register != "low":
        fallos.append(f"registro esperado low, obtenido {seed.register}")

    if fallos:
        print("\nFALLOS:")
        for f in fallos:
            print(f" - {f}")
        return 1
    print("\nOK: las notas repetidas se separan correctamente")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
