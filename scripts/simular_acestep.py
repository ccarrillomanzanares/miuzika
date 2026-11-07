"""Runs the real generar_audio.py on the laptop with torch and ACE-Step replaced by stand-ins.

Only for checking the path from the form to the model without spending GPU: the stand-in writes
what it received to <name>.recibido.json and a sine WAV of the duration asked for. It says
nothing about the music. Used through server/gpu/simulado.ts.
"""

import json
import math
import os
import runpy
import struct
import sys
import time
import types
import wave
from pathlib import Path


class Sinfo:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def falso_torch():
    t = types.ModuleType("torch")
    t.cuda = types.SimpleNamespace(
        is_available=lambda: False,
        get_device_name=lambda _=0: "simulated",
        get_device_properties=lambda _=0: types.SimpleNamespace(total_memory=0),
        reset_peak_memory_stats=lambda: None,
        max_memory_allocated=lambda: 0,
    )
    return t


def segundos_de(params):
    if params.src_audio and os.path.exists(params.src_audio):
        with wave.open(params.src_audio) as w:
            return w.getnframes() / w.getframerate()
    return params.duration if params.duration and params.duration > 0 else 5


def escribir_seno(ruta, segundos, frecuencia):
    tasa = 48000
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(tasa)
        cuadro = bytearray()
        for i in range(int(segundos * tasa)):
            valor = int(9000 * math.sin(2 * math.pi * frecuencia * i / tasa))
            cuadro += struct.pack("<hh", valor, valor)
        w.writeframes(bytes(cuadro))


def generate_music(_dit, _llm, params, config, save_dir):
    time.sleep(float(os.environ.get("MIUZIKA_SIMULAR_RETARDO", "0")))
    recibido = {k: v for k, v in params.__dict__.items()}
    recibido["config_semillas"] = config.seeds
    recibido["config_aleatoria"] = config.use_random_seed
    audios = []
    for i in range(config.batch_size):
        ruta = Path(save_dir) / f"crudo-{i}.wav"
        escribir_seno(ruta, segundos_de(params), 220 * (i + 1))
        semilla = config.seeds[i] if config.seeds else 1000 + i
        audios.append({"path": str(ruta), "params": {"seed": semilla}, "sample_rate": 48000})
    nombre = [a for a in sys.argv if a.endswith(".receta.json")][0]
    nombre = Path(nombre).name.replace(".receta.json", "")
    (Path(save_dir) / f"{nombre}.recibido.json").write_text(json.dumps(recibido, ensure_ascii=False, indent=1), encoding="utf-8")
    return types.SimpleNamespace(success=True, audios=audios, extra_outputs={"lm_metadata": {"bpm": params.bpm or 97}, "time_costs": {}}, error=None, status_message="")


def instalar_falsos():
    sys.modules["torch"] = falso_torch()
    handler = types.ModuleType("acestep.handler")
    handler.AceStepHandler = lambda: types.SimpleNamespace(initialize_service=lambda **_: None)
    inference = types.ModuleType("acestep.inference")
    inference.GenerationParams = lambda **kw: Sinfo(normalization_db=-1.0, **kw)
    inference.GenerationConfig = lambda **kw: types.SimpleNamespace(**kw)
    inference.generate_music = generate_music
    llm = types.ModuleType("acestep.llm_inference")
    llm.LLMHandler = lambda: types.SimpleNamespace(initialize=lambda **_: None)
    sys.modules.update({"acestep": types.ModuleType("acestep"), "acestep.handler": handler, "acestep.inference": inference, "acestep.llm_inference": llm})


if __name__ == "__main__":
    script = sys.argv[1]
    sys.argv = sys.argv[1:]
    os.environ["MIUZIKA_GENERAR_DENTRO"] = "1"
    instalar_falsos()
    runpy.run_path(script, run_name="__main__")
