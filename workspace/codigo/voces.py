"""Catalogue of engine voices, read from `instruments.py` itself.

A **voice** is a public function in `instruments.py` that returns a mono numpy
array and whose parameters are numbers or lists of numbers with a default value.
Without a docstring there is no label or range, but the voice is listed anyway
(marked as `documentada: False`): what is never done is inventing.

Docstring format (the first line is the description):

    def cowbell(vel=1.0, pitch=1.0, seed=0):
        \"\"\"Two-tone metallic cowbell.
        familia: percusión
        vel: 0.05..1 Intensity
        pitch: 0.5..2.5 Pitch (x)
        seed: 0..9999 Seed
        \"\"\"

For note lists: `midis: 21..108[8] Notes` (the `[8]` is the maximum number of notes).

Usage:
    python codigo/voces.py                  # catalogue as JSON
    python codigo/voces.py --medir          # also measures each voice (renders)
    python codigo/voces.py --json ruta.json # writes the catalogue to a file
"""

import ast
import importlib
import inspect
import json
import os
import re
import sys
import time

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import dsp  # noqa: E402
import instruments  # noqa: E402

# Voices that need input material (a note pattern, a source sound or syllables)
# and therefore cannot be described with plain numbers.
EXCLUIR = {
    "guitar_loop": "needs a note pattern (a score, not parameters)",
    "reverse_swell": "needs a source sound",
    "voice": "needs syllables",
}

FAMILIAS = ("percusión", "tonal", "ruido", "textura", "sin clasificar")

LINEA_PARAM = re.compile(
    r"^(?P<clave>[a-z_][a-z0-9_]*):\s*"
    r"(?P<min>-?\d+(?:\.\d+)?)\.\.(?P<max>-?\d+(?:\.\d+)?)"
    r"(?:\[(?P<maximo>\d+)\])?"
    r"\s+(?P<etiqueta>.+?)"
    r"(?:\s+\((?P<unidad>[^)]+)\))?\s*$"
)
LINEA_BOOL = re.compile(r"^(?P<clave>[a-z_][a-z0-9_]*):\s*bool\s+(?P<etiqueta>.+?)\s*$")


def _leer_docstring(fn):
    """Extracts description, family and parameters from a voice's docstring."""
    doc = inspect.getdoc(fn) or ""
    lineas = [l.strip() for l in doc.splitlines() if l.strip()]
    datos = {"descripcion": lineas[0] if lineas else "", "familia": "sin clasificar", "params": {}}
    for linea in lineas[1:]:
        if linea.lower().startswith("familia:"):
            familia = linea.split(":", 1)[1].strip().lower()
            datos["familia"] = familia if familia in FAMILIAS else "sin clasificar"
            continue
        m = LINEA_PARAM.match(linea)
        if m:
            datos["params"][m["clave"]] = {
                "tipo": "enteros" if m["maximo"] else "num",
                "min": float(m["min"]),
                "max": float(m["max"]),
                "etiqueta": m["etiqueta"].strip(),
                "unidad": (m["unidad"] or "").strip(),
                **({"maximo_elementos": int(m["maximo"])} if m["maximo"] else {}),
            }
            continue
        m = LINEA_BOOL.match(linea)
        if m:
            datos["params"][m["clave"]] = {"tipo": "bool", "etiqueta": m["etiqueta"].strip()}
    return datos


def _defecto(valor):
    """Default value serializable to JSON."""
    if isinstance(valor, (bool, int, float, str)):
        return valor
    if isinstance(valor, (list, tuple)):
        return [float(v) if isinstance(v, float) else int(v) for v in valor]
    if valor is inspect.Parameter.empty:
        return None
    return None


def _tipo_de(valor, anotacion):
    if isinstance(valor, bool):
        return "bool"
    if isinstance(valor, (list, tuple)):
        return "enteros"
    if isinstance(valor, str):
        return "texto"
    if anotacion is bool:
        return "bool"
    return "num"


def voces(excluidas=None):
    """List of engine voices, with their parameters as they are in the code."""
    excluidas = EXCLUIR if excluidas is None else excluidas
    salida = []
    for nombre, fn in sorted(vars(instruments).items()):
        if nombre.startswith("_") or not inspect.isfunction(fn):
            continue
        if fn.__module__ != instruments.__name__:
            continue
        doc = _leer_docstring(fn)
        firma = inspect.signature(fn)
        params = []
        for clave, param in firma.parameters.items():
            if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                continue
            defecto = _defecto(param.default)
            meta = doc["params"].get(clave, {})
            params.append(
                {
                    "clave": clave,
                    "etiqueta": meta.get("etiqueta") or clave.capitalize(),
                    "tipo": meta.get("tipo") or _tipo_de(defecto, param.annotation),
                    "defecto": defecto,
                    "obligatorio": param.default is inspect.Parameter.empty,
                    **({k: meta[k] for k in ("min", "max", "unidad", "maximo_elementos") if k in meta}),
                }
            )
        voz = {
            "clave": nombre,
            "etiqueta": doc["descripcion"].split(".")[0][:60] or nombre.capitalize(),
            "familia": doc["familia"],
            "descripcion": doc["descripcion"],
            "documentada": bool(doc["descripcion"]) and "familia" in inspect.getdoc(fn or "").lower(),
            "params": params,
            "destino": "cpu",
            "excluida": excluidas.get(nombre),
        }
        salida.append(voz)
    return salida


# ── GPU voices: read without importing them (there is no torch here) ─────────

RUTA_GPU = os.path.abspath(os.path.join(AQUI, "..", "gpu", "voces_gpu.py"))


def _docstring_de(nodo):
    """Same as _leer_docstring but from the AST, without importing the module."""
    doc = ast.get_docstring(nodo) or ""
    lineas = [l.strip() for l in doc.splitlines() if l.strip()]
    datos = {"descripcion": lineas[0] if lineas else "", "familia": "sin clasificar", "params": {}}
    for linea in lineas[1:]:
        if linea.lower().startswith("familia:"):
            familia = linea.split(":", 1)[1].strip().lower()
            datos["familia"] = familia if familia in FAMILIAS else "sin clasificar"
            continue
        m = LINEA_PARAM.match(linea)
        if m:
            datos["params"][m["clave"]] = {
                "tipo": "enteros" if m["maximo"] else "num",
                "min": float(m["min"]),
                "max": float(m["max"]),
                "etiqueta": m["etiqueta"].strip(),
                "unidad": (m["unidad"] or "").strip(),
                **({"maximo_elementos": int(m["maximo"])} if m["maximo"] else {}),
            }
            continue
        m = LINEA_BOOL.match(linea)
        if m:
            datos["params"][m["clave"]] = {"tipo": "bool", "etiqueta": m["etiqueta"].strip()}
    return datos


def voces_gpu(ruta=None):
    """GPU engine voices, read from the code with `ast` (no torch)."""
    ruta = ruta or RUTA_GPU
    if not os.path.exists(ruta):
        return []
    arbol = ast.parse(open(ruta, encoding="utf-8").read())
    salida = []
    for nodo in arbol.body:
        if not isinstance(nodo, ast.FunctionDef) or nodo.name.startswith("_"):
            continue
        doc = _docstring_de(nodo)
        params = []
        argumentos = nodo.args.args
        por_defecto = [None] * (len(argumentos) - len(nodo.args.defaults)) + list(nodo.args.defaults)
        for arg, defecto in zip(argumentos, por_defecto):
            if arg.arg in ("self", "cls"):
                continue
            valor = None
            if isinstance(defecto, ast.Constant):
                valor = defecto.value
            elif isinstance(defecto, (ast.List, ast.Tuple)):
                valor = [el.value for el in defecto.elts if isinstance(el, ast.Constant)]
            meta = doc["params"].get(arg.arg, {})
            params.append(
                {
                    "clave": arg.arg,
                    "etiqueta": meta.get("etiqueta") or arg.arg.capitalize(),
                    "tipo": meta.get("tipo") or ("enteros" if isinstance(valor, list) else "num"),
                    "defecto": valor,
                    "obligatorio": defecto is None,
                    **({k: meta[k] for k in ("min", "max", "unidad", "maximo_elementos") if k in meta}),
                }
            )
        salida.append(
            {
                "clave": nodo.name,
                "etiqueta": doc["descripcion"].split(".")[0][:60] or nodo.name.capitalize(),
                "familia": doc["familia"],
                "descripcion": doc["descripcion"],
                "documentada": bool(doc["descripcion"]) and "familia" in (ast.get_docstring(nodo) or "").lower(),
                "params": params,
                "destino": "gpu",
                "excluida": None,
            }
        )
    return salida


# ── Profile measurement ──────────────────────────────────────────────────────


def _db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def perfil(x):
    """Measurable acoustic profile of a render: what admits no opinion."""
    x = np.asarray(x, dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    n = len(x)
    if n == 0:
        return {"duracion_s": 0.0, "vacia": True}
    pico = float(np.max(np.abs(x)))
    if pico < 1e-9:
        return {"duracion_s": n / dsp.SR, "vacia": True}
    rms = float(np.sqrt(np.mean(x**2)))
    # Attack: how long it takes to reach 90 % of the peak.
    indice_pico = int(np.argmax(np.abs(x)))
    umbral90 = 0.9 * pico
    ataques = np.nonzero(np.abs(x[: indice_pico + 1]) >= umbral90)[0]
    ataque_ms = (ataques[0] / dsp.SR * 1000.0) if len(ataques) else 0.0
    # Tail: from the peak until it falls 40 dB below.
    # The tail goes up to the LAST sample above the threshold: looking for the first
    # one below gave 5 ms on a kick, because the wave crosses zero.
    umbral40 = pico * 10 ** (-40 / 20)
    por_encima = np.nonzero(np.abs(x[indice_pico:]) >= umbral40)[0]
    ultimo = int(por_encima[-1]) if len(por_encima) else 0
    cola_ms = ultimo / dsp.SR * 1000.0
    # Spectral centroid (energy) up to 16 kHz.
    bloque = x[: min(n, dsp.SR * 4)]
    espectro = np.abs(np.fft.rfft(bloque * np.hanning(len(bloque))))
    freqs = np.fft.rfftfreq(len(bloque), 1.0 / dsp.SR)
    util = freqs <= 16000
    total = float(np.sum(espectro[util]))
    centroide = float(np.sum(freqs[util] * espectro[util]) / total) if total > 0 else 0.0
    return {
        "duracion_s": round(n / dsp.SR, 3),
        "pico_dbfs": round(_db(pico), 2),
        "rms_dbfs": round(_db(rms), 2),
        "crest_db": round(_db(pico) - _db(rms), 2),
        "dc": round(float(np.mean(x)), 5),
        "ataque_ms": round(ataque_ms, 1),
        "cola_ms": round(cola_ms, 1),
        "centroide_hz": round(centroide, 0),
        "clipeadas": int(np.sum(np.abs(x) > 1.0)),
        "vacia": False,
    }


def medir_voz(nombre, args=None, timeout_s=10.0):
    """Renders a voice with its default values and returns its profile."""
    fn = getattr(instruments, nombre, None)
    if fn is None:
        return {"error": f"voice {nombre} does not exist"}
    if args is None:
        args = {
            clave: param.default
            for clave, param in inspect.signature(fn).parameters.items()
            if param.default is not inspect.Parameter.empty
        }
    t0 = time.perf_counter()
    x = np.asarray(fn(**args), dtype=float)
    ms = (time.perf_counter() - t0) * 1000.0
    datos = perfil(x)
    datos["render_ms"] = round(ms, 1)
    return datos


def catalogo(con_perfil=False):
    """Full catalogue: voices (the excluded ones, marked) and their profile if requested."""
    lista = voces() + voces_gpu()
    for voz in lista:
        if voz.get("destino") == "gpu":
            # The profile of a GPU voice is measured on Lambda, not here (there is no torch).
            continue
        if voz["excluida"]:
            continue
        if any(p["obligatorio"] for p in voz["params"]):
            # Without default values it can neither be listened to nor measured: a warning is given.
            voz["aviso"] = "has required parameters: it cannot be used without arguments"
            continue
        if con_perfil:
            voz["perfil"] = medir_voz(voz["clave"])
    return {
        "motor": "instruments.py",
        "voces": lista,
        "familias": list(FAMILIAS),
        "excluidas": EXCLUIR,
    }


def main(argv):
    con_perfil = "--medir" in argv
    datos = catalogo(con_perfil=con_perfil)
    destino = None
    if "--json" in argv:
        destino = argv[argv.index("--json") + 1]
    texto = json.dumps(datos, ensure_ascii=False, indent=2)
    if destino:
        with open(destino, "w", encoding="utf-8") as f:
            f.write(texto)
        print(f"wrote {destino}")
        return 0
    print(texto)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
