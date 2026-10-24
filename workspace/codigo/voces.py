"""Catálogo de voces del motor, leído del propio `instruments.py`.

Una **voz** es una función pública de `instruments.py` que devuelve un array numpy
mono y cuyos parámetros son números o listas de números con valor por defecto.
Sin docstring no hay etiqueta ni rango, pero la voz se lista igual (marcada como
`documentada: False`): lo que no se hace nunca es inventar.

Formato del docstring (la primera línea es la descripción):

    def cowbell(vel=1.0, pitch=1.0, seed=0):
        \"\"\"Cencerro metálico de dos tonos.
        familia: percusión
        vel: 0.05..1 Intensidad
        pitch: 0.5..2.5 Tono (x)
        seed: 0..9999 Semilla
        \"\"\"

Para listas de notas: `midis: 21..108[8] Notas` (el `[8]` es el máximo de notas).

Uso:
    python codigo/voces.py                  # catálogo en JSON
    python codigo/voces.py --medir          # además mide cada voz (renderiza)
    python codigo/voces.py --json ruta.json # escribe el catálogo en un fichero
"""

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

# Voces que necesitan material de entrada (un patrón de notas, un sonido de
# origen o sílabas) y por tanto no se pueden describir con números sueltos.
EXCLUIR = {
    "guitar_loop": "pide un patrón de notas (partitura, no parámetros)",
    "reverse_swell": "pide un sonido de origen",
    "voice": "pide sílabas",
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
    """Saca descripción, familia y parámetros del docstring de una voz."""
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
    """Valor por defecto serializable a JSON."""
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
    """Lista de voces del motor, con sus parámetros tal como están en el código."""
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
            "excluida": excluidas.get(nombre),
        }
        salida.append(voz)
    return salida


# ── Medida del perfil ────────────────────────────────────────────────────────


def _db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def perfil(x):
    """Perfil acústico medible de un render: lo que no admite opinión."""
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
    # Ataque: hasta dónde tarda en llegar al 90 % del pico.
    indice_pico = int(np.argmax(np.abs(x)))
    umbral90 = 0.9 * pico
    ataques = np.nonzero(np.abs(x[: indice_pico + 1]) >= umbral90)[0]
    ataque_ms = (ataques[0] / dsp.SR * 1000.0) if len(ataques) else 0.0
    # Cola: desde el pico hasta caer 40 dB por debajo.
    # La cola es hasta el ULTIMO sample por encima del umbral: buscar el primero
    # por debajo daba 5 ms en un bombo, porque la onda cruza por cero.
    umbral40 = pico * 10 ** (-40 / 20)
    por_encima = np.nonzero(np.abs(x[indice_pico:]) >= umbral40)[0]
    ultimo = int(por_encima[-1]) if len(por_encima) else 0
    cola_ms = ultimo / dsp.SR * 1000.0
    # Centroide espectral (energía) hasta 16 kHz.
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
    """Renderiza una voz con sus valores por defecto y devuelve su perfil."""
    fn = getattr(instruments, nombre, None)
    if fn is None:
        return {"error": f"no existe la voz {nombre}"}
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
    """Catálogo completo: voces (las excluidas, marcadas) y su perfil si se pide."""
    lista = voces()
    for voz in lista:
        if voz["excluida"]:
            continue
        if any(p["obligatorio"] for p in voz["params"]):
            # Sin valores por defecto no se puede ni escuchar ni medir: se avisa.
            voz["aviso"] = "tiene parametros obligatorios: no se puede usar sin argumentos"
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
        print(f"escrito {destino}")
        return 0
    print(texto)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
