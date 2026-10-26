"""dsp.py - utilidades DSP en numpy puro (sin scipy)."""
import numpy as np

SR = 44100

# Aquí NO hay tempo: la biblioteca no tiene canción. Cada obra calcula su
# SPB = 60/BPM y su BAR con SU tempo (los tenía metidos a 90 BPM de una obra
# concreta, y el smoke test obligaba a que siguieran casando con ella).

# ---------------------------------------------------------------- basicos
def db2lin(db):
    return 10.0 ** (np.asarray(db, dtype=float) / 20.0)

def lin2db(x):
    return 20.0 * np.log10(np.maximum(np.abs(np.asarray(x, dtype=float)), 1e-12))

def note_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)

def white(n, seed=0):
    return np.random.default_rng(seed).standard_normal(int(n))

def fade(x, ms_in=5.0, ms_out=5.0):
    x = np.array(x, dtype=float, copy=True)
    n = len(x)
    a = min(int(SR * ms_in / 1000.0), n // 2)
    b = min(int(SR * ms_out / 1000.0), n // 2)
    if a > 0:
        x[:a] *= np.linspace(0.0, 1.0, a)
    if b > 0:
        x[n - b:] *= np.linspace(1.0, 0.0, b)
    return x

# ---------------------------------------------------------------- filtros
def biquad(kind, f0, Q=0.70710678, gain_db=0.0, fs=SR):
    f0 = float(min(max(f0, 1.0), fs * 0.49))
    w0 = 2.0 * np.pi * f0 / fs
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * Q)
    A = 10.0 ** (gain_db / 40.0)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bp':
        b = [alpha, 0.0, -alpha]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'notch':
        b = [1.0, -2 * cw, 1.0]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]; a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'hshelf':
        sq = 2.0 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw),
             (A + 1) - (A - 1) * cw - sq]
    elif kind == 'lshelf':
        sq = 2.0 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw),
             A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw),
             (A + 1) + (A - 1) * cw - sq]
    else:
        raise ValueError('tipo de filtro desconocido: ' + kind)
    b = np.array(b, float) / a[0]
    a = np.array(a, float) / a[0]
    return b, a

_IRCACHE = {}

def _ir(b, a, n=16384):
    key = (tuple(np.round(b, 10)), tuple(np.round(a, 10)), n)
    if key in _IRCACHE:
        return _IRCACHE[key]
    imp = np.zeros(n)
    imp[0] = 1.0
    y = np.zeros(n)
    b0, b1, b2 = b
    a1, a2 = a[1], a[2]
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        xi = imp[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, xi
        y2, y1 = y1, yi
        y[i] = yi
    _IRCACHE[key] = y
    return y

def fftconvolve(x, h, block=1 << 16):
    x = np.asarray(x, dtype=float)
    L = len(h)
    nfft = 1 << int(np.ceil(np.log2(block + L - 1)))
    H = np.fft.rfft(h, nfft)
    out = np.zeros(len(x) + nfft)
    for i in range(0, len(x), block):
        seg = x[i:i + block]
        X = np.fft.rfft(seg, nfft)
        out[i:i + nfft] += np.fft.irfft(X * H, nfft)
    return out[:len(x) + L - 1]

def filt(x, b, a):
    ir = _ir(b, a)
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        return fftconvolve(x, ir)[:len(x)]
    return np.stack([fftconvolve(x[:, c], ir)[:len(x)] for c in range(x.shape[1])], axis=1)

def lp(x, f, Q=0.7071):
    return filt(x, *biquad('lp', f, Q))

def hp(x, f, Q=0.7071):
    return filt(x, *biquad('hp', f, Q))

def bp(x, f, Q=1.0):
    return filt(x, *biquad('bp', f, Q))

# ---------------------------------------------------------------- STFT
def _win(n):
    return np.hanning(n + 1)[:-1]

def stft(x, n=1024, hop=256):
    w = _win(n)
    pad = n
    xp = np.concatenate([np.zeros(pad), np.asarray(x, float), np.zeros(pad)])
    nf = 1 + (len(xp) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(nf)[:, None]
    frames = xp[idx] * w
    return np.fft.rfft(frames, axis=1), w, pad

def istft(X, w, pad, length, n=1024, hop=256):
    nf = X.shape[0]
    frames = np.fft.irfft(X, n=n, axis=1) * w
    out = np.zeros(hop * (nf - 1) + n)
    wsum = np.zeros_like(out)
    ww = w * w
    k = n // hop
    for j in range(k):
        out[j * hop:j * hop + nf * hop] += frames[:, j * hop:(j + 1) * hop].reshape(-1)
        wsum[j * hop:j * hop + nf * hop] += np.tile(ww[j * hop:(j + 1) * hop], nf)
    out /= np.maximum(wsum, 1e-6)
    return out[pad:pad + length]

def tv_filter(x, env_func, n=1024, hop=256, chunk=1024):
    """Filtro variante en el tiempo: env_func(times, freqs) -> (nframes, nbins)."""
    X, w, pad = stft(x, n, hop)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    nf = X.shape[0]
    times = (np.arange(nf) * hop - pad + n / 2.0) / SR
    Y = np.empty_like(X)
    for i in range(0, nf, chunk):
        j = min(i + chunk, nf)
        E = env_func(times[i:j], freqs).astype(np.float32)
        Y[i:j] = X[i:j] * E
    return istft(Y, w, pad, len(x), n, hop)

# ---------------------------------------------------------------- utilidades
def pan(x, p):
    p = float(np.clip(p, -1.0, 1.0))
    l = np.cos((p + 1.0) * np.pi / 4.0)
    r = np.sin((p + 1.0) * np.pi / 4.0)
    x = np.asarray(x, float)
    return np.stack([x * l, x * r], axis=1)

def soft_clip(x, drive=2.0):
    return np.tanh(drive * np.asarray(x, float)) / np.tanh(drive)

def moving_avg(x, ms=50.0):
    n = max(1, int(SR * ms / 1000.0))
    k = np.ones(n) / n
    x = np.asarray(x, float)
    return fftconvolve(x, k)[:len(x)]

def moving_rms(x, ms=50.0):
    return np.sqrt(np.maximum(moving_avg(np.asarray(x, float) ** 2, ms), 1e-12))

def compress(x, thresh_db=-18.0, ratio=2.0, win_ms=40.0, makeup_db=0.0):
    x = np.asarray(x, float)
    mono = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    env = moving_rms(mono, win_ms)
    thr = float(db2lin(thresh_db))
    g = np.ones_like(env)
    over = env > thr
    g[over] = (env[over] / thr) ** (1.0 / ratio - 1.0)
    g = moving_avg(g, 25.0)
    g = np.clip(g, 0.0, 4.0)
    if x.ndim == 2:
        return x * g[:, None] * float(db2lin(makeup_db))
    return x * g * float(db2lin(makeup_db))

def reverb_ir(dur=2.5, decay=0.55, seed=1, lp_hz=6000.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-t / decay)
    ir = lp(ir, lp_hz, 0.7)
    a = int(0.008 * SR)
    ir[:a] *= np.linspace(0.0, 1.0, a)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    return ir

def reverb(x, ir):
    return fftconvolve(np.asarray(x, float), ir)

def delay(x, time_s, fb=0.35, mix=0.3, taps=5, lp_hz=4000.0):
    x = np.asarray(x, float)
    d = int(time_s * SR)
    out = np.zeros(len(x) + d * taps)
    out[:len(x)] += x
    g = 1.0
    for k in range(1, taps + 1):
        g *= fb
        s = d * k
        out[s:s + len(x)] += x * g
    out = lp(out, lp_hz, 0.7)
    out[:len(x)] *= (1.0 - mix)
    out[:len(x)] += x * mix
    return out[:len(x)]

def vinyl_noise(n, seed=0, hiss=0.02, crackle=0.6):
    rng = np.random.default_rng(seed)
    h = rng.standard_normal(n) * hiss
    h = hp(h, 900.0, 0.7)
    h = lp(h, 12000.0, 0.7)
    ncr = int(n * 0.0009 * crackle)
    cr = np.zeros(n)
    if ncr > 0:
        pos = rng.integers(0, n, ncr)
        cr[pos] = rng.standard_normal(ncr) * rng.uniform(0.2, 1.0, ncr)
        cr = bp(cr, 3500.0, 0.8)
    return h + cr * 0.35

def tape_hiss(n, seed=0, level=0.01):
    rng = np.random.default_rng(seed)
    h = rng.standard_normal(n)
    h = bp(h, 5000.0, 0.5) * 0.7 + bp(h, 900.0, 0.6) * 0.3
    wow = 1.0 + 0.05 * np.sin(2 * np.pi * 0.31 * np.arange(n) / SR)
    return h * level * wow

# ---------------------------------------------------------------- medicion
def _k_weight(x):
    b1, a1 = biquad('hshelf', 1681.974450955533, 0.7071752369554196, 4.0)
    b2, a2 = biquad('hp', 38.13547087602444, 0.5003270373238773)
    return filt(filt(x, b1, a1), b2, a2)

def lufs_integrated(x, fs=SR):
    x = np.asarray(x, float)
    if x.ndim == 1:
        x = x[:, None]
    y = _k_weight(x)
    block = int(0.4 * fs)
    hop = int(0.1 * fs)
    n = len(y)
    if n < block:
        return -70.0
    starts = np.arange(0, n - block + 1, hop)
    ms = np.empty(len(starts))
    for i, s in enumerate(starts):
        seg = y[s:s + block]
        ms[i] = np.mean(seg ** 2)
    l = -0.691 + 10.0 * np.log10(np.maximum(ms, 1e-20))
    keep = l > -70.0
    if not keep.any():
        return -70.0
    l1 = -0.691 + 10.0 * np.log10(np.mean(ms[keep]))
    keep2 = l > (l1 - 10.0)
    return float(-0.691 + 10.0 * np.log10(np.mean(ms[keep2])))

def true_peak_db(x, fs=SR):
    x = np.asarray(x, float)
    if x.ndim == 1:
        x = x[:, None]
    peak = 0.0
    blk = 1 << 15
    for i in range(0, len(x), blk):
        seg = x[i:i + blk]
        n = len(seg)
        nfft = 1 << int(np.ceil(np.log2(n * 4)))
        for c in range(seg.shape[1]):
            X = np.fft.rfft(seg[:, c], nfft)
            up = np.fft.irfft(X, nfft)
            peak = max(peak, float(np.max(np.abs(up))))
    return 20.0 * np.log10(max(peak, 1e-12))

def rms_db(x):
    x = np.asarray(x, float)
    return float(10.0 * np.log10(max(np.mean(x ** 2), 1e-20)))

def crest_db(x):
    x = np.asarray(x, float)
    return float(lin2db(np.max(np.abs(x))) - rms_db(x))

def normalize_peak(x, target_db=-1.0):
    x = np.asarray(x, float)
    p = np.max(np.abs(x))
    if p < 1e-12:
        return x
    return x * (float(db2lin(target_db)) / p)
