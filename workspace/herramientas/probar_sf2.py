"""Comprueba un SF2 sin depender de nada: lee el fichero y lo toca.

    python herramientas/probar_sf2.py <instrumento.sf2> [nota ...]

Qué hace:
  1. Recorre los chunks del RIFF y lee `phdr`, `pbag`, `pgen`, `pinst`, `ibag`,
     `igen` y `shdr` como manda el formato.
  2. Para cada nota que se le pida, busca la zona cuyo keyRange la contiene, toma
     su sample y la afina con la raíz (`overridingRootKey`) y la afinación fina.
  3. Mide la fundamental y la compara con la esperada (440 · 2^((n-69)/12)).

Si la nota suena a la frecuencia que toca, el mapa de notas está bien. Es una
prueba independiente del conversor: sólo comparte con él el formato, no el código.
"""

import json
import struct
import sys

import numpy as np


def _chunks(datos, inicio, fin):
    """Recorre los chunks de un RIFF y devuelve {id: (inicio_cuerpo, tamaño)}."""
    salida = {}
    i = inicio
    while i + 8 <= fin:
        cid = datos[i : i + 4]
        tam = struct.unpack("<I", datos[i + 4 : i + 8])[0]
        cuerpo = i + 8
        if cid == b"LIST":
            tipo = datos[cuerpo : cuerpo + 4]
            sub = _chunks(datos, cuerpo + 4, cuerpo + tam)
            salida[tipo.decode("latin-1")] = sub
        else:
            salida[cid.decode("latin-1")] = (cuerpo, tam)
        i = cuerpo + tam + (tam & 1)
    return salida


def leer(datos):
    cabecera = _chunks(datos, 12, len(datos))
    info = cabecera.get("INFO", {})
    pdta = cabecera.get("pdta", {})
    sdta = cabecera.get("sdta", {})

    nombre = ""
    if "INAM" in info:
        inicio, tam = info["INAM"]
        nombre = datos[inicio : inicio + tam].split(b"\x00")[0].decode("latin-1", "replace")

    # shdr: 46 bytes por registro
    inicio_shdr, tam_shdr = pdta["shdr"]
    muestras = []
    for i in range(0, tam_shdr, 46):
        registro = datos[inicio_shdr + i : inicio_shdr + i + 46]
        if len(registro) < 46:
            break
        n, s, e, ls, le, sr, pitch, corr, link, tipo = struct.unpack("<20sIIIIIBbHH", registro)
        if n.rstrip(b"\x00") == b"EOS":
            break
        muestras.append(
            {
                "nombre": n.rstrip(b"\x00").decode("latin-1", "replace"),
                "inicio": s,
                "fin": e,
                "sr": sr,
                "nota_original": pitch,
                "correccion": corr,
            }
        )

    # igen: 4 bytes por generador, termina en (0,0)
    inicio_igen, tam_igen = pdta["igen"]
    zonas = []
    actual = {}
    for i in range(0, tam_igen, 4):
        oper, cantidad = struct.unpack("<HH", datos[inicio_igen + i : inicio_igen + i + 4])
        if oper == 0 and cantidad == 0:
            if actual:
                zonas.append(actual)
            actual = {}
            continue
        if oper == 43:  # keyRange
            actual["lokey"], actual["hikey"] = cantidad >> 8, cantidad & 0xFF
        elif oper == 44:
            actual["lovey"], actual["hivey"] = cantidad >> 8, cantidad & 0xFF
        elif oper == 58:
            actual["root"] = cantidad
        elif oper == 51:
            actual["coarse"] = struct.unpack("<h", struct.pack("<H", cantidad))[0]
        elif oper == 52:
            actual["fine"] = struct.unpack("<h", struct.pack("<H", cantidad))[0]
        elif oper == 48:
            actual["atenuacion"] = cantidad
        elif oper == 53:
            actual["sample_id"] = cantidad
    if actual:
        zonas.append(actual)

    # smpl: PCM 16 bits
    inicio_smpl, tam_smpl = sdta["smpl"]
    pcm = np.frombuffer(datos[inicio_smpl : inicio_smpl + tam_smpl], dtype="<i2")
    return {"nombre": nombre, "muestras": muestras, "zonas": zonas, "pcm": pcm}


def tocar(sf2, nota, duracion=1.2):
    for zona in sf2["zonas"]:
        if zona.get("lokey", 0) <= nota <= zona.get("hikey", 127):
            indice = zona.get("sample_id")
            if indice is None or indice >= len(sf2["muestras"]):
                continue
            muestra = sf2["muestras"][indice]
            raiz = zona.get("root", muestra["nota_original"])
            semitonos = nota - raiz + zona.get("coarse", 0)
            cents = zona.get("fine", 0)
            ratio = 2 ** ((semitonos + cents / 100.0) / 12.0)
            audio = sf2["pcm"][muestra["inicio"] : muestra["fin"]].astype(np.float64) / 32768.0
            if len(audio) < 64:
                continue
            n = min(int(duracion * muestra["sr"]), int(len(audio) / max(ratio, 1e-6)))
            posiciones = np.arange(n) * ratio
            trozo = np.interp(posiciones, np.arange(len(audio)), audio)
            atenuacion = 10 ** (-(zona.get("atenuacion", 0) / 10.0) / 20.0)
            return trozo * atenuacion, ratio, muestra["nombre"], raiz
    return None, 1.0, "", 0


def fundamental(x, sr=44100):
    """Fundamental por análisis armónico, no por el pico más alto.

    Un arpa o un saxo pueden tener el 2º armónico mucho más fuerte que la
    fundamental (medido: 522 Hz con amplitud 66 frente a 261 Hz con 13). Se busca el
    pico global y luego se comprueba si la mitad —o un tercio, o un cuarto— también
    tiene un pico con energía suficiente: si lo tiene, ésa es la fundamental.
    """
    trozo = x[int(0.15 * sr) : int(0.15 * sr) + 16384]
    if len(trozo) < 1024:
        return 0.0
    ventana = trozo * np.hanning(len(trozo))
    espectro = np.abs(np.fft.rfft(ventana))
    freqs = np.fft.rfftfreq(len(trozo), 1.0 / sr)
    util = (freqs > 40) & (freqs < 4000)
    if not util.any():
        return 0.0
    f = freqs[util]
    a = espectro[util]
    maximo = float(np.max(a))
    if maximo <= 0:
        return 0.0
    pico = float(f[int(np.argmax(a))])
    # ¿Hay energía en un submúltiplo del pico? Entonces el pico era un armónico.
    for divisor in (2, 3, 4):
        objetivo = pico / divisor
        cercanos = np.nonzero(np.abs(f - objetivo) / max(objetivo, 1e-9) < 0.03)[0]
        if len(cercanos) > 0 and float(np.max(a[cercanos])) > 0.05 * maximo:
            pico = objetivo
            break
    return pico


def main(argv):
    if not argv:
        print("uso: probar_sf2.py <instrumento.sf2> [nota ...]")
        return 1
    datos = open(argv[0], "rb").read()
    sf2 = leer(datos)
    notas = [int(n) for n in argv[1:]] or [60, 72]
    resultados = []
    for nota in notas:
        audio, ratio, nombre, raiz = tocar(sf2, nota)
        if audio is None:
            resultados.append({"nota": nota, "error": "ninguna zona cubre esa nota"})
            continue
        f = fundamental(audio)
        esperada = 440.0 * 2 ** ((nota - 69) / 12.0)
        cents = 1200 * np.log2(max(f, 1e-9) / esperada)
        resultados.append(
            {
                "nota": nota,
                "sample": nombre,
                "raiz": raiz,
                "ratio": round(ratio, 4),
                "hz_medidos": round(f, 1),
                "hz_esperados": round(esperada, 1),
                "desviacion_cents": round(float(cents), 1),
            }
        )
    print(
        json.dumps(
            {
                "instrumento": sf2["nombre"],
                "zonas": len(sf2["zonas"]),
                "muestras": len(sf2["muestras"]),
                "notas": resultados,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
