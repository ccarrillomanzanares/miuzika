#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""voices_extras.py -- seis timbres que "Filament" (industrial/electro sucio) necesita.

Sintesis 100% offline: numpy puro + dsp_core (SIN scipy). Todas las voces devuelven MONO
float64 de longitud EXACTAMENTE n, finitas, con pico <= 1.2 y sin DC apreciable. El estereo
(pan, Haas, reverb) y el nivel final se aplican fuera, en render.py.

Voces:
  piano          adicion de ~10 parciales con inarmonicidad (B=4e-4) y decaimiento por parcial
  organ          acorde sostenido tipo drawbar (1, 2, 3, 4, 6, 8), tremolo y cutoff
  guitar_crunch  cuerda pulsada + saturacion fuerte + banda 300-3500 Hz, gated (figura corta)
  squelch        efecto-percusion: barrido resonante f_start -> f_end con caida corta
  growl          drone grave de realimentacion: FM lenta + distorsion + pico resonante
  vinyl          suelo de vinilo: siseo de banda ancha + crackles + retumbo grave

Uso:
    import voices_extras as vx
    x = vx.piano(dc.note("C4"), dc.sec(2.0), velocity=0.8)
    y = vx.organ([dc.note(n) for n in ("C3", "Eb3", "G3")], dc.sec(2.0))
    z = vx.vinyl(dc.sec(4.0))
"""
from __future__ import annotations

import numpy as np

import dsp_core as dc

__all__ = ["piano", "organ", "guitar_crunch", "squelch", "growl", "vinyl"]


# --------------------------------------------------------------------------
# utilidades internas
# --------------------------------------------------------------------------


def _mul(*resps):
    """Combina varias respuestas de magnitud en una sola (un unico fft_shape)."""
    def r(f):
        y = np.ones_like(np.asarray(f, dtype=np.float64))
        for fn in resps:
            y = y * np.asarray(fn(f), dtype=np.float64)
        return y
    return r


def _chord(freqs) -> list:
    """Lista de Hz a partir de nombres ('C3') o numeros. Acepta escalar."""
    if isinstance(freqs, str):
        items = [freqs]
    elif np.isscalar(freqs):
        items = [freqs]
    else:
        items = list(np.atleast_1d(freqs))
    out = [float(dc.hz_of(v)) for v in items]
    out = [f for f in out if np.isfinite(f) and f > 0.0]
    if not out:
        raise ValueError("organ: acorde vacio")
    return out


def _drive_norm(x: np.ndarray, pre: float = 0.9) -> np.ndarray:
    """Normaliza a `pre` para que la saturacion no dependa del nivel de entrada."""
    p = dc.peak(x)
    if p <= 0.0:
        return np.asarray(x, dtype=np.float64)
    return np.asarray(x, dtype=np.float64) * (float(pre) / p)


def _trim(x: np.ndarray, n: int) -> np.ndarray:
    """Recorta el render interno a la longitud pedida (exactamente n muestras)."""
    x = np.asarray(x, dtype=np.float64).ravel()
    if x.size < n:
        x = np.concatenate([x, np.zeros(n - x.size)])
    return np.ascontiguousarray(x[:n], dtype=np.float64)


def _finish(x: np.ndarray, n: int, sr: int, target: float,
            hp_hz: float = 22.0, fade_out: float = 0.002) -> np.ndarray:
    """Ajusta longitud, quita DC (pasa-alto), normaliza pico y micro-fade final."""
    x = np.asarray(x, dtype=np.float64).ravel()
    if x.size < n:
        x = np.concatenate([x, np.zeros(n - x.size)])
    elif x.size > n:
        x = x[:n].copy()
    x = dc.ensure_finite(x, "voices_extras")
    x = dc.hp(x, hp_hz, 2.0, sr)
    x -= float(np.mean(x))
    p = dc.peak(x)
    if p > 0.0:
        x = x * (float(target) / p)
    k = int(fade_out * sr)
    if 2 < k <= n // 4:
        x[-k:] *= np.linspace(1.0, 0.0, k)
    return np.ascontiguousarray(x, dtype=np.float64)


# --------------------------------------------------------------------------
# PIANO
# --------------------------------------------------------------------------
_MIN_LEN = 256           # muestras minimas de render interno
_PIANO_B = 4.0e-4        # inarmonicidad tipica de cuerda de piano
_PIANO_NPART = 10        # ~10 parciales (contrato)


def piano(freq, n, sr=dc.SR, velocity=1.0, bright=1.0, seed=401):
    """Piano sintetizado por adicion con decaimiento por parcial y martillo.

    freq: UNA frecuencia (Hz o 'C4'); se llama nota a nota, no por acordes.
    velocity: 0..1 (escala nivel y abre el timbre hacia los agudos).
    bright: 1.0 = neutro; >1 mas filo, <1 mas dulce.
    Cada parcial k usa f_k = k*f0*sqrt(1 + B*k^2) con B = 4e-4, su propia constante de
    decaimiento (los agudos se apagan antes) y dos cuerdas desafinadas 2 cents (batido).
    El transitorio de martillo es ruido de banda alta muy corto (10 ms).
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    f0 = float(dc.hz_of(freq))
    if not np.isfinite(f0) or f0 <= 0.0:
        raise ValueError(f"piano: frecuencia invalida {freq!r}")
    vel = float(np.clip(velocity, 0.0, 1.2))
    br = float(np.clip(bright, 0.15, 2.5))
    rng = np.random.default_rng(int(seed))
    t = np.arange(n, dtype=np.float64) / sr
    nyq = 0.45 * sr
    x = np.zeros(n, dtype=np.float64)

    for k in range(1, _PIANO_NPART + 1):
        fk = k * f0 * np.sqrt(1.0 + _PIANO_B * k * k)
        if fk >= nyq:
            break
        # brillo: los agudos pesan mas cuanto mas fuerte/brillante es la nota
        amp = (1.0 / k ** 1.05) * np.exp(0.14 * (k - 1) * (br - 1.0))
        amp *= 1.0 + 0.30 * (vel - 0.7) * (k - 1) / 9.0
        # decaimiento por parcial: los agudos caen antes
        tau = (1.15 / (1.0 + 0.60 * (k - 1))) * (0.85 + 0.30 * vel)
        env = np.exp(-t / max(tau, 1e-3))
        env *= 1.0 + 0.45 * np.exp(-t / 0.025)          # caida inicial del ataque
        for sgn in (-1.0, 1.0):                          # dos cuerdas -> batido lento
            fs = fk * 2.0 ** (sgn * 2.0 / 1200.0)
            ph = rng.uniform(0.0, 2.0 * np.pi)
            x += 0.5 * amp * env * np.sin(2.0 * np.pi * fs * t + ph)

    # transitorio de martillo: ruido corto y agudo, sin cola
    ham = dc.noise_spec(n, _mul(dc.resp_hp(1800.0, 2.0), dc.resp_lp(9000.0, 2.0)),
                         sr, int(seed) + 1)
    ham *= dc.env_exp(n, 0.010, attack=0.0005, sr=sr)
    x += 0.30 * (0.35 + 0.65 * vel) * ham

    tgt = min(0.88 * float(np.clip(vel, 0.05, 1.2)), 1.05)
    return _trim(_finish(x, n, sr, tgt, hp_hz=28.0), n_req)


# --------------------------------------------------------------------------
# ORGANO
# --------------------------------------------------------------------------
_ORGAN_DRAWBARS = ((1, 1.00), (2, 0.62), (3, 0.44), (4, 0.30), (6, 0.16), (8, 0.10))


def organ(freqs, n, sr=dc.SR, attack=0.5, release=1.2, cutoff=3000.0,
          tremolo_hz=5.2, tremolo_depth=0.15):
    """Acorde sostenido de organo (drawbar 1,2,3,4,6,8) con tremolo.

    freqs: LISTA de frecuencias (acorde) o un unico valor.
    Ataque/release suaves (meseta), tremolo = LFO de amplitud, cutoff = pasa-bajo estatico y
    pasa-alto a 90 Hz (el bajo del acorde no se come). Parciales exactos en 1/2/3/4/6/8 para
    que el timbre sea de organo y no de sierra.
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    fs = _chord(freqs)
    t = np.arange(n, dtype=np.float64) / sr
    x = np.zeros(n, dtype=np.float64)
    nyq = 0.45 * sr
    for j, f0 in enumerate(fs):
        ph0 = 0.61 * (j + 1.0)                       # desfase por nota (sin pico de ataque)
        for k, a in _ORGAN_DRAWBARS:
            fk = k * f0
            if fk >= nyq:
                continue
            x += a * np.sin(2.0 * np.pi * fk * t + ph0 * k)
    x /= np.sqrt(float(len(fs)))

    # tremolo (LFO de amplitud) + meseta con ataque/release suaves
    x *= 1.0 + float(tremolo_depth) * np.sin(2.0 * np.pi * float(tremolo_hz) * t)
    x *= dc.env_sustain(n, float(attack), float(release), sr=sr, curve=0.9)
    x = dc.fft_shape(x, dc.resp_lp(float(cutoff), 1.6), sr)
    return _trim(_finish(x, n, sr, 0.80, hp_hz=90.0), n_req)


# --------------------------------------------------------------------------
# GUITARRA CRUJIENTE (gated)
# --------------------------------------------------------------------------


def guitar_crunch(freq, n, sr=dc.SR, amp=1.0, cutoff=2600.0, seed=501):
    """Figura corta de guitarra distorsionada y gated (mono).

    Cuerda pulsada = excitacion de pua (ruido corto) + serie armonica con decaimiento rapido,
    despues saturacion fuerte (tanh) y banda 300-3500 Hz. Ataque inmediato, cola de 0.3-0.8 s
    cerrada en seco (gate). Sin acordes: una nota.
    amp: nivel relativo del resultado (0..1.2).
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    f0 = float(dc.hz_of(freq))
    if not np.isfinite(f0) or f0 <= 0.0:
        raise ValueError(f"guitar_crunch: frecuencia invalida {freq!r}")
    lvl = float(np.clip(amp, 0.0, 1.2))
    dur = n / sr
    t = np.arange(n, dtype=np.float64) / sr
    nyq = 0.45 * sr

    # --- cuerda: pua + armonicos con caida rapida (los agudos, antes) ---
    x = np.zeros(n, dtype=np.float64)
    for k in range(1, 30):
        fk = k * f0
        if fk >= nyq:
            break
        tau = 0.55 / (k ** 0.75)
        # peso del fundamental contenido: en una guitarra distorsionada manda el medio
        w = 0.45 if k == 1 else 1.0 / k ** 0.90
        x += w * np.sin(2.0 * np.pi * fk * t + 0.7 * k) * np.exp(-t / tau)
    pick = dc.noise_spec(n, _mul(dc.resp_bp(f0 * 4.0, 0.55), dc.resp_lp(7000.0, 2.0),
                                dc.resp_hp(320.0, 2.0)), sr, int(seed) + 1)
    pick *= dc.env_exp(n, 0.025, attack=0.0006, sr=sr)
    x = _drive_norm(x, 0.85) + 0.70 * pick
    x += 0.22 * dc.noise_spec(n, _mul(dc.resp_hp(400.0, 2.0), dc.resp_lp(6000.0, 2.0)),
                              sr, int(seed) + 2) * dc.env_exp(n, 0.05, attack=0.001, sr=sr)

    # --- saturacion fuerte (el crunch) ---
    y = dc.soft_clip(_drive_norm(x, 0.95), 6.0)

    # --- gate: cola corta y cierre en seco (rampa de 8 ms: sin click) ---
    gate_t = min(0.40, 0.80 * dur) if dur >= 0.12 else max(dur * 0.92, 1e-3)
    y *= dc.env_exp(n, 0.16, attack=0.0015, sr=sr)
    y *= np.clip((gate_t - t) / 0.008, 0.0, 1.0)

    # --- banda 300-3500 Hz (despues del gate, para que el cierre tambien quede en banda) ---
    # tres pasa-alto en cascada: el fundamental (261.6 Hz en C4) queda muy por debajo de 300
    band_lp = min(float(cutoff), 3500.0)
    hpf = dc.resp_hp(330.0, 3.0)
    y = dc.fft_shape(y, _mul(hpf, hpf, hpf, dc.resp_lp(3500.0, 3.0),
                             dc.resp_lp(band_lp, 1.5)), sr)
    return _trim(_finish(y, n, sr, 0.90 * max(lvl, 0.05), hp_hz=120.0), n_req)


# --------------------------------------------------------------------------
# SQUELCH (efecto-percusion)
# --------------------------------------------------------------------------


def squelch(n, sr=dc.SR, f_start=420.0, f_end=70.0, res=6.0, decay=0.25, seed=601):
    """Bass squelch: barrido de tono f_start -> f_end con filtro resonante y caida corta.

    Es un efecto-percusion, no una nota: ruido excitado por un pasa-banda resonante (Q = res)
    cuyo centro barre exponencialmente, mas una componente tonal que hace legible la altura.
    El barrido ocupa la parte audible del buffer (85% como maximo), asi que tambien funciona
    en buffers cortos. `decay` es la constante de caida de la envolvente (segundos).
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    dur = n / sr
    f0 = float(np.clip(f_start, 20.0, 0.45 * sr))
    f1 = float(np.clip(f_end, 20.0, 0.45 * sr))
    dec = max(float(decay), 0.015)
    sweep_t = float(np.clip(max(2.2 * dec, 0.12), 0.03, max(0.85 * dur, 0.03)))

    t = np.arange(n, dtype=np.float64) / sr
    u = np.clip(t / sweep_t, 0.0, 1.0)
    f = f0 * (f1 / f0) ** u                       # barrido exponencial (constante por octava)

    src = dc.noise_spec(n, _mul(dc.resp_hp(55.0, 1.5), dc.resp_lp(7000.0, 1.5)), sr, int(seed))
    y = dc.svf(src, f, np.clip(float(res), 0.7, 12.0), mode="bp", sr=sr)
    y = _drive_norm(y, 0.75) + 0.95 * dc.osc("sine", f, n, sr=sr)

    y *= dc.env_exp(n, dec, attack=0.004, sr=sr)
    y = dc.soft_clip(_drive_norm(y, 0.95), 1.8)
    return _trim(_finish(y, n, sr, 0.92, hp_hz=30.0), n_req)


# --------------------------------------------------------------------------
# GROWL (gruñido de realimentacion)
# --------------------------------------------------------------------------


def growl(n, sr=dc.SR, f=55.0, drive=3.0, res=5.0, lfo_hz=0.3, seed=701):
    """Drone grave sostenido con caracter de gruñido de realimentacion.

    Oscilador grave + FM/wobble lento (lfo_hz) + sub una octava abajo + distorsion + dos picos
    resonantes (formantes del gruñido). Ataque suave (sin click) y sin cola: la cola la pone el
    render, aqui se cierra en 3 ms.
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    f0 = float(dc.hz_of(f))
    if not np.isfinite(f0) or f0 <= 0.0:
        raise ValueError(f"growl: frecuencia invalida {f!r}")
    dr = float(np.clip(drive, 0.5, 12.0))
    q = float(np.clip(res, 0.7, 10.0))
    lh = max(float(lfo_hz), 0.02)
    rng = np.random.default_rng(int(seed))
    t = np.arange(n, dtype=np.float64) / sr

    lfo = np.sin(2.0 * np.pi * lh * t + rng.uniform(0.0, 2.0 * np.pi))
    fcar = f0 * (1.0 + 0.035 * lfo)                       # wobble de altura
    # indice de FM que respira con un LFO mas rapido: el "gruñido" cambia de filo
    idx = 1.6 * (1.0 + 0.5 * (0.5 + 0.5 * np.sin(2.0 * np.pi * 1.7 * lh * t)))
    x = dc.osc_fm(fcar, f0 * 2.0, idx, n, sr=sr)
    x += 0.60 * dc.osc("sine", f0 * 0.5, n, sr=sr)         # sub una octava abajo
    x += 0.35 * np.sin(2.0 * np.pi * f0 * 1.005 * t)      # capa afinada: batido lento

    y = dc.soft_clip(_drive_norm(x, 0.95), dr)
    y = dc.fft_shape(y, _mul(dc.resp_lp(900.0, 2.0),
                             dc.resp_peak(f0 * 2.0, q, 6.0),
                             dc.resp_peak(f0 * 4.0, q, 3.0)), sr)
    y *= dc.env_sustain(n, min(0.25, 0.35 * (n / sr)),
                        min(0.03, 0.20 * (n / sr)), sr=sr, curve=0.7)
    return _trim(_finish(y, n, sr, 0.95, hp_hz=24.0, fade_out=0.003), n_req)


# --------------------------------------------------------------------------
# VINYL (suelo de ruido de vinilo)
# --------------------------------------------------------------------------


def vinyl(n, sr=dc.SR, hiss=0.35, crackle=0.6, seed=801):
    """Suelo de vinilo: siseo de banda ancha + crackles dispersos + retumbo grave.

    hiss: nivel del siseo (0..1). crackle: densidad/ganancia de los impulsos (0..1).
    El pico se normaliza (~0.85) y el espectro es de banda ancha: sin frecuencia dominante.
    """
    n = int(n)
    if n <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)
    n_req = n
    n = max(n, _MIN_LEN)          # render interno minimo: envolventes y filtros necesitan largo
    hs = float(np.clip(hiss, 0.0, 1.5))
    cr_lvl = float(np.clip(crackle, 0.0, 1.5))
    rng = np.random.default_rng(int(seed))

    # --- siseo: banda ancha con un poco de pendiente (superficie desgastada) ---
    hiss_x = dc.noise_spec(n, _mul(dc.resp_hp(140.0, 1.4), dc.resp_lp(12000.0, 1.2),
                                  dc.resp_shelf(1800.0, -3.0, low=False)), sr, int(seed))
    # --- retumbo: ruido muy grave ---
    rumble = dc.noise_spec(n, dc.resp_lp(55.0, 3.0), sr, int(seed) + 3)

    # --- crackles: impulsos cortos dispersos (Poisson) + algunos chasquidos grandes ---
    cr = np.zeros(n, dtype=np.float64)
    rate = 14.0 + 30.0 * cr_lvl
    n_ev = int(max(0, rng.poisson(rate * (n / sr))))
    if n_ev > 0:
        pos = rng.integers(0, n, n_ev)
        for p0 in pos:
            L = int(rng.uniform(0.0012, 0.0060) * sr)
            p0 = int(p0)
            if p0 + L >= n or L < 4:
                continue
            big = 1.0 if rng.random() < 0.10 else 0.45
            a = big * float(rng.uniform(0.25, 1.0)) ** 2
            k = np.arange(L, dtype=np.float64)
            burst = rng.standard_normal(L) * np.exp(-k / (L * rng.uniform(0.18, 0.40)))
            cr[p0:p0 + L] += a * burst
    cr = dc.fft_shape(cr, _mul(dc.resp_hp(700.0, 2.0), dc.resp_lp(9000.0, 2.0)), sr)

    x = hs * _drive_norm(hiss_x, 0.60) + cr_lvl * _drive_norm(cr, 0.70) + 0.15 * _drive_norm(rumble, 0.5)
    if dc.peak(x) <= 0.0:
        return np.zeros(n_req, dtype=np.float64)
    return _trim(_finish(x, n, sr, 0.85, hp_hz=18.0, fade_out=0.005), n_req)


# --------------------------------------------------------------------------
# test / comprobaciones FFT
# --------------------------------------------------------------------------


def _check(name: str, x: np.ndarray, n: int) -> float:
    """Invariantes del contrato de datos + linea `nombre len= pico= rms=`."""
    assert isinstance(x, np.ndarray), f"{name}: no es ndarray"
    assert x.dtype == np.float64, f"{name}: dtype {x.dtype} != float64"
    assert x.ndim == 1, f"{name}: no es mono ({x.ndim}D)"
    assert len(x) == n, f"{name}: len {len(x)} != {n}"
    assert np.isfinite(x).all(), f"{name}: hay muestras no finitas"
    p, r = dc.peak(x), dc.rms(x)
    m = float(np.mean(x))
    assert p <= 1.2, f"{name}: pico {p:.3f} > 1.2"
    assert p > 0.02 and r > 1e-4, f"{name}: nivel nulo (pico {p:.4f}, rms {r:.4f})"
    assert abs(m) < 0.01, f"{name}: DC {m:+.4f} apreciable"
    print(f"{name:14s} len={len(x):6d} pico={p:.3f} rms={r:.3f} dc={m:+.2e}")
    return r


def _spec(x: np.ndarray, sr: int):
    """Espectro de magnitud con ventana de Hann (f, |X|)."""
    x = np.asarray(x, dtype=np.float64)
    w = np.hanning(len(x))
    F = np.abs(np.fft.rfft(x * w))
    f = np.fft.rfftfreq(len(x), 1.0 / sr)
    return f, F


def _peak_near(f, F, f0: float, rel: float = 0.02) -> float:
    """Maximo del espectro en la ventana f0*(1+-rel)."""
    m = (f >= f0 * (1.0 - rel)) & (f <= f0 * (1.0 + rel))
    return float(F[m].max()) if m.any() else 0.0


def _dom(x: np.ndarray, sr: int) -> float:
    """Frecuencia dominante (interpolacion parabolica del maximo espectral)."""
    x = np.asarray(x, dtype=np.float64)
    F = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    i = int(np.argmax(F[1:])) + 1
    a, b, c = F[i - 1], F[i], min(F[i + 1], F[i])
    den = a - 2.0 * b + c
    d = 0.5 * (a - c) / den if abs(den) > 1e-20 else 0.0
    return float((i + d) * sr / len(x))


def _band_frac(f, F, lo: float, hi: float) -> float:
    """Fraccion de energia (potencia) entre lo y hi Hz."""
    P = F * F
    m = (f >= lo) & (f <= hi)
    return float(P[m].sum() / max(P.sum(), 1e-30))


def _smooth(y: np.ndarray, k: int) -> np.ndarray:
    k = max(int(k) | 1, 3)
    ker = np.ones(k) / k
    return np.convolve(y, ker, mode="same")


if __name__ == "__main__":
    sr = dc.SR
    n = dc.sec(2.0)
    print(f"voices_extras -- sr={sr}  n={n} (2.0 s)  mono float64")
    print()

    # ---------------- render real de cada voz ----------------
    xp = piano(dc.note("C4"), n)
    _check("piano", xp, n)
    xp_soft = piano(dc.note("C2"), n, velocity=0.45, bright=0.7, seed=11)
    _check("piano_soft", xp_soft, n)

    xo = organ([dc.note(s) for s in ("C3", "Eb3", "G3")], n)      # Do menor
    _check("organ_Cm", xo, n)
    xo1 = organ(dc.note("C3"), n)                               # una nota (chequeo parciales)
    _check("organ_C3", xo1, n)

    xg = guitar_crunch(dc.note("C4"), n)
    _check("guitar_crunch", xg, n)

    xs = squelch(n)
    _check("squelch", xs, n)

    xw = growl(n)
    _check("growl", xw, n)

    xv = vinyl(n)
    _check("vinyl", xv, n)
    print()

    print("comprobaciones FFT:")

    # (a) el piano decae en el tiempo
    h = n // 2
    r1, r2 = dc.rms(xp[:h]), dc.rms(xp[h:])
    print(f"  [a] piano decaimiento: rms 1a mitad={r1:.4f}  2a mitad={r2:.4f}  "
          f"ratio={r1 / max(r2, 1e-12):.2f}x")
    assert r1 > 1.5 * r2, f"piano no decae (ratio {r1 / max(r2, 1e-12):.2f})"
    # (a2) serie armonica presente (no es un seno ni un organo)
    f, F = _spec(xp, sr)
    f0p = dc.note("C4")
    amps = [_peak_near(f, F, k * f0p) for k in range(1, 9)]
    amax = max(amps)
    harm = [a / amax for a in amps]
    print("      piano armonicos 1..8 (rel): " + " ".join(f"{v:.2f}" for v in harm))
    assert sum(1 for v in harm if v > 0.02) >= 5, "piano: serie armonica insuficiente"

    # (b) organo: parciales en 1/2/3/4/6/8 veces la fundamental (nota unica C3)
    f, F = _spec(xo1, sr)
    fo = dc.note("C3")
    want = (1, 2, 3, 4, 6, 8)
    part = {k: _peak_near(f, F, k * fo, rel=0.012) for k in want}
    pmax = max(part.values())
    rel = {k: part[k] / pmax for k in want}
    db = {k: 20.0 * np.log10(max(part[k] / pmax, 1e-9)) for k in want}
    print("  [b] organo parciales (dB rel al mayor, f0=%.1f Hz):" % fo)
    print("      " + "  ".join(f"{k}x:{db[k]:+6.1f}dB" for k in want))
    for k in want:
        assert rel[k] > 0.03, f"organo: parcial {k}x ausente ({db[k]:.1f} dB)"
    # los armonicos 5 y 7 no estan en el drawbar: deben quedar por debajo de 4x y 6x
    a5 = _peak_near(f, F, 5 * fo, rel=0.012)
    a7 = _peak_near(f, F, 7 * fo, rel=0.012)
    print(f"      control: 5x={20 * np.log10(max(a5 / pmax, 1e-9)):+.1f}dB  "
          f"7x={20 * np.log10(max(a7 / pmax, 1e-9)):+.1f}dB  (fuera del drawbar)")
    assert a5 < 0.5 * part[4] and a7 < 0.5 * part[6], "organo: parciales fuera del drawbar"

    # (c) guitar_crunch: >90% de la energia en 300-3500 Hz
    f, F = _spec(xg, sr)
    frac = _band_frac(f, F, 300.0, 3500.0)
    below = _band_frac(f, F, 0.0, 300.0)
    above = _band_frac(f, F, 3500.0, sr / 2.0)
    print(f"  [c] guitar_crunch banda 300-3500 Hz: {100 * frac:.1f}% de la energia "
          f"(<300: {100 * below:.1f}%,  >3500: {100 * above:.1f}%)")
    assert frac > 0.90, f"guitar_crunch fuera de banda ({100 * frac:.1f}%)"

    # (d) squelch: frecuencia dominante DECRECIENTE (primera vs ultima ventana audible)
    wlen = int(0.04 * sr)
    hop = max(wlen // 4, 1)
    pico = dc.peak(xs)
    first = None
    last = None
    for i0 in range(0, n - wlen, hop):
        seg = xs[i0:i0 + wlen]
        if dc.rms(seg) > 0.03 * pico:
            if first is None:
                first = (i0, _dom(seg, sr))
            last = (i0, _dom(seg, sr))
    assert first is not None and last is not None and last[0] > first[0], "squelch: sin señal"
    print(f"  [d] squelch barrido: 1a ventana t={first[0] / sr:.3f}s f={first[1]:7.1f} Hz  ->  "
          f"ultima t={last[0] / sr:.3f}s f={last[1]:7.1f} Hz  (ratio {first[1] / max(last[1], 1e-9):.2f}x)")
    assert first[1] > 1.8 * last[1], f"squelch: la frecuencia dominante no baja ({first[1]:.0f} -> {last[1]:.0f})"

    # (e) growl: primeras muestras pequenas (sin click) + RMS sostenido en el centro
    k0 = int(0.004 * sr)
    p = dc.peak(xw)
    onset = float(np.max(np.abs(xw[:k0])))
    c0, c1 = int(0.35 * n), int(0.75 * n)
    rc = dc.rms(xw[c0:c1])
    print(f"  [e] growl: |x| max primeras {k0} muestras={onset:.4f} ({100 * onset / p:.1f}% del pico)"
          f"  rms centro(35-75%)={rc:.3f}  rms total={dc.rms(xw):.3f}")
    assert onset <= 0.10 * p, f"growl: click de arranque ({100 * onset / p:.1f}% del pico)"
    assert rc > 0.25 and rc >= 0.9 * dc.rms(xw), "growl: RMS no sostenido en el centro"

    # (f) vinyl: espectro sin pico tonal claro
    f, F = _spec(xv, sr)
    m = (f >= 100.0) & (f <= 15000.0)
    Fs = _smooth(F[m], 15)
    flat = float(Fs.max() / max(np.median(Fs), 1e-30))
    # referencia: un seno puro debe dar un pico muchisimo mayor (contraste del criterio)
    ref = np.sin(2.0 * np.pi * 440.0 * np.arange(n) / sr) * 0.5
    fr, Fr = _spec(ref, sr)
    mr = (fr >= 100.0) & (fr <= 15000.0)
    Frs = _smooth(Fr[mr], 15)
    flat_ref = float(Frs.max() / max(np.median(Frs), 1e-30))
    print(f"  [f] vinyl planitud: pico/mediana={flat:.2f}  (seno de referencia={flat_ref:.0f})")
    assert flat < 8.0, f"vinyl: pico tonal (pico/mediana {flat:.2f})"
    assert flat_ref > 20.0 * flat, "vinyl: el criterio de planitud no discrimina"

    # ---------------- robustez: buffers cortos y extremos ----------------
    print()
    for nm, y in (("piano_tiny", piano(dc.note("C4"), 96)),
                  ("organ_tiny", organ(["C3"], 128)),
                  ("guitar_short", guitar_crunch(dc.note("C2"), dc.sec(0.25))),
                  ("squelch_short", squelch(dc.sec(0.30))),
                  ("growl_short", growl(dc.sec(0.20))),
                  ("vinyl_short", vinyl(dc.sec(0.20), hiss=0.2, crackle=0.9))):
        assert len(y) and np.isfinite(y).all() and dc.peak(y) <= 1.2
        print(f"{nm:14s} len={len(y):6d} pico={dc.peak(y):.3f} rms={dc.rms(y):.3f}")

    # barrido corto: el squelch tambien baja en un buffer de 0.30 s
    xq = squelch(dc.sec(0.30))
    w = int(0.03 * sr)
    f_a = _dom(xq[:w], sr)
    f_b = _dom(xq[-w:], sr)
    print(f"  squelch 0.30s: primera ventana={f_a:6.1f} Hz  ultima={f_b:6.1f} Hz")
    assert f_a > 1.8 * f_b, "squelch corto: la frecuencia dominante no baja"

    # longitud exacta en buffers degenerados (1 muestra, 7, 64) para las seis voces
    for tiny in (1, 7, 64):
        for nm, y in (("piano", piano(dc.note("C4"), tiny)),
                      ("organ", organ(["C3", "Eb3"], tiny)),
                      ("guitar", guitar_crunch(dc.note("C4"), tiny)),
                      ("squelch", squelch(tiny)),
                      ("growl", growl(tiny)),
                      ("vinyl", vinyl(tiny))):
            assert isinstance(y, np.ndarray) and y.dtype == np.float64
            assert y.shape == (tiny,), f"{nm}: len {y.shape} != ({tiny},)"
            assert np.isfinite(y).all() and dc.peak(y) <= 1.2, f"{nm}: buffer degenerado"
    print("  buffers degenerados (n=1,7,64): longitud exacta, finitos, pico<=1.2 OK")

    print()
    print("VOICES_EXTRAS OK")
