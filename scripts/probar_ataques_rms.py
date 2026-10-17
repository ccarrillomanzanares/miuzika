"""Compara detectar ataques por flujo espectral vs por envolvente de amplitud.

Motivo: el flujo espectral se dispara con el VIBRATO (el tono oscila y el
espectro se mueve), aunque la nota no se rearticule. Al tararear, una nota
repetida se reconoce por la AMETRALLADORA DE AMPLITUD (sube-baja-sube), no
porque cambie el espectro. Si detectamos por RMS, el vibrato deberia dejar
de generar ataques falsos.

Criterio de exito:
  toma real (2 notas repetidas)  ->  ~64
  melodia sintetica (9 notas)    ->  ~9
"""
import librosa
import numpy as np
from humseed import analyze

CASOS = [
    ("tu toma", "cache/tomas/toma_20261016_104442_original.wav", 64),
    ("sintetico", "cache/hum_test.wav", 9),
]


def con_flujo_espectral(y, wait, delta):
    return librosa.onset.onset_detect(
        y=y, sr=analyze.SR, hop_length=256, delta=delta, wait=wait,
        pre_max=3, post_max=3, pre_avg=3, post_avg=3, units="time")


def _solo_rms(y, sr=None, n_fft=2048, hop_length=512, **kw):
    """Envolvente de amplitud en 1 sola banda (ignora sr: rms no lo necesita)."""
    return librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop_length)


def con_rms(y, wait, delta):
    env = librosa.onset.onset_strength(
        y=y, sr=analyze.SR, hop_length=256, feature=_solo_rms)
    return librosa.onset.onset_detect(
        onset_envelope=env, sr=analyze.SR, hop_length=256, delta=delta,
        wait=wait, pre_max=3, post_max=3, pre_avg=3, post_avg=3, units="time")


def main():
    datos = {n: analyze.load_audio(f) for n, f, _ in CASOS}

    print("=== flujo espectral (lo de ahora) ===")
    print(f"{'wait':>5} {'delta':>7}  " + "  ".join(f"{n:>10}" for n, _, _ in CASOS))
    for wait in (15, 17, 20):
        for delta in (0.012, 0.02):
            fila = []
            for n, _, _ in CASOS:
                on = con_flujo_espectral(datos[n], wait, delta)
                fila.append(f"{len(on):>10d}")
            print(f"{wait:5d} {delta:7.3f}  " + "  ".join(fila))

    print("\n=== envolvente de amplitud (RMS) ===")
    print(f"{'wait':>5} {'delta':>7}  " + "  ".join(f"{n:>10}" for n, _, _ in CASOS))
    for wait in (5, 8, 10, 12, 15, 20):
        for delta in (0.02, 0.05, 0.1):
            fila = []
            for n, _, _ in CASOS:
                on = con_rms(datos[n], wait, delta)
                fila.append(f"{len(on):>10d}")
            print(f"{wait:5d} {delta:7.3f}  " + "  ".join(fila))

    print("\n=== el mejor compromiso ===")
    mejor = None
    for wait in range(3, 31):
        for delta in (0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15):
            err = 0.0
            cuentas = []
            for n, _, obj in CASOS:
                on = con_rms(datos[n], wait, delta)
                cuentas.append(len(on))
                err += abs(len(on) - obj) / obj
            if mejor is None or err < mejor[0]:
                mejor = (err, wait, delta, cuentas)
    err, wait, delta, cuentas = mejor
    print(f"wait={wait} delta={delta}  ->  " +
          "  ".join(f"{n}: {c} (quiero {o})"
                    for (n, _, o), c in zip(CASOS, cuentas)))
    print(f"error total: {err:.3f}")


if __name__ == "__main__":
    main()
