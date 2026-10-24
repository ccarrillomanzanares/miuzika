"""La puerta por la que pasa una voz nueva antes de entrar en el motor.

Uso:
    python codigo/gate_voz.py <ruta_candidata.py>

El fichero candidato define **una** función (el nombre del fichero sin el prefijo
`_candidata_` ni la extensión) con su docstring en el formato de `voces.py`.

Se renderiza dos veces con sus valores por defecto y se mide. Si no cumple los
umbrales, no entra y se devuelven los motivos concretos; si cumple, imprime
`"ok": true` y el perfil, y es el servidor quien la cuece en `instruments.py`.

Salida: JSON por stdout (nada más, para poder parsearlo).
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

# Umbrales. Ni un click de 3 ms ni una onda cuadrada son un sonido.
DURACION_MIN, DURACION_MAX = 0.05, 16.0
RMS_MIN = -60.0
CREST_MIN, CREST_MAX = 2.0, 30.0
DC_MAX = 0.01
RENDER_MAX_MS = 3000.0
PARAMS_MAX = 12


def _cargar(ruta, nombre):
    spec = importlib.util.spec_from_file_location(f"candidata_{nombre}", ruta)
    if spec is None or spec.loader is None:
        raise RuntimeError("no se pudo cargar el fichero")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    fn = getattr(modulo, nombre, None)
    if fn is None or not callable(fn):
        raise RuntimeError(f"el fichero no define una función llamada '{nombre}'")
    return fn


def _huella(x):
    return hashlib.sha256(np.asarray(x, dtype=float).tobytes()).hexdigest()[:16]


def _docstring(fn):
    """Comprueba que el docstring describe la voz: familia y todos los parámetros."""
    problemas = []
    doc = inspect.getdoc(fn) or ""
    lineas = [l.strip() for l in doc.splitlines() if l.strip()]
    if not lineas:
        return ["sin docstring: hace falta una descripción y la familia"], {}
    if len(lineas[0]) < 8:
        problemas.append("la primera línea del docstring debe describir el sonido")
    familia = None
    for linea in lineas[1:]:
        if linea.lower().startswith("familia:"):
            familia = linea.split(":", 1)[1].strip().lower()
    if familia is None:
        problemas.append("falta 'familia: percusión|tonal|ruido|textura'")
    elif familia not in voces.FAMILIAS:
        problemas.append(f"familia '{familia}' no válida (usa: {', '.join(voces.FAMILIAS)})")
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
            problemas.append(f"el parámetro '{clave}' no está documentado en el docstring")
    for clave, meta in documentados.items():
        if clave not in params:
            problemas.append(f"documentas '{clave}' pero la función no lo tiene")
        elif meta.get("tipo") != "bool" and meta["min"] >= meta["max"]:
            problemas.append(f"rango vacío en '{clave}': {meta['min']}..{meta['max']}")
    return problemas, documentados


def main(argv):
    if not argv:
        print(json.dumps({"ok": False, "motivos": ["falta la ruta del candidato"]}))
        return 1
    ruta = argv[0]
    base = os.path.basename(ruta)
    nombre = base.replace("_candidata_", "").replace(".py", "")
    motivos = []
    perfil = {}

    if nombre in voces.EXCLUIR:
        motivos.append(f"'{nombre}' está reservado ({voces.EXCLUIR[nombre]})")
    if nombre in vars(instruments):
        motivos.append(f"ya existe una voz llamada '{nombre}'")
    if not nombre.replace("_", "").isalnum() or nombre[:1].isdigit():
        motivos.append("el nombre solo puede tener letras, números y guiones bajos")

    fn = None
    try:
        fn = _cargar(ruta, nombre)
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "motivos": [f"no carga: {error}"],
                    "traza": traceback.format_exc()[-1500:],
                }
            )
        )
        return 1

    problemas_doc, documentados = _docstring(fn)
    motivos.extend(problemas_doc)

    firma = inspect.signature(fn)
    if len(firma.parameters) > PARAMS_MAX:
        motivos.append(f"demasiados parámetros ({len(firma.parameters)} > {PARAMS_MAX})")
    obligatorios = [
        c for c, p in firma.parameters.items() if p.default is inspect.Parameter.empty
    ]
    if obligatorios:
        motivos.append(f"tiene parámetros sin valor por defecto: {', '.join(obligatorios)}")

    # Render dos veces: tiene que ser reproducible y rápido.
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
                motivos.append("devuelve un array vacío")
                break
            if not np.all(np.isfinite(x)):
                motivos.append("devuelve NaN o infinitos")
                break
            huellas.append(_huella(x))
            if ms > RENDER_MAX_MS:
                motivos.append(f"tarda {ms:.0f} ms en renderizar (máximo {RENDER_MAX_MS:.0f})")
            perfil = voces.perfil(x)
            perfil["render_ms"] = round(ms, 1)
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "motivos": [f"falla al renderizar: {error}"],
                    "traza": traceback.format_exc()[-1500:],
                }
            )
        )
        return 1

    if len(huellas) == 2 and huellas[0] != huellas[1]:
        motivos.append("no es reproducible: dos renders dan muestras distintas (usa 'seed')")

    if perfil:
        if not DURACION_MIN <= perfil["duracion_s"] <= DURACION_MAX:
            motivos.append(
                f"dura {perfil['duracion_s']} s (debe estar entre {DURACION_MIN} y {DURACION_MAX})"
            )
        if perfil["rms_dbfs"] < RMS_MIN:
            motivos.append(f"es silencio: RMS {perfil['rms_dbfs']} dBFS")
        if not CREST_MIN <= perfil["crest_db"] <= CREST_MAX:
            motivos.append(
                f"crest {perfil['crest_db']} dB fuera de {CREST_MIN}-{CREST_MAX} "
                "(un click o una onda cuadrada, no un sonido)"
            )
        if abs(perfil["dc"]) > DC_MAX:
            motivos.append(f"tiene continua: DC {perfil['dc']}")

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
