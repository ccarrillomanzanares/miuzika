"""instruments.py - sintesis de todos los instrumentos del tema."""
import numpy as np
from dsp import (SR, note_hz, white, fade, biquad, filt, lp, hp, bp, tv_filter,
                 soft_clip, pan, reverb_ir, reverb, delay, vinyl_noise, tape_hiss,
                 db2lin)

# ================================================================ BATERIA
def kick(vel=1.0, seed=0):
    """Bombo sintético: seno con caída de tono rápida y golpe de aire.
    familia: percusión
    vel: 0.05..1 Intensidad
    seed: 0..9999 Semilla
    """
    n = int(0.60 * SR)
    t = np.arange(n) / SR
    f = 44.0 + 118.0 * np.exp(-t / 0.026) + 26.0 * np.exp(-t / 0.13)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.34)
    body += 0.35 * np.sin(2 * ph) * np.exp(-t / 0.09)
    click = hp(white(n, seed) * np.exp(-t / 0.0035), 1800.0) * 0.45
    x = body * 0.95 + click
    x = soft_clip(x * 1.9, 2.4)
    x = lp(x, 5600.0, 0.8)
    x = hp(x, 30.0, 0.7)
    # suciedad digital + siseo de vinilo pegado al golpe
    x = np.round(x * 110.0) / 110.0 * 0.72 + x * 0.28
    x += vinyl_noise(n, seed + 7, hiss=0.012, crackle=0.4) * np.exp(-t / 0.05)
    return fade(x * vel, 0.5, 40.0)


def snare(vel=1.0, seed=0):
    """Caja: cuerpo tonal corto y ruido filtrado con cola.
    familia: percusión
    vel: 0.05..1 Intensidad
    seed: 0..9999 Semilla
    """
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    body = (np.sin(2 * np.pi * 186.0 * t) * 0.55 +
            np.sin(2 * np.pi * 331.0 * t) * 0.35 +
            np.sin(2 * np.pi * 517.0 * t) * 0.18)
    body *= np.exp(-t / 0.055)
    nz = bp(noise, 2400.0, 0.7) * np.exp(-t / 0.10)
    nz += hp(noise, 6000.0) * np.exp(-t / 0.045) * 0.5
    x = body * 0.8 + nz * 0.9
    # ring modulation: la caja deja de ser caja
    ring = np.sin(2 * np.pi * 137.0 * t + 0.6 * np.sin(2 * np.pi * 3.1 * t))
    x = x * (0.55 + 0.45 * ring)
    x = soft_clip(x * 2.6, 2.0)
    x = bp(x, 1500.0, 0.55)
    x = lp(x, 9000.0, 0.7)
    x += vinyl_noise(n, seed + 3, hiss=0.02, crackle=0.5) * np.exp(-t / 0.08)
    return fade(x * vel, 0.5, 30.0)


def hat(vel=1.0, seed=0, open_=False):
    """Charles de ruido metálico filtrado, cerrado o abierto.
    familia: percusión
    vel: 0.05..1 Intensidad
    open_: bool Abierto
    seed: 0..9999 Semilla
    """
    dur = 0.30 if open_ else 0.075
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    # 808-style: seis cuadradas inarmonicas
    ratios = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21]
    base = 317.0
    x = np.zeros(n)
    for r in ratios:
        x += np.sign(np.sin(2 * np.pi * base * r * t + rng.uniform(0, 6.28)))
    x /= len(ratios)
    x = hp(x, 7200.0, 0.8)
    x += hp(rng.standard_normal(n), 9000.0) * 0.35
    dec = 0.22 if open_ else 0.028
    x *= np.exp(-t / dec)
    x = soft_clip(x * 1.4, 1.6)
    return fade(x * vel, 0.3, 8.0)


def metal_hit(vel=1.0, seed=0, pitch=1.0, dur=0.9):
    """Chapa metálica con parciales inarmónicos: el golpe industrial.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.4..2.5 Tono (x)
    dur: 0.05..4 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    for k in range(9):
        r = (1.0 + 1.37 * k + rng.uniform(-0.06, 0.06)) * pitch
        f = 420.0 * r
        if f > 15000:
            continue
        x += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (0.55 / (1 + 0.35 * k)))
    x /= 6.0
    x += bp(rng.standard_normal(n), 3200.0, 0.6) * np.exp(-t / 0.02) * 0.6
    x = bp(x, 2600.0, 0.5)
    x = soft_clip(x * 1.8, 1.8)
    return fade(x * vel, 0.4, 60.0)


def shaker(vel=1.0, seed=0):
    """Cascabel: ruido corto con envolvente suave.
    familia: ruido
    vel: 0.05..1 Intensidad
    seed: 0..9999 Semilla
    """
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = bp(rng.standard_normal(n), 5200.0, 0.9) * (np.exp(-t / 0.03) + 0.4 * np.exp(-t / 0.09))
    return fade(x * vel, 1.0, 20.0)


# ================================================================ SINTES
def _saw_table(n=4096, nh=96):
    ph = np.arange(n) / n
    x = np.zeros(n)
    for h in range(1, nh + 1):
        x += np.sin(2 * np.pi * h * ph) / h
    return x / np.max(np.abs(x))


_SAW = _saw_table()
_PULSE = None


def _pulse_table(n=4096, nh=96):
    ph = np.arange(n) / n
    x = np.zeros(n)
    for h in range(1, nh + 1):
        x += np.sin(2 * np.pi * h * ph) * (2.0 / (np.pi * h)) * (1 - (-1) ** h) / 2
    return x / np.max(np.abs(x))


_PULSE = _pulse_table()


def _osc(freq, n, table=_SAW, phase0=0.0):
    f = np.asarray(freq, float)
    if f.ndim == 0:
        f = np.full(n, float(f))
    ph = (phase0 + np.cumsum(f) / SR) % 1.0
    idx = ph * len(table)
    i0 = idx.astype(np.int64) % len(table)
    i1 = (i0 + 1) % len(table)
    fr = idx - np.floor(idx)
    return table[i0] * (1 - fr) + table[i1] * fr


def bass_note(midi=40, dur=0.5, vel=1.0, seed=0, squelch=0.0, bright=1.0):
    """Bajo sintético con filtro: del seno limpio al squelch ácido.
    familia: tonal
    midi: 21..108 Nota (midi)
    dur: 0.05..8 Duración (s)
    vel: 0.05..1 Intensidad
    squelch: 0..1 Squelch
    bright: 0.2..3 Brillo (x)
    seed: 0..9999 Semilla
    """
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    f0 = float(note_hz(midi))
    rng = np.random.default_rng(seed)
    det = 1.0 + rng.uniform(-0.004, 0.004)
    a = _osc(f0 * det, n, _SAW)
    b = _osc(f0 * det * 1.006, n, _PULSE)
    sub = np.sin(2 * np.pi * f0 * t) * 0.9
    x = a * 0.55 + b * 0.35 + sub * 0.5
    # envolvente de filtro: el "gruñido" analogico
    env = np.exp(-t / 0.16) * 0.85 + 0.15
    cut = (240.0 + 1500.0 * bright * env) * (1.0 + 2.2 * squelch * np.exp(-t / 0.05))
    cut = np.clip(cut, 60.0, 9000.0)
    X = tv_filter(x, lambda tt, ff: 1.0 / (1.0 + (ff[None, :] / cut[:len(tt)][:, None]) ** 4),
                  n=1024, hop=256)
    X = X[:n]
    # resonancia del filtro (pico que se mueve)
    res = tv_filter(x, lambda tt, ff: np.exp(-0.5 * ((np.log2(np.maximum(ff[None, :], 1.0)) -
                                                     np.log2(cut[:len(tt)][:, None])) / 0.55) ** 2) * 0.9,
                    n=1024, hop=256)[:n]
    y = X + res * 0.55
    y = soft_clip(y * 1.5, 1.8)
    amp = np.minimum(1.0, t / 0.006) * np.exp(-t / (dur * 0.9 + 0.12))
    rel = np.clip((dur + 0.2 - t) / 0.2, 0.0, 1.0)
    y *= amp * rel
    y = lp(y, 4200.0, 0.7)
    y = hp(y, 34.0, 0.7)
    return fade(y * vel, 1.0, 15.0)


def drone_note(midi=40, dur=4.0, vel=1.0, seed=0, cutoff=320.0):
    """Zumbido sostenido de dientes de sierra filtrados.
    familia: textura
    midi: 21..108 Nota (midi)
    dur: 0.1..16 Duración (s)
    vel: 0.05..1 Intensidad
    cutoff: 40..8000 Corte (Hz)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = float(note_hz(midi))
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    for k, (mul, g) in enumerate([(1.0, 1.0), (1.0035, 0.8), (0.997, 0.7), (2.0, 0.25), (3.0, 0.12)]):
        x += _osc(f0 * mul, n, _SAW, phase0=rng.uniform()) * g
    x += np.sin(2 * np.pi * f0 * 0.5 * t) * 0.5
    lfo = 1.0 + 0.25 * np.sin(2 * np.pi * 0.07 * t + rng.uniform(0, 6))
    cut = cutoff * lfo
    y = tv_filter(x, lambda tt, ff: 1.0 / (1.0 + (ff[None, :] / cut[:len(tt)][:, None]) ** 3.2),
                  n=2048, hop=512)[:n]
    y = soft_clip(y * 1.2, 1.5)
    a = int(1.2 * SR)
    y[:a] *= np.linspace(0, 1, a) ** 1.5
    b = int(1.5 * SR)
    y[-b:] *= np.linspace(1, 0, b) ** 1.2
    return y * vel


def organ_chord(midis=(40, 47, 52), dur=2.0, vel=1.0, seed=0):
    """Acorde de órgano con registro de dientes y vibrato.
    familia: tonal
    midis: 21..108[8] Notas (midi)
    dur: 0.1..16 Duración (s)
    vel: 0.05..1 Intensidad
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    bars = [(1, 1.0), (2, 0.55), (3, 0.35), (4, 0.28), (6, 0.16), (8, 0.10)]
    for m in midis:
        f0 = float(note_hz(m))
        for h, g in bars:
            if f0 * h > 12000:
                continue
            x += np.sin(2 * np.pi * f0 * h * t + rng.uniform(0, 6.28)) * g / max(1, len(midis))
    # chorus lento (leslie parado)
    mod = 1.0 + 0.35 * np.sin(2 * np.pi * 0.9 * t)
    x = x * mod
    x = lp(x, 2600.0, 0.6)
    x = hp(x, 90.0, 0.7)
    a = int(0.09 * SR)
    x[:a] *= np.linspace(0, 1, a)
    b = int(0.25 * SR)
    x[-b:] *= np.linspace(1, 0, b)
    return x * vel


def guitar_loop(beats, bpm, pattern, vel=1.0, seed=0, drive=7.0):
    """Riff de guitarra completo: no es un one-shot, pide patrón y tempo.
    familia: tonal
    """
    spb = 60.0 / bpm
    n = int(beats * spb * SR)
    out = np.zeros(n + SR)
    rng = np.random.default_rng(seed)
    for (bt, db, m, v, mute) in pattern:
        d = db * spb
        ln = int((d + 0.35) * SR)
        t = np.arange(ln) / SR
        f0 = float(note_hz(m))
        x = np.zeros(ln)
        for h in range(1, 22):
            if f0 * h > 9000:
                break
            x += np.sin(2 * np.pi * f0 * h * t + rng.uniform(0, 6.28)) / (h ** 0.9)
        x += rng.standard_normal(ln) * 0.06
        env = np.minimum(1.0, t / 0.004) * np.exp(-t / (0.10 if mute else 0.55))
        env *= np.clip((d + 0.3 - t) / 0.3, 0, 1)
        x *= env
        # distorsion de amplificador
        x = soft_clip(x * drive, 1.0)
        x = bp(x, 700.0, 0.55)
        x = lp(x, 4200.0, 0.7)
        s = int(bt * spb * SR)
        out[s:s + ln] += x * v
    out = out[:n]
    # empalme de bucle sin clic
    xf = int(0.02 * SR)
    out[:xf] = out[:xf] * np.linspace(0, 1, xf) + out[-xf:] * np.linspace(1, 0, xf)
    return out * vel


def piano_note(midi=60, dur=1.0, vel=1.0, seed=0, detune=0.0):
    """Piano sintético con parciales y desafinado ajustable.
    familia: tonal
    midi: 21..108 Nota (midi)
    dur: 0.05..12 Duración (s)
    vel: 0.05..1 Intensidad
    detune: -0.05..0.05 Desafinado
    seed: 0..9999 Semilla
    """
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    f0 = float(note_hz(midi)) * (1.0 + detune)
    rng = np.random.default_rng(seed)
    B = 0.0004
    x = np.zeros(n)
    for k in range(1, 11):
        fk = f0 * k * np.sqrt(1 + B * k * k)
        if fk > 12000:
            break
        amp = 1.0 / (k ** 1.35)
        dec = 1.6 / (1 + 0.55 * k)
        x += np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * amp * np.exp(-t / dec)
    # coro desafinado (piano ligeramente fuera)
    x += np.sin(2 * np.pi * f0 * 1.0021 * t) * 0.25 * np.exp(-t / 1.4)
    ham = bp(rng.standard_normal(n), 2600.0, 0.8) * np.exp(-t / 0.012) * 0.25
    x = x + ham
    x = lp(x, 5200.0, 0.7)
    x *= np.minimum(1.0, t / 0.003)
    x *= np.clip((dur + 0.55 - t) / 0.55, 0, 1)
    return fade(x * vel, 1.0, 40.0)


def reverse_swell(src, dur=None):
    """Inversión de un sonido dado: pide material de origen.
    familia: textura
    """
    x = np.asarray(src, float)
    if dur is not None:
        n = int(dur * SR)
        x = x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))
    y = x[::-1].copy()
    env = np.linspace(0, 1, len(y)) ** 2.2
    return y * env


def squelch(vel=1.0, seed=0, dur=0.35, f_lo=180.0, f_hi=1800.0):
    """Barrido de resonancia con subida de tono: el blip del techno.
    familia: ruido
    vel: 0.05..1 Intensidad
    dur: 0.05..2 Duración (s)
    f_lo: 40..2000 Frecuencia baja (Hz)
    f_hi: 200..12000 Frecuencia alta (Hz)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = 55.0
    x = _osc(f0, n, _SAW) + 0.5 * _osc(f0 * 1.5, n, _PULSE)
    cut = f_lo * (f_hi / f_lo) ** (np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7)
    y = tv_filter(x, lambda tt, ff: np.exp(-0.5 * ((np.log2(np.maximum(ff[None, :], 1.0)) -
                                                   np.log2(cut[:len(tt)][:, None])) / 0.35) ** 2),
                  n=1024, hop=256)[:n]
    y = soft_clip(y * 3.0, 1.5)
    y *= np.exp(-t / (dur * 0.5))
    return fade(y * vel, 1.0, 20.0)


def feedback_growl(vel=1.0, seed=0, dur=1.6, f0=196.0):
    """Rugido de realimentación con formantes: cola industrial.
    familia: textura
    vel: 0.05..1 Intensidad
    dur: 0.1..8 Duración (s)
    f0: 30..2000 Fundamental (Hz)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    f = f0 * (1.0 + 0.35 * (t / dur) ** 1.5) * (1 + 0.004 * np.sin(2 * np.pi * 5.3 * t))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x += 0.4 * np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR)
    x = soft_clip(x * 6.0, 1.2)
    x = bp(x, 900.0, 0.6)
    x += bp(rng.standard_normal(n), 1800.0, 0.7) * 0.15
    x *= np.minimum(1.0, t / 0.25) * np.clip((dur - t) / 0.3, 0, 1)
    return fade(x * vel, 2.0, 30.0)


# ================================================================ VOZ
VOWELS = {
    'a': [(730, 1.0, 90), (1090, 0.55, 100), (2440, 0.22, 130)],
    'e': [(530, 1.0, 80), (1840, 0.45, 100), (2480, 0.18, 130)],
    'i': [(280, 1.0, 70), (2290, 0.38, 100), (3010, 0.16, 140)],
    'o': [(570, 1.0, 80), (840, 0.5, 90), (2410, 0.14, 130)],
    'u': [(310, 1.0, 70), (870, 0.35, 90), (2240, 0.10, 140)],
    'm': [(250, 1.0, 70), (1100, 0.14, 110), (2300, 0.05, 160)],
    'n': [(250, 1.0, 70), (1500, 0.12, 110), (2500, 0.05, 160)],
    'l': [(360, 1.0, 70), (1300, 0.28, 100), (2700, 0.12, 130)],
    'r': [(430, 1.0, 80), (1250, 0.4, 100), (1650, 0.3, 110)],
    's': [(4200, 0.55, 500), (6600, 0.45, 600), (1200, 0.05, 300)],
    'f': [(1250, 0.35, 250), (4600, 0.28, 450), (700, 0.1, 200)],
    't': [(3100, 0.35, 350), (5100, 0.28, 450), (900, 0.08, 250)],
    'k': [(2100, 0.35, 350), (3600, 0.28, 450), (800, 0.08, 250)],
    'd': [(2600, 0.35, 300), (4100, 0.25, 400), (600, 0.1, 200)],
    'b': [(620, 0.45, 180), (1500, 0.28, 280), (400, 0.15, 150)],
    'p': [(720, 0.45, 180), (1850, 0.28, 280), (400, 0.15, 150)],
    'g': [(1850, 0.35, 280), (2900, 0.28, 380), (500, 0.1, 200)],
    'v': [(1450, 0.35, 250), (3600, 0.28, 380), (500, 0.1, 200)],
    'z': [(3900, 0.45, 400), (6100, 0.35, 500), (900, 0.06, 250)],
    'j': [(2250, 0.35, 330), (3300, 0.28, 430), (800, 0.08, 250)],
    'ch': [(2650, 0.35, 330), (4300, 0.28, 430), (900, 0.08, 250)],
    'y': [(320, 0.8, 70), (2250, 0.28, 100), (3000, 0.1, 140)],
    'w': [(320, 0.8, 70), (720, 0.4, 90), (2200, 0.08, 140)],
    'h': [(1550, 0.28, 350), (3100, 0.2, 450), (600, 0.1, 250)],
    'x': [(3600, 0.35, 400), (5600, 0.28, 500), (900, 0.06, 250)],
    'ñ': [(260, 1.0, 70), (1650, 0.28, 110), (2500, 0.08, 150)],
    'th': [(4800, 0.3, 450), (6800, 0.25, 550), (1000, 0.05, 250)],
}
VOWEL_ONLY = set('aeiou')


def _formant_env(times, freqs, track):
    """track: (nframes_ctrl, 3) frecuencias + (nframes_ctrl,3) ganancias + anchos."""
    nf = len(times)
    idx = np.clip((times * 200.0).astype(np.int64), 0, len(track[0]) - 1)
    F = track[0][idx]      # (nf,3)
    G = track[1][idx]
    Bw = track[2][idx]
    ff = np.maximum(freqs[None, :], 1.0)
    E = np.zeros((nf, len(freqs)))
    for k in range(3):
        lf = np.log2(ff) - np.log2(F[:, k:k + 1])
        bw = np.maximum(Bw[:, k:k + 1], 0.05)
        E += G[:, k:k + 1] * np.exp(-0.5 * (lf / bw) ** 2)
    return E


def voice(syllables, seed=0, f0_base=98.0, breath=0.10, drive=1.0,
          whisper=False, jitter=0.35, tail=0.35, tilt=1.0):
    """Voz sintética por sílabas: pide una lista de sílabas.
    familia: textura
    """
    if not syllables:
        return np.zeros(1)
    total = max(s[0] + s[1] for s in syllables) + tail
    n = int(total * SR)
    rng = np.random.default_rng(seed)

    # --- control de f0 y amplitud a 200 Hz
    ctrl = int(total * 200.0) + 2
    f0 = np.full(ctrl, float(note_hz(syllables[0][2])))
    amp = np.zeros(ctrl)
    F = np.zeros((ctrl, 3))
    G = np.zeros((ctrl, 3))
    BW = np.full((ctrl, 3), 0.12)
    cur = np.array(VOWELS['a'], float)
    F[:] = cur[:, 0]
    G[:] = cur[:, 1]
    BW[:] = cur[:, 2] / 1200.0
    prev_m = float(syllables[0][2])
    noise_amp = np.zeros(ctrl)

    for (t0, dur, m, vow, cons, vel) in syllables:
        i0 = int(t0 * 200.0)
        i1 = min(ctrl, int((t0 + dur) * 200.0))
        if i1 <= i0:
            continue
        tgt = float(note_hz(m))
        prev = float(note_hz(prev_m))
        seg = np.arange(i0, i1)
        rel = (seg - i0) / max(1, (i1 - i0))
        # portamento corto y plano despues: casi hablado
        gl = np.clip(rel / 0.22, 0, 1)
        f = prev * (tgt / prev) ** gl
        f *= 1.0 + 0.004 * np.sin(2 * np.pi * 4.7 * seg / 200.0 + rng.uniform(0, 6))
        f *= 1.0 + rng.normal(0, 0.0015 * jitter, len(seg))
        # caida al final de la silaba
        f *= 1.0 - 0.02 * np.clip((rel - 0.75) / 0.25, 0, 1)
        f0[i0:i1] = f
        # envolvente
        a = np.clip(rel / 0.10, 0, 1)
        r = np.clip((1 - rel) / 0.18, 0, 1)
        amp[i0:i1] = np.maximum(amp[i0:i1], a * r * vel)
        # formantes
        v = np.array(VOWELS.get(vow, VOWELS['a']), float)
        if cons and cons in VOWELS:
            c = np.array(VOWELS[cons], float)
            ncons = min(len(seg), int(0.055 * 200))
            for k in range(3):
                F[i0:i0 + ncons, k] = c[k, 0]
                G[i0:i0 + ncons, k] = c[k, 1] * 0.9
                BW[i0:i0 + ncons, k] = c[k, 2] / 1200.0
            noise_amp[i0:i0 + ncons] = 0.55 * vel
            st = i0 + ncons
            mv = min(len(seg) - ncons, int(0.05 * 200))
            for k in range(3):
                if mv > 0:
                    F[st:st + mv, k] = np.linspace(c[k, 0], v[k, 0], mv)
                    G[st:st + mv, k] = np.linspace(c[k, 1] * 0.9, v[k, 1], mv)
                    BW[st:st + mv, k] = np.linspace(c[k, 2] / 1200.0, v[k, 2] / 1200.0, mv)
                F[st + mv:i1, k] = v[k, 0]
                G[st + mv:i1, k] = v[k, 1]
                BW[st + mv:i1, k] = v[k, 2] / 1200.0
        else:
            for k in range(3):
                F[i0:i1, k] = v[k, 0]
                G[i0:i1, k] = v[k, 1]
                BW[i0:i1, k] = v[k, 2] / 1200.0
        prev_m = m

    # suavizado de los tracks de formantes
    k = np.ones(9) / 9.0
    for arr in (F, G, BW):
        for c in range(3):
            arr[:, c] = np.convolve(arr[:, c], k, mode='same')

    # --- fuente
    f0s = np.interp(np.arange(n) / SR, np.arange(ctrl) / 200.0, f0)
    if whisper:
        src = rng.standard_normal(n) * 0.5
    else:
        src = _osc(f0s, n, _SAW)
        src = src * 0.8 + _osc(f0s * 1.0, n, _PULSE, 0.25) * 0.35
        # aspereza de garganta
        src = soft_clip(src * (1.0 + 0.6 * tilt), 1.4)
    nz = rng.standard_normal(n)
    nzamp = np.interp(np.arange(n) / SR, np.arange(ctrl) / 200.0, noise_amp + breath * amp)
    src = src + nz * nzamp * 0.5

    track = (F, G, BW)
    y = tv_filter(src, lambda tt, ff: _formant_env(tt, ff, track), n=1024, hop=256)[:n]
    # aire: ruido filtrado por los mismos formantes
    air = tv_filter(nz, lambda tt, ff: _formant_env(tt, ff, track) * 0.35, n=1024, hop=256)[:n]
    y = y + air * (0.35 + breath)
    y = hp(y, 70.0, 0.7)
    y = lp(y, 7500.0, 0.7)
    if drive != 1.0:
        y = soft_clip(y * drive, 1.6)
    y *= np.interp(np.arange(n) / SR, np.arange(ctrl) / 200.0, amp)
    return fade(y, 3.0, 25.0)


# ── VOCES CREADAS POR EL AGENTE ──────────────────────────────────────────────
# Añadidas desde la app. Docstring obligatorio: ver codigo/voces.py.

import numpy as np

from instruments import _PULSE, _osc, SR
from dsp import bp


def cowbell(vel=1.0, pitch=1.0, dur=0.45, seed=0):
    """Cencerro metálico de dos tonos, tipo industrial.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.6..1.8 Tono (x)
    dur: 0.08..2 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Dos pulsos cuadrados desafinados entre sí: el batido es lo que suena a cencerro.
    a = _osc(540.0 * pitch, n, _PULSE, 0.0)
    b = _osc(800.0 * pitch, n, _PULSE, 0.35)
    x = 0.6 * a + 0.4 * b
    # Los dos formantes del cencerro (2,6 y 3,9 kHz) y una cola corta.
    x = bp(x, 2600.0 * pitch, 1.2) + 0.4 * bp(x, 3900.0 * pitch, 1.6)
    x *= np.exp(-t / (0.10 * max(dur, 0.08)))
    return x * float(vel)

import numpy as np

from dsp import SR, bp, white

def palmada(vel=1.0, pitch=1.0, dur=0.30, seed=0):
    """Palmada de manos: tres golpes de ruido muy juntos y cola corta.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.6..1.6 Tono (x)
    dur: 0.1..1 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    x = np.zeros(n)
    # Tres "manos" separadas 6 ms: eso es lo que suena a palmada y no a ruido.
    for i, desplazamiento in enumerate((0.0, 0.006, 0.013)):
        inicio = int((desplazamiento / 0.006) * 0.0 + desplazamiento * SR)
        resto = n - inicio
        if resto <= 0:
            continue
        t = np.arange(resto) / SR
        golpe = bp(white(resto, seed + i), 1200.0 * pitch, 0.9) * np.exp(-t / 0.012)
        golpe += bp(white(resto, seed + i + 7), 3200.0 * pitch, 1.2) * np.exp(-t / 0.006) * 0.5
        x[inicio:] += golpe * (1.0 - 0.25 * i)
    t = np.arange(n) / SR
    x += bp(white(n, seed + 21), 900.0 * pitch, 0.7) * np.exp(-t / 0.09) * 0.35
    return x * float(vel)
