#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""voices_drums.py -- percusion sintetica para "Static Prayer" (dark synth-pop industrial).

Todas las voces son MONO, float64, de longitud EXACTAMENTE n, finitas, con pico
normalizado (0.7-1.05) y sin DC apreciable. Solo numpy + dsp_core (sin scipy).

Criterios de sintesis:
  - El ruido NUNCA se filtra con recursivos: se genera ya filtrado en el dominio de la
    frecuencia con dc.noise_spec(..., dc.resp_*), que ademas no pre-ringea los ataques.
  - dc.svf (bucle por muestra) se usa SOLO en buffers cortos de percusion (metal), nunca
    sobre material largo.
  - Los barridos de filtro (sweep) se hacen como BANCO DE BANDAS con ganancia variable en
    el tiempo: vectorizado, sin bucle por muestra y con la misma ley que dc.resp_bp.
  - Cada voz se normaliza a un pico fijo conocido (material "predecible" para el master).

Test:  python voices_drums.py
"""
from __future__ import annotations

import os
import sys

# dsp_core vive junto a este fichero; si no somos el cwd, hay que poder importarlo.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import numpy as np

import dsp_core as dc


# --------------------------------------------------------------------------
# utilidades internas
# --------------------------------------------------------------------------

def _t(n: int, sr: int) -> np.ndarray:
    """Eje de tiempo en segundos (vectorizado)."""
    return np.arange(int(n), dtype=np.float64) / float(sr)


def _noise(n: int, resp, sr: int, seed: int) -> np.ndarray:
    """Ruido filtrado por magnitud y SIN componente DC.

    noise_spec normaliza el pico a 1 pero deja pasar la componente DC (bin 0 con fase
    aleatoria); se elimina ANTES de aplicar la envolvente para que el offset no se
    convierta en un escalon al principio del buffer.
    """
    nz = dc.noise_spec(int(n), resp, sr=sr, seed=int(seed))
    return nz - float(nz.mean())


def _fade_out_tail(x: np.ndarray, sr: int, seconds: float = 0.004) -> np.ndarray:
    """Rampa final corta: evita el click de truncacion al cortar el buffer."""
    n = len(x)
    k = int(min(max(seconds * sr, 0), n))
    if k > 1:
        x[n - k:] *= np.linspace(1.0, 0.0, k) ** 0.6
    return x


def _finish(x, n: int, target: float = 0.9, sr: int = dc.SR,
            fade_out: float = 0.004) -> np.ndarray:
    """Cierre comun: largo exacto, finito, sin DC, rampa final y pico fijo."""
    x = np.asarray(x, dtype=np.float64).ravel()
    if x.size < n:
        x = np.concatenate([x, np.zeros(n - x.size)])
    x = x[:n]
    x = np.where(np.isfinite(x), x, 0.0)
    x = x - float(x.mean())                 # DC exactamente a cero
    x = _fade_out_tail(x, sr, fade_out)
    p = dc.peak(x)
    if p > 0.0:
        x = x / p * float(target)
    return x


def _gate_window(n: int, sr: int, gate: float, release_s: float = 0.003) -> np.ndarray:
    """Ventana de puerta: 1 hasta `gate` segundos y corte EN SECO (2-3 ms de rampa)."""
    w = np.ones(n)
    ig = int(round(max(gate, 0.0) * sr))
    if ig < n:
        w[:ig] = 1.0
        k = int(min(max(release_s * sr, 1), n - ig))
        if k > 1:
            w[ig:ig + k] = np.linspace(1.0, 0.0, k) ** 0.7
        rest = ig + k
        if rest < n:
            w[rest:] = 0.0
    return w


def _band_noise_resp(lo: float, hi: float, q: float = 0.9):
    """Respuesta de banda (dc.resp_bp centrada en la media geometrica) recortada a [lo, hi]."""
    lo = max(float(lo), 30.0)
    hi = max(float(hi), lo * 1.05)
    c = np.sqrt(lo * hi)
    return lambda f: dc.resp_bp(c, q)(f) * dc.resp_hp(lo * 0.85, 1.5)(f) * \
        dc.resp_lp(hi * 1.15, 1.5)(f)


# --------------------------------------------------------------------------
# 1. bombo
# --------------------------------------------------------------------------

def kick(n, sr=dc.SR, f0=115.0, f1=45.0, pitch_tau=0.045, decay=0.55,
         drive=2.2, click=0.5, seed=11):
    """Bombo: seno con caida de tono f0 -> f1 + click de ruido corto, saturado.

    Cuerpo en la zona 45-115 Hz (dc.osc con frecuencia por muestra, sin aliasing) y
    ataque audible en 1-3 kHz aportado por el click. Sin cola larga.
    """
    n = int(n)
    t = _t(n, sr)

    # --- cuerpo: caida exponencial de tono (curva, no escalon) ---
    fenv = f1 + (f0 - f1) * np.exp(-t / max(pitch_tau, 1e-4))
    body = dc.osc("sine", fenv, n, sr=sr)

    # envolvente de amplitud: dos constantes (pegada inicial + cola corta)
    amp = 0.72 * np.exp(-t / max(decay * 0.26, 1e-3)) + \
        0.28 * np.exp(-t / max(decay * 0.85, 1e-3))
    amp *= 1.0 - np.exp(-t / 0.0012)                    # ataque sin click digital
    body *= amp

    # --- click: ruido en 1-3 kHz, muy corto (define el ataque en la mezcla) ---
    click_nz = _noise(n, dc.resp_bp(2100.0, 0.75), sr, seed)
    click_nz *= np.exp(-t / 0.0035) * (1.0 - np.exp(-t / 0.0004))
    # un poco de transitorio tonal agudo ayuda a "cortar" en cajas pequenas
    tick = dc.osc("sine", 2800.0, n, sr=sr) * np.exp(-t / 0.0018)

    y = body + float(click) * (0.85 * click_nz + 0.35 * tick)
    y = dc.soft_clip(y * 1.15, drive)
    return _finish(y, n, 0.95, sr)


# --------------------------------------------------------------------------
# 2. caja
# --------------------------------------------------------------------------

def snare(n, sr=dc.SR, tone=185.0, decay=0.20, gate=0.0, noise_lo=1200.0,
          noise_hi=9000.0, drive=1.6, seed=21):
    """Caja: dos senos (tone y ~1,78*tone) + ruido en banda, saturada.

    gate > 0 anade la cola de GATED REVERB de los 80: ruido brillante que se corta en
    seco a los `gate` segundos (2-3 ms de rampa para no clicar).
    """
    n = int(n)
    t = _t(n, sr)

    # --- tono: 185 Hz y su parcial inarmonica ~330 Hz ---
    f_lo, f_hi = float(tone), float(tone) * 1.7838
    ton = (0.62 * dc.osc("sine", f_lo, n, sr=sr) * dc.env_exp(n, decay * 0.55, 0.0008, sr)
           + 0.40 * dc.osc("sine", f_hi, n, sr=sr) * dc.env_exp(n, decay * 0.32, 0.0006, sr))

    # --- ruido de caja: banda pedida, con caida propia ---
    resp = _band_noise_resp(noise_lo, noise_hi, 0.85)
    nz = _noise(n, resp, sr, seed) * dc.env_exp(n, decay * 0.62, 0.0006, sr)

    y = 0.85 * ton + 0.95 * nz

    # --- cola gated reverb (opcional): brillante, plana y cortada en seco ---
    if gate and gate > 0.0:
        g_resp = lambda f: dc.resp_hp(max(noise_lo * 1.5, 2000.0), 2.0)(f) * \
            dc.resp_lp(min(max(noise_hi * 1.6, 9000.0), 16000.0), 1.5)(f)
        g = _noise(n, g_resp, sr, seed + 17)
        g_env = np.exp(-t / max(gate * 1.1, 0.02))
        y = y + 0.85 * g * g_env * _gate_window(n, sr, gate)

    y = dc.soft_clip(y * 1.1, drive)
    return _finish(y, n, 0.90, sr)


# --------------------------------------------------------------------------
# 3. charles / hi-hat
# --------------------------------------------------------------------------

def hat(n, sr=dc.SR, decay=0.045, lo=7000.0, hi=15000.0, open=False, seed=31):
    """Hi-hat: ruido en banda alta, limpio (sin energia por debajo de `lo`)."""
    n = int(n)
    t = _t(n, sr)

    lo = float(min(lo, hi * 0.8))
    hi = float(max(hi, lo * 1.2))
    # paso alto de orden alto: el charles debe quedar LIMPIO, sin energia por debajo de `lo`
    resp = lambda f: dc.resp_hp(lo, 6.0)(f) * dc.resp_lp(min(hi, sr * 0.45), 2.0)(f)
    nz = _noise(n, resp, sr, seed)

    tau = max(float(decay) * (6.5 if open else 1.0), 0.004)
    env = np.exp(-t / tau) * (1.0 - np.exp(-t / 0.00035))
    # un pelin de "metal" tonal inarmonico muy bajo para que no suene a ruido plano
    tone = (dc.osc("sine", 8250.0, n, sr=sr) + 0.6 * dc.osc("sine", 11320.0, n, sr=sr))
    y = nz + 0.05 * tone
    y *= env
    return _finish(y, n, 0.75 if open else 0.70, sr, fade_out=0.006)


# --------------------------------------------------------------------------
# 4. palmada
# --------------------------------------------------------------------------

def clap(n, sr=dc.SR, decay=0.18, spread=0.011, lo=900.0, hi=6000.0, seed=41):
    """Palmada: 4 rafagas de ruido separadas por `spread`; la ultima lleva la cola."""
    n = int(n)
    resp = _band_noise_resp(lo, hi, 0.95)
    spread = max(float(spread), 0.002)

    y = np.zeros(n)
    for i in range(4):
        nz = _noise(n, resp, sr, seed + 7 * i)
        tau = 0.0055 if i < 3 else max(float(decay) * 0.55, 0.012)
        env = dc.env_exp(n, tau, 0.0004, sr) * (0.72 if i < 3 else 1.0)
        # cada rafaga con su propio ruido (descorrelacionadas = suena a manos)
        i0 = int(round(i * spread * sr))
        if i0 >= n:
            break
        m = n - i0
        y[i0:] += nz[:m] * env[:m]
    # cuerpo seco bajo (la caja del pecho), apenas insinuado
    t = _t(n, sr)
    y += 0.10 * dc.osc("sine", 190.0, n, sr=sr) * np.exp(-t / max(decay * 0.35, 0.01))
    y = dc.soft_clip(y * 1.1, 1.35)
    return _finish(y, n, 0.85, sr)


# --------------------------------------------------------------------------
# 5. metal (golpe industrial)
# --------------------------------------------------------------------------

def metal(n, sr=dc.SR, f=131.0, ratio=1.4142, ratio2=2.732, index0=14.0, index_tau=0.28,
          decay=0.9, crush_hz=11000.0, crush_levels=96.0, drive=3.4, seed=51):
    """Golpe metalico inarmonico: dos pares de FM (ratios NO enteros), bitcrush
    (retencion + cuantizacion) ANTES del filtro de banda, y saturacion."""
    n = int(n)
    t = _t(n, sr)
    f = float(max(f, 20.0))

    # --- FM inharmonica: dos pares con ratios no enteros ---
    ix = float(index0) * np.exp(-t / max(index_tau, 1e-3))
    pair1 = dc.osc_fm(f, f * float(ratio), ix, n, sr=sr)
    pair2 = dc.osc_fm(f * float(ratio2), f * float(ratio) * float(ratio2), ix * 0.8, n, sr=sr)
    y = 0.62 * pair1 + 0.45 * pair2

    # --- bitcrush: retencion de muestras (sample rate reduction) + cuantizacion ---
    step = max(int(round(sr / max(float(crush_hz), 100.0))), 1)
    if step > 1:
        idx = (np.arange(n) // step) * step              # vectorizado, sin bucle
        y = y[idx]
    lev = max(float(crush_levels), 2.0)
    y = np.round(np.clip(y, -1.5, 1.5) * lev) / lev

    # --- filtro de banda: fase cero y ANTES de la envolvente ---
    # (filtrar el golpe ya envuelto redondearia el ataque; aqui la senal que se filtra es
    #  continua y la envolvente, aplicada despues, mantiene el transitorio intacto)
    hp_f = float(np.clip(max(f * 2.5, 220.0), 40.0, sr * 0.4))
    lp_f = float(np.clip(8500.0, hp_f * 1.5, sr * 0.45))
    resp = lambda ff: dc.resp_hp(hp_f, 2.0)(ff) * dc.resp_lp(lp_f, 2.0)(ff)
    y = dc.fft_shape(y, resp, sr=sr)[:n]

    env = (0.65 * np.exp(-t / max(decay * 0.22, 1e-3)) +
           0.35 * np.exp(-t / max(decay * 0.85, 1e-3)))
    env *= 1.0 - np.exp(-t / 0.0008)
    y *= env

    # suciedad de valvula: saturacion asimetrica (armonicos pares)
    y = dc.soft_clip(y * 1.6, drive, bias=0.12)
    return _finish(y, n, 0.95, sr)


# --------------------------------------------------------------------------
# 6. barrido (riser)
# --------------------------------------------------------------------------

def sweep(n, sr=dc.SR, f_start=200.0, f_end=7000.0, res=2.0, up=True, seed=61):
    """Riser de ruido: barrido de filtro resonante f_start -> f_end + tremolo.

    up=True  sube de brillo (f_start -> f_end) y crece hasta el final.
    up=False barrido descendente (f_end -> f_start) que se apaga.
    Se implementa como banco de bandas con ganancia variable en el tiempo (misma ley que
    dc.resp_bp): totalmente vectorizado, sin bucles por muestra.
    """
    n = int(n)
    t = _t(n, sr)
    T = max(n / float(sr), 1e-6)
    ramp = np.clip(t / T, 0.0, 1.0)

    fa, fb = (float(f_start), float(f_end)) if up else (float(f_end), float(f_start))
    fa, fb = max(fa, 25.0), max(fb, 25.0)
    fc = fa * (fb / fa) ** ramp                     # barrido exponencial por muestra
    lfc = np.log2(fc)

    # banco de bandas que cubre todo el recorrido
    lo_c = max(min(fa, fb) * 0.55, 40.0)
    hi_c = min(max(fa, fb) * 1.7, sr * 0.45)
    centers = np.geomspace(lo_c, hi_c, 12)
    res = max(float(res), 0.5)

    y = np.zeros(n)
    for i, c in enumerate(centers):
        nz = _noise(n, dc.resp_bp(float(c), 0.7), sr, seed + 13 * i)
        g = np.exp(-(((np.log2(float(c)) - lfc) * 2.0 * res) ** 2))
        y += nz * g

    # tremolo (la LFO acelera al subir / frena al bajar)
    rate = np.linspace(4.0, 9.0, n) if up else np.linspace(9.0, 4.0, n)
    trem = 1.0 + 0.30 * np.sin(2.0 * np.pi * np.cumsum(rate) / float(sr) + 0.7)

    amp = ramp ** 1.7 if up else (1.0 - 0.85 * ramp) ** 0.8
    y *= amp * trem
    return _finish(y, n, 0.80, sr, fade_out=0.005)


# --------------------------------------------------------------------------
# 7. impacto
# --------------------------------------------------------------------------

def impact(n, sr=dc.SR, f0=90.0, f1=32.0, decay=1.2, drive=2.0, seed=71):
    """Impacto grave largo (marca secciones): sub 30-40 Hz, armonicos y golpe seco."""
    n = int(n)
    t = _t(n, sr)

    fenv = f1 + (f0 - f1) * np.exp(-t / 0.085)
    sub = dc.osc("sine", fenv, n, sr=sr)
    body_env = (0.60 * np.exp(-t / max(decay * 0.30, 1e-3)) +
                0.40 * np.exp(-t / max(decay * 0.95, 1e-3)))
    body_env *= 1.0 - np.exp(-t / 0.0018)
    sub *= body_env

    # armonicos que dan "tamano" sin embarrar el sub
    h2 = dc.osc("sine", fenv * 2.0, n, sr=sr) * np.exp(-t / max(decay * 0.22, 1e-3)) * 0.26
    h3 = dc.osc("sine", fenv * 3.0, n, sr=sr) * np.exp(-t / max(decay * 0.14, 1e-3)) * 0.12
    h2 *= 1.0 - np.exp(-t / 0.0015)
    h3 *= 1.0 - np.exp(-t / 0.0012)

    # golpe seco (cuerpo del martillo)
    hit = _noise(n, _band_noise_resp(700.0, 5200.0, 0.8), sr, seed) * np.exp(-t / 0.020)
    hit *= 1.0 - np.exp(-t / 0.0004)

    y = sub + h2 + h3 + 0.55 * hit
    y = dc.soft_clip(y * 1.2, drive)
    return _finish(y, n, 1.05, sr)


# --------------------------------------------------------------------------
# 8. plato invertido
# --------------------------------------------------------------------------

def rev_cymbal(n, sr=dc.SR, lo=3000.0, seed=81):
    """Plato invertido: ruido que CRECE hasta el final y se corta (envolvente invertida)."""
    n = int(n)
    t = _t(n, sr)
    T = max(n / float(sr), 1e-6)
    ramp = np.clip(t / T, 0.0, 1.0)

    lo = max(float(lo), 500.0)
    resp = lambda f: dc.resp_hp(lo, 2.2)(f) * dc.resp_lp(min(16000.0, sr * 0.45), 1.2)(f)
    nz = _noise(n, resp, sr, seed)
    # aire por encima: segundo ruido con bandas mas altas, descorrelacionado
    nz2 = _noise(n, dc.resp_hp(lo * 2.2, 2.0), sr, seed + 5)

    env = ramp ** 2.4                            # crece (invertida) hasta el ultimo sample
    shimmer = 1.0 + 0.18 * np.sin(2.0 * np.pi * 3.1 * t)
    y = (nz + 0.45 * nz2) * env * shimmer
    # corte final muy corto: maximo justo antes del final, sin discontinuidad
    return _finish(y, n, 0.70, sr, fade_out=0.003)


# --------------------------------------------------------------------------
# autotest
# --------------------------------------------------------------------------

def _band_frac(x: np.ndarray, f_lo: float, f_hi: float, sr: int = dc.SR) -> float:
    """Fraccion de ENERGIA en [f_lo, f_hi) medida con filtro de fase cero.

    OJO: no se usa ventana de Hann a proposito; el ataque de una percusion vive en las
    primeras muestras y la ventana de Hann vale ~0 justo ahi (falsearia la medida).
    """
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 8:
        return 0.0
    resp = lambda f: dc.resp_hp(f_lo, 4.0)(f) * dc.resp_lp(f_hi, 4.0)(f)
    y = dc.fft_shape(x, resp, sr)
    tot = float(np.sum(x * x))
    return float(np.sum(y * y)) / tot if tot > 0.0 else 0.0


if __name__ == "__main__":
    n = dc.sec(1.5)
    print(f"voices_drums autotest  n={n}  sr={dc.SR}")

    _cases = [
        ("kick", lambda m: kick(m)),
        ("snare", lambda m: snare(m)),
        ("snare_gate", lambda m: snare(m, gate=0.35)),
        ("hat", lambda m: hat(m)),
        ("hat_open", lambda m: hat(m, open=True)),
        ("clap", lambda m: clap(m)),
        ("metal", lambda m: metal(m)),
        ("sweep_up", lambda m: sweep(m)),
        ("sweep_down", lambda m: sweep(m, up=False)),
        ("impact", lambda m: impact(m)),
        ("rev_cymbal", lambda m: rev_cymbal(m)),
    ]

    out = {}
    for name, fn in _cases:
        x = fn(n)
        assert isinstance(x, np.ndarray), name
        assert x.dtype == np.float64, f"{name}: dtype {x.dtype}"
        assert x.ndim == 1, f"{name}: ndim {x.ndim}"
        assert x.shape == (n,), f"{name}: forma {x.shape} != ({n},)"
        assert np.isfinite(x).all(), f"{name}: hay NaN/inf"
        pk = dc.peak(x)
        assert pk <= 1.2, f"{name}: pico {pk:.3f} > 1.2"
        assert pk > 0.3, f"{name}: pico {pk:.3f} demasiado bajo (voz muerta)"
        assert abs(float(x.mean())) < 2e-3, f"{name}: DC {x.mean():.2e}"
        out[name] = x
        print(f"{name:11s} len={len(x)} pico={pk:.3f} rms={dc.rms(x):.3f}")

    # --- comprobaciones de CARACTER (las exigencias sonoras del contrato) ---
    k = out["kick"]
    e_sub = _band_frac(k, 30.0, 130.0)
    e_att = _band_frac(k, 1000.0, 3000.0)
    print(f"  kick   E(30-130Hz)={e_sub:.4f}  E(1-3kHz)={e_att:.5f} "
          f"({10 * np.log10(max(e_att, 1e-12)):.1f} dB rel)")
    assert e_sub > 0.5, "kick sin cuerpo grave (>40 Hz)"
    assert e_att > 2e-4, "kick sin ataque audible en 1-3 kHz"

    h = out["hat"]
    e_low = _band_frac(h, 60.0, 5000.0)
    e_hi = _band_frac(h, 5000.0, min(16000.0, dc.SR * 0.45))
    print(f"  hat    E(<5kHz)={e_low:.6f}  E(>5kHz)={e_hi:.6f}")
    assert e_low < 0.02, "hat con energia por debajo de 5 kHz"

    g = out["snare_gate"]
    ig = int(0.35 * dc.SR) + int(0.01 * dc.SR)
    e_before = float(np.sum(g[:ig] ** 2))
    e_after = float(np.sum(g[ig:] ** 2))
    print(f"  snare_gate  E(antes)={e_before:.3e} E(tras corte)={e_after:.3e}")
    assert e_after < 0.02 * e_before, "el gated reverb no se corta en seco tras `gate`"

    r = out["rev_cymbal"]
    w = dc.sec(0.15)
    e_start = dc.rms(r[:w])
    e_end = dc.rms(r[-2 * w:-w])
    print(f"  rev_cymbal  rms(0-0.15s)={e_start:.4f} rms(1.35-1.5s)={e_end:.4f} "
          f"ratio={e_end / max(e_start, 1e-12):.1f}")
    assert e_end > 3.0 * e_start, "rev_cymbal no crece hacia el final (envolvente invertida)"
    assert abs(float(r[-1])) < 1e-6, "rev_cymbal debe acabar a cero"

    for nm in ("sweep_up", "sweep_down"):
        s = out[nm]
        a, b = dc.sec(0.2), dc.sec(1.3)
        low0 = _band_frac(s[:a], 100.0, 900.0)
        low1 = _band_frac(s[-a:], 100.0, 900.0)
        top0 = _band_frac(s[:a], 3000.0, 9000.0)
        top1 = _band_frac(s[-a:], 3000.0, 9000.0)
        print(f"  {nm:10s} graves(E ini/fin)={low0:.3f}/{low1:.3f}  "
              f"agudos(E ini/fin)={top0:.3f}/{top1:.3f}")
        if nm == "sweep_up":
            assert top1 > top0, "sweep_up no sube de brillo"
        else:
            assert top0 > top1, "sweep_down no baja de brillo"
        assert abs(float(s[-1])) < 1e-6, f"{nm} debe acabar a cero"

    for name in ("kick", "snare", "hat", "clap", "metal", "sweep_up", "impact", "rev_cymbal"):
        assert abs(float(out[name][-1])) < 5e-3, f"{name}: final no esta a cero"

    # --- firmas EXACTAS del contrato (nombres y defaults) ---
    import inspect

    _firmas = {
        "kick": "n, sr, f0, f1, pitch_tau, decay, drive, click, seed",
        "snare": "n, sr, tone, decay, gate, noise_lo, noise_hi, drive, seed",
        "hat": "n, sr, decay, lo, hi, open, seed",
        "clap": "n, sr, decay, spread, lo, hi, seed",
        "metal": ("n, sr, f, ratio, ratio2, index0, index_tau, decay, crush_hz, "
                  "crush_levels, drive, seed"),
        "sweep": "n, sr, f_start, f_end, res, up, seed",
        "impact": "n, sr, f0, f1, decay, drive, seed",
        "rev_cymbal": "n, sr, lo, seed",
    }
    for nm, want in _firmas.items():
        got = list(inspect.signature(globals()[nm]).parameters)
        assert ", ".join(got) == want, f"{nm}: firma {got} != contrato [{want}]"
    print(f"  firmas OK ({len(_firmas)} funciones, kwargs y defaults del contrato)")

    # --- robustez de longitudes (cortas y no multiplos de bloque) ---
    for m in (512, 1000, 4410, 66151):
        for name, fn in _cases:
            z = fn(m)
            assert z.shape == (m,), f"{name}({m}): {z.shape}"
            assert np.isfinite(z).all(), f"{name}({m}): no finito"
            assert dc.peak(z) <= 1.2, f"{name}({m}): pico {dc.peak(z):.3f}"
    print("  longitudes 512/1000/4410/66151 OK en las 11 variantes")

    print("voices_drums OK")
