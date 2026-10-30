"""Index of the sample catalogue: walks a tree of WAVs and writes catalogo.json.

    python codigo/catalogo.py vcsl --raiz ../catalogo/VCSL-1.2.2-RC

What it stores per file: relative path, family (according to the Hornbostel-Sachs
folder), instrument and articulation inferred from the path, actual format (channels,
bits, sr), measurements (duration, peak, RMS, crest, centroid) and a short content hash
so it can be updated without duplicates.

It does not move or copy audio: it indexes what is there. Deduplication and fine
tagging with the taxonomy are done later, on top of this index.
"""

import hashlib
import json
import os
import re
import sys
import time
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import voces  # noqa: E402  (reuses the profile meter)

CATALOGO = os.path.join(AQUI, "..", "catalogo")

# Hornbostel-Sachs folder -> our family and BST category.
FAMILIAS = {
    "Membranophones": ("percusión", "is-p"),
    "Idiophones": ("percusión", "is-p"),
    "Chordophones": ("tonal", "is-s"),
    "Aerophones": ("tonal", "is-w"),
    "Electrophones": ("tonal", "is-e"),
}

# Name noise: layers, round-robin and mics.
RUIDO = re.compile(
    r"(?:_?v[l\d]+|_rr\d+|_mid|_sum|_main|_\d+|\brr\d+\b|\bvl\d+\b|\bmf\b|\bff\b|\bf\d\b)",
    re.IGNORECASE,
)


def _leer_wav(ruta):
    """Returns (mono float, sr, channels, bits) with no external dependencies."""
    with wave.open(ruta, "rb") as w:
        canales = w.getnchannels()
        ancho = w.getsampwidth()
        sr = w.getframerate()
        n = w.getnframes()
        crudo = w.readframes(n)
    if ancho == 2:
        datos = np.frombuffer(crudo, dtype="<i2").astype(np.float32) / 32768.0
    elif ancho == 3:
        b = np.frombuffer(crudo, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        entero = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        entero = np.where(entero >= 1 << 23, entero - (1 << 24), entero)
        datos = entero.astype(np.float32) / float(1 << 23)
    elif ancho == 4:
        datos = np.frombuffer(crudo, dtype="<i4").astype(np.float32) / float(1 << 31)
    else:
        datos = np.frombuffer(crudo, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
    if canales > 1:
        datos = datos.reshape(-1, canales).mean(axis=1)
    return datos, sr, canales, ancho * 8


# Path levels that are a category, not an instrument.
CATEGORIAS = {
    "composite chordophones", "zithers", "struck idiophones", "plucked idiophones",
    "friction idiophones", "struck membranophones", "other membranophones",
    "edge-blown aerophones", "reed aerophones", "lip aerophones", "free aerophones",
    "tx81z", "assets",
}

# Subfolders that are an articulation, not an instrument.
ARTICULACIONES = {
    "normal", "stroke", "sustains", "releases", "non-vibrato", "vibrato", "staccato",
    "gliss", "fx", "individual", "keyswitch", "hard mallet", "soft mallet",
    "traditional mallet", "roll", "hit", "all samples", "scale",
}


def _nombre(ruta_rel):
    """Instrument and articulation from the path.

    The VCSL path is categorical: family / category / [instrument] / [articulation] /
    file. Category and articulation levels are discarded, and the first level left
    is the instrument. Without this, «Grand Piano, Steinway B/Sustains/x.wav»
    came out as the instrument «Sustains».
    """
    partes = ruta_rel.replace("\\", "/").split("/")
    fichero = os.path.splitext(partes[-1])[0]
    intermedios = [p.strip() for p in partes[1:-1] if p.strip().lower() not in CATEGORIAS]
    instrumento = ""
    articulacion = ""
    for nivel in intermedios:
        if nivel.lower() in ARTICULACIONES:
            articulacion = nivel
            break
        if instrumento == "":
            instrumento = nivel
    if instrumento == "":
        instrumento = os.path.splitext(partes[-1])[0]
    limpio = RUIDO.sub(" ", fichero).replace("_", " ").strip()
    return instrumento.strip(), articulacion.strip(), limpio


def indexar(raiz, nombre_catalogo="vcsl"):
    entradas = []
    t0 = time.perf_counter()
    for carpeta, _, ficheros in os.walk(raiz):
        for fichero in ficheros:
            if not fichero.lower().endswith((".wav", ".flac")):
                continue
            completo = os.path.join(carpeta, fichero)
            relativo = os.path.relpath(completo, raiz).replace("\\", "/")
            familia_sachs = relativo.split("/")[0]
            familia, bst = FAMILIAS.get(familia_sachs, ("sin clasificar", ""))
            if fichero.lower().endswith(".flac"):
                # This index measures with `wave`: FLACs are recorded and measured separately.
                entradas.append(
                    {
                        "archivo": relativo,
                        "familia": familia,
                        "bst": bst,
                        "medido": None,
                        "aviso": "flac: pending conversion",
                    }
                )
                continue
            try:
                datos, sr, canales, bits = _leer_wav(completo)
            except Exception as error:
                entradas.append({"archivo": relativo, "error": str(error)})
                continue
            instrumento, articulacion, etiqueta = _nombre(relativo)
            perfil = voces.perfil(datos)
            # The profile is measured at 44.1k; if the file is 48k, the real duration
            # is what the file says, not what comes from assuming 44.1.
            perfil["duracion_s"] = round(len(datos) / sr, 3)
            huella = hashlib.sha1(open(completo, "rb").read(262144)).hexdigest()[:12]
            entradas.append(
                {
                    "archivo": relativo,
                    "familia": familia,
                    "bst": bst,
                    "instrumento": instrumento,
                    "articulacion": articulacion,
                    "etiqueta": etiqueta,
                    "sr": sr,
                    "canales": canales,
                    "bits": bits,
                    "medido": perfil,
                    "sha1": huella,
                }
            )
            if len(entradas) % 250 == 0:
                print(f"  {len(entradas)} files… ({time.perf_counter() - t0:.0f} s)", flush=True)
    return entradas


def main(argv):
    nombre = argv[0] if argv else "vcsl"
    raiz = os.path.join(CATALOGO, "VCSL-1.2.2-RC")
    if "--raiz" in argv:
        raiz = argv[argv.index("--raiz") + 1]
    print(f"indexing {raiz} …", flush=True)
    entradas = indexar(raiz, nombre)
    os.makedirs(CATALOGO, exist_ok=True)
    destino = os.path.join(CATALOGO, f"catalogo-{nombre}.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(
            {
                "catalogo": nombre,
                "raiz": os.path.basename(raiz),
                "licencia": "CC0-1.0",
                "fuente": "https://github.com/sgossner/VCSL",
                "generado": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "total": len(entradas),
                "entradas": entradas,
            },
            f,
            ensure_ascii=False,
        )
    medidos = [e for e in entradas if e.get("medido")]
    print(f"wrote {destino}: {len(entradas)} entries ({len(medidos)} measured)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
