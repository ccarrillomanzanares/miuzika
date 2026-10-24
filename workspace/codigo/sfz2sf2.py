"""Convierte un SFZ (+ sus WAV) en un SF2 que entienda openDAW.

    python codigo/sfz2sf2.py "<ruta/al/instrumento.sfz>" "<salida.sf2>"

Por qué existe: los samples de VCSL traen el mapa de notas en `.sfz`, pero el motor
del DAW toca SoundFont (`.sf2`). Sin este paso, un arpa es «un WAV de un Do4»; con
él, es un instrumento que responde al piano roll con sus capas de intensidad.

Qué se hace con cada región del SFZ:
  sample            → se carga, se pasa a mono 44,1k/16b (SF2 no guarda 24 bits)
  pitch_keycenter   → overridingRootKey (la nota original del sample)
  lokey..hikey      → keyRange
  lovey..hivey      → velRange (si no hay, 0..127)
  tune              → fineTune / coarseTune (el SFZ lo da en cents)
  volume            → initialAttenuation (dB → centibeles, sin pasar de 0)
  offset            → se recorta el principio del sample

Los bucles y los ampeg se ignoran: en VCSL ningún SFZ trae `loop_start`, así que
todos los sonidos son one-shot con release. Si algún día aparecen, hay que añadir
el generador 54 (sampleModes) y los índices de bucle en `shdr`.

Lo que NO hace: no genera presets por banco, ni moduladores reales (se emiten los
mínimos obligatorios), ni capas cruzadas por `xfout`. Es un conversor honesto, no
un editor de SoundFonts.
"""

import json
import os
import re
import struct
import sys
import wave

import numpy as np

SR = 44100

# Generadores de SF2 que usamos.
GEN_KEY_RANGE = 43
GEN_VEL_RANGE = 44
GEN_INITIAL_ATTENUATION = 48
GEN_COARSE_TUNE = 51
GEN_FINE_TUNE = 52
GEN_SAMPLE_ID = 53
GEN_SAMPLE_MODES = 54
GEN_OVERALL_AMPLITUDE = 41
GEN_ROOT_KEY = 58


def _leer_wav(ruta):
    """WAV a mono float (16 o 24 bits, cualquier frecuencia)."""
    with wave.open(ruta, "rb") as w:
        canales = w.getnchannels()
        ancho = w.getsampwidth()
        sr = w.getframerate()
        crudo = w.readframes(w.getnframes())
    if ancho == 2:
        datos = np.frombuffer(crudo, dtype="<i2").astype(np.float64) / 32768.0
    elif ancho == 3:
        b = np.frombuffer(crudo, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        entero = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        entero = np.where(entero >= 1 << 23, entero - (1 << 24), entero)
        datos = entero.astype(np.float64) / float(1 << 23)
    elif ancho == 4:
        datos = np.frombuffer(crudo, dtype="<i4").astype(np.float64) / float(1 << 31)
    else:
        datos = np.frombuffer(crudo, dtype=np.uint8).astype(np.float64) / 128.0 - 1.0
    if canales > 1:
        datos = datos.reshape(-1, canales).mean(axis=1)
    if sr != SR and len(datos) > 1:
        n = int(round(len(datos) * SR / sr))
        datos = np.interp(np.linspace(0, len(datos) - 1, n), np.arange(len(datos)), datos)
    return datos


def parsear_sfz(ruta):
    """Devuelve la lista de regiones del SFZ (heredando los valores de <group>)."""
    regiones = []
    actuales = {}
    grupo = {}
    with open(ruta, encoding="utf-8", errors="replace") as f:
        for linea in f:
            limpia = linea.split("//")[0].strip()
            if not limpia:
                continue
            if limpia.lower().startswith("<region>"):
                actuales = dict(grupo)
                continue
            if limpia.lower().startswith("<group>"):
                grupo = {}
                actuales = grupo
                continue
            if limpia.startswith("<"):
                actuales = {}
                continue
            if "=" in limpia:
                clave, valor = limpia.split("=", 1)
                actuales[clave.strip().lower()] = valor.strip()
                if actuales is grupo:
                    continue
                # guardar la región cuando se cierra con la siguiente o al final
                if actuales not in regiones and "sample" in actuales:
                    regiones.append(actuales)
    # `actuales` es el mismo dict que se va rellenando: hay que copiar al cerrar.
    finales = []
    vistos = set()
    for region in regiones:
        clave = region.get("sample")
        if clave and (clave, region.get("lokey"), region.get("hikey")) not in vistos:
            vistos.add((clave, region.get("lokey"), region.get("hikey")))
            finales.append(region)
    return finales


def parsear_sfz_secuencial(ruta):
    """Parser secuencial de verdad: cada <region> se cierra al empezar la siguiente."""
    regiones = []
    grupo = {}
    actual = None
    with open(ruta, encoding="utf-8", errors="replace") as f:
        for linea in f:
            limpia = linea.split("//")[0].strip()
            if not limpia:
                continue
            bajo = limpia.lower()
            if bajo.startswith("<region>"):
                if actual and "sample" in actual:
                    regiones.append(actual)
                actual = dict(grupo)
                continue
            if bajo.startswith("<group>"):
                if actual and "sample" in actual:
                    regiones.append(actual)
                grupo = {}
                actual = grupo
                continue
            if bajo.startswith("<"):
                if actual and "sample" in actual:
                    regiones.append(actual)
                actual = None
                continue
            if "=" in limpia and actual is not None:
                clave, valor = limpia.split("=", 1)
                actual[clave.strip().lower()] = valor.strip()
    if actual and "sample" in actual:
        regiones.append(actual)
    return regiones


def _campo(region, nombre, defecto=None):
    valor = region.get(nombre)
    if valor is None:
        return defecto
    try:
        return float(valor)
    except ValueError:
        return defecto


def construir(regiones, carpeta_sfz, nombre_preset):
    """Devuelve (pcm_bytes, shdr_lista, zonas) listo para escribir."""
    pcm = bytearray()
    shdr = []
    zonas = []
    for region in regiones:
        ruta = os.path.join(carpeta_sfz, region["sample"])
        if not os.path.exists(ruta):
            continue
        datos = _leer_wav(ruta)
        offset = int(_campo(region, "offset", 0) or 0)
        if offset > 0:
            datos = datos[offset:]
        if len(datos) < 32:
            continue
        # SF2 exige 46 muestras de silencio al final de cada sample.
        datos = np.concatenate([datos, np.zeros(46)])
        entero = np.clip(datos * 32767.0, -32768, 32767).astype("<i2")
        inicio = len(pcm) // 2
        pcm += entero.tobytes()
        fin = len(pcm) // 2

        centro = int(_campo(region, "pitch_keycenter", 60) or 60)
        lokey = int(_campo(region, "lokey", centro) or centro)
        hikey = int(_campo(region, "hikey", centro) or centro)
        lovey = int(_campo(region, "lovel", 0) or 0)
        hivey = int(_campo(region, "hivel", 127) or 127)
        tune = _campo(region, "tune", 0.0) or 0.0
        volumen = _campo(region, "volume", 0.0) or 0.0

        # tune en cents → coarse (semitonos) + fine (cents)
        semitonos = int(round(tune / 100.0))
        cents = int(round(tune - semitonos * 100))
        cents = max(-99, min(99, cents))

        shdr.append(
            {
                "nombre": os.path.basename(region["sample"])[:19],
                "inicio": inicio,
                "fin": fin,
                "loop_inicio": inicio,
                "loop_fin": fin,
                "sr": SR,
                "nota_original": max(0, min(127, centro)),
                "correccion": 0,
            }
        )
        zonas.append(
            {
                "sample_id": len(shdr) - 1,
                "lokey": max(0, min(127, lokey)),
                "hikey": max(0, min(127, hikey)),
                "lovey": max(0, min(127, lovey)),
                "hivey": max(0, min(127, hivey)),
                "root": max(0, min(127, centro)),
                "coarse": semitonos,
                "fine": cents,
                # initialAttenuation: dB → centibeles; positivo sólo (no se puede amplificar)
                "atenuacion": int(round(min(0.0, volumen) * -10.0)),
            }
        )
    return bytes(pcm), shdr, zonas


def _chunk(chunk_id, cuerpo):
    """Chunk RIFF con su relleno: los cuerpos impares llevan un byte de pad, y sin él
    el siguiente chunk queda desalineado y ningún lector estricto abre el fichero."""
    relleno = b"\x00" if len(cuerpo) % 2 else b""
    return chunk_id + struct.pack("<I", len(cuerpo)) + cuerpo + relleno


def _lista(tipo, *chunks):
    cuerpo = tipo + b"".join(chunks)
    return _chunk(b"LIST", cuerpo)


def escribir(salida, pcm, shdr, zonas, nombre_preset):
    """Escribe el SF2 completo: INFO, sdta y pdta con sus listas."""
    if not zonas:
        raise SystemExit("no hay ninguna región válida")

    # ── INFO
    info = _lista(
        b"INFO",
        _chunk(b"ifil", struct.pack("<HH", 2, 1)),
        _chunk(b"isng", b"EMU8000\x00"),
        _chunk(b"INAM", nombre_preset[:255].encode("latin-1", "replace") + b"\x00"),
    )

    # ── sdta
    sdta = _lista(b"sdta", _chunk(b"smpl", pcm))

    # ── pdta
    # Estructura: preset → bolsas → instrumento → bolsas por zona → generadores.
    # Cada bolsa apunta al primer generador/modulador que le toca, y cada lista
    # termina con un registro de ceros. Si falta un terminador por zona, el lector
    # funde todas las zonas en una (pasó: el arpa salía con 1 zona y sin notas).
    phdr = [
        struct.pack(
            "<20sHHHiii",
            nombre_preset[:19].encode("latin-1", "replace").ljust(20, b"\x00"),
            0,
            0,
            0,  # bagIndex del preset
            0,
            0,
            0,
        ),
        struct.pack("<20sHHHiii", b"EOP".ljust(20, b"\x00"), 0, 0, 0, 0, 0, 0),
    ]

    # Preset: una bolsa con el generador 41 (instrumento) y su terminador.
    pgen = [struct.pack("<HH", 41, 0), struct.pack("<HH", 0, 0)]
    pbag = [struct.pack("<HH", 0, 0), struct.pack("<HH", 2, 0)]
    pmod = [struct.pack("<HHHHH", 0, 0, 0, 0, 0), struct.pack("<HHHHH", 0, 0, 0, 0, 0)]

    pinst = [
        struct.pack("<20sH", nombre_preset[:19].encode("latin-1", "replace").ljust(20, b"\x00"), 0),
        struct.pack("<20sH", b"EOI".ljust(20, b"\x00"), 0),
    ]

    # Una bolsa por zona: (primer generador, primer modulador).
    ibag = []
    imod = []
    igen = []
    gen_index = 0
    for indice, zona in enumerate(zonas):
        ibag.append(struct.pack("<HH", gen_index, indice))
        generadores = [
            struct.pack("<HH", GEN_KEY_RANGE, (zona["lokey"] << 8) | zona["hikey"]),
            struct.pack("<HH", GEN_VEL_RANGE, (zona["lovey"] << 8) | zona["hivey"]),
            struct.pack("<HH", GEN_ROOT_KEY, zona["root"]),
            struct.pack("<hH", GEN_COARSE_TUNE, zona["coarse"] & 0xFFFF),
            struct.pack("<hH", GEN_FINE_TUNE, zona["fine"] & 0xFFFF),
            struct.pack("<HH", GEN_INITIAL_ATTENUATION, min(1440, zona["atenuacion"])),
            struct.pack("<HH", GEN_SAMPLE_MODES, 0),
            struct.pack("<HH", GEN_SAMPLE_ID, zona["sample_id"]),
            struct.pack("<HH", 0, 0),  # terminador de la zona
        ]
        igen.extend(generadores)
        gen_index += len(generadores)
        imod.append(struct.pack("<HHHHH", 0, 0, 0, 0, 0))
    ibag.append(struct.pack("<HH", gen_index, len(zonas)))  # sentinel
    imod.append(struct.pack("<HHHHH", 0, 0, 0, 0, 0))

    # shdr: un registro por sample (46 bytes) y el terminador EOS.
    registros_shdr = b""
    for s in shdr:
        registros_shdr += struct.pack(
            "<20sIIIIIBbHH",
            s["nombre"].encode("latin-1", "replace").ljust(20, b"\x00"),
            s["inicio"],
            s["fin"],
            s["loop_inicio"],
            s["loop_fin"],
            s["sr"],
            s["nota_original"],
            s["correccion"],
            0,
            1,  # sampleType 1 = mono
        )
    registros_shdr += struct.pack("<20sIIIIIBbHH", b"EOS".ljust(20, b"\x00"), 0, 0, 0, 0, 0, 0, 0, 0, 0)

    pdta = _lista(
        b"pdta",
        _chunk(b"phdr", b"".join(phdr)),
        _chunk(b"pbag", b"".join(pbag)),
        _chunk(b"pmod", b"".join(pmod)),
        _chunk(b"pgen", b"".join(pgen)),
        # El chunk se llama "inst" (4 letras), no "pinst": el nombre largo es el de
        # la estructura de la especificación, no el identificador del fichero.
        _chunk(b"inst", b"".join(pinst)),
        _chunk(b"ibag", b"".join(ibag)),
        _chunk(b"imod", b"".join(imod)),
        _chunk(b"igen", b"".join(igen)),
        _chunk(b"shdr", registros_shdr),
    )

    cuerpo = b"sfbk" + info + sdta + pdta
    with open(salida, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", len(cuerpo) + 4) + cuerpo)


def main(argv):
    if len(argv) < 2:
        print("uso: sfz2sf2.py <in.sfz> <salida.sf2>")
        return 1
    entrada, salida = argv[0], argv[1]
    regiones = parsear_sfz_secuencial(entrada)
    if not regiones:
        print(json.dumps({"ok": False, "error": "el SFZ no tiene regiones"}))
        return 1
    nombre = os.path.splitext(os.path.basename(entrada))[0]
    pcm, shdr, zonas = construir(regiones, os.path.dirname(os.path.abspath(entrada)), nombre)
    escribir(salida, pcm, shdr, zonas, nombre)
    print(
        json.dumps(
            {
                "ok": True,
                "salida": salida,
                "regiones_sfz": len(regiones),
                "zonas": len(zonas),
                "muestras_pcm": len(pcm) // 2,
                "bytes": os.path.getsize(salida),
                "notas": [min(z["lokey"] for z in zonas), max(z["hikey"] for z in zonas)] if zonas else [],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
