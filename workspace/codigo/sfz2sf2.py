"""Converts an SFZ (+ its WAVs) into an SF2 that openDAW can read.

    python codigo/sfz2sf2.py "<path/to/instrument.sfz>" "<output.sf2>"

Why it exists: VCSL samples bring their note map in `.sfz`, but the DAW engine
plays SoundFont (`.sf2`). Without this step, a harp is «a WAV of one C4»; with
it, it is an instrument that responds to the piano roll with its velocity layers.

What is done with each SFZ region:
  sample            → loaded, converted to mono 44.1k/16b (SF2 does not store 24 bits)
  pitch_keycenter   → overridingRootKey (the sample's original note)
  lokey..hikey      → keyRange
  lovey..hivey      → velRange (if absent, 0..127)
  tune              → fineTune / coarseTune (the SFZ gives it in cents)
  volume            → initialAttenuation (dB → centibels, never above 0)
  offset            → the beginning of the sample is trimmed

Loops and ampeg are ignored: in VCSL no SFZ brings `loop_start`, so
all sounds are one-shots with release. If they ever appear, generator 54
(sampleModes) and the loop indices in `shdr` would have to be added.

What it does NOT do: it does not generate per-bank presets, nor real modulators
(only the mandatory minimums are emitted), nor crossfaded layers via `xfout`. It is an honest
converter, not a SoundFont editor.
"""

import json
import os
import re
import struct
import sys
import wave

import numpy as np

SR = 44100

# SF2 generators we use.
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
    """WAV to mono float (16 or 24 bits, any sample rate)."""
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


# Maximum .sf2 size: the browser loads it entirely into memory. VCSL's Steinway
# is 1.3 GB of WAV (126 samples of 28 s in stereo at 24 bits for each pedal):
# converted as-is, ~600 MB that the DAW cannot open.
MAX_BYTES = 40 * 1024 * 1024
# Each sample is cut to this duration (with a fade): a 28 s piano note
# is not needed to play; if the sf2 is still large it is lowered to MIN_SEGUNDOS.
MAX_SEGUNDOS = 6.0
MIN_SEGUNDOS = 2.5
FUNDIDO_S = 0.25


def suenan_por_defecto(regiones):
    """The regions that sound when a key is pressed without touching anything else.

    The SFZ ties regions to controllers (locc64/hicc64 = pedal) and to
    `trigger=release` (the noise of releasing the key). SF2 has none of that:
    without this filter, the samples with pedal, without pedal and the release
    ones all sounded AT THE SAME TIME. An untouched controller is worth 0 (as the SFZ
    standard says).
    """
    elegidas = []
    for region in regiones:
        if region.get("trigger", "attack").lower() not in ("attack", "first", "legato"):
            continue
        valida = True
        for clave, valor in region.items():
            m = re.fullmatch(r"(lo|hi)cc(\d+)", clave)
            if not m:
                continue
            try:
                limite = float(valor)
            except ValueError:
                continue
            if (m.group(1) == "lo" and limite > 0) or (m.group(1) == "hi" and limite < 0):
                valida = False
                break
        if valida:
            elegidas.append(region)
    return elegidas or regiones


def capas_reducidas(regiones, maximo):
    """Leaves at most `maximo` velocity layers per key range.

    The remaining ones are spread out (the softest, the loudest and the middle ones) and
    stretched to cover 0-127 without gaps.
    """
    por_tecla = {}
    for region in regiones:
        clave = (region.get("lokey"), region.get("hikey"), region.get("pitch_keycenter"))
        por_tecla.setdefault(clave, []).append(region)
    salida = []
    for grupo in por_tecla.values():
        grupo = sorted(grupo, key=lambda r: int(_campo(r, "lovel", 0) or 0))
        if len(grupo) > maximo:
            if maximo == 1:
                # The middle one: neither the quietest nor the hardest.
                indices = [len(grupo) // 2]
            else:
                indices = sorted({round(i * (len(grupo) - 1) / (maximo - 1)) for i in range(maximo)})
            grupo = [dict(grupo[i]) for i in indices]
            for i, region in enumerate(grupo):
                region["lovel"] = "0" if i == 0 else str(int(_campo(region, "lovel", 0) or 0))
                siguiente = grupo[i + 1] if i + 1 < len(grupo) else None
                region["hivel"] = str(int(_campo(siguiente, "lovel", 128) or 128) - 1) if siguiente else "127"
        salida.extend(grupo)
    return salida


def _frames_de(ruta):
    try:
        with wave.open(ruta, "rb") as w:
            return w.getnframes() * SR / max(1, w.getframerate())
    except Exception:
        return 0


def ajustar_tamano(regiones, carpeta_sfz, max_bytes=MAX_BYTES):
    """(regions, seconds per sample) that fit in `max_bytes` (16-bit mono)."""
    def estimar(lista, segundos):
        total = 0
        for region in lista:
            frames = _frames_de(os.path.join(carpeta_sfz, region["sample"]))
            total += (min(frames, segundos * SR) + 46) * 2
        return total

    capas = max(len(v) for v in _agrupar(regiones).values()) if regiones else 1
    segundos = MAX_SEGUNDOS
    lista = regiones
    while estimar(lista, segundos) > max_bytes and capas > 1:
        capas -= 1
        lista = capas_reducidas(regiones, capas)
    while estimar(lista, segundos) > max_bytes and segundos > MIN_SEGUNDOS:
        segundos = max(MIN_SEGUNDOS, segundos - 0.5)
    return lista, segundos


def _agrupar(regiones):
    grupos = {}
    for region in regiones:
        grupos.setdefault((region.get("lokey"), region.get("hikey"), region.get("pitch_keycenter")), []).append(region)
    return grupos


def parsear_sfz_secuencial(ruta):
    """A real sequential parser: each <region> closes when the next one starts."""
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


def construir(regiones, carpeta_sfz, nombre_preset, max_segundos=None):
    """Returns (pcm_bytes, shdr_list, zones) ready to write."""
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
        if max_segundos and len(datos) > max_segundos * SR:
            datos = datos[: int(max_segundos * SR)].copy()
            n = int(FUNDIDO_S * SR)
            datos[-n:] *= np.linspace(1.0, 0.0, n)
        # SF2 requires 46 samples of silence at the end of each sample.
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

        # tune in cents → coarse (semitones) + fine (cents)
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
                # initialAttenuation: dB → centibels; positive only (it cannot amplify)
                "atenuacion": int(round(min(0.0, volumen) * -10.0)),
            }
        )
    return bytes(pcm), shdr, zonas


def _chunk(chunk_id, cuerpo):
    """RIFF chunk with its padding: odd bodies carry a pad byte, and without it
    the next chunk is misaligned and no strict reader opens the file."""
    relleno = b"\x00" if len(cuerpo) % 2 else b""
    return chunk_id + struct.pack("<I", len(cuerpo)) + cuerpo + relleno


def _lista(tipo, *chunks):
    cuerpo = tipo + b"".join(chunks)
    return _chunk(b"LIST", cuerpo)


def escribir(salida, pcm, shdr, zonas, nombre_preset):
    """Writes the complete SF2: INFO, sdta and pdta with their lists."""
    if not zonas:
        raise SystemExit("there is no valid region")

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
    # Structure: preset → bags → instrument → per-zone bags → generators.
    # Zones are delimited by the INDICES: the bags of preset i go from
    # phdr[i].bagIndex to phdr[i+1].bagIndex (the final EOP/EOI record counts), and
    # the generators of bag j, from bag[j] to bag[j+1]. Only each LIST ends
    # in a zero record; inside a zone there is no terminator, and the instrument (41)
    # or sample (53) generator goes last.
    # Measured on 28-Oct: with EOP/EOI pointing at 0 and a (0,0) closing each zone,
    # the openDAW reader saw the preset with 0 zones and the instrument with no regions:
    # ALL the instruments in the library sounded silent.
    phdr = [
        struct.pack(
            "<20sHHHiii",
            nombre_preset[:19].encode("latin-1", "replace").ljust(20, b"\x00"),
            0,  # preset (program)
            0,  # bank
            0,  # first bag of the preset
            0,
            0,
            0,
        ),
        struct.pack("<20sHHHiii", b"EOP".ljust(20, b"\x00"), 0, 0, 1, 0, 0, 0),
    ]

    # Preset: one bag with generator 41 (instrument 0); then the terminators.
    pgen = [struct.pack("<HH", 41, 0), struct.pack("<HH", 0, 0)]
    pbag = [struct.pack("<HH", 0, 0), struct.pack("<HH", 1, 0)]
    pmod = [struct.pack("<HHhHH", 0, 0, 0, 0, 0)]

    pinst = [
        struct.pack("<20sH", nombre_preset[:19].encode("latin-1", "replace").ljust(20, b"\x00"), 0),
        struct.pack("<20sH", b"EOI".ljust(20, b"\x00"), len(zonas)),
    ]

    # One bag per zone: (first generator, first modulator). No modulators.
    ibag = []
    igen = []
    for zona in zonas:
        ibag.append(struct.pack("<HH", len(igen), 0))
        igen.extend([
            # keyRange first and velRange after: the specification requires it.
            struct.pack("<HH", GEN_KEY_RANGE, zona["lokey"] | (zona["hikey"] << 8)),
            struct.pack("<HH", GEN_VEL_RANGE, zona["lovey"] | (zona["hivey"] << 8)),
            struct.pack("<HH", GEN_ROOT_KEY, zona["root"]),
            struct.pack("<Hh", GEN_COARSE_TUNE, zona["coarse"]),
            struct.pack("<Hh", GEN_FINE_TUNE, zona["fine"]),
            struct.pack("<HH", GEN_INITIAL_ATTENUATION, min(1440, zona["atenuacion"])),
            struct.pack("<HH", GEN_SAMPLE_MODES, 0),
            struct.pack("<HH", GEN_SAMPLE_ID, zona["sample_id"]),  # the last one
        ])
    ibag.append(struct.pack("<HH", len(igen), 0))  # terminal bag
    igen.append(struct.pack("<HH", 0, 0))  # terminal generator
    imod = [struct.pack("<HHhHH", 0, 0, 0, 0, 0)]  # terminal modulator

    # shdr: one record per sample (46 bytes) and the EOS terminator.
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
        # The chunk is called "inst" (4 letters), not "pinst": the long name is that of
        # the specification structure, not the file identifier.
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
        print("usage: sfz2sf2.py <in.sfz> <output.sf2>")
        return 1
    entrada, salida = argv[0], argv[1]
    regiones = parsear_sfz_secuencial(entrada)
    if not regiones:
        print(json.dumps({"ok": False, "error": "the SFZ has no regions"}))
        return 1
    nombre = os.path.splitext(os.path.basename(entrada))[0]
    carpeta = os.path.dirname(os.path.abspath(entrada))
    regiones_sfz = len(regiones)
    regiones, segundos = ajustar_tamano(suenan_por_defecto(regiones), carpeta)
    pcm, shdr, zonas = construir(regiones, carpeta, nombre, segundos)
    escribir(salida, pcm, shdr, zonas, nombre)
    print(
        json.dumps(
            {
                "ok": True,
                "salida": salida,
                "regiones_sfz": regiones_sfz,
                "segundos_por_muestra": segundos,
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
