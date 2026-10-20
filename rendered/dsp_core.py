#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""dsp_core.py -- utilidades DSP compartidas para sintesis offline (numpy puro, SIN scipy).

Contrato de datos: todo buffer de audio es un np.ndarray float64 1-D (mono) o 2-D (2, n)
con la forma (canales, muestras). Rango nominal +-1.0 (se permite hasta +-1.2 antes del master).

Incluye:
  - notas/Hz:            note(), hz_of()
  - osciladores:         osc() (wavetable con MIP por limite de banda), osc_fm()
  - ruido espectral:     noise_spec()  (ruido con espectro exacto, sin filtros recursivos)
  - envolventes:         env_ad(), env_sustain(), env_ar(), env_exp()
  - filtros:             svf() (tiempo variable, por muestra), fft_shape()/hp/lp/bp/bell (estaticos)
  - estereo/utilidades:  pan(), bus(), add_at(), write_wav16(), normalize_peak(), fade(),
                         soft_clip(), rms(), peak(), ensure_finite()

Uso tipico:
    import dsp_core as dc
    n = dc.sec(0.5)
    x = dc.osc('saw', dc.note('D2'), n) * dc.env_ad(n, 0.002, 0.4)
    x = dc.svf(x, np.linspace(3000, 200, n), 3.0)          # barrido de cutoff
    x = dc.soft_clip(x, 2.5)
"""
from __future__ import annotations

import wave

import numpy as np

SR = 44100

# --------------------------------------------------------------------------
# tiempo / niveles
# --------------------------------------------------------------------------


def sec(seconds: float, sr: int = SR) -> int:
    """Segundos -> entero de muestras."""
    return int(round(seconds * sr))


def lin2db(x: float) -> float:
    return 20.0 * np.log10(max(abs(x), 1e-12))


def db2lin(d: float) -> float:
    return 10.0 ** (d / 20.0)


def rms(x: np.ndarray) -> float:
    x = np.asarray(x, dtype=np.float64)
    return float(np.sqrt(np.mean(x * x)))


def peak(x: np.ndarray) -> float:
    x = np.asarray(x, dtype=np.float64)
    return float(np.max(np.abs(x))) if x.size else 0.0


def ensure_finite(x: np.ndarray, where: str = "") -> np.ndarray:
    """Sustituye NaN/inf por 0 y avisa. Se usa antes de escribir el WAV."""
    x = np.asarray(x, dtype=np.float64)
    bad = ~np.isfinite(x)
    if bad.any():
        print(f"[dsp_core] AVISO: {int(bad.sum())} muestras no finitas en {where or 'buffer'} -> 0")
        x = np.where(bad, 0.0, x)
    return x


# --------------------------------------------------------------------------
# notas
# --------------------------------------------------------------------------
_NOTE_IDX = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
             "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def note(name: str, a4: float = 440.0) -> float:
    """Nombre de nota -> Hz. Acepta 'D3', 'Bb2', 'F#4' (bemol o sostenido)."""
    name = name.strip()
    letter, octave = name[:-1], int(name[-1])
    return a4 * 2.0 ** ((_NOTE_IDX[letter] + 12 * (octave - 4) - 9) / 12.0)


def shift(name_or_hz, semitones: float) -> float:
    """Desplaza una nota o frecuencia en semitonos."""
    f = name_or_hz if isinstance(name_or_hz, (int, float)) else note(name_or_hz)
    return float(f) * 2.0 ** (semitones / 12.0)


def hz_of(x) -> float:
    """Acepta 'D3' o numero y devuelve Hz (numeros pasan tal cual)."""
    return float(x) if isinstance(x, (int, float, np.floating)) else note(str(x))


# --------------------------------------------------------------------------
# osciladores (wavetable + MIP por limite de banda: sin aliasing)
# --------------------------------------------------------------------------
_TABLE_CACHE: dict[tuple, np.ndarray] = {}
_TABLE_SIZE = 4096


def _ideal_cycle(kind: str, size: int) -> np.ndarray:
    ph = np.arange(size) / size
    if kind == "saw":
        return 2.0 * ph - 1.0
    if kind == "square":
        return np.where(ph < 0.5, 1.0, -1.0)
    if kind == "pulse":
        return np.where(ph < 0.25, 1.0, -1.0)
    if kind == "tri":
        return 4.0 * np.abs(ph - 0.5) - 1.0
    if kind == "sine":
        return np.sin(2.0 * np.pi * ph)
    if kind == "organ":                      # suma de armonicos tipo organo
        y = np.sin(2 * np.pi * ph)
        for k, a in ((2, 0.5), (3, 0.33), (4, 0.25), (6, 0.15)):
            y += a * np.sin(2 * np.pi * k * ph)
        return y
    raise ValueError(f"kind de onda no soportado: {kind}")


def table(kind: str, nh: int, size: int = _TABLE_SIZE) -> np.ndarray:
    """Tabla de un ciclo con armonicos limitados a nh (cacheada)."""
    key = (kind, int(nh), size)
    tab = _TABLE_CACHE.get(key)
    if tab is None:
        ideal = _ideal_cycle(kind, size)
        Y = np.fft.rfft(ideal)
        Y[int(nh) + 1:] = 0.0
        tab = np.fft.irfft(Y, size)
        p = np.max(np.abs(tab))
        tab = tab / p if p > 0 else tab
        _TABLE_CACHE[key] = tab
    return tab


def osc(kind: str, freq, n: int, sr: int = SR, fmax: float = 16000.0,
        size: int = _TABLE_SIZE) -> np.ndarray:
    """Oscilador de wavetable. freq puede ser escalar o array por muestra (portamento/pitch env)."""
    f = np.atleast_1d(np.asarray(freq, dtype=np.float64))
    if f.size == 1:
        f = np.full(n, f[0])
    f = np.maximum(f, 1e-6)
    fmax_i = max(f.max(), 1e-6)
    nh = max(1, min(size // 2 - 1, int(fmax / fmax_i)))
    tab = table(kind, nh, size)
    ph = np.cumsum(f) / sr
    ph -= np.floor(ph)
    x = ph * size
    i0 = x.astype(np.int64) % size
    i1 = (i0 + 1) % size
    w = x - np.floor(x)
    return tab[i0] * (1.0 - w) + tab[i1] * w


def osc_fm(carrier, mod, index, n: int, sr: int = SR) -> np.ndarray:
    """FM de 2 operadores con envolvente de indice por muestra.

    carrier/mod: Hz (escalar o array por muestra). index: escalar o array (radianes).
    """
    car = np.atleast_1d(np.asarray(carrier, dtype=np.float64))
    mo = np.atleast_1d(np.asarray(mod, dtype=np.float64))
    ix = np.atleast_1d(np.asarray(index, dtype=np.float64))
    if car.size == 1:
        car = np.full(n, car[0])
    if mo.size == 1:
        mo = np.full(n, mo[0])
    if ix.size == 1:
        ix = np.full(n, ix[0])
    ph_m = 2.0 * np.pi * np.cumsum(mo) / sr
    ph_c = 2.0 * np.pi * np.cumsum(car) / sr
    return np.sin(ph_c + ix * np.sin(ph_m))


# --------------------------------------------------------------------------
# ruido con espectro exacto (evita filtros recursivos en percusion)
# --------------------------------------------------------------------------


def noise_spec(n: int, resp, sr: int = SR, seed: int = 0) -> np.ndarray:
    """Ruido blanco * respuesta de magnitud resp(f) (callable de Hz -> ganancia).

    Genera el ruido YA filtrado en el dominio de la frecuencia: sin bucle recursivo y sin
    pre-ringing apreciable. Ej.: resp = dc.resp_bp(4000, 0.9)  -> ruido en banda.
    """
    rng = np.random.default_rng(seed)
    nfft = int(2 ** np.ceil(np.log2(max(n, 64))))
    f = np.fft.rfftfreq(nfft, 1.0 / sr)
    mag = np.asarray(resp(f), dtype=np.float64)
    X = mag * np.exp(1j * rng.uniform(0.0, 2.0 * np.pi, len(f)))
    y = np.fft.irfft(X, nfft)[:n]
    p = peak(y)
    return y / p if p > 0 else y


def white(n: int, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


# --------------------------------------------------------------------------
# envolventes
# --------------------------------------------------------------------------


def env_ad(n: int, attack: float, decay: float, sr: int = SR,
           shape: float = 1.0, sus: float = 0.0) -> np.ndarray:
    """Ataque lineal suave + caida exponencial hacia sus.

    shape: 1.0 = exponencial pura; <1.0 (0.6-0.8) = caida inicial MAS rapida (percusivo);
           >1.0 = meseta antes de caer (sostenido).
    """
    t = np.arange(n) / sr
    e = sus + (1.0 - sus) * np.exp(-(np.maximum(t - attack, 0.0) / max(decay, 1e-4)) ** shape)
    a = max(int(attack * sr), 2)
    if a > 2:
        e[:a] *= np.linspace(0.0, 1.0, a) ** 0.6
    return np.clip(e, 0.0, None)


def env_exp(n: int, tau: float, attack: float = 0.002, sr: int = SR) -> np.ndarray:
    """Caida exponencial pura (tau = constante de tiempo en segundos)."""
    t = np.arange(n) / sr
    e = np.exp(-t / max(tau, 1e-4))
    a = max(int(attack * sr), 2)
    if a > 2:
        e[:a] *= np.linspace(0.0, 1.0, a) ** 0.6
    return e


def env_sustain(n: int, attack: float, release: float, sr: int = SR,
                curve: float = 0.7) -> np.ndarray:
    """Meseta con rampas de ataque y release (voces sostenidas: pad, coro, cuerdas)."""
    e = np.ones(n)
    a = min(max(int(attack * sr), 1), n // 2)
    r = min(max(int(release * sr), 1), n - a)
    if a > 1:
        e[:a] = np.linspace(0.0, 1.0, a) ** curve
    if r > 1:
        e[n - r:] = np.linspace(1.0, 0.0, r) ** curve
    return e


def env_ar(n: int, attack: float, release: float, sr: int = SR) -> np.ndarray:
    """Subida y bajada (1 -> 0): percusion tipo swipe/riser."""
    a = min(max(int(attack * sr), 2), n - 2)
    e = np.empty(n)
    e[:a] = np.linspace(0.0, 1.0, a) ** 0.5
    e[a:] = np.cos(np.linspace(0.0, np.pi / 2, n - a)) ** 2
    return e


def env_duck(n: int, attack: float, hold: float, release: float, sr: int = SR) -> np.ndarray:
    """Envolvente de bombeo (1 -> suelo -> 1): para domar pads con el kick."""
    t = np.arange(n) / sr
    floor_ = np.exp(-np.maximum(t - hold, 0.0) / max(release, 1e-4))
    ramp = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    return np.clip(1.0 - (1.0 - floor_) * ramp, 0.0, 1.0)


# --------------------------------------------------------------------------
# filtros
# --------------------------------------------------------------------------


def svf(x: np.ndarray, fc, q, mode: str = "lp", sr: int = SR) -> np.ndarray:
    """Filtro de variable de estado TPT (Zavalishin), cutoff y Q POR MUESTRA.

    mode: 'lp' | 'bp' | 'hp'. fc/q escalares o arrays de longitud len(x).
    Es la unica opcion para barridos por muestra (no hay scipy); acepta buffers sueltos
    (voz a voz), no la mezcla completa de 3 minutos.
    """
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    fc = np.atleast_1d(np.asarray(fc, dtype=np.float64))
    q = np.atleast_1d(np.asarray(q, dtype=np.float64))
    if fc.size == 1:
        fc = np.full(n, fc[0])
    if q.size == 1:
        q = np.full(n, q[0])
    fc = np.clip(fc, 20.0, sr * 0.45)
    q = np.maximum(q, 0.5)
    g = np.tan(np.pi * fc / sr)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2

    y = np.zeros(n)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        v0 = x[i]
        v3 = v0 - ic2
        v1 = a1[i] * ic1 + a2[i] * v3            # bandpass
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3      # lowpass
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == "lp":
            y[i] = v2
        elif mode == "bp":
            y[i] = v1 * k[i]
        else:
            y[i] = v0 - k[i] * v1 - v2
    return y


def fft_shape(x: np.ndarray, resp, sr: int = SR, pad: int | None = None) -> np.ndarray:
    """Filtro estatico de fase cero por magnitud: resp(f) -> ganancia.

    Para material SOSTENIDO (pad, coro, ruido, EQ). No usar en ataques percusivos:
    es de fase cero y puede pre-ringear. Rellena con ceros para evitar el salto circular.
    """
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if pad is None:
        pad = min(n, 1 << 14)
    xp = np.concatenate([x, np.zeros(pad)])
    X = np.fft.rfft(xp)
    f = np.fft.rfftfreq(len(xp), 1.0 / sr)
    y = np.fft.irfft(X * np.asarray(resp(f), dtype=np.float64), len(xp))
    return y[:n]


def resp_hp(f0: float, order: float = 2.0):
    """Magnitud Butterworth de paso alto (fase cero, para fft_shape)."""
    return lambda f: 1.0 / np.sqrt(1.0 + (f0 / np.maximum(f, 1e-6)) ** (2.0 * order))


def resp_lp(f0: float, order: float = 2.0):
    return lambda f: 1.0 / np.sqrt(1.0 + (np.maximum(f, 1e-6) / f0) ** (2.0 * order))


def resp_bp(f0: float, q: float):
    """Paso banda resonante (aproximacion gaussiana en octavas: q alto = mas estrecho)."""
    q = max(float(q), 0.2)
    return lambda f: np.exp(-(((np.log2(np.maximum(f, 1.0) / f0)) * 2.0 * q) ** 2))


def resp_peak(f0: float, q: float, gain_db: float):
    """Campana de EQ (bell)."""
    q = max(float(q), 0.2)
    amp = db2lin(gain_db) - 1.0
    return lambda f: 1.0 + amp * np.exp(-(((np.log2(np.maximum(f, 1.0) / f0)) * q) ** 2))


def resp_shelf(f0: float, gain_db: float, low: bool = True, slope: float = 1.2):
    """Estante bajo/alto suave, para dar cuerpo o aire."""
    amp = db2lin(gain_db)
    def r(f):
        u = np.clip(np.log2(np.maximum(f, 1.0) / f0) * slope, -30, 30)
        s = 1.0 / (1.0 + np.exp(u))                # 1 en bajas, 0 en altas
        g = s if low else (1.0 - s)
        return 1.0 + (amp - 1.0) * g
    return r


def hp(x, f0, order: float = 2.0, sr: int = SR):
    return fft_shape(x, resp_hp(f0, order), sr)


def lp(x, f0, order: float = 2.0, sr: int = SR):
    return fft_shape(x, resp_lp(f0, order), sr)


def bp(x, f0, q: float = 1.0, sr: int = SR):
    return fft_shape(x, resp_bp(f0, q), sr)


def bell(x, f0, q: float = 1.0, gain_db: float = 0.0, sr: int = SR):
    return fft_shape(x, resp_peak(f0, q, gain_db), sr)


# --------------------------------------------------------------------------
# distorsion / dinamica
# --------------------------------------------------------------------------


def soft_clip(x: np.ndarray, drive: float = 2.0, bias: float = 0.0) -> np.ndarray:
    """Waveshaper tanh (bias != 0 -> armonicos pares, suciedad industrial)."""
    x = np.asarray(x, dtype=np.float64)
    if bias:
        return np.tanh(drive * x + bias) - np.tanh(bias)
    return np.tanh(drive * x)


def normalize_peak(x: np.ndarray, target_db: float = -1.0) -> np.ndarray:
    p = peak(x)
    if p <= 0:
        return x
    return np.asarray(x, dtype=np.float64) / p * db2lin(target_db)


# --------------------------------------------------------------------------
# estereo y montaje
# --------------------------------------------------------------------------


def bus(n: int) -> np.ndarray:
    """Bus estereo vacio de n muestras, forma (2, n)."""
    return np.zeros((2, int(n)), dtype=np.float64)


def pan(mono: np.ndarray, p: float = 0.0) -> np.ndarray:
    """Paneo de ley de potencia. p: -1 izq, 0 centro, +1 der. -> (2, n)."""
    p = float(np.clip(p, -1.0, 1.0))
    th = (p + 1.0) * 0.25 * np.pi                  # 0..pi/2
    return np.stack([np.asarray(mono, dtype=np.float64) * np.cos(th),
                     np.asarray(mono, dtype=np.float64) * np.sin(th)])


def add_at(dst: np.ndarray, src, t_seconds: float, gain: float = 1.0,
           pan_value: float = 0.0, sr: int = SR) -> None:
    """Suma una voz a un bus (2, n) en t_seconds, con ganancia y paneo. Recorta al final del bus."""
    if isinstance(src, tuple):                    # ya es estereo (2, n)
        st = np.asarray(src, dtype=np.float64)
    else:
        st = pan(src, pan_value)
    i0 = int(round(t_seconds * sr))
    if i0 < 0:
        st = st[:, -i0:]
        i0 = 0
    n = st.shape[1]
    if i0 >= dst.shape[1]:
        return
    n = min(n, dst.shape[1] - i0)
    if n <= 0:
        return
    dst[:, i0:i0 + n] += st[:, :n] * gain


def mono_sum(st: np.ndarray) -> np.ndarray:
    st = np.asarray(st, dtype=np.float64)
    return st if st.ndim == 1 else st.sum(axis=0) / st.shape[0]


def fade(st: np.ndarray, sr: int = SR, in_s: float = 0.0, out_s: float = 0.0) -> np.ndarray:
    """Fades lineales de entrada/salida sobre (2, n) o (n,)."""
    st = np.asarray(st, dtype=np.float64).copy()
    n = st.shape[-1]
    if in_s > 0:
        k = min(int(in_s * sr), n)
        if k > 1:
            if st.ndim == 2:
                st[:, :k] *= np.linspace(0.0, 1.0, k)
            else:
                st[:k] *= np.linspace(0.0, 1.0, k)
    if out_s > 0:
        k = min(int(out_s * sr), n)
        if k > 1:
            if st.ndim == 2:
                st[:, n - k:] *= np.linspace(1.0, 0.0, k)
            else:
                st[n - k:] *= np.linspace(1.0, 0.0, k)
    return st


def haas(mono: np.ndarray, delay_ms: float = 0.8, sr: int = SR) -> np.ndarray:
    """Ensancha un mono: L directo, R retardado delay_ms (descorrelacion suave)."""
    m = np.asarray(mono, dtype=np.float64)
    d = max(int(delay_ms * sr / 1000.0), 1)
    r = np.concatenate([np.zeros(d), m[:len(m) - d]]) if d < len(m) else np.zeros_like(m)
    return np.stack([m, r])


# --------------------------------------------------------------------------
# escritura
# --------------------------------------------------------------------------


def write_wav16(path: str, st: np.ndarray, sr: int = SR, headroom: float = 1.0) -> dict:
    """Escribe PCM 16-bit entrelazado. Devuelve metricas reales del fichero escrito.

    headroom: 1.0 = sin escalar. Nunca normaliza por canal (destruye el balance L/R).
    """
    st = ensure_finite(np.asarray(st, dtype=np.float64), "write_wav16")
    if st.ndim == 1:
        st = np.stack([st, st])
    st = np.clip(st * headroom, -1.0, 1.0)
    inter = np.empty(st.shape[1] * 2, dtype=np.int16)
    inter[0::2] = np.round(st[0] * 32767.0).astype(np.int16)
    inter[1::2] = np.round(st[1] * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(inter.tobytes())
    return {"path": path, "frames": int(st.shape[1]), "sr": sr,
            "peak_L": peak(st[0]), "peak_R": peak(st[1]),
            "rms_L": rms(st[0]), "rms_R": rms(st[1]),
            "clipped": int(np.sum(np.abs(st) >= 0.99999))}


# --------------------------------------------------------------------------
# autotest
# --------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import tempfile

    print("A4 =", note("A4"), " D2 =", round(note("D2"), 3), " Bb2 =", round(note("Bb2"), 3))

    n = sec(0.5)
    for kind in ("saw", "square", "pulse", "tri", "sine", "organ"):
        x = osc(kind, note("A3"), n)
        assert x.shape == (n,), kind
        assert np.isfinite(x).all(), kind
        print(f"  osc {kind:7s} peak={peak(x):.3f} rms={rms(x):.3f}")

    # sin aliasing: una sierra muy aguda no debe tener energia por encima de 16 kHz
    x = osc("saw", 4000.0, sec(1.0))
    F = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    hi = F[f > 16000].sum() / max(F.sum(), 1e-12)
    print("  energia >16kHz en sierra de 4 kHz: %.2e (debe ser ~0)" % hi)

    # osc_fm
    y = osc_fm(131.0, 131.0 * 1.4142, np.linspace(14, 0.8, n), n)
    print("  osc_fm peak=%.3f  finito=%s" % (peak(y), np.isfinite(y).all()))

    # ruido espectral: banda 4 kHz debe tener mas energia en 3-5k que en <200 Hz
    nz = noise_spec(sec(1.0), resp_bp(4000.0, 0.9), seed=3)
    F = np.abs(np.fft.rfft(nz * np.hanning(len(nz))))
    f = np.fft.rfftfreq(len(nz), 1 / SR)
    print("  noise_spec band3-5k/band<200 = %.1f" %
          (F[(f > 3000) & (f < 5000)].mean() / max(F[f < 200].mean(), 1e-12)))

    # svf: escalar y array no deben reventar; un lowpass debe atenuar agudos
    a = svf(white(n, 1), 800.0, 0.7)
    b = svf(white(n, 2), np.linspace(6000, 200, n), 3.0)
    fa = np.abs(np.fft.rfft(a * np.hanning(n)))
    fb = np.abs(np.fft.rfft(b * np.hanning(n)))
    fr = np.fft.rfftfreq(n, 1 / SR)
    print("  svf escalar hp_rel=%.3f  svf barrido hp_rel=%.3f (barrido debe ser menor)" %
          (fa[fr > 6000].mean() / max(fa[fr < 500].mean(), 1e-12),
           fb[fr > 6000].mean() / max(fb[fr < 500].mean(), 1e-12)))

    # envolventes
    for name, e in (("ad", env_ad(n, 0.002, 0.3, shape=2.0)), ("exp", env_exp(n, 0.2)),
                    ("sustain", env_sustain(n, 0.05, 0.1)), ("ar", env_ar(n, 0.2, 0.2)),
                    ("duck", env_duck(n, 0.001, 0.02, 0.2))):
        print(f"  env {name:8s} [{e.min():.3f}..{e.max():.3f}] largo={len(e)}")

    # filtros estaticos
    for nm, fun in (("hp", hp), ("lp", lp), ("bp", bp)):
        z = fun(white(n, 5), 1000.0) if nm != "bp" else bp(white(n, 5), 1000.0, 1.0)
        assert np.isfinite(z).all() and len(z) == n
        print(f"  {nm}(x) ok  peak={peak(z):.3f}")

    # estereo + escritura
    st = pan(osc("saw", note("D3"), n) * env_ad(n, 0.005, 0.3), -0.3)
    st += pan(osc("saw", note("A3"), n) * env_ad(n, 0.005, 0.3), 0.3)
    st = fade(normalize_peak(st, -1.0), in_s=0.01, out_s=0.05)
    out = os.path.join(tempfile.gettempdir(), "dsp_core_autotest.wav")
    info = write_wav16(out, st)
    print("  WAV:", info)
    print("dsp_core OK")
