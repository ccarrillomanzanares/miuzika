"""The gate a new voice goes through before entering the engine.

Usage:
    python codigo/gate_voz.py <candidate_path.py>

The candidate file defines **one** function (the file name without the
`_candidata_` prefix and without the extension) with its docstring in the `voces.py` format.

It is rendered twice with its default values and measured. If it does not meet the
thresholds, it does not get in and the specific reasons are returned; if it does, it prints
`"ok": true` and the profile, and it is the server that bakes it into `instruments.py`.

Output: JSON on stdout (nothing else, so it can be parsed).
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
sys.path.insert(0, AQUI)

import dsp  # noqa: E402
import instruments  # noqa: E402
import voces  # noqa: E402

# Thresholds. Neither a 3 ms click nor a square wave is a sound.
DURACION_MIN, DURACION_MAX = 0.05, 16.0
RMS_MIN = -60.0
CREST_MIN, CREST_MAX = 2.0, 30.0
DC_MAX = 0.01
RENDER_MAX_MS = 3000.0
PARAMS_MAX = 12


def _cargar(ruta, nombre):
    spec = importlib.util.spec_from_file_location(f"candidata_{nombre}", ruta)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load the file")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    fn = getattr(modulo, nombre, None)
    if fn is None or not callable(fn):
        raise RuntimeError(f"the file does not define a function called '{nombre}'")
    return fn


def _huella(x):
    return hashlib.sha256(np.asarray(x, dtype=float).tobytes()).hexdigest()[:16]


def _docstring(fn):
    """Checks that the docstring describes the voice: family and all parameters."""
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
        problemas.append("missing 'familia: percusión|tonal|ruido|textura'")
    elif familia not in voces.FAMILIAS:
        problemas.append(f"family '{familia}' is not valid (use: {', '.join(voces.FAMILIAS)})")
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
            problemas.append(f"parameter '{clave}' is not documented in the docstring")
    for clave, meta in documentados.items():
        if clave not in params:
            problemas.append(f"you document '{clave}' but the function does not have it")
        elif meta.get("tipo") != "bool" and meta["min"] >= meta["max"]:
            problemas.append(f"empty range in '{clave}': {meta['min']}..{meta['max']}")
    return problemas, documentados


def main(argv):
    if not argv:
        print(json.dumps({"ok": False, "motivos": ["missing candidate path"]}))
        return 1
    ruta = argv[0]
    base = os.path.basename(ruta)
    nombre = base.replace("_candidata_", "").replace(".py", "")
    motivos = []
    perfil = {}

    if nombre in voces.EXCLUIR:
        motivos.append(f"'{nombre}' is reserved ({voces.EXCLUIR[nombre]})")
    if nombre in vars(instruments):
        motivos.append(f"a voice called '{nombre}' already exists")
    if not nombre.replace("_", "").isalnum() or nombre[:1].isdigit():
        motivos.append("the name may only contain letters, numbers and underscores")

    fn = None
    try:
        fn = _cargar(ruta, nombre)
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "motivos": [f"does not load: {error}"],
                    "traza": traceback.format_exc()[-1500:],
                }
            )
        )
        return 1

    problemas_doc, documentados = _docstring(fn)
    motivos.extend(problemas_doc)

    firma = inspect.signature(fn)
    if len(firma.parameters) > PARAMS_MAX:
        motivos.append(f"too many parameters ({len(firma.parameters)} > {PARAMS_MAX})")
    obligatorios = [
        c for c, p in firma.parameters.items() if p.default is inspect.Parameter.empty
    ]
    if obligatorios:
        motivos.append(f"has parameters without a default value: {', '.join(obligatorios)}")

    # Render twice: it must be reproducible and fast.
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
            ms = (time.perf_counter() - t0) * 1000.0
            if x.size == 0:
                motivos.append("returns an empty array")
                break
            if not np.all(np.isfinite(x)):
                motivos.append("returns NaN or infinities")
                break
            huellas.append(_huella(x))
            if ms > RENDER_MAX_MS:
                motivos.append(f"takes {ms:.0f} ms to render (maximum {RENDER_MAX_MS:.0f})")
            perfil = voces.perfil(x)
            perfil["render_ms"] = round(ms, 1)
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "motivos": [f"fails when rendering: {error}"],
                    "traza": traceback.format_exc()[-1500:],
                }
            )
        )
        return 1

    if len(huellas) == 2 and huellas[0] != huellas[1]:
        motivos.append("not reproducible: two renders give different samples (use 'seed')")

    if perfil:
        if not DURACION_MIN <= perfil["duracion_s"] <= DURACION_MAX:
            motivos.append(
                f"lasts {perfil['duracion_s']} s (must be between {DURACION_MIN} and {DURACION_MAX})"
            )
        if perfil["rms_dbfs"] < RMS_MIN:
            motivos.append(f"it is silence: RMS {perfil['rms_dbfs']} dBFS")
        if not CREST_MIN <= perfil["crest_db"] <= CREST_MAX:
            motivos.append(
                f"crest {perfil['crest_db']} dB outside {CREST_MIN}-{CREST_MAX} "
                "(a click or a square wave, not a sound)"
            )
        if abs(perfil["dc"]) > DC_MAX:
            motivos.append(f"has DC offset: DC {perfil['dc']}")

    print(
        json.dumps(
            {
                "ok": len(motivos) == 0,
                "nombre": nombre,
                "motivos": motivos,
                "perfil": perfil,
                "params": list(firma.parameters),
                "documentados": documentados,
            },
            ensure_ascii=False,
        )
    )
    return 0 if len(motivos) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
