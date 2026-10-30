"""Reads a Standard MIDI File and returns it as JSON (no dependencies).

Usage: python herramientas/midi_lector.py <path.mid>

Output: {"bpm", "division", "tracks": [{"name", "program", "channel",
         "notes": [{"pitch", "start", "duration", "velocity"}]}]}
`start` and `duration` are in BEATS (quarter-note pulses), ready for the add_notes op.
"""

import json
import struct
import sys


def vlq(datos, i):
    valor = 0
    while True:
        if i >= len(datos):
            return valor, i
        b = datos[i]
        i += 1
        valor = (valor << 7) | (b & 0x7F)
        if not b & 0x80:
            return valor, i


def leer(path):
    datos = open(path, "rb").read()
    if datos[:4] != b"MThd":
        raise SystemExit("not a MIDI file (MThd missing)")
    _fmt, ntrk, division = struct.unpack(">HHH", datos[8:14])
    division = division or 480
    i = 14
    pistas = []
    primero_us = None

    for _ in range(ntrk):
        if datos[i : i + 4] != b"MTrk":
            break
        largo = struct.unpack(">I", datos[i + 4 : i + 8])[0]
        cuerpo = datos[i + 8 : i + 8 + largo]
        i += 8 + largo

        j = 0
        t = 0
        estado = None
        nombre = ""
        prog = None
        canal = 0
        activas = {}
        notas = []

        while j < len(cuerpo):
            delta, j = vlq(cuerpo, j)
            t += delta
            if j >= len(cuerpo):
                break
            b = cuerpo[j]
            if b & 0x80:
                estado = b
                j += 1
            elif estado is None:
                break

            if estado == 0xFF:
                meta = cuerpo[j]
                j += 1
                ln, j = vlq(cuerpo, j)
                contenido = cuerpo[j : j + ln]
                j += ln
                if meta == 0x03:
                    nombre = contenido.decode("utf-8", "replace").strip()
                elif meta == 0x51 and len(contenido) >= 3 and primero_us is None:
                    primero_us = int.from_bytes(contenido[:3], "big")
                elif meta == 0x2F:
                    break
            elif estado in (0xF0, 0xF7):
                ln, j = vlq(cuerpo, j)
                j += ln
            elif (estado & 0xF0) in (0xC0, 0xD0):
                valor = cuerpo[j]
                j += 1
                if (estado & 0xF0) == 0xC0 and prog is None:
                    prog = valor
                    canal = estado & 0x0F
            else:
                a = cuerpo[j]
                b2 = cuerpo[j + 1]
                j += 2
                tipo = estado & 0xF0
                ch = estado & 0x0F
                if tipo == 0x90 and b2 > 0:
                    activas[(ch, a)] = (t, b2)
                elif tipo == 0x80 or (tipo == 0x90 and b2 == 0):
                    clave = (ch, a)
                    if clave in activas:
                        t0, vel = activas.pop(clave)
                        notas.append((t0, max(t - t0, 1), a, vel))

        # notes left unstopped: they are closed at the end of the track
        for (ch, a), (t0, vel) in activas.items():
            notas.append((t0, max(t - t0, 1), a, vel))

        if not notas and not nombre:
            continue
        notas.sort()
        pistas.append(
            {
                "name": nombre or f"Track {len(pistas) + 1}",
                "program": prog if prog is not None else 0,
                "channel": canal,
                "notes": [
                    {
                        "pitch": int(p),
                        "start": round(t0 / division, 6),
                        "duration": round(dur / division, 6),
                        "velocity": int(vel),
                    }
                    for (t0, dur, p, vel) in notas
                ],
            }
        )

    bpm = 120.0
    if primero_us:
        bpm = round(60000000.0 / primero_us, 3)
    return {"division": division, "bpm": bpm, "tracks": pistas}


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python herramientas/midi_lector.py <path.mid>")
    print(json.dumps(leer(sys.argv[1]), ensure_ascii=False))


if __name__ == "__main__":
    main()
