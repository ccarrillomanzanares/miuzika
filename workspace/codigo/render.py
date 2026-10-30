# -*- coding: utf-8 -*-
"""render.py - mixing and audio-writing utilities (LIBRARY).

There is **no song here**: no tempo, no bars, no structure. These are the pieces that
serve any track:

    log, pcm_bytes, riff_header, StemWriter, write_wav,
    env_fn, place, reverb_st, actividad, midi_add,
    a_nivel (peak at -6 dBFS), stem (renders a stem only if it has changed)

Mono and stereo: `place`, `dsp.pan`, `dsp.reverb`, `dsp.delay` and the filters
accept both shapes, (N,) and (N, 2).

The work that uses them (its data, its `gen_*` and its master) lives in
`workspace/obras/<slug>/`, outside the engine: the agent should not see a specific
song as if it were the API.

Timing note: `reverb()` returns len(x) + len(ir) - 1, so `reverb_st`
trims the tail; without that the mix does not add up (smoke.py checks it).
"""
import hashlib
import inspect
import os
import struct
import time

import numpy as np

from dsp import SR, reverb

T0 = time.time()


def log(msg):
    print('[%6.1fs] %s' % (time.time() - T0, msg), flush=True)


# ------------------------------------------------------------------ WAV
def pcm_bytes(x, width=3):
    x = np.clip(np.asarray(x, np.float32), -1.0, 1.0)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if width == 3:
        i = np.round(x * 8388607.0).astype(np.int32)
        return i.astype('<i4').view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    i = np.round(x * 32767.0).astype(np.int16)
    return i.tobytes()


def riff_header(sr, ch, width, data_size):
    ba = ch * width
    return (b'RIFF' + struct.pack('<I', 36 + data_size) + b'WAVE' +
            b'fmt ' + struct.pack('<IHHIIHH', 16, 1, ch, sr, sr * ba, ba, width * 8) +
            b'data' + struct.pack('<I', data_size))


class StemWriter:
    def __init__(self, path, n_frames, width=3):
        self.path = path
        self.n = n_frames
        self.w = width
        self.f = open(path, 'wb')
        self.f.write(b'\x00' * 44)

    def write_at(self, start, x):
        x = np.asarray(x, np.float32)
        if x.ndim == 1:
            x = np.stack([x, x], axis=1)
        s = int(start)
        if s < 0:
            x = x[-s:]
            s = 0
        n = min(len(x), self.n - s)
        if n <= 0:
            return
        self.f.seek(44 + s * 2 * self.w)
        self.f.write(pcm_bytes(x[:n], self.w))

    def close(self):
        self.f.seek(0)
        self.f.write(riff_header(SR, 2, self.w, self.n * 2 * self.w))
        self.f.close()


def write_wav(path, x, width=3, pico_db=-1.0):
    """Writes a stereo WAV. If the signal goes above 0 dBFS, it brings it down to `pico_db`
    and says so: a full WAV stores nothing above 0 dBFS and before this it was
    clipped in silence (measured on 28-Oct: guitars at +13 dBFS, already broken).
    The engine instruments come out hot (kick +4, guitar +5.6 dBFS):
    the level is decided in the mix, with `a_nivel` or with gain."""
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    pico = float(np.max(np.abs(x))) if x.size else 0.0
    if pico > 1.0:
        x = x * np.float32(10 ** (pico_db / 20.0) / pico)
        print(f"write_wav: {os.path.basename(path)} reached {20 * np.log10(pico):+.1f} dBFS; "
              f"lowered to {pico_db:.0f} dBFS to avoid clipping", flush=True)
    data = pcm_bytes(x, width)
    with open(path, 'wb') as f:
        f.write(riff_header(SR, 2, width, len(data)))
        f.write(data)


# ------------------------------------------------------------------ utilities
def a_nivel(x, pico_db=-6.0):
    """The signal with its peak at `pico_db` (default -6 dBFS: headroom for summing)."""
    x = np.asarray(x, np.float32)
    pico = float(np.max(np.abs(x))) if x.size else 0.0
    if pico <= 0.0:
        return x
    return x * np.float32(10 ** (pico_db / 20.0) / pico)


def _huella(fn, claves):
    """Fingerprint of what decides a stem: the code of `fn` and the data it uses."""
    try:
        codigo = inspect.getsource(fn)
    except (OSError, TypeError):
        codigo = getattr(fn, "__qualname__", repr(fn))
    h = hashlib.sha1(codigo.encode("utf-8"))
    for clave in claves:
        h.update(repr(clave).encode("utf-8"))
    return h.hexdigest()[:16]


def stem(ruta, fn, *claves, pico_db=None):
    """Renders a stem ONLY if it has changed: if `ruta` exists and the fingerprint of
    the code of `fn` and of `claves` (the notes, the parameters…) is the same as
    last time, it is not recomputed. Returns True if it has rendered it.

        R.stem("salida/bajo.wav", p_bajo, P.BAJO, P.BPM)

    Measured on 28-Oct: every tweak of a 10-stem script recalculated them all
    (2.5 min per attempt); with this only what has been touched is redone.
    Note: whatever `fn` reads from other modules (a score, an instrument) has
    to go in `claves`, or a change there is not noticed.
    """
    marca = ruta + ".huella"
    huella = _huella(fn, claves)
    if os.path.exists(ruta) and os.path.exists(marca):
        with open(marca, encoding="utf-8") as f:
            if f.read().strip() == huella:
                print(f"stem: {os.path.basename(ruta)} unchanged (not recomputed)", flush=True)
                return False
    t0 = time.time()
    y = fn()
    if pico_db is not None:
        y = a_nivel(y, pico_db)
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    write_wav(ruta, y)
    with open(marca, "w", encoding="utf-8") as f:
        f.write(huella)
    print(f"stem: {os.path.basename(ruta)} rendered in {time.time() - t0:.1f} s", flush=True)
    return True


def env_fn(pts):
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    return lambda t: np.interp(t, xs, ys)


def place(dst, sig, t, gain=1.0, panp=0.0):
    """Adds `sig` (mono or stereo) into `dst` starting at `t` seconds. `dst` can be
    a stereo bus (N, 2), where mono is panned with `panp`, or mono (N,),
    where stereo is reduced to mono. (Before, a mono bus blew up.)"""
    s = int(round(t * SR))
    sig = np.asarray(sig, np.float32)
    if dst.ndim == 1:
        if s >= len(dst):
            return
        if sig.ndim == 2:
            sig = sig.mean(axis=1)
        if s < 0:
            sig = sig[-s:]
            s = 0
        n = min(len(sig), len(dst) - s)
        if n > 0:
            dst[s:s + n] += sig[:n] * gain
        return
    if s >= len(dst):
        return
    if s < 0:
        sig = sig[-s:]
        s = 0
    n = min(len(sig), len(dst) - s)
    if n <= 0:
        return
    seg = sig[:n]
    if seg.ndim == 1:
        p = float(np.clip(panp, -1.0, 1.0))
        l = np.cos((p + 1.0) * np.pi / 4.0)
        r = np.sin((p + 1.0) * np.pi / 4.0)
        dst[s:s + n, 0] += seg * (l * gain)
        dst[s:s + n, 1] += seg * (r * gain)
    else:
        dst[s:s + n] += seg * gain


def reverb_st(x, ir_l, ir_r, mix=0.2):
    # reverb() returns len(x) + len(ir) - 1 (full convolution): the tail has to be
    # trimmed or the mix does not add up (same bug as in dsp.filt).
    x = np.asarray(x, np.float32)
    n = len(x)
    if x.ndim == 1:
        w = reverb(x, ir_l)[:n]
        y = reverb(x, ir_r)[:n]
        wet = np.stack([w, y], axis=1)
        dry = np.stack([x, x], axis=1)
    else:
        wet = np.stack([reverb(x[:, 0], ir_l)[:n], reverb(x[:, 1], ir_r)[:n]], axis=1)
        dry = x
    return dry * (1.0 - mix) + wet * mix


def actividad(sil, n):
    a = np.zeros(n, np.float32)
    for s in sil:
        i0 = int(s[0] * SR)
        i1 = min(n, int((s[0] + s[1]) * SR))
        if i1 > i0:
            a[i0:i1] = 1.0
    return a


# ------------------------------------------------------------------ accumulated MIDI
MIDI = {}


def midi_add(track, start_beat, dur_beat, pitch, vel):
    MIDI.setdefault(track, []).append((float(start_beat), float(dur_beat), int(pitch), int(vel)))


