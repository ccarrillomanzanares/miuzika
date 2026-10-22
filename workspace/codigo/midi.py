"""midi.py - escritor de Standard MIDI File (tipo 1) sin dependencias."""
import struct


def _vlq(n):
    n = int(max(0, n))
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def _track_chunk(events):
    events.sort(key=lambda e: (e[0], e[1]))
    data = bytearray()
    last = 0
    for tick, _order, payload in events:
        data += _vlq(tick - last) + payload
        last = tick
    data += _vlq(0) + b'\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + bytes(data)


def _meta_text(kind, text):
    b = text.encode('latin-1', 'replace')[:127]
    return bytes([0xFF, kind, len(b)]) + b


def write_midi(path, tracks, bpm=90.0, ppq=480, name='miuzika'):
    """tracks: lista de dicts {name, channel, program, notes=[(start_beats, dur_beats, pitch, vel)]}"""
    header = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks) + 1, ppq)
    chunks = []

    us = int(round(60000000.0 / float(bpm)))
    ev = [(0, 0, _meta_text(0x03, name)),
          (0, 0, b'\xFF\x51\x03' + us.to_bytes(3, 'big')),
          (0, 0, b'\xFF\x58\x04\x04\x02\x18\x08')]
    chunks.append(_track_chunk(ev))

    for t in tracks:
        ev = []
        nm = t.get('name', 'track')
        ch = int(t.get('channel', 0)) & 0x0F
        prog = int(t.get('program', 0)) & 0x7F
        ev.append((0, 0, _meta_text(0x03, nm)))
        ev.append((0, 0, bytes([0xC0 | ch, prog])))
        for (s, d, p, v) in t.get('notes', []):
            on = int(round(float(s) * ppq))
            off = int(round((float(s) + float(d)) * ppq))
            if off <= on:
                off = on + 1
            p = int(max(0, min(127, p)))
            v = int(max(1, min(127, v)))
            ev.append((on, 1, bytes([0x90 | ch, p, v])))
            ev.append((off, 0, bytes([0x80 | ch, p, 0])))
        chunks.append(_track_chunk(ev))

    with open(path, 'wb') as f:
        f.write(header)
        for c in chunks:
            f.write(c)
    return path
