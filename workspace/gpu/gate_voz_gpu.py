"""The gate for GPU voices. It runs IN LAMBDA (there is torch there).

    python gpu/gate_voz_gpu.py _candidata_campana.py

Renders the candidate function (imported from `gpu/`), measures it with the same
`perfil()` as the CPU ones and writes the verdict to the project output, which
comes back to the laptop on its own:

    salida/voz_<nombre>.json   verdict + profile + params
    salida/voz_<nombre>.wav    the render, to listen to it

Same thresholds as `codigo/gate_voz.py`: if it does not pass, it does not get in.
"""

import hashlib
import importlib.util
import inspect
import json
import os
import sys
import time
import traceback

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "codigo"))

import voces  # noqa: E402

DURACION_MIN, DURACION_MAX = 0.05, 16.0
RMS_MIN = -60.0
CREST_MIN, CREST_MAX = 2.0, 30.0
DC_MAX = 0.01
RENDER_MAX_MS = 3000.0
PARAMS_MAX = 12


def _cargar(ruta, nombre):
    spec = importlib.util.spec_from_file_location(f"candidata_gpu_{nombre}", ruta)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load the file")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    fn = getattr(modulo, nombre, None)
    if fn is None or not callable(fn):
        raise RuntimeError(f"the file does not define a function called '{nombre}'")
    return fn


def _huella(x):
    return hashlib.sha256(np.asarray(x, dtype=np.float32).tobytes()).hexdigest()[:16]


def _docstring(fn):
    problemas = []
    doc = inspect.getdoc(fn) or ""
    lineas = [l.strip() for l in doc.splitlines() if l.strip()]
    if not lineas:
        return ["no docstring: a description and the family are required"], {}
    if len(lineas[0]) < 8:
        problemas.append("the first docstring line must describe the sound")
    familia = None
    for linea in lineas[1:]:
        if linea.lower().startswith("familia:"):
            familia = linea.split(":", 1)[1].strip().lower()
    if familia is None:
        problemas.append("missing 'familia: percusion|tonal|ruido|textura'")
    elif familia not in voces.FAMILIAS:
        problemas.append(f"family '{familia}' is not valid")
    documentados = {}
    for linea in lineas[1:]:
        m = voces.LINEA_PARAM.match(linea)
        if m:
            documentados[m["clave"]] = {"min": float(m["min"]), "max": float(m["max"])}
            continue
        m = voces.LINEA_BOOL.match(linea)
        if m:
            documentados[m["clave"]] = {"tipo": "bool"}
    params = inspect.signature(fn).parameters
    for clave in params:
        if clave not in documentados:
            problemas.append(f"parameter '{clave}' is not documented")
    for clave, meta in documentados.items():
        if clave not in params:
            problemas.append(f"you document '{clave}' but the function does not have it")
        elif meta.get("tipo") != "bool" and meta["min"] >= meta["max"]:
            problemas.append(f"empty range in '{clave}'")
    return problemas, documentados


def _escribir_wav(ruta, x, sr=44100):
    import wave

    x = np.asarray(x, dtype=float)
    x = x - x.mean()
    pico = max(float(np.max(np.abs(x))), 1e-9)
    x = x * (10.0 ** (-1 / 20.0)) / pico
    est = np.stack([x, x], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def main(argv):
    if not argv:
        print(json.dumps({"ok": False, "motivos": ["missing candidate path"]}))
        return 1
    base = os.path.basename(argv[0])
    nombre = base.replace("_candidata_", "").replace(".py", "")
    ruta = os.path.join(AQUI, base)
    salida = os.path.join(os.getcwd(), "salida")
    motivos = []
    perfil = {}

    try:
        fn = _cargar(ruta, nombre)
    except Exception as error:
        print(json.dumps({"ok": False, "motivos": [f"does not load: {error}"], "traza": traceback.format_exc()[-1200:]}))
        return 1

    problemas_doc, documentados = _docstring(fn)
    motivos.extend(problemas_doc)
    firma = inspect.signature(fn)
    if len(firma.parameters) > PARAMS_MAX:
        motivos.append(f"too many parameters ({len(firma.parameters)} > {PARAMS_MAX})")
    obligatorios = [c for c, p in firma.parameters.items() if p.default is inspect.Parameter.empty]
    if obligatorios:
        motivos.append(f"parameters without a default value: {', '.join(obligatorios)}")

    args = {
        clave: param.default
        for clave, param in firma.parameters.items()
        if param.default is not inspect.Parameter.empty
    }
    huellas = []
    try:
        for _ in range(2):
            t0 = time.perf_counter()
            x = np.asarray(fn(**args), dtype=float)
            if x.ndim > 1:
                x = x.mean(axis=1)
            ms = (time.perf_counter() - t0) * 1000.0
            if x.size == 0:
                motivos.append("returns an empty array")
                break
            if not np.all(np.isfinite(x)):
                motivos.append("returns NaN or infinities")
                break
            huellas.append(_huella(x))
            if ms > RENDER_MAX_MS:
                motivos.append(f"takes {ms:.0f} ms (maximum {RENDER_MAX_MS:.0f})")
            perfil = voces.perfil(x)
            perfil["render_ms"] = round(ms, 1)
    except Exception as error:
        print(json.dumps({"ok": False, "motivos": [f"fails when rendering: {error}"], "traza": traceback.format_exc()[-1200:]}))
        return 1

    if len(huellas) == 2 and huellas[0] != huellas[1]:
        motivos.append("not reproducible: two renders give different samples (use 'seed')")
    if perfil:
        if not DURACION_MIN <= perfil["duracion_s"] <= DURACION_MAX:
            motivos.append(f"lasts {perfil['duracion_s']} s (between {DURACION_MIN} and {DURACION_MAX})")
        if perfil["rms_dbfs"] < RMS_MIN:
            motivos.append(f"it is silence: RMS {perfil['rms_dbfs']} dBFS")
        if not CREST_MIN <= perfil["crest_db"] <= CREST_MAX:
            motivos.append(f"crest {perfil['crest_db']} dB outside {CREST_MIN}-{CREST_MAX}")
        if abs(perfil["dc"]) > DC_MAX:
            motivos.append(f"has DC offset: DC {perfil['dc']}")

    if len(motivos) == 0 and perfil:
        try:
            _escribir_wav(os.path.join(salida, f"voz_{nombre}.wav"), np.asarray(fn(**args), dtype=float))
        except Exception:
            pass

    veredicto = {
        "ok": len(motivos) == 0,
        "nombre": nombre,
        "motivos": motivos,
        "perfil": perfil,
        "params": list(firma.parameters),
        "destino": "gpu",
    }
    os.makedirs(salida, exist_ok=True)
    with open(os.path.join(salida, f"voz_{nombre}.json"), "w", encoding="utf-8") as f:
        json.dump(veredicto, f, ensure_ascii=False)
    print(json.dumps(veredicto, ensure_ascii=False))
    return 0 if veredicto["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
