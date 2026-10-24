"""Cancion instrumental de 2 minutos: samples CC0 de la biblioteca + sintesis del motor numpy.

Re menor, 100 BPM, 50 compases (120 s exactos).
Stems separados en salida/ + un MIDI multitrack. Sin masterizar.
"""
import os
import sys
import wave

import numpy as np

_AQUI = os.path.dirname(os.path.abspath(__file__))
for _p in (_AQUI, os.path.join(_AQUI, '..'), os.path.join(_AQUI, '..', '..', 'codigo')):
    _p = os.path.abspath(_p)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import dsp
import instruments as I
import midi as M

SR = dsp.SR
BPM = 100.0
COMPASES = 50
BEATS = 4
DUR_COMPAS = 60.0 / BPM * BEATS          # 2.4 s
DUR = COMPASES * DUR_COMPAS              # 120.0 s
N = int(round(DUR * SR))


# ---------------------------------------------------------------- utilidades
def _buscar_catalogo():
    cands = []
    p = os.path.abspath(os.getcwd())
    for _ in range(7):
        cands.append(os.path.join(p, 'catalogo'))
        p = os.path.dirname(p)
    cands.append(os.path.abspath(os.path.join(_AQUI, '..', '..', 'catalogo')))
    for c in cands:
        if os.path.isdir(c):
            return c
    return None


def _leer_wav(ruta):
    with wave.open(ruta, 'rb') as w:
        ch = w.getnchannels()
        sw = w.getsampwidth()
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    if sw == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    elif sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= (1 << 23), v - (1 << 24), v)
        x = v.astype(np.float64) / float(1 << 23)
    elif sw == 4:
        x = np.frombuffer(raw, dtype='<i4').astype(np.float64) / float(1 << 31)
    elif sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128.0) / 128.0
    else:
        raise ValueError('ancho de muestra no soportado: %d' % sw)
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def _resamp(x, ratio):
    if abs(ratio - 1.0) < 1e-6:
        return x.copy()
    n = max(2, int(round(len(x) / ratio)))
    idx = np.arange(n, dtype=np.float64) * ratio
    return np.interp(idx, np.arange(len(x), dtype=np.float64), x)


def _f0(x, sr, fmin=50.0, fmax=1600.0):
    """Frecuencia fundamental aproximada por autocorrelacion (via FFT)."""
    n = len(x)
    if n < 2048:
        return 0.0
    # ventana de 0,25 s con mas energia dentro de los primeros 2 s
    w = int(0.25 * sr)
    if n < w * 2:
        w = n // 2
    hop = max(1, w // 2)
    mejor, mejor_e = 0, -1.0
    for i in range(0, max(1, min(n - w, int(2.0 * sr))), hop):
        e = float(np.sum(x[i:i + w] ** 2))
        if e > mejor_e:
            mejor_e, mejor = e, i
    seg = x[mejor:mejor + w]
    seg = seg - seg.mean()
    m = len(seg)
    if m < 1024:
        return 0.0
    Nf = 1 << int(np.ceil(np.log2(2 * m)))
    X = np.fft.rfft(seg, Nf)
    ac = np.fft.irfft(X * np.conj(X), Nf)[:m]
    if ac[0] <= 0:
        return 0.0
    ac = ac / ac[0]
    lo = max(2, int(sr / fmax))
    hi = min(m - 2, int(sr / fmin))
    if hi <= lo + 2:
        return 0.0
    idx = lo + int(np.argmax(ac[lo:hi]))
    if 0 < idx < m - 1:
        a, b, c = ac[idx - 1], ac[idx], ac[idx + 1]
        den = a - 2.0 * b + c
        if abs(den) > 1e-12:
            idx = idx + 0.5 * (a - c) / den
    if idx <= 0:
        return 0.0
    return float(sr / idx)


def _prep(x, sr, dur_max=2.5, recorta_ataque=True):
    if recorta_ataque:
        pico = float(np.max(np.abs(x))) + 1e-12
        idx = int(np.argmax(np.abs(x) > 0.02 * pico))
        x = x[max(0, idx - 32):]
    n = int(dur_max * sr)
    if len(x) > n:
        x = x[:n]
    return dsp.fade(x, 2.0, 80.0)


def _nota(x, sr, f0, midi_n, dur, gan=1.0):
    ratio = float(np.clip(dsp.note_hz(midi_n) / max(f0, 1e-6), 0.25, 4.0))
    y = _resamp(x, ratio)
    n = int(dur * sr)
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    else:
        y = y[:n]
    return dsp.fade(y, 2.0, min(150.0, dur * 400.0)) * gan


def _poner(bus, sig, t, gan=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= bus.shape[1] or i < 0:
        return
    n = min(len(sig), bus.shape[1] - i)
    if n <= 0:
        return
    s = np.asarray(sig[:n], dtype=np.float32) * gan
    a = (pan + 1.0) * 0.25 * np.pi
    bus[0, i:i + n] += s * np.float32(np.cos(a))
    bus[1, i:i + n] += s * np.float32(np.sin(a))


def _guardar(ruta, x, pico_db=-3.0):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.vstack([x, x])
    m = float(np.max(np.abs(x))) + 1e-12
    x = np.clip(x / m * dsp.db2lin(pico_db), -1.0, 1.0)
    v = np.round(x.T.reshape(-1) * float((1 << 23) - 1)).astype(np.int32)
    u = (v & 0xFFFFFF).astype(np.uint32)
    b = np.empty((u.size, 3), dtype=np.uint8)
    b[:, 0] = (u & 0xFF).astype(np.uint8)
    b[:, 1] = ((u >> 8) & 0xFF).astype(np.uint8)
    b[:, 2] = ((u >> 16) & 0xFF).astype(np.uint8)
    d = os.path.dirname(ruta)
    if d:
        os.makedirs(d, exist_ok=True)
    with wave.open(ruta, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b.tobytes())
    print('  %-28s %6.2f s  pico %.1f dBFS' % (ruta, len(x[0]) / SR, pico_db))


# ---------------------------------------------------------------- armonia
AC = {
    'Dm': [50, 53, 57],
    'Bb': [46, 50, 53],
    'F':  [53, 57, 60],
    'Gm': [43, 46, 50],
    'A':  [45, 49, 52],
    'C':  [48, 52, 55],
}
RAIZ = {'Dm': 38, 'Bb': 34, 'F': 41, 'Gm': 43, 'A': 45, 'C': 36}

PROG = (['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'] +
        ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'] +
        ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'] +
        ['Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'Bb', 'A', 'A'] +
        ['Bb', 'Bb', 'F', 'F', 'Gm', 'Gm', 'A', 'A'] +
        ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C', 'Dm', 'Dm'])
assert len(PROG) == COMPASES, len(PROG)


def _seccion(c):
    if c < 8:
        return 'intro'
    if c < 16:
        return 'a'
    if c < 32:
        return 'b'
    if c < 40:
        return 'brk'
    return 'fin'


MEL = {
    16: [(0, 2, 69), (2, 1, 67), (3, 1, 65)],
    17: [(0, 3.5, 62)],
    18: [(0, 1.5, 70), (1.5, 0.5, 69), (2, 2, 65)],
    19: [(0, 3.5, 67)],
    20: [(0, 1, 72), (1, 1, 70), (2, 1, 69), (3, 1, 67)],
    21: [(0, 2, 65), (2, 1.5, 62)],
    22: [(0, 1.5, 70), (1.5, 0.5, 72), (2, 2, 74)],
    23: [(0, 3.5, 69)],
    24: [(0, 2, 69), (2, 1, 72), (3, 1, 74)],
    25: [(0, 3.5, 72)],
    26: [(0, 1.5, 70), (1.5, 0.5, 69), (2, 2, 67)],
    27: [(0, 3.5, 65)],
    28: [(0, 1, 69), (1, 1, 67), (2, 1, 65), (3, 1, 62)],
    29: [(0, 2, 65), (2, 2, 62)],
    30: [(0, 1.5, 70), (1.5, 0.5, 72), (2, 2, 69)],
    31: [(0, 3.5, 62)],
    40: [(0, 2, 69), (2, 1, 67), (3, 1, 65)],
    41: [(0, 3.5, 62)],
    42: [(0, 1.5, 70), (1.5, 0.5, 69), (2, 2, 65)],
    43: [(0, 3.5, 67)],
    44: [(0, 1, 72), (1, 1, 70), (2, 1, 69), (3, 1, 67)],
    45: [(0, 2, 65), (2, 1.5, 62)],
    46: [(0, 1.5, 70), (1.5, 0.5, 72), (2, 2, 74)],
    47: [(0, 3.5, 69)],
    48: [(0, 4, 74)],
    49: [(0, 4, 62)],
}


# ---------------------------------------------------------------- partes
def _arpa(bus, arpa_a4, f0_arpa, arpa_a6, f0_a6):
    notas_midi = []
    for c in range(COMPASES):
        t0 = c * DUR_COMPAS
        ac = AC[PROG[c]]
        sec = _seccion(c)
        if sec in ('intro', 'brk'):
            oct_ = 12 if sec == 'intro' else 24
            pat = [(0, 0), (1, 1), (2, 2), (3, 1)]
            vel = 0.55 if sec == 'intro' else 0.45
        else:
            oct_ = 12
            pat = [(0, 0), (0.5, 1), (1, 2), (1.5, 0), (2, 1), (2.5, 2), (3, 0), (3.5, 1)]
            vel = 0.7
        for k, (bt, j) in enumerate(pat):
            m = ac[j] + oct_
            if m > 84:
                m -= 12
            dur = 1.6 if sec in ('intro', 'brk') else 1.0
            src, f0 = (arpa_a6, f0_a6) if m >= 78 else (arpa_a4, f0_arpa)
            y = _nota(src, SR, f0, m, dur, gan=vel * (0.85 + 0.15 * ((k % 3) / 2.0)))
            pan = -0.35 + 0.7 * (j / 2.0)
            _poner(bus, y, t0 + bt * (DUR_COMPAS / BEATS), 1.0, pan)
            notas_midi.append((c * BEATS + bt, min(dur / (DUR_COMPAS / BEATS), 2.0), m, int(60 + 40 * vel)))
    return notas_midi


def _pad(bus):
    notas_midi = []
    for c in range(0, COMPASES, 2):
        ac = AC[PROG[c]]
        sec = _seccion(c)
        vel = {'intro': 0.55, 'a': 0.5, 'b': 0.42, 'brk': 0.6, 'fin': 0.5}[sec]
        dur = DUR_COMPAS * 2 + 0.4
        y = I.organ_chord(midis=tuple(m + 12 for m in ac), dur=dur, vel=vel, seed=c)
        ir = dsp.reverb_ir(dur=2.6, decay=0.6, seed=3, lp_hz=5200.0)
        y = dsp.reverb(y, ir)
        _poner(bus, y, c * DUR_COMPAS, 0.9, 0.0)
        for m in ac:
            notas_midi.append((c * BEATS, 8.0, m + 12, int(50 + 30 * vel)))
    return notas_midi


def _bajo(bus):
    notas_midi = []
    for c in range(COMPASES):
        sec = _seccion(c)
        if sec == 'intro':
            continue
        r = RAIZ[PROG[c]]
        t0 = c * DUR_COMPAS
        b = DUR_COMPAS / BEATS
        if sec == 'brk':
            pat = [(0, 4.0, r, 0.55)]
        elif sec == 'a':
            pat = [(0, 1.5, r, 0.7), (2, 1.0, r, 0.65), (3, 1.0, r + 7, 0.6)]
        else:
            pat = [(0, 1.0, r, 0.85), (1, 0.5, r, 0.6), (1.5, 0.5, r + 12, 0.7),
                   (2, 1.0, r, 0.8), (3, 0.5, r + 7, 0.65), (3.5, 0.5, r, 0.6)]
        for bt, db, m, v in pat:
            y = I.bass_note(midi=m, dur=db * b * 0.95, vel=v, seed=c * 7 + int(bt * 2),
                            squelch=0.25 if sec in ('b', 'fin') else 0.1, bright=0.9)
            _poner(bus, y, t0 + bt * b, 1.0, 0.0)
            notas_midi.append((c * BEATS + bt, db, m, int(60 + 40 * v)))
    return notas_midi


def _bateria(bus, bombo_s, shaker_s):
    notas_midi = []
    for c in range(COMPASES):
        sec = _seccion(c)
        t0 = c * DUR_COMPAS
        b = DUR_COMPAS / BEATS
        golpes = []          # (beat, tipo, vel, pan)
        if sec == 'intro':
            for k in range(8):
                golpes.append((k * 0.5, 'shaker', 0.30, -0.25))
            for k in range(4):
                golpes.append((k, 'hat', 0.22, 0.3))
        elif sec == 'a':
            for bt in (0, 2.5):
                golpes.append((bt, 'bombo', 0.85, 0.0))
            for k in range(8):
                golpes.append((k * 0.5, 'hat', 0.30 if k % 2 == 0 else 0.20, 0.3))
            for k in range(8):
                golpes.append((k * 0.5, 'shaker', 0.22, -0.25))
            if c >= 12:
                for bt in (1, 3):
                    golpes.append((bt, 'caja', 0.7, -0.1))
        elif sec == 'b':
            for bt in (0, 1.5, 2.5):
                golpes.append((bt, 'bombo', 0.95, 0.0))
            for bt in (1, 3):
                golpes.append((bt, 'caja', 0.85, -0.1))
            for k in range(8):
                golpes.append((k * 0.5, 'hat', 0.34 if k % 2 == 0 else 0.22, 0.3))
            for k in range(8):
                golpes.append((k * 0.5, 'shaker', 0.24, -0.25))
        elif sec == 'brk':
            for k in range(8):
                golpes.append((k * 0.5, 'shaker', 0.20, -0.25))
            if c % 2 == 0:
                golpes.append((0, 'bombo', 0.5, 0.0))
        else:
            for bt in (0, 1.5, 2.5):
                golpes.append((bt, 'bombo', 1.0, 0.0))
            for bt in (1, 3):
                golpes.append((bt, 'caja', 0.9, -0.1))
            for k in range(8):
                golpes.append((k * 0.5, 'hat', 0.36 if k % 2 == 0 else 0.24, 0.3))
            for k in range(8):
                golpes.append((k * 0.5, 'shaker', 0.26, -0.25))
            if c in (40, 44, 48):
                golpes.append((0, 'crash', 0.8, 0.15))

        for bt, tipo, v, pan in golpes:
            t = t0 + bt * b
            if tipo == 'bombo':
                y = I.kick(vel=v, seed=c * 13 + int(bt * 2))
                _poner(bus, y, t, 0.9, 0.0)
                if bombo_s is not None:
                    _poner(bus, bombo_s, t, 0.55 * v, 0.0)
                notas_midi.append((c * BEATS + bt, 0.25, 36, int(60 + 40 * v)))
            elif tipo == 'caja':
                y = I.snare(vel=v, seed=c * 17 + int(bt))
                _poner(bus, y, t, 0.85, pan)
                notas_midi.append((c * BEATS + bt, 0.25, 38, int(60 + 40 * v)))
            elif tipo == 'hat':
                y = I.hat(vel=v, seed=c * 19 + int(bt * 2), open_=False)
                _poner(bus, y, t, 0.7, pan)
                notas_midi.append((c * BEATS + bt, 0.25, 42, int(50 + 40 * v)))
            elif tipo == 'shaker':
                if shaker_s is not None:
                    _poner(bus, shaker_s, t, 0.5 * v, pan)
                else:
                    _poner(bus, I.shaker(vel=v, seed=c * 23 + int(bt * 2)), t, 0.7, pan)
                notas_midi.append((c * BEATS + bt, 0.25, 70, int(40 + 40 * v)))
            elif tipo == 'crash':
                y = I.metal_hit(vel=v, seed=c, pitch=1.6, dur=2.2)
                _poner(bus, y, t, 0.55, pan)
                notas_midi.append((c * BEATS + bt, 1.0, 49, int(60 + 40 * v)))
    return notas_midi


def _saxo(bus, sax, f0_sax):
    notas_midi = []
    ir = dsp.reverb_ir(dur=2.2, decay=0.55, seed=11, lp_hz=6000.0)
    for c, frases in MEL.items():
        t0 = c * DUR_COMPAS
        b = DUR_COMPAS / BEATS
        for bt, db, m in frases:
            dur = db * b * 0.92
            y = _nota(sax, SR, f0_sax, m, dur + 0.25, gan=0.9)
            y = dsp.reverb(y, ir)
            y = dsp.delay(y, b * 0.75, fb=0.22, mix=0.16, taps=3, lp_hz=3500.0)
            _poner(bus, y, t0 + bt * b, 1.0, 0.12)
            notas_midi.append((c * BEATS + bt, db, m, 92))
    return notas_midi


def _fx(bus):
    for c in (16, 32, 40):
        y = I.reverse_swell(I.organ_chord(midis=(62, 65, 69), dur=1.6, vel=0.5, seed=c), dur=1.6)
        _poner(bus, y, c * DUR_COMPAS - 1.6, 0.5, 0.0)
    y = I.metal_hit(vel=0.7, seed=5, pitch=0.7, dur=3.0)
    _poner(bus, y, 32 * DUR_COMPAS, 0.45, -0.2)
    y = I.feedback_growl(vel=0.6, seed=9, dur=2.4, f0=73.4)
    _poner(bus, y, 39 * DUR_COMPAS + 1.2, 0.4, 0.0)


# ---------------------------------------------------------------- main
def main():
    cat = _buscar_catalogo()
    if cat is None:
        raise SystemExit('no encuentro la carpeta catalogo/')
    base = os.path.join(cat, 'VCSL-1.2.2-RC')
    print('catalogo:', base)

    def _ruta(rel):
        p = os.path.join(base, rel)
        if not os.path.isfile(p):
            raise SystemExit('falta el sample: %s' % p)
        return p

    arpa_a4, sr_a4 = _leer_wav(_ruta('Chordophones/Composite Chordophones/Concert Harp/KSHarp_A4_mf1.wav'))
    arpa_a6, sr_a6 = _leer_wav(_ruta('Chordophones/Composite Chordophones/Concert Harp/KSHarp_A6_mf1.wav'))
    sax, sr_sax = _leer_wav(_ruta('Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/BrettTenor_NV_Main_A#2_vl2_rr1.wav'))
    bombo, sr_bom = _leer_wav(_ruta('Membranophones/Struck Membranophones/Bass Drum 2/bassdrum_hit_mf1.wav'))
    shaker, sr_sha = _leer_wav(_ruta('Idiophones/Struck Idiophones/Shaker, Large/LShaker_Hit_rr1_Mid.wav'))

    f0_a4 = _f0(arpa_a4, sr_a4, 350.0, 560.0)
    f0_a6 = _f0(arpa_a6, sr_a6, 1300.0, 2300.0)
    f0_sax = _f0(sax, sr_sax, 80.0, 190.0)
    print('f0 medidos -> arpa A4 %.1f Hz | arpa A6 %.1f Hz | saxo %.1f Hz' % (f0_a4, f0_a6, f0_sax))
    if not (200.0 < f0_a4 < 900.0):
        f0_a4 = 440.0
    if not (400.0 < f0_a6 < 1800.0):
        f0_a6 = 1760.0
    if not (60.0 < f0_sax < 700.0):
        f0_sax = 116.5

    arpa_a4 = _prep(arpa_a4, sr_a4, 2.6)
    arpa_a6 = _prep(arpa_a6, sr_a6, 2.0)
    sax = _prep(sax, sr_sax, 4.0)
    bombo_s = _prep(bombo, sr_bom, 0.55)
    shaker_s = _prep(shaker, sr_sha, 0.16)

    print('renderizando %d compases (%.1f s)...' % (COMPASES, DUR))
    b_arpa = np.zeros((2, N), dtype=np.float32)
    b_pad = np.zeros((2, N), dtype=np.float32)
    b_bajo = np.zeros((2, N), dtype=np.float32)
    b_bat = np.zeros((2, N), dtype=np.float32)
    b_sax = np.zeros((2, N), dtype=np.float32)
    b_fx = np.zeros((2, N), dtype=np.float32)

    n_arpa = _arpa(b_arpa, arpa_a4, f0_a4, arpa_a6, f0_a6)
    n_pad = _pad(b_pad)
    n_bajo = _bajo(b_bajo)
    n_bat = _bateria(b_bat, bombo_s, shaker_s)
    n_sax = _saxo(b_sax, sax, f0_sax)
    _fx(b_fx)

    print('escribiendo stems...')
    _guardar('salida/01_arpa.wav', b_arpa, -6.0)
    _guardar('salida/02_pad.wav', b_pad, -8.0)
    _guardar('salida/03_bajo.wav', b_bajo, -5.0)
    _guardar('salida/04_bateria.wav', b_bat, -5.0)
    _guardar('salida/05_saxo.wav', b_sax, -6.0)
    _guardar('salida/06_fx.wav', b_fx, -10.0)

    pistas = [
        {'name': 'Arpa', 'channel': 0, 'program': 46, 'notes': n_arpa},
        {'name': 'Pad', 'channel': 1, 'program': 19, 'notes': n_pad},
        {'name': 'Bajo', 'channel': 2, 'program': 38, 'notes': n_bajo},
        {'name': 'Saxo', 'channel': 3, 'program': 66, 'notes': n_sax},
        {'name': 'Bateria', 'channel': 9, 'program': 0, 'notes': n_bat},
    ]
    M.write_midi('salida/tema.mid', pistas, bpm=BPM, ppq=480, name='prueba')
    print('  salida/tema.mid  (%d notas)' % sum(len(p['notes']) for p in pistas))
    print('OK')


if __name__ == '__main__':
    main()
