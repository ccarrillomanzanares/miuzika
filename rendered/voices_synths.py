#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""voices_synths.py -- voces AFINADAS de "Static Prayer" (dark synth-pop industrial).

Sintesis 100% offline con numpy puro + dsp_core (SIN scipy). Todas las funciones devuelven
MONO float64 de longitud EXACTAMENTE n, finito y sin DC apreciable. El estereo (Haas, pan,
reverb) se aplica fuera, en render_song.py / mix_master.py.

Voces:
  bass     bajo con sub, filtro con envolvente (dc.svf por muestra) y acento
  pad      acorde sostenido de sierras desafinadas, pasa-alto 110 Hz obligatorio
  strings  stab de cuerdas agresivo y saturado (ataque 20 ms)
  choir    coro por FORMANTES (fuente glotal + 3 resonancias), 'ah' / 'ooh'
  lead     linea solista oscura: saturada, vibrato y wah (LFO de cutoff)
  pluck    nota corta percusiva para el arpegio

Uso:
    import voices_synths as vs
    x = vs.bass(dc.note("D2"), dc.sec(0.8), glide=0.05, acc=0.7)
    y = vs.pad([dc.note(n) for n in ("D3", "F3", "A3", "D4")], dc.sec(2.6))
"""
from __future__ import annotations

import os
import sys

import numpy as np

# permite `python voices_synths.py` desde cualquier directorio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dsp_core as dc  # noqa: E402

# picos objetivo (el master fija los niveles finales; aqui solo material predecible)
_PEAK = {"bass": 0.88, "pad": 0.72, "strings": 0.78, "choir": 0.80,
         "lead": 1.06, "pluck": 0.62}


# --------------------------------------------------------------------------
# utilidades internas
# --------------------------------------------------------------------------
def _chord(freqs) -> list:
    """Lista de Hz a partir de nombres ('D3') o numeros. Acepta escalar."""
    if isinstance(freqs, str):
        items = [freqs]
    elif np.isscalar(freqs):
        items = [freqs]
    else:
        items = list(np.atleast_1d(freqs))
    out = [float(dc.hz_of(v)) for v in items]
    out = [f for f in out if f > 0.0]
    if not out:
        raise ValueError("acorde vacio")
    return out


def _freq_curve(f, n: int, sr: int, glide: float = 0.0, semis: float = -8.0) -> np.ndarray:
    """f -> array de frecuencia por muestra, con portamento exponencial desde `semis` abajo."""
    a = np.asarray(f, dtype=np.float64).ravel()
    if a.size == 0:
        raise ValueError("f vacio")
    if a.size == 1:
        tgt = np.full(n, float(a[0]))
    elif a.size == n:
        tgt = a.astype(np.float64).copy()
    else:
        tgt = np.interp(np.linspace(0.0, 1.0, n), np.linspace(0.0, 1.0, a.size), a)
    tgt = np.maximum(tgt, 1e-3)
    if glide and float(glide) > 0.0 and n > 4:
        k = int(min(max(float(glide) * sr, 2), n))
        start = float(tgt[0]) * 2.0 ** (float(semis) / 12.0)
        u = np.linspace(0.0, 1.0, k)
        u = u * u * (3.0 - 2.0 * u)                 # smoothstep: sin esquina al llegar
        tgt[:k] = start * (tgt[:k] / start) ** u
    return tgt


def _osc_ph(kind: str, freq, n: int, sr: int, phase: int = 0) -> np.ndarray:
    """dc.osc con desfase inicial en muestras (para descorrelacionar capas sin clicks)."""
    k = int(max(phase, 0)) % 4096
    f = np.asarray(freq, dtype=np.float64)
    if k <= 0:
        return dc.osc(kind, f, n, sr=sr)
    f2 = np.concatenate([np.full(k, float(f.ravel()[0])), f.ravel()]) if f.size > 1 else f
    return dc.osc(kind, f2, n + k, sr=sr)[k:]


def _mul(*resps):
    """Combina varias respuestas de magnitud en una sola (un solo fft_shape)."""
    def r(f):
        y = np.ones_like(np.asarray(f, dtype=np.float64))
        for fn in resps:
            y = y * np.asarray(fn(f), dtype=np.float64)
        return y
    return r


def _finish(x: np.ndarray, n: int, sr: int, target: float,
            hp_hz: float = 20.0, lp_hz: float | None = None) -> np.ndarray:
    """Ajusta longitud, quita DC (pasa-alto), normaliza pico y micro-fade final."""
    x = np.asarray(x, dtype=np.float64).ravel()
    if x.size < n:
        x = np.concatenate([x, np.zeros(n - x.size)])
    elif x.size > n:
        x = x[:n].copy()
    x = dc.ensure_finite(x, "voices_synths")
    resp = dc.resp_hp(hp_hz, 2.0) if lp_hz is None else _mul(dc.resp_hp(hp_hz, 2.0),
                                                            dc.resp_lp(lp_hz, 1.5))
    x = dc.fft_shape(x, resp, sr)
    x -= float(np.mean(x))
    p = dc.peak(x)
    if p > 0.0:
        x = x * (float(target) / p)
    k = min(int(0.002 * sr), n // 4)
    if k > 2:
        x[-k:] *= np.linspace(1.0, 0.0, k)
    return np.ascontiguousarray(x, dtype=np.float64)


def _atk(seconds: float, n: int, sr: int, frac: float = 0.4) -> float:
    """Ataque acotado a la longitud del buffer (dc.env_ad exige attack <= n)."""
    return float(min(max(seconds, 1.0 / sr), max(frac * n / sr, 1.0 / sr)))


def _saturate(x: np.ndarray, drive: float, pre: float = 0.9) -> np.ndarray:
    """Normaliza a `pre` y satura con tanh: la saturacion no depende del nivel de entrada."""
    p = dc.peak(x)
    if p <= 0.0:
        return x
    return dc.soft_clip(x * (float(pre) / p), float(np.clip(drive, 0.2, 12.0)))


# --------------------------------------------------------------------------
# BAJO
# --------------------------------------------------------------------------
def bass(f, n, sr=dc.SR, glide=0.0, wave="saw", sub=0.5, fc_env=(90.0, 2600.0), fc_tau=0.22,
         res=3.2, drive=2.4, acc=0.0):
    """Bajo monofonico con sub y filtro con envolvente (se abre de fc_env[0] a fc_env[1]).

    f: Hz o array por muestra. glide: segundos de portamento desde una sexta menor abajo.
    acc: 0..1 acento, abre el filtro (y adelanta la apertura).
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    freq = _freq_curve(f, n, sr, glide=glide, semis=-8.0)
    t = np.arange(n, dtype=np.float64) / sr

    # fuente: sierra (o wave) + pulso estrecho para el filo industrial + sub una octava abajo
    src = 0.80 * dc.osc(wave, freq, n, sr=sr)
    src += 0.28 * dc.osc("pulse", freq, n, sr=sr)
    if float(sub) != 0.0:
        src += float(sub) * dc.osc("sine", freq * 0.5, n, sr=sr)

    # filtro con envolvente: fc -> 90 Hz al ataque, abre a 2600 Hz con tau
    fc0, fc1 = float(fc_env[0]), float(fc_env[1])
    tau = max(float(fc_tau), 1e-3)
    acc = float(np.clip(acc, 0.0, 1.0))
    fc = fc1 + (max(fc0, 30.0) - fc1) * np.exp(-t / tau)
    if acc > 0.0:
        fc = fc * (1.0 + 1.6 * acc * np.exp(-t / (2.0 * tau)))
    fc = np.clip(fc, 32.0, 9000.0)
    y = dc.svf(src, fc, float(np.clip(res, 0.6, 8.0)), mode="lp", sr=sr)

    # VCA: cuerpo con caida lenta + cola corta (sin click al cortar la nota)
    e = dc.env_ad(n, _atk(0.004, n, sr), 1.8, sr=sr, shape=1.5, sus=0.60)
    e *= dc.env_sustain(n, 0.0015, min(0.04, max(0.006, 0.03 * n / sr)), sr=sr)
    y = y * e

    y = _saturate(y, drive, pre=0.92)
    # oscurece la saturacion por encima del contrato (armonicos utiles ~2.5 kHz)
    return _finish(y, n, sr, _PEAK["bass"], hp_hz=22.0, lp_hz=4600.0)


# --------------------------------------------------------------------------
# PAD
# --------------------------------------------------------------------------
def pad(freqs, n, sr=dc.SR, detune=7.0, cutoff=2400.0, res=0.9, attack=0.7, release=1.4,
        width=6.0, seed=101):
    """Acorde sostenido: 3 sierras por nota desafinadas +-detune cents, filtro y HP 110 Hz.

    width: cents extra de apertura entre las capas externas (base de la anchura estereo que se
    aplica despues). Devuelve MONO.
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    fs = _chord(freqs)
    rng = np.random.default_rng(int(seed))
    det = float(detune)
    spread = 0.5 * float(width)

    acc = np.zeros(n, dtype=np.float64)
    for f0 in fs:
        jitter = float(rng.uniform(-0.25, 0.25)) * det     # deriva propia de cada nota
        for sgn in (-1.0, 0.0, 1.0):
            cents = sgn * (det + spread) + (jitter if sgn != 0.0 else 0.0)
            fv = f0 * 2.0 ** (cents / 1200.0)
            acc += _osc_ph("saw", fv, n, sr, int(rng.integers(0, 2048)))
    acc /= np.sqrt(max(len(fs) * 3, 1))

    # filtro estatico (fase cero, material sostenido): LP + campana de resonancia + HP 110
    co = float(cutoff)
    r = float(np.clip(res, 0.2, 6.0))
    resp = _mul(dc.resp_lp(co, 1.6), dc.resp_peak(co * 0.85, 1.1, 2.2 * r),
                dc.resp_hp(110.0, 2.0))
    x = dc.fft_shape(acc, resp, sr)

    e = dc.env_sustain(n, float(attack), float(release), sr=sr, curve=0.7)
    x = x * e
    # el pasa-alto de 110 Hz ya va en `resp`; en _finish solo se limpia el DC
    return _finish(x, n, sr, _PEAK["pad"], hp_hz=30.0)


# --------------------------------------------------------------------------
# CUERDAS / STABS
# --------------------------------------------------------------------------
def strings(freqs, n, sr=dc.SR, attack=0.02, release=0.5, detune=9.0, drive=2.0,
            cutoff=4200.0):
    """Stab de cuerdas: acorde corto y agresivo (ataque 20 ms), tres sierras por nota, saturado."""
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    fs = _chord(freqs)
    t = np.arange(n, dtype=np.float64) / sr
    det = float(detune)

    acc = np.zeros(n, dtype=np.float64)
    for i, f0 in enumerate(fs):
        for j, sgn in enumerate((-1.0, 0.0, 1.0)):
            cents = sgn * det * 1.10                        # las dos capas externas, mas abiertas
            fv = f0 * 2.0 ** (cents / 1200.0)
            acc += _osc_ph("saw", fv, n, sr, (i * 733 + j * 1517) % 2048)
    acc /= np.sqrt(max(len(fs) * 3, 1))

    co = float(cutoff)
    resp = _mul(dc.resp_lp(co, 1.5), dc.resp_peak(co * 0.8, 1.2, 3.0), dc.resp_hp(95.0, 2.0))
    x = dc.fft_shape(acc, resp, sr)

    # envolvente de stab: ataque 20 ms + caida rapida sobre una meseta que suelta en release
    e = dc.env_sustain(n, float(attack), float(release), sr=sr, curve=0.6)
    e *= 0.40 + 0.60 * np.exp(-t / 0.30)
    x = x * e

    x = _saturate(x, drive, pre=0.85)
    return _finish(x, n, sr, _PEAK["strings"], hp_hz=30.0, lp_hz=9000.0)


# --------------------------------------------------------------------------
# CORO POR FORMANTES
# --------------------------------------------------------------------------
# (freq, q, peso) por formante; q alto = resonancia mas estrecha
_FORMANTS = {
    "ah": ((800.0, 2.6, 0.95), (1150.0, 2.8, 0.60), (2900.0, 3.0, 0.30)),
    "ooh": ((300.0, 2.6, 1.00), (870.0, 2.9, 0.52), (2240.0, 3.1, 0.22)),
}
_VOWEL_ALIAS = {"a": "ah", "ahh": "ah", "aa": "ah", "o": "ooh", "oo": "ooh", "ou": "ooh",
                "u": "ooh"}


def choir(freqs, n, sr=dc.SR, vowel="ah", attack=0.25, release=0.9, vib_hz=4.8,
          vib_depth=0.006, breath=0.15, seed=201):
    """Acorde vocal sin palabras: fuente glotal + 3 resonancias formanticas (paralelas).

    vowel: 'ah' (800/1150/2900 Hz) u 'ooh' (300/870/2240 Hz). vibrato y aire ('breath').
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    key = _VOWEL_ALIAS.get(str(vowel).lower(), str(vowel).lower())
    if key not in _FORMANTS:
        raise ValueError(f"vocal no soportada: {vowel!r} (usa 'ah' u 'ooh')")
    fs = _chord(freqs)
    rng = np.random.default_rng(int(seed))
    t = np.arange(n, dtype=np.float64) / sr

    # ajuste de formantes (formant tuning): si la nota mas grave supera F1, el cantante sube
    # F1 hasta rozarla; sin esto un 'ooh' agudo se queda sin cuerpo (F1 no se excita)
    forms = list(_FORMANTS[key])
    f1, q1, g1 = forms[0]
    forms[0] = (max(f1, 0.95 * min(fs)), q1, g1)

    # fuente glotal: sierra (1/k, como el pulso glotal) + pulso para el brillo de la voz
    src = np.zeros(n, dtype=np.float64)
    for i, f0 in enumerate(fs):
        jit = float(rng.uniform(-4.0, 4.0))                       # desafinado de coro
        phi = float(rng.uniform(0.0, 2.0 * np.pi))
        fv = f0 * 2.0 ** (jit / 1200.0) * (
            1.0 + float(vib_depth) * np.sin(2.0 * np.pi * float(vib_hz) * t + phi))
        fv = np.maximum(fv, 1e-3)
        src += _osc_ph("saw", fv, n, sr, int(rng.integers(0, 2048)))
        src += 0.30 * dc.osc("pulse", fv, n, sr=sr)
    src /= np.sqrt(max(len(fs), 1))

    # resonancias formanticas EN PARALELO (filtro de magnitud, fase cero)
    def resp(f):
        y = 0.06 * np.ones_like(np.asarray(f, dtype=np.float64))
        for ff, qq, gg in forms:
            y = y + gg * dc.resp_bp(ff, qq)(f)
        return y * dc.resp_hp(120.0, 2.0)(f)

    x = dc.fft_shape(src, resp, sr)

    # aire: ruido suave que pasa por los mismos formantes (no es una 's' suelta)
    if float(breath) > 0.0 and n > 64:
        air = dc.noise_spec(n, dc.resp_bp(2200.0, 0.7), sr, seed=int(seed) + 7)
        air = dc.fft_shape(air, resp, sr)
        x = x + float(breath) * 0.55 * air / max(dc.peak(air), 1e-9) * dc.peak(x)

    e = dc.env_sustain(n, float(attack), float(release), sr=sr, curve=0.9)
    x = x * e
    return _finish(x, n, sr, _PEAK["choir"], hp_hz=40.0)


# --------------------------------------------------------------------------
# LEAD
# --------------------------------------------------------------------------
def lead(f, n, sr=dc.SR, glide=0.0, vibrato=0.004, vib_hz=5.2, drive=2.6, wah=(0.4, 2.8),
         cutoff=3400.0):
    """Linea solista oscura y saturada: vibrato retardado + wah (LFO de cutoff en octavas)."""
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    freq = _freq_curve(f, n, sr, glide=glide, semis=-5.0)     # portamento desde una 4a justa
    t = np.arange(n, dtype=np.float64) / sr

    # vibrato con entrada retardada (~0.28 s): mas humano y menos 'organillo'
    ramp = np.clip(t / 0.28, 0.0, 1.0)
    ramp = ramp * ramp * (3.0 - 2.0 * ramp)
    freq = freq * (1.0 + float(vibrato) * ramp * np.sin(2.0 * np.pi * float(vib_hz) * t))
    freq = np.maximum(freq, 1e-3)

    src = 0.90 * dc.osc("saw", freq, n, sr=sr)
    src += 0.40 * dc.osc("saw", freq * 2.0 ** (7.0 / 1200.0), n, sr=sr)
    src += 0.22 * dc.osc("square", freq, n, sr=sr)

    # wah: LFO senoidal de cutoff en octavas (dc.svf con cutoff por muestra)
    w_hz, w_oct = float(wah[0]), float(wah[1])
    fc = float(cutoff) * 2.0 ** (w_oct * np.sin(2.0 * np.pi * w_hz * t - 0.6))
    fc = np.clip(fc, 220.0, sr * 0.45)
    y = dc.svf(src, fc, 2.4, mode="lp", sr=sr)

    e = dc.env_ad(n, _atk(0.012, n, sr), 1.5, sr=sr, shape=1.4, sus=0.66)
    e *= dc.env_sustain(n, 0.002, min(0.06, max(0.008, 0.04 * n / sr)), sr=sr)
    y = y * e

    y = _saturate(y, drive, pre=0.80)
    return _finish(y, n, sr, _PEAK["lead"], hp_hz=160.0, lp_hz=10000.0)


# --------------------------------------------------------------------------
# PLUCK
# --------------------------------------------------------------------------
def pluck(f, n, sr=dc.SR, decay=0.45, cutoff=2200.0, drive=1.4, seed=301):
    """Nota corta percusiva para el arpegio: barrido de filtro + decaimiento exponencial."""
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    freq = _freq_curve(f, n, sr)
    t = np.arange(n, dtype=np.float64) / sr
    d = max(float(decay), 0.02)

    src = 0.70 * dc.osc("saw", freq, n, sr=sr)
    src += 0.45 * dc.osc("square", freq, n, sr=sr)
    src += 0.28 * dc.osc("saw", freq * 2.0 ** (11.0 / 1200.0), n, sr=sr)

    fc = float(cutoff) * (0.45 + 2.6 * np.exp(-t / (0.30 * d)))
    y = dc.svf(src, np.clip(fc, 150.0, sr * 0.45), 2.2, mode="lp", sr=sr)

    e = dc.env_exp(n, tau=d * 0.55, attack=_atk(0.002, n, sr), sr=sr)
    y = y * e

    # click de pua: ruido muy corto en banda media
    if n > dc.sec(0.02, sr):
        nz = dc.noise_spec(n, dc.resp_bp(2600.0, 1.1), sr, seed=int(seed))
        y = y + 0.10 * nz * np.exp(-t / 0.006)

    y = _saturate(y, drive, pre=0.85)
    return _finish(y, n, sr, _PEAK["pluck"], hp_hz=180.0, lp_hz=7000.0)


# --------------------------------------------------------------------------
# autotest: renderiza de verdad cada voz y comprueba el contrato + FFT
# --------------------------------------------------------------------------
def _spec(x, sr=dc.SR):
    """Espectro de magnitud con ventana Hann y su eje de frecuencias."""
    x = np.asarray(x, dtype=np.float64)
    w = np.hanning(len(x))
    F = np.abs(np.fft.rfft(x * w))
    f = np.fft.rfftfreq(len(x), 1.0 / sr)
    return F, f


def _band(F, f, lo, hi):
    m = (f >= lo) & (f <= hi)
    return float(F[m].mean()) if m.any() else 0.0


def _smooth(F, f, width_hz=160.0):
    """Suaviza el espectro con una ventana triangular de `width_hz` (quita el peine de armonicos)."""
    df = f[1] - f[0]
    k = max(int(round(width_hz / df)) | 1, 3)
    ker = np.hanning(k)
    ker /= ker.sum()
    return np.convolve(F, ker, mode="same")


def _check(name, x, n):
    assert isinstance(x, np.ndarray), f"{name}: no es ndarray"
    assert x.dtype == np.float64, f"{name}: dtype {x.dtype} (se espera float64)"
    assert x.shape == (n,), f"{name}: forma {x.shape} != ({n},)"
    assert np.isfinite(x).all(), f"{name}: hay NaN/inf"
    p, r = dc.peak(x), dc.rms(x)
    dcv = float(np.mean(x))
    assert p <= 1.2, f"{name}: pico {p:.3f} > 1.2"
    assert p > 0.2, f"{name}: pico {p:.3f} demasiado bajo (voz muda)"
    assert r > 0.01, f"{name}: rms {r:.4f} demasiado bajo"
    assert abs(dcv) < 1e-3, f"{name}: DC {dcv:.2e} apreciable"
    print(f"{name:8s} len={len(x):6d} pico={p:.3f} rms={r:.3f}  dc={dcv:+.1e}")
    return p, r


def _test_bass_fft(x, sr):
    """(a) graves concentrados + armonicos hasta ~2.5 kHz DESPUES del filtro."""
    F, f = _spec(x, sr)
    tot = max(F.sum(), 1e-12)
    graves = F[(f >= 35.0) & (f <= 180.0)].sum() / tot
    med = F[(f >= 1000.0) & (f <= 2500.0)].sum() / tot
    alto = F[(f >= 4500.0) & (f <= 12000.0)].sum() / max(tot, 1e-12)
    ratio = med / max(alto, 1e-12)
    # pico armonico dentro de 1.5-2.5k: debe caer en un multiplo de f0
    f0 = dc.note("D2")
    m = (f >= 1500.0) & (f <= 2500.0)
    fpk = float(f[m][np.argmax(F[m])])
    k = fpk / f0
    err_cents = abs(1200.0 * np.log2(fpk / (round(k) * f0)))
    print(f"  FFT bajo: graves35-180={graves*100:.1f}%  1-2.5k/tot={med*100:.2f}%  "
          f"1-2.5k/4.5-12k={ratio:.1f}  pico={fpk:.0f}Hz (armonico {round(k)} de D2, "
          f"err={err_cents:.1f} cents)")
    assert graves > 0.30, f"bajo: poca energia en graves ({graves:.2f})"
    assert ratio > 3.0, f"bajo: no llega a ~2.5 kHz (ratio {ratio:.1f})"
    assert err_cents < 25.0, f"bajo: el pico en 1.5-2.5k no es armonico ({err_cents:.1f} cents)"


def _test_choir_fft(x, vowel, sr):
    """(b) picos formanticos del coro en las frecuencias del contrato."""
    F, f = _spec(x, sr)
    S = _smooth(F, f, 160.0)
    if vowel == "ah":
        forms = (800.0, 1150.0, 2900.0)
        valleys = (560.0, 1650.0, 3800.0)          # valles entre formantes
    else:
        forms = (300.0, 870.0, 2240.0)
        valleys = (520.0, 1500.0, 3400.0)
    lv = []
    for (ff, vv) in zip(forms, valleys):
        a = _band(S, f, ff * 0.94, ff * 1.06)
        b = _band(S, f, vv * 0.92, vv * 1.08)
        lv.append(a / max(b, 1e-12))
    print(f"  FFT coro '{vowel}': picos " + " ".join(f"{ff:.0f}Hz" for ff in forms) +
          "  nivel/valle=" + " ".join(f"{r:.2f}" for r in lv))
    for (ff, r) in zip(forms, lv):
        assert r > 1.25, f"coro {vowel}: formante {ff:.0f} Hz no destaca (x{r:.2f})"


def _test_pad_hp(x, sr):
    """El pad NO debe comerse el bajo: pasa-alto a 110 Hz obligatorio."""
    F, f = _spec(x, sr)
    tot = max(F.sum(), 1e-12)
    lo = F[f < 95.0].sum() / tot
    body = F[(f >= 110.0) & (f <= 400.0)].sum() / tot
    print(f"  FFT pad: energia <95Hz={lo*100:.4f}%  110-400Hz={body*100:.1f}%")
    assert lo < 0.01, f"pad: pasa-alto 110 Hz insuficiente ({lo*100:.2f}% bajo 95 Hz)"


def _zc_hz(seg, sr):
    s = np.signbit(seg)
    idx = np.where(s[1:] != s[:-1])[0]
    return (len(idx) - 1) * sr / (2.0 * (idx[-1] - idx[0])) if len(idx) > 4 else 0.0


def _test_glide(sr):
    """Portamento REAL: con fuente senoidal y el filtro abierto se mide la frecuencia por tramos."""
    f_tgt = dc.note("D2")
    x = bass(f_tgt, dc.sec(1.0), glide=0.35, wave="sine", sub=0.0,
             fc_env=(3000.0, 3000.0), fc_tau=0.01)
    w = dc.sec(0.10)
    fz = [_zc_hz(x[i * w:(i + 1) * w], sr) for i in range(5)]
    print("  glide 0.35s desde 6a menor: " + " ".join(f"{v:.1f}" for v in fz) +
          f" Hz (objetivo {f_tgt:.1f})")
    assert all(b > a for a, b in zip(fz, fz[1:])), "glide: la frecuencia no sube de forma monotona"
    assert abs(fz[0] - f_tgt * 2.0 ** (-8.0 / 12.0)) < 3.0, f"glide: arranque {fz[0]:.1f} Hz"
    assert abs(fz[-1] - f_tgt) < 1.5, f"glide: final {fz[-1]:.1f} Hz != {f_tgt:.1f}"


if __name__ == "__main__":
    sr = dc.SR
    n = dc.sec(1.5)
    print(f"voices_synths -- sr={sr}  n={n} (1.5 s)")

    xb = bass(dc.note("D2"), n)
    _check("bass", xb, n)

    xbg = bass(dc.note("D2"), n, glide=0.10, acc=0.85, sub=0.35)
    _check("bass_gl", xbg, n)

    xp = pad([dc.note(s) for s in ("D3", "F3", "A3", "D4")], n)
    _check("pad", xp, n)

    xs = strings([dc.note(s) for s in ("D3", "F3", "A3", "D4")], n)
    _check("strings", xs, n)

    xa = choir([dc.note(s) for s in ("D4", "F4", "A4")], n, vowel="ah")
    _check("choir_ah", xa, n)

    xo = choir([dc.note(s) for s in ("D4", "F4", "A4")], n, vowel="ooh")
    _check("choir_ooh", xo, n)

    xl = lead(dc.note("F4"), n, glide=0.06, wah=(0.6, 2.2))
    _check("lead", xl, n)

    xpl = pluck(dc.note("A3"), n)
    _check("pluck", xpl, n)

    print("\ncomprobaciones FFT:")
    _test_bass_fft(xb, sr)
    _test_bass_fft(xbg, sr)
    _test_choir_fft(xa, "ah", sr)
    _test_choir_fft(xo, "ooh", sr)
    _test_pad_hp(xp, sr)
    _test_glide(sr)

    # extras de contrato: acordes de otras tonalidades y voces muy cortas
    for nm in ("pad", "strings"):
        fn = pad if nm == "pad" else strings
        for chord in (("Bb2", "D3", "F3", "Bb3"), ("G2", "Bb2", "D3", "G3")):
            y = fn([dc.note(s) for s in chord], dc.sec(2.6))
            _check(f"{nm}:{chord[0]}", y, dc.sec(2.6))
    for nm, y in (("bass_short", bass(dc.note("Bb1"), dc.sec(0.14))),
                  ("pluck_short", pluck(dc.note("D4"), dc.sec(0.10))),
                  ("lead_tiny", lead(dc.note("A4"), 64))):
        assert len(y) and np.isfinite(y).all() and dc.peak(y) <= 1.2
        print(f"{nm:8s} len={len(y):6d} pico={dc.peak(y):.3f} rms={dc.rms(y):.3f}")

    print("\nVOICES_SYNTHS OK")
