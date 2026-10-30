"""Validates and renders the drum kit IN LAMBDA, in a single trip.

    python gpu/gate_lote.py

For each voice in the list: renders, measures with the same `perfil()` as the catalogue,
checks the gate thresholds and, if it passes, writes the sample to the project output
with post-processing applied and normalized to -1 dBFS.

Leaves in `salida/`:
    kit_<voz>.wav        the sample, ready for the timeline
    kit_<voz>.json       verdict + profile + arguments used

Prints a JSON with everything (the app reads it from stdout).
"""

import json
import os
import sys
import time
import traceback
import wave

import numpy as np
import torch  # the work is done on the GPU: that is why it runs in Lambda

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "codigo"))

import dsp  # noqa: E402
import voces  # noqa: E402
import voces_gpu as V  # noqa: E402

SALIDA = os.path.join(os.getcwd(), "salida")

DURACION_MIN, DURACION_MAX = 0.05, 16.0
RMS_MIN = -60.0
CREST_MIN, CREST_MAX = 2.0, 30.0
DC_MAX = 0.01

# voice: arguments used to generate the kit sample
KIT = {
    "kit_bombo": {"vel": 1.0, "pitch": 1.0, "dur": 0.75, "seed": 1},
    "kit_caja": {"vel": 0.95, "pitch": 1.0, "dur": 0.5, "seed": 2},
    "kit_tom": {"vel": 0.95, "pitch": 1.0, "dur": 1.1, "seed": 3},
    "kit_charles": {"vel": 0.8, "pitch": 1.0, "dur": 0.28, "seed": 4},
    "kit_crash": {"vel": 0.75, "pitch": 1.0, "dur": 2.6, "seed": 5},
    "kit_china": {"vel": 0.75, "pitch": 0.95, "dur": 2.2, "seed": 6},
    "kit_ride": {"vel": 0.8, "pitch": 1.0, "dur": 2.0, "seed": 7},
}


def _post(x, cuerpo=0.0, brillo=0.0, cola=1.0):
    """The same post-processing as the recipes: body, brightness and tail."""
    x = np.asarray(x, dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = x - x.mean()
    if abs(cuerpo) > 1e-6:
        x = x + cuerpo * 1.2 * dsp.lp(x, 180.0, 0.7)
    if abs(brillo) > 1e-6:
        x = x + brillo * 1.1 * dsp.hp(x, 2200.0, 0.7)
    n = len(x)
    if abs(cola - 1.0) > 1e-6 and n > 2:
        ventana = max(int(0.005 * dsp.SR), 1)
        suave = np.convolve(np.abs(x), np.ones(ventana) / ventana, mode="same")
        referencia = max(float(np.max(suave)), 1e-9)
        factor = (np.maximum(suave, 1e-9) / referencia) ** ((1.0 / cola) - 1.0)
        x = x * np.clip(factor, 0.0, 4.0)
    x = x - x.mean()
    pico = max(float(np.max(np.abs(x))), 1e-9)
    return x * (10.0 ** (-1.0 / 20.0)) / pico


def _escribir(ruta, mono):
    est = np.stack([mono, mono], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(dsp.SR)
        w.writeframes(pcm.tobytes())


def main():
    os.makedirs(SALIDA, exist_ok=True)
    resultados = []
    for nombre, args in KIT.items():
        fn = getattr(V, nombre, None)
        if fn is None:
            resultados.append({"voz": nombre, "ok": False, "motivos": ["does not exist"]})
            continue
        motivos = []
        try:
            t0 = time.perf_counter()
            crudo = fn(**args)
            ms = (time.perf_counter() - t0) * 1000.0
            x = _post(crudo, cuerpo=0.15 if nombre in ("kit_bombo", "kit_tom") else 0.0,
                      brillo=-0.1 if nombre == "kit_bombo" else 0.0)
            perfil = voces.perfil(x)
            perfil["render_ms"] = round(ms, 1)
            if not DURACION_MIN <= perfil["duracion_s"] <= DURACION_MAX:
                motivos.append(f"duration {perfil['duracion_s']}")
            if perfil["rms_dbfs"] < RMS_MIN:
                motivos.append("it is silence")
            if not CREST_MIN <= perfil["crest_db"] <= CREST_MAX:
                motivos.append(f"crest {perfil['crest_db']}")
            if abs(perfil["dc"]) > DC_MAX:
                motivos.append(f"DC {perfil['dc']}")
            if not motivos:
                ruta = os.path.join(SALIDA, f"{nombre}.wav")
                _escribir(ruta, x)
                with open(os.path.join(SALIDA, f"{nombre}.json"), "w", encoding="utf-8") as f:
                    json.dump({"voz": nombre, "args": args, "perfil": perfil}, f, ensure_ascii=False)
            resultados.append({"voz": nombre, "ok": not motivos, "motivos": motivos, "perfil": perfil})
        except Exception as error:
            resultados.append(
                {"voz": nombre, "ok": False, "motivos": [str(error)], "traza": traceback.format_exc()[-800:]}
            )
    print(
        json.dumps(
            {
                "ok": all(r["ok"] for r in resultados),
                "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no CUDA",
                "cuda": torch.cuda.is_available(),
                "resultados": resultados,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
