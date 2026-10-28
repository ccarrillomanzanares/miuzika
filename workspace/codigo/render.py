# -*- coding: utf-8 -*-
"""render.py - utilidades de mezcla y escritura de audio (BIBLIOTECA).

Aquí **no hay canción**: ni tempo, ni compases, ni estructura. Son las piezas que
sirven para cualquier tema:

    log, pcm_bytes, riff_header, StemWriter, write_wav,
    env_fn, place, reverb_st, actividad, midi_add,
    a_nivel (pico a -6 dBFS), stem (renderiza un stem sólo si ha cambiado)

Mono y estéreo: `place`, `dsp.pan`, `dsp.reverb`, `dsp.delay` y los filtros
aceptan las dos formas, (N,) y (N, 2).

La obra que las usa (sus datos, sus `gen_*` y su master) vive en
`workspace/obras/<slug>/`, fuera del motor: el agente no debe ver una canción
concreta como si fuera API.

Nota de tiempo: `reverb()` devuelve len(x) + len(ir) - 1, así que `reverb_st`
recorta la cola; sin eso la mezcla no suma (smoke.py lo comprueba).
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
    """Escribe un WAV estéreo. Si la señal pasa de 0 dBFS, la baja a `pico_db`
    y lo avisa: un WAV entero no guarda nada por encima de 0 dBFS y antes se
    recortaba en silencio (medido el 28-oct: guitarras a +13 dBFS, ya rotas).
    Los instrumentos del motor salen calientes (bombo +4, guitarra +5,6 dBFS):
    el nivel se decide en la mezcla, con `a_nivel` o con ganancia."""
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    pico = float(np.max(np.abs(x))) if x.size else 0.0
    if pico > 1.0:
        x = x * np.float32(10 ** (pico_db / 20.0) / pico)
        print(f"write_wav: {os.path.basename(path)} llegaba a {20 * np.log10(pico):+.1f} dBFS; "
              f"bajado a {pico_db:.0f} dBFS para no recortar", flush=True)
    data = pcm_bytes(x, width)
    with open(path, 'wb') as f:
        f.write(riff_header(SR, 2, width, len(data)))
        f.write(data)


# ------------------------------------------------------------------ utilidades
def a_nivel(x, pico_db=-6.0):
    """La señal con su pico en `pico_db` (por defecto -6 dBFS: margen para sumar)."""
    x = np.asarray(x, np.float32)
    pico = float(np.max(np.abs(x))) if x.size else 0.0
    if pico <= 0.0:
        return x
    return x * np.float32(10 ** (pico_db / 20.0) / pico)


def _huella(fn, claves):
    """Huella de lo que decide un stem: el código de `fn` y los datos que use."""
    try:
        codigo = inspect.getsource(fn)
    except (OSError, TypeError):
        codigo = getattr(fn, "__qualname__", repr(fn))
    h = hashlib.sha1(codigo.encode("utf-8"))
    for clave in claves:
        h.update(repr(clave).encode("utf-8"))
    return h.hexdigest()[:16]


def stem(ruta, fn, *claves, pico_db=None):
    """Renderiza un stem SOLO si ha cambiado: si `ruta` existe y la huella del
    código de `fn` y de `claves` (las notas, los parámetros…) es la misma que la
    última vez, no se recalcula. Devuelve True si lo ha renderizado.

        R.stem("salida/bajo.wav", p_bajo, P.BAJO, P.BPM)

    Medido el 28-oct: cada arreglo de un script de 10 stems volvía a calcularlos
    todos (2,5 min por intento); con esto sólo se rehace lo que se ha tocado.
    Ojo: lo que `fn` lee de otros módulos (una partitura, un instrumento) tiene
    que ir en `claves`, o un cambio ahí no se nota.
    """
    marca = ruta + ".huella"
    huella = _huella(fn, claves)
    if os.path.exists(ruta) and os.path.exists(marca):
        with open(marca, encoding="utf-8") as f:
            if f.read().strip() == huella:
                print(f"stem: {os.path.basename(ruta)} sin cambios (no se recalcula)", flush=True)
                return False
    t0 = time.time()
    y = fn()
    if pico_db is not None:
        y = a_nivel(y, pico_db)
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    write_wav(ruta, y)
    with open(marca, "w", encoding="utf-8") as f:
        f.write(huella)
    print(f"stem: {os.path.basename(ruta)} renderizado en {time.time() - t0:.1f} s", flush=True)
    return True


def env_fn(pts):
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    return lambda t: np.interp(t, xs, ys)


def place(dst, sig, t, gain=1.0, panp=0.0):
    """Suma `sig` (mono o estéreo) en `dst` a partir de `t` segundos. `dst` puede
    ser un bus estéreo (N, 2), donde lo mono se panea con `panp`, o mono (N,),
    donde lo estéreo se reduce a mono. (Antes un bus mono reventaba.)"""
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
    # reverb() devuelve len(x) + len(ir) - 1 (convolucion completa): hay que
    # recortar la cola o la mezcla no suma (mismo bug que en dsp.filt).
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


# ------------------------------------------------------------------ MIDI acumulado
MIDI = {}


def midi_add(track, start_beat, dur_beat, pitch, vel):
    MIDI.setdefault(track, []).append((float(start_beat), float(dur_beat), int(pitch), int(vel)))


