#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""mix_master.py -- reverb por convolucion FFT, delay ping-pong, dinamica y escritura.

numpy puro (SIN scipy). Todo trabaja con el contrato de dsp_core:
  voz mono  -> (n,)     float64
  bus estereo -> (2, n) float64

Funciones publicas (contrato INTERFACES.md seccion 3):
  make_ir()        IR estereo descorrelacionada (reflexiones tempranas + cola con damp)
  convolve_fft()   convolucion por OVERLAP-ADD en bloques (memoria acotada en 3 minutos)
  pingpong()       delay con rebote L/R desde una voz mono (devuelve SOLO la parte humeda)
  bus_glue()       compresor de bus vectorizado (envolvente RMS por bloques + np.interp)
  limiter()        limitador de pico con lookahead vectorizado y techo garantizado
  stereo_width()   mid/side con el bajo forzado a mono
  measure()        metricas (pico, RMS, crest, DC, correlacion, clipping)
  write_song()     escritura WAV 16-bit envolviendo dc.write_wav16

Reglas de rendimiento: la cancion son ~7,8 M muestras/canal. Nada de bucles por muestra
en senales largas: se usan bloques (FFT overlap-add, envolventes cada 64-128 muestras
subidas con np.interp).
"""
from __future__ import annotations

import os

import numpy as np

import dsp_core as dc

__all__ = ["make_ir", "convolve_fft", "pingpong", "bus_glue", "limiter",
           "stereo_width", "measure", "write_song"]

# --------------------------------------------------------------------------
# utilidades internas
# --------------------------------------------------------------------------


def _as_stereo(x) -> np.ndarray:
    """Acepta (n,) o (2,n) y devuelve siempre (2,n) float64."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        return np.stack([x, x])
    if x.ndim != 2 or x.shape[0] != 2:
        raise ValueError(f"se esperaba (n,) o (2,n), llego {x.shape}")
    return x


def _next_pow2(n: int) -> int:
    return int(2 ** int(np.ceil(np.log2(max(int(n), 2)))))


def _next_fast_len(n: int) -> int:
    """Menor longitud 'suave' (solo factores 2, 3 y 5) >= n.

    Importante: np.fft sobre longitudes con factores primos grandes (una cancion
    de 7,95 M muestras) cae en Bluestein y tarda decenas de segundos; con una
    longitud 5-smooth baja a menos de un segundo.
    """
    n = max(int(n), 1)
    best = _next_pow2(n)
    p2 = 1
    while p2 < best:
        p3 = p2
        while p3 < best:
            p5 = p3
            while p5 < n:
                p5 *= 5
            if p5 < best:
                best = p5
            p3 *= 3
        p2 *= 2
    return best


def _fft_filter(x, resp, sr=dc.SR, pad=None):
    """Filtro estatico de fase cero por magnitud, con padding 'rapido'.

    Igual que dc.fft_shape pero eligiendo una longitud FFT suave: imprescindible
    para filtros sobre la cancion completa (dc.fft_shape usa n+16384, que con
    7,95 M muestras puede tardar ~20 s por llamada).
    """
    x = np.asarray(x, dtype=np.float64)
    n = int(x.size)
    if n == 0:
        return x.copy()
    if pad is None:
        pad = min(n, 1 << 14)
    nfft = _next_fast_len(n + pad)
    X = np.fft.rfft(x, nfft)
    f = np.fft.rfftfreq(nfft, 1.0 / sr)
    return np.fft.irfft(X * np.asarray(resp(f), dtype=np.float64), nfft)[:n]


def _ir_energy_norm(ir: np.ndarray) -> np.ndarray:
    """IR sin DC y con energia unidad por canal (nivel de salida predecible)."""
    ir = np.asarray(ir, dtype=np.float64)
    ir = ir - ir.mean(axis=1, keepdims=True)
    e = np.sqrt(np.sum(ir * ir, axis=1, keepdims=True))
    e[e < 1e-12] = 1.0
    return ir / e


# --------------------------------------------------------------------------
# 1. IR de reverberacion
# --------------------------------------------------------------------------
def make_ir(sr=dc.SR, dur=2.8, decay=3.4, predelay=0.02, damp=5200.0,
            seed=7, width=0.9):
    """IR estereo descorrelacionada: reflexiones tempranas + cola difusa.

    dur    : duracion de la cola en segundos (la IR mide dur + predelay)
    decay  : RT60 aproximado en segundos (caida de 60 dB)
    predelay: silencio inicial antes de la primera reflexion (s)
    damp   : frecuencia (Hz) a la que la cola pierde agudos con el tiempo
    width  : 0 = canales identicos, 1 = totalmente descorrelacionados
    Devuelve (2, N) float64, finita, sin DC, energia unidad por canal.
    """
    sr = int(sr)
    n_tail = max(dc.sec(dur, sr), 64)
    pre = max(int(round(predelay * sr)), 0)
    n = n_tail + pre

    rng = np.random.default_rng(seed)
    t = np.arange(n_tail, dtype=np.float64) / sr

    # envolvente de la cola: subida suave de 8 ms y caida exponencial (RT60 = decay)
    env = (1.0 - np.exp(-t / 0.008)) * np.exp(-6.907755 * t / max(decay, 1e-3))

    # progresion del amortiguamiento: la cola empieza brillante y se va apagando
    dmix = np.clip(t / max(dur * 0.75, 1e-3), 0.0, 1.0) ** 1.2

    # respuestas de filtrado: version brillante (hasta ~9 kHz) y version apagada
    resp_hi = lambda f: dc.resp_hp(70.0, 2.0)(f) * dc.resp_lp(min(9000.0, 0.45 * sr), 2.0)(f)
    resp_lo = lambda f: dc.resp_hp(70.0, 2.0)(f) * dc.resp_lp(max(damp, 120.0), 2.0)(f)

    w = float(np.clip(width, 0.0, 1.0))
    rho = np.clip(1.0 - w, 0.0, 1.0)              # correlacion entre canales
    rho_c = float(np.sqrt(max(1.0 - rho * rho, 0.0)))

    ir = np.zeros((2, n), dtype=np.float64)
    common = rng.standard_normal(n_tail)
    for c in range(2):
        indep = rng.standard_normal(n_tail)
        nz = rho * common + rho_c * indep          # ruido propio de cada canal
        hi = _fft_filter(nz, resp_hi, sr)
        lo = _fft_filter(nz, resp_lo, sr)
        tail = (hi * (1.0 - dmix) + lo * dmix) * env
        ir[c, pre:] += tail

    # reflexiones tempranas discretas (patron fijo con jitter, distinto por canal)
    er_t = np.array([0.0071, 0.0113, 0.0161, 0.0209, 0.0287, 0.0371,
                     0.0457, 0.0581, 0.0727, 0.0913])
    er_t = np.maximum(er_t + rng.uniform(-1.5e-3, 1.5e-3, er_t.size), 0.002)
    er_t.sort()
    for c in range(2):
        for k, tt in enumerate(er_t):
            i = int(round(tt * sr))
            if i >= n_tail:
                break
            amp = (0.42 + 0.55 * rng.random()) * np.exp(-tt / max(decay * 0.9, 1e-3))
            if rng.random() < 0.5:
                amp = -amp
            ir[c, pre + i] += amp * (0.75 + 0.5 * rng.random())

    return _ir_energy_norm(ir)


# --------------------------------------------------------------------------
# 2. convolucion por overlap-add
# --------------------------------------------------------------------------
def convolve_fft(x, ir, sr=dc.SR, block_s=20.0):
    """Convolucion FFT con OVERLAP-ADD por bloques de block_s segundos.

    x : (n,) mono o (2,n) estereo.  ir : (2,N) o (N,).
    Devuelve (2, n): mono -> convolucionado con las dos IR (estereo real);
    estereo -> L con ir[0], R con ir[1]. La IR se normaliza a energia unidad
    de forma interna, asi que la salida tiene un nivel predecible.
    """
    sr = int(sr)
    sig_in = np.asarray(x, dtype=np.float64)
    mono_in = sig_in.ndim == 1
    if mono_in:
        sig = np.stack([sig_in, sig_in])
    else:
        sig = _as_stereo(sig_in)

    ir_st = _as_stereo(ir)
    ir_st = _ir_energy_norm(ir_st)

    n = int(sig.shape[1])
    n_ir = int(ir_st.shape[1])
    out = np.zeros((2, n), dtype=np.float64)
    if n == 0:
        return out

    bs = int(max(min(int(round(block_s * sr)), n), 256))
    nfft = _next_pow2(bs + n_ir - 1)

    for c in range(2):
        H = np.fft.rfft(ir_st[c], nfft)
        xc = sig[c]
        for i0 in range(0, n, bs):
            seg = xc[i0:i0 + bs]
            L = int(seg.size)
            Y = np.fft.irfft(np.fft.rfft(seg, nfft) * H, nfft)
            m = min(L + n_ir - 1, n - i0)          # recorta la cola al final del bus
            out[c, i0:i0 + m] += Y[:m]

    return dc.ensure_finite(out, "convolve_fft")


# --------------------------------------------------------------------------
# 3. delay ping-pong
# --------------------------------------------------------------------------
def pingpong(mono, time_s=0.406, feedback=0.42, mix=0.35, damp=3800.0,
             taps=6, sr=dc.SR):
    """Delay con rebote izquierda/derecha a partir de una voz MONO.

    Devuelve SOLO la parte humeda (2, n), para sumarla al bus seco: el nivel se
    normaliza a mix * pico(mono), asi `mix` es la relacion humedo/seco.
    Cada eco va alternando de canal, con realimentacion `feedback` y
    amortiguamiento progresivo de agudos (`damp`).
    """
    sr = int(sr)
    m = np.asarray(mono, dtype=np.float64).ravel()
    n = int(m.size)
    out = np.zeros((2, n), dtype=np.float64)
    if n == 0:
        return out

    pk_in = dc.peak(m)
    if pk_in <= 1e-9:
        return out

    d = int(max(round(time_s * sr), 1))
    taps = int(max(taps, 1))

    # la fuente del delay ya limpia de graves (que no se acumule barro) y una
    # version apagada para los ecos tardios
    src = _fft_filter(m, dc.resp_hp(110.0, 2.0), sr)
    src = src - src.mean()                        # sin DC (el pasa-alto ya lo quita)
    src_soft = _fft_filter(src, dc.resp_lp(max(damp, 200.0), 2.0), sr)

    for k in range(1, taps + 1):
        off = k * d
        if off >= n:
            break
        w = (k - 1) / max(taps - 1, 1)            # 0 en el 1er eco, 1 en el ultimo
        src_k = src * (1.0 - w) + src_soft * w
        a = float(feedback) ** (k - 1)
        c = 0 if (k % 2 == 1) else 1              # rebote L/R
        out[c, off:] += a * src_k[:n - off]
        out[1 - c, off:] += 0.18 * a * src_k[:n - off]

    p = dc.peak(out)
    if p > 0:
        out *= (float(mix) * pk_in) / p
    return out


# --------------------------------------------------------------------------
# 4. compresor de bus
# --------------------------------------------------------------------------
_BLK_C = 128


def bus_glue(st, thresh_db=-16.0, ratio=2.0, attack=0.02, release=0.18,
             makeup_db=0.0, sr=dc.SR):
    """Compresor de bus VECTORIZADO (pegamento suave de la mezcla).

    Envolvente = RMS estereo cada 128 muestras; ganancia calculada en dB y
    suavizada a ritmo de bloque (ataque/liberacion); la curva se sube a la
    frecuencia de muestreo con np.interp. Cero bucles por muestra.
    """
    sr = int(sr)
    x = _as_stereo(st)
    n = int(x.shape[1])
    if n == 0:
        return x.copy()

    blk = _BLK_C
    nb = (n + blk - 1) // blk
    pad = nb * blk - n
    xp = np.pad(x, ((0, 0), (0, pad)), mode="edge") if pad else x

    # envolvente RMS por bloque (potencia media de los dos canales)
    pw = 0.5 * (xp[0] * xp[0] + xp[1] * xp[1])
    env = np.sqrt(pw.reshape(nb, blk).mean(axis=1))

    env_db = 20.0 * np.log10(np.maximum(env, 1e-9))
    over = np.maximum(env_db - float(thresh_db), 0.0)
    gr_db = over * (1.0 - 1.0 / max(float(ratio), 1.0))       # reduccion en dB
    target = dc.db2lin(-gr_db)

    # suavizado de la ganancia a ritmo de bloque (una iteracion por bloque, ~62k)
    rate = sr / float(blk)
    a_att = 1.0 - np.exp(-1.0 / max(float(attack), 1e-4) * rate)
    a_rel = 1.0 - np.exp(-1.0 / max(float(release), 1e-4) * rate)
    g = np.empty(nb, dtype=np.float64)
    cur = 1.0
    for i in range(nb):
        tgt = target[i]
        cur += (tgt - cur) * (a_att if tgt < cur else a_rel)
        g[i] = cur

    # subida a la frecuencia de muestreo (centro de cada bloque)
    centers = (np.arange(nb, dtype=np.float64) + 0.5) * blk - 0.5
    gain = np.interp(np.arange(n, dtype=np.float64), centers, g)

    out = x * gain
    if makeup_db:
        out *= dc.db2lin(float(makeup_db))
    return dc.ensure_finite(out, "bus_glue")


# --------------------------------------------------------------------------
# 5. limitador de pico
# --------------------------------------------------------------------------
_BLK_L = 64


def limiter(st, ceiling_db=-1.0, lookahead_ms=3.0, release=0.12, sr=dc.SR):
    """Limitador de pico con lookahead vectorizado.

    Pico por bloque de 64 muestras -> minimo deslizante hacia delante (lookahead)
    -> liberacion exponencial a ritmo de bloque -> np.interp a la frecuencia de
    muestreo -> correccion por bloque. El techo queda GARANTIZADO.
    """
    sr = int(sr)
    x = _as_stereo(st)
    n = int(x.shape[1])
    ceil_lin = dc.db2lin(float(ceiling_db))
    if n == 0:
        return x.copy()

    blk = _BLK_L
    nb = (n + blk - 1) // blk
    pad = nb * blk - n
    xp = np.pad(x, ((0, 0), (0, pad))) if pad else x

    pk = np.abs(xp).max(axis=0).reshape(nb, blk).max(axis=1)
    g = np.minimum(1.0, ceil_lin / np.maximum(pk, 1e-12))

    # minimo deslizante hacia delante: la reduccion llega ANTES del pico
    la = max(int(round(float(lookahead_ms) * sr / 1000.0)), 1)
    lb = max(int(np.ceil(la / blk)), 1)
    gm = g.copy()
    for j in range(1, lb + 1):
        gm[:-j] = np.minimum(gm[:-j], g[j:])

    # liberacion: la ganancia vuelve despacio (la bajada es inmediata, ya anticipada)
    rate = sr / float(blk)
    a_rel = 1.0 - np.exp(-1.0 / max(float(release), 1e-4) * rate)
    out_g = np.empty(nb, dtype=np.float64)
    cur = 1.0
    for i in range(nb):
        tgt = gm[i]
        if tgt < cur:
            cur = tgt
        else:
            cur += (tgt - cur) * a_rel
        out_g[i] = cur

    centers = (np.arange(nb, dtype=np.float64) + 0.5) * blk - 0.5
    gain = np.interp(np.arange(n, dtype=np.float64), centers, out_g)
    y = x * gain

    # correccion final por bloque: interpolacion suave puede dejar puntas fuera
    pk2 = np.abs(y).max(axis=0)
    corr = np.minimum(1.0, ceil_lin / np.maximum(pk2, 1e-12))
    if (corr < 1.0).any():
        y *= np.repeat(corr, blk)[:n]

    y = dc.ensure_finite(y, "limiter")
    p = dc.peak(y)
    if p > ceil_lin:                              # red de seguridad (trim estatico minimo)
        y *= ceil_lin / p
    return y


# --------------------------------------------------------------------------
# 6. anchura estereo (mid/side, bajo mono)
# --------------------------------------------------------------------------
def stereo_width(st, amount=0.0, sr=dc.SR):
    """mid/side. amount -1..+1 (<0 mas mono, >0 mas ancho). El bajo queda mono.

    La componente lateral por debajo de 140 Hz se elimina, de modo que bombos y
    bajos se suman en fase en cualquier reproductor. Ojo: amount=0 no es la
    identidad, es "ancho de referencia sin graves en el side".
    """
    x = _as_stereo(st)
    a = float(np.clip(amount, -1.0, 1.0))
    mid = 0.5 * (x[0] + x[1])
    side = 0.5 * (x[0] - x[1])
    side_low = _fft_filter(side, dc.resp_lp(140.0, 4.0), sr)
    side_hi = side - side_low                     # laterales sin graves -> bajo mono
    g = 1.0 + a
    y = np.stack([mid + g * side_hi, mid - g * side_hi])
    return dc.ensure_finite(y, "stereo_width")


# --------------------------------------------------------------------------
# 7. medicion
# --------------------------------------------------------------------------
def measure(st, sr=dc.SR):
    """Metricas de un bus estereo. Claves EXACTAS del contrato."""
    x = _as_stereo(st)
    if x.shape[1] == 0:
        return {"peak_db": -120.0, "rms_db": -120.0, "crest_db": 0.0,
                "rms_l_db": -120.0, "rms_r_db": -120.0,
                "dc_l": 0.0, "dc_r": 0.0, "corr": 0.0, "clip_samples": 0}
    L, R = x[0], x[1]
    pk = dc.peak(x)
    rms_all = float(np.sqrt(np.mean(0.5 * (L * L + R * R))))
    peak_db = dc.lin2db(pk)
    rms_db = dc.lin2db(rms_all)

    lc = L - L.mean()
    rc = R - R.mean()
    den = float(np.sqrt(np.sum(lc * lc) * np.sum(rc * rc)))
    corr = float(np.sum(lc * rc) / den) if den > 1e-12 else 0.0

    return {
        "peak_db": float(peak_db),
        "rms_db": float(rms_db),
        "crest_db": float(peak_db - rms_db),
        "rms_l_db": float(dc.lin2db(dc.rms(L))),
        "rms_r_db": float(dc.lin2db(dc.rms(R))),
        "dc_l": float(np.mean(L) * 1000.0),
        "dc_r": float(np.mean(R) * 1000.0),
        "corr": float(np.clip(corr, -1.0, 1.0)),
        "clip_samples": int(np.count_nonzero(np.abs(x) >= 0.99999)),
    }


# --------------------------------------------------------------------------
# 8. escritura
# --------------------------------------------------------------------------
def write_song(path, st, sr=dc.SR):
    """Escribe el master PCM 16-bit y devuelve las metricas reales del WAV.

    Envuelve dc.write_wav16. Solo si el pico supera 1.0 (donde el PCM recortaria
    de todos modos) se aplica un trim estatico a 0.999 para no recortar.
    """
    x = dc.ensure_finite(_as_stereo(st), "write_song")
    p = dc.peak(x)
    if p > 1.0:
        x = x * (0.999 / p)
        print(f"[mix_master] write_song: pico {dc.lin2db(p):+.2f} dBFS -> trim a -0.02 dBFS")
    return dc.write_wav16(path, x, sr)


# --------------------------------------------------------------------------
# autotest con senal LARGA (180 s) -- renderiza de verdad
# --------------------------------------------------------------------------
def _kick_template(sr, dur=0.45, f0=112.0, f1=47.0):
    k = dc.sec(dur, sr)
    tt = np.arange(k) / sr
    f = f1 + (f0 - f1) * np.exp(-tt / 0.035)
    ph = 2.0 * np.pi * np.cumsum(f) / sr
    return np.sin(ph) * np.exp(-tt / 0.16)


def _hat_template(sr, dur=0.06):
    k = dc.sec(dur, sr)
    nz = dc.noise_spec(k, dc.resp_bp(9000.0, 0.7), sr, seed=9)
    return nz * np.exp(-np.arange(k) / (sr * 0.012))


def _test_music(sr=dc.SR, seconds=180.0, seed=5):
    """Musica sintetica de prueba: ruido + senos + golpes (180 s estereo)."""
    n = dc.sec(seconds, sr)
    t = np.arange(n, dtype=np.float64) / sr
    slow = 0.55 + 0.45 * np.sin(2.0 * np.pi * t / 17.0) ** 2

    mono = 0.30 * np.sin(2.0 * np.pi * 55.0 * t) * slow
    mono += 0.22 * np.sin(2.0 * np.pi * 110.0 * t + 0.4 * np.sin(2.0 * np.pi * 0.13 * t))
    mono += 0.12 * np.sin(2.0 * np.pi * 164.81 * t) * (0.5 + 0.5 * np.sin(2.0 * np.pi * 3.1 * t))
    mono += 0.18 * dc.noise_spec(n, dc.resp_bp(2600.0, 0.8), sr, seed=3) * slow

    kick = _kick_template(sr)
    hat = _hat_template(sr)
    step = sr // 2
    for i in range(0, n - kick.size, step):
        mono[i:i + kick.size] += 0.55 * kick
    for i in range(sr // 4, n - hat.size, step):
        mono[i:i + hat.size] += 0.22 * hat

    nl = dc.noise_spec(n, dc.resp_lp(6000.0, 2.0), sr, seed=31)
    nr = dc.noise_spec(n, dc.resp_lp(6000.0, 2.0), sr, seed=32)
    L = mono + 0.10 * nl
    R = 0.97 * mono + 0.10 * nr
    st = np.stack([L, R])
    st = dc.normalize_peak(st, -1.6)              # pico ~0.83: deja aire al limitador
    st -= st.mean(axis=1, keepdims=True)          # material de prueba sin DC
    return st


if __name__ == "__main__":
    import time
    import wave

    t_start = time.perf_counter()
    st = _test_music(dc.SR, 180.0)
    n = st.shape[1]
    print(f"test: senal sintetica {n} muestras/canal = {n / dc.SR:.1f} s  "
          f"pico={dc.peak(st):.3f}")

    # --- 1. IR -----------------------------------------------------------
    ir = make_ir()
    assert ir.ndim == 2 and ir.shape[0] == 2, ir.shape
    assert ir.shape[1] == dc.sec(2.8) + dc.sec(0.02), ir.shape
    assert np.isfinite(ir).all(), "IR con NaN/inf"
    assert abs(ir[0].mean()) < 1e-3 and abs(ir[1].mean()) < 1e-3, (ir[0].mean(), ir[1].mean())
    xc = float(np.sum(ir[0] * ir[1]) / np.sqrt(np.sum(ir[0] ** 2) * np.sum(ir[1] ** 2)))
    print(f"  make_ir len={ir.shape[1]} pico={dc.peak(ir):.4f} "
          f"dc_l={ir[0].mean():+.2e} dc_r={ir[1].mean():+.2e} corr_LR={xc:+.3f}")
    assert abs(xc) < 0.5, "los canales de la IR deberian estar descorrelacionados"

    # la cola debe apagarse: energia del ultimo 10 % muy por debajo del primer 10 %
    q = ir.shape[1] // 10
    e_head = float(np.sum(ir[:, :q] ** 2))
    e_tail = float(np.sum(ir[:, -q:] ** 2))
    print(f"  make_ir energia primero/ultimo decil = {e_head:.4f} / {e_tail:.6f}")
    assert e_tail < 0.05 * e_head, "la cola de la IR no decae"

    # --- 2. convolucion de 180 s (overlap-add) ---------------------------
    t0 = time.perf_counter()
    wet = convolve_fft(st, ir)
    dt_conv = time.perf_counter() - t0
    assert wet.shape == (2, n), wet.shape
    assert np.isfinite(wet).all(), "convolucion con NaN/inf"
    print(f"  convolve_fft 180 s estereo: {dt_conv:.2f} s  "
          f"pico={dc.peak(wet):.3f} rms={dc.rms(wet):.3f} (limite 60 s)")
    assert dt_conv < 60.0, f"convolve_fft demasiado lento: {dt_conv:.1f} s"

    # mono -> estereo tambien
    wet_m = convolve_fft(st[0], ir[0])
    assert wet_m.shape == (2, n) and np.isfinite(wet_m).all()
    print(f"  convolve_fft mono->estereo ok  pico={dc.peak(wet_m):.3f}")

    # --- 3. ping-pong ----------------------------------------------------
    dly = pingpong(st[0])
    assert dly.shape == (2, n) and np.isfinite(dly).all()
    assert dc.peak(dly) <= 0.35 * dc.peak(st[0]) * 1.001
    d_smp = int(round(0.406 * dc.SR))
    assert dc.peak(dly[:, :d_smp]) == 0.0, "el primer eco no respeta el tiempo de delay"
    print(f"  pingpong len={dly.shape[1]} pico={dc.peak(dly):.3f} "
          f"dc_l={dly[0].mean():+.1e} primer_eco={d_smp / dc.SR:.3f} s")

    # --- 4. compresor de bus: el crest debe bajar ------------------------
    m0 = measure(st)
    comp = bus_glue(st, thresh_db=-18.0, ratio=2.5, attack=0.01, release=0.20,
                    makeup_db=0.0)
    m1 = measure(comp)
    print(f"  bus_glue crest antes={m0['crest_db']:.2f} dB  despues={m1['crest_db']:.2f} dB"
          f"  (pico {m0['peak_db']:+.2f} -> {m1['peak_db']:+.2f} dBFS)")
    assert m1["crest_db"] < m0["crest_db"], "bus_glue no reduce el crest"
    assert np.isfinite(comp).all()

    # --- 5. limitador: techo garantizado ---------------------------------
    ceiling_db = -1.0
    ceil_lin = dc.db2lin(ceiling_db)
    loud = comp * dc.db2lin(10.0)                 # sube 10 dB: pico muy por encima del techo
    pk_loud = dc.peak(loud)
    assert pk_loud > ceil_lin, "el material de prueba no llega al techo"
    lim = limiter(loud, ceiling_db=ceiling_db)
    p_lim = dc.peak(lim)
    assert p_lim <= ceil_lin * 1.000001, (dc.lin2db(p_lim), ceiling_db)
    assert np.isfinite(lim).all()
    print(f"  limiter pico_entrada={dc.lin2db(pk_loud):+.2f} dBFS -> "
          f"pico_salida={dc.lin2db(p_lim):+.4f} dBFS  techo={ceiling_db:+.1f} dBFS "
          f"({dc.lin2db(pk_loud) - dc.lin2db(p_lim):.2f} dB de reduccion, "
          f"clipeadas={int(np.count_nonzero(np.abs(lim) >= 0.99999))})")

    # --- 6. anchura estereo (sobre el bus con reverb, que si es ancho) ---
    corr_pre = measure(wet)["corr"]
    base = stereo_width(wet, 0.0)                 # referencia: side sin graves
    wide = stereo_width(wet, 0.5)
    mono_ish = stereo_width(wet, -1.0)
    mb, mw, mm = measure(base), measure(wide), measure(mono_ish)
    side_base = float(dc.rms(0.5 * (base[0] - base[1])))
    side_post = float(dc.rms(0.5 * (wide[0] - wide[1])))
    # el bajo debe seguir mono: correlacion del contenido < 100 Hz
    lo = _fft_filter(wide[:, :dc.sec(20.0)], dc.resp_lp(100.0, 4.0), dc.SR)
    lo_corr = measure(lo)["corr"]
    assert abs(mm["corr"] - 1.0) < 1e-3, mm["corr"]
    assert mw["corr"] < mb["corr"], (mb["corr"], mw["corr"])
    assert side_post > 1.4 * side_base and side_post < 1.6 * side_base, (side_base, side_post)
    assert lo_corr > 0.99, lo_corr
    print(f"  stereo_width corr {corr_pre:+.3f} (seco) -> {mb['corr']:+.3f} (0.0) / "
          f"{mw['corr']:+.3f} (+0.5) / {mm['corr']:+.3f} (-1.0)  "
          f"lateral {side_base:.4f} -> {side_post:.4f}  corr<100Hz={lo_corr:+.3f}")

    # --- 7. measure: las 9 claves ---------------------------------------
    m = measure(lim)
    keys = {"peak_db", "rms_db", "crest_db", "rms_l_db", "rms_r_db",
            "dc_l", "dc_r", "corr", "clip_samples"}
    assert set(m.keys()) == keys, set(m.keys()) ^ keys
    assert m["peak_db"] <= 0.0 and m["rms_db"] < m["peak_db"]
    assert 0.5 < m["crest_db"] < 60.0
    assert -1.0 <= m["corr"] <= 1.0
    assert abs(m["dc_l"]) < 5.0 and abs(m["dc_r"]) < 5.0, (m["dc_l"], m["dc_r"])
    print("  measure: " + "  ".join(f"{k}={v:.3f}" if isinstance(v, float) else f"{k}={v}"
                                    for k, v in m.items()))

    # --- 8. escritura y relectura del WAV -------------------------------
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mix_master_selftest.wav")
    excerpt = dc.fade(lim[:, :dc.sec(30.0)], in_s=0.01, out_s=0.25)
    info = write_song(path, excerpt)
    assert info["frames"] == excerpt.shape[1] and info["clipped"] == 0, info
    try:
        with wave.open(path, "rb") as w:
            got = (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes())
            raw = w.readframes(w.getnframes())
        print(f"  write_song wave: ch={got[0]} bits={got[1] * 8} sr={got[2]} "
              f"frames={got[3]} bytes={len(raw)}")
        assert got == (2, 2, dc.SR, excerpt.shape[1]), got
        assert len(raw) == got[3] * 4
        assert os.path.getsize(path) == 44 + len(raw)
    finally:
        if os.path.exists(path):
            os.remove(path)
    print(f"  WAV borrado: {not os.path.exists(path)}")

    print(f"mix_master OK  ({time.perf_counter() - t_start:.1f} s en total)")
