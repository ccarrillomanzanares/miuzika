#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""verify_song.py -- verificacion INDEPENDIENTE de un WAV cualquiera.

Uso:  python verify_song.py <ruta.wav>

Lee el fichero con el modulo estandar `wave` y saca todas las metricas de los
datos PCM reales del fichero. NO importa ninguno de los modulos de sintesis
(dsp_core, voices_*, mix_master): la medida no depende del codigo que genero
el audio. `song_data` se usa SOLO (y opcionalmente) para la tabla por secciones.

Salida por stdout, en este orden:
  1. cabecera      (canales, bits, sample rate, frames, duracion, bytes)
  2. niveles       (pico/RMS L-R, crest, DC, muestras clipeadas, correlacion)
  3. energia       (RMS por tramos de 5 s + silencio inicial/final > 1 s)
  4. espectro      (centro y pico espectral cada 10 s, ventana 8192 Hann)
  5. secciones     (song_data.SECTIONS con song_data.BAR -> segundos)
  6. figura PNG    (<nombre>_analisis.png junto al WAV, escala de dB real)
  7. VERIFY OK + sys.exit(0)

Funciona con cualquier WAV: mono o multicalnal, 8/16/24/32 bits, cualquier
sample rate y cualquier duracion (de 2 s a 3 minutos o mas).

Solo depende de: wave, numpy, PIL (y song_data, opcional).
"""

from __future__ import annotations

import math
import os
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# constantes de analisis
# ---------------------------------------------------------------------------
EPS = 1e-12
DB_FLOOR = -120.0             # suelo de medida: por debajo se reporta silencio digital
CLIP_LEVEL = 0.99999          # umbral de clipping del contrato
SILENCE_DB = -60.0            # umbral de silencio del contrato
SILENCE_MIN_S = 1.0           # duracion minima para reportar silencio
SEG_S = 5.0                   # tramo de la curva de energia
SPEC_EVERY_S = 10.0           # cada cuantos segundos se mide el espectro
SPEC_NFFT = 8192              # ventana de la medida espectral
SPEC_FMAX = 16000.0           # techo del espectrograma de la figura


# ---------------------------------------------------------------------------
# lectura del WAV
# ---------------------------------------------------------------------------
def load_wav(path):
    """Lee el WAV con `wave` y devuelve (datos (canales, frames) float64, meta)."""
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        nframes = wf.getnframes()
        comptype = wf.getcomptype()
        if comptype != "NONE":
            raise SystemExit("ERROR: WAV comprimido no soportado (%s)" % comptype)
        blobs = []
        while True:
            b = wf.readframes(1 << 18)
            if not b:
                break
            blobs.append(b)
    raw = b"".join(blobs)

    if sw == 1:                                    # 8 bit sin signo
        v = np.frombuffer(raw, dtype=np.uint8).astype(np.float64)
        v = (v - 128.0) / 128.0
    elif sw == 2:                                  # 16 bit
        v = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif sw == 3:                                  # 24 bit empaquetado
        a = np.frombuffer(raw, dtype=np.uint8)
        a = a[: (len(a) // 3) * 3].reshape(-1, 3)
        iv = (a[:, 0].astype(np.int32)
              | (a[:, 1].astype(np.int32) << 8)
              | (a[:, 2].astype(np.int32) << 16))
        iv = np.where(iv >= (1 << 23), iv - (1 << 24), iv)
        v = iv.astype(np.float64) / 8388608.0
    elif sw == 4:                                  # 32 bit entero
        v = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
    else:
        raise SystemExit("ERROR: ancho de muestra no soportado (%d bytes)" % sw)

    usable = (len(v) // nch) * nch
    v = v[:usable]
    if usable == 0:
        raise SystemExit("ERROR: el WAV no contiene muestras")
    data = v.reshape(-1, nch).T.copy()

    meta = {
        "path": path,
        "nch": nch,
        "sampwidth": sw,
        "sr": sr,
        "nframes": int(data.shape[1]),
        "bytes_file": os.path.getsize(path),
        "bytes_pcm": len(raw),
        "comptype": comptype,
    }
    return data, meta


def to_db(lin):
    """Lineal -> dBFS, con suelo DB_FLOOR (no devuelve -inf)."""
    return max(DB_FLOOR, 20.0 * math.log10(max(float(lin), EPS)))


def rms_db(x):
    """RMS en dBFS de un array (suelo EPS)."""
    if len(x) == 0:
        return to_db(0.0)
    return to_db(math.sqrt(float(np.mean(np.square(x)))))


def peak_db(x):
    """Pico en dBFS de un array."""
    if len(x) == 0:
        return to_db(0.0)
    return to_db(float(np.max(np.abs(x))))


def mono_of(data):
    """Suma de canales normalizada: representacion mono para el analisis."""
    return data.mean(axis=0)


# ---------------------------------------------------------------------------
# metricas de nivel
# ---------------------------------------------------------------------------
def levels(data):
    """Metricas de nivel leidas del fichero (canal 0 = L, canal 1 = R)."""
    nch = data.shape[0]
    L = data[0]
    R = data[1] if nch > 1 else data[0]

    peak_l = float(np.max(np.abs(L)))
    peak_r = float(np.max(np.abs(R)))
    peak = max(peak_l, peak_r)
    rms_l = math.sqrt(float(np.mean(np.square(L))))
    rms_r = math.sqrt(float(np.mean(np.square(R))))
    rms = math.sqrt(float(np.mean(np.square(data))))

    crest_db = to_db(peak / rms) if peak > 0.0 and rms > 0.0 else float("nan")

    clip_l = int(np.count_nonzero(np.abs(L) >= CLIP_LEVEL))
    clip_r = int(np.count_nonzero(np.abs(R) >= CLIP_LEVEL))
    clip = int(np.count_nonzero(np.abs(data) >= CLIP_LEVEL))

    if nch > 1:
        sl, sr_ = float(np.std(L)), float(np.std(R))
        if sl > EPS and sr_ > EPS:
            corr = float(np.mean((L - L.mean()) * (R - R.mean())) / (sl * sr_))
            corr = max(-1.0, min(1.0, corr))
        else:
            corr = float("nan")
    else:
        corr = float("nan")

    return {
        "peak_l": peak_l, "peak_r": peak_r, "peak": peak,
        "peak_l_db": to_db(peak_l), "peak_r_db": to_db(peak_r), "peak_db": to_db(peak),
        "rms_l": rms_l, "rms_r": rms_r, "rms": rms,
        "rms_l_db": to_db(rms_l), "rms_r_db": to_db(rms_r), "rms_db": to_db(rms),
        "crest_db": crest_db,
        "dc_l": float(np.mean(L)), "dc_r": float(np.mean(R)),
        "clip": clip, "clip_l": clip_l, "clip_r": clip_r,
        "corr": corr,
    }


def block_rms(x, sr, block_s):
    """RMS por bloques fijos de block_s segundos -> (dB array, t_inicio array)."""
    b = max(1, int(round(block_s * sr)))
    nb = len(x) // b
    if nb == 0:
        return np.array([rms_db(x)]), np.array([0.0])
    seg = x[: nb * b].reshape(nb, b)
    r = np.sqrt(np.mean(seg * seg, axis=1))
    dbs = np.maximum(DB_FLOOR, 20.0 * np.log10(np.maximum(r, EPS)))
    t = np.arange(nb, dtype=np.float64) * (b / float(sr))
    return dbs, t


def edge_silence(x, sr):
    """Duracion (s) del silencio inicial y final (< -60 dBFS en bloques de 100 ms)."""
    dbs, t = block_rms(x, sr, 0.1)
    total = len(x) / float(sr)
    loud = np.nonzero(dbs > SILENCE_DB)[0]
    if loud.size == 0:
        return total, total
    t0 = float(t[loud[0]])
    t_end = float(t[loud[-1]]) + 0.1
    return t0, max(0.0, total - min(total, t_end))


# ---------------------------------------------------------------------------
# medidas espectrales
# ---------------------------------------------------------------------------
def spectral_at(x, sr, t, nfft=SPEC_NFFT):
    """Centro espectral (Hz), frecuencia del pico (Hz) y RMS (dB) en t segundos."""
    n = len(x)
    if n == 0:
        return None
    nfft = int(min(nfft, n))
    if nfft < 64:
        return None
    start = int(round(t * sr)) - nfft // 2
    start = max(0, min(start, n - nfft))
    seg = x[start:start + nfft]
    win = np.hanning(len(seg))
    mag = np.abs(np.fft.rfft(seg * win))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
    tot = float(mag.sum())
    if tot <= EPS * len(mag):
        return None
    centroid = float(np.sum(freqs * mag) / tot)
    peak_f = float(freqs[int(np.argmax(mag))])
    return centroid, peak_f, rms_db(seg)


def spectrogram(x, sr, nfft=2048, max_frames=4000, fmax=SPEC_FMAX):
    """Espectrograma |STFT| en dB, (bins, frames), freqs y tiempos."""
    n = len(x)
    if n < 256:
        return None
    nfft = int(min(nfft, 1 << int(math.floor(math.log2(max(n, 2))))))
    nfft = max(64, nfft)
    hop = max(1, nfft // 2)
    if (n - nfft) // hop + 1 > max_frames:                 # ficheros muy largos
        hop = max(hop, (n - nfft) // max_frames + 1)
    sv = np.lib.stride_tricks.sliding_window_view(x, nfft)[::hop]
    nf = sv.shape[0]
    if nf < 1:
        return None
    win = np.hanning(nfft)
    nbins = nfft // 2 + 1
    S = np.empty((nf, nbins), dtype=np.float32)
    chunk = 512
    for i in range(0, nf, chunk):
        block = sv[i:i + chunk] * win
        S[i:i + chunk] = np.abs(np.fft.rfft(block, axis=1)).astype(np.float32)
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    keep = freqs <= min(fmax, sr / 2.0)
    keep[0] = True
    S = S[:, keep]
    freqs = freqs[keep]
    times = (np.arange(nf, dtype=np.float64) * hop + nfft / 2.0) / sr
    S_db = 20.0 * np.log10(np.maximum(S.astype(np.float64), EPS))
    return S_db.T, freqs, times          # (bins, frames)


# ---------------------------------------------------------------------------
# utilidades de figura
# ---------------------------------------------------------------------------
_VIRIDIS = np.array([
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
], dtype=np.float64)


def colormap_lut():
    """LUT 256x3 tipo viridis por interpolacion lineal de puntos de control."""
    xs = np.linspace(0.0, 1.0, len(_VIRIDIS))
    xi = np.linspace(0.0, 1.0, 256)
    lut = np.stack([np.interp(xi, xs, _VIRIDIS[:, k]) for k in range(3)], axis=1)
    return np.clip(lut, 0, 255).astype(np.uint8)


def get_font(size, bold=False):
    """Fuente TrueType del sistema; si no hay, la de PIL."""
    names = (("seguisb.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf") if bold
             else ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"))
    for nm in names:
        try:
            return ImageFont.truetype(nm, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


def pool_max(a, ncols):
    """Reduce un array 1-D a ncols columnas tomando el maximo de cada tramo."""
    n = len(a)
    if n <= ncols:
        return a.astype(np.float64)
    edges = np.linspace(0, n, ncols + 1).astype(int)
    out = np.empty(ncols, dtype=np.float64)
    for i in range(ncols):
        lo, hi = edges[i], max(edges[i] + 1, edges[i + 1])
        out[i] = float(np.max(a[lo:hi]))
    return out


def pool_minmax(a, ncols):
    """Reduce un array 1-D a ncols columnas -> (minimos, maximos)."""
    n = len(a)
    if n <= ncols:
        idx = np.arange(n)
        return a.astype(np.float64), a.astype(np.float64), idx
    edges = np.linspace(0, n, ncols + 1).astype(int)
    lo_a = np.empty(ncols)
    hi_a = np.empty(ncols)
    for i in range(ncols):
        lo, hi = edges[i], max(edges[i] + 1, edges[i + 1])
        seg = a[lo:hi]
        lo_a[i] = float(seg.min())
        hi_a[i] = float(seg.max())
    return lo_a, hi_a, edges[:-1]


def nice_step(span, target=12):
    """Paso 'bonito' para un eje de `span` unidades con ~target marcas."""
    raw = span / float(max(1, target))
    for c in (1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 1200):
        if c >= raw:
            return float(c)
    return float(math.ceil(raw))


# ---------------------------------------------------------------------------
# figura PNG
# ---------------------------------------------------------------------------
def make_figure(path, data, sr, bits, lev, sections, env_db, spec):
    """Dibuja espectrograma + envolvente RMS + forma de onda y guarda el PNG.

    La escala de dB sale de los datos (min/max reales de la envolvente), no se
    estira: si hay silencio, se dibuja abajo del todo.
    """
    n = data.shape[1]
    dur = n / float(sr)
    mono = mono_of(data)

    W, H = 1600, 1070
    ML, MR = 68, 18
    PW = W - ML - MR
    img = Image.new("RGB", (W, H), (10, 10, 12))
    dr = ImageDraw.Draw(img)

    f_title = get_font(19, True)
    f_sub = get_font(13)
    f_ax = get_font(12)
    f_sec = get_font(12, True)

    bg = (10, 10, 12)
    grid = (56, 56, 66)
    lab = (190, 190, 198)
    frame = (78, 78, 88)

    # ---- cabecera de la figura ------------------------------------------
    dr.text((12, 6), "Verificacion de audio   (escala de dB real)", font=f_title,
            fill=(238, 238, 244))
    sub = "%s   |   %.2f s   |   %d ch   |   %d Hz   |   %d bits   |   pico %.2f dBFS   |   RMS %.2f dBFS" % (
        os.path.basename(path), dur, data.shape[0], sr, bits,
        lev["peak_db"], lev["rms_db"])
    dr.text((12, 30), sub, font=f_sub, fill=(148, 148, 160))

    # ---- (a) espectrograma 0-16 kHz -------------------------------------
    a_title = 56
    a_top, a_h = 74, 384
    a_bot = a_top + a_h
    dr.text((ML, a_title), "(a) espectrograma 0-16 kHz de la cancion completa  (STFT 2048, Hann)",
            font=f_ax, fill=lab)
    if spec is not None:
        S_db, freqs, _times = spec
        db_max_s = float(np.max(S_db))
        db_min_s = max(float(np.min(S_db)), db_max_s - 90.0)
        rng_s = max(1e-9, db_max_s - db_min_s)
        norm = np.clip((S_db - db_min_s) / rng_s, 0.0, 1.0)
        rgb = colormap_lut()[(norm * 255.0).astype(np.uint8)]
        rgb = rgb[::-1, :, :]                       # graves abajo
        sp_img = Image.fromarray(rgb, mode="RGB").resize((PW, a_h), Image.BILINEAR)
        img.paste(sp_img, (ML, a_top))
        dr = ImageDraw.Draw(img)
        fmax = float(freqs[-1])
        for fk in range(0, 17000, 2000):
            if fk > fmax + 1:
                continue
            y = a_bot - int(round(a_h * fk / fmax))
            dr.line([(ML, y), (ML + PW, y)], fill=(70, 70, 80), width=1)
            dr.text((ML - 34, y - 6), ("%dk" % (fk // 1000)) if fk else "0",
                    font=f_ax, fill=lab)
        cap = "escala de color %.0f .. %.0f dB (real)" % (db_min_s, db_max_s)
        cw = int(dr.textlength(cap, font=f_ax))
        cap_x = ML + PW - cw - 6
        dr.rectangle([cap_x - 4, a_bot - 19, ML + PW - 2, a_bot - 3], fill=(10, 10, 12))
        dr.text((cap_x, a_bot - 17), cap, font=f_ax, fill=(236, 236, 240))
    else:
        dr.text((ML + 8, a_top + 12), "(senal demasiado corta para espectrograma)",
                font=f_ax, fill=lab)
    dr.rectangle([ML - 1, a_top - 1, ML + PW, a_bot], outline=frame)

    # ---- (b) envolvente RMS en dB ---------------------------------------
    b_title = a_bot + 22
    b_names = b_title + 18
    b_top = b_names + 20
    b_h = 292
    b_bot = b_top + b_h
    dr.text((ML, b_title), "(b) envolvente RMS en dB (escala real) con las secciones",
            font=f_ax, fill=lab)

    if env_db.size:
        finite = env_db[np.isfinite(env_db)]
        db_hi = float(np.max(finite)) if finite.size else -10.0
        db_lo = float(np.min(finite)) if finite.size else -90.0
    else:
        db_hi, db_lo = -10.0, -90.0
    db_hi = min(db_hi, 6.0)
    db_hi = math.ceil(db_hi / 3.0) * 3.0
    if db_hi - db_lo > 96.0:                       # maximo 96 dB de ventana
        db_lo = db_hi - 96.0
    db_lo = math.floor(db_lo / 3.0) * 3.0
    if db_hi - db_lo < 12.0:                       # senal casi constante
        db_hi += 6.0
        db_lo -= 6.0
    db_hi = max(db_hi, db_lo + 6.0)

    def y_of_db(v):
        r = (float(v) - db_lo) / (db_hi - db_lo)
        return b_bot - int(round(min(1.0, max(0.0, r)) * b_h))

    def x_of_t(t):
        return ML + int(round(PW * min(1.0, max(0.0, t / dur))))

    # relleno de la curva (primero, para no tapar la rejilla)
    if env_db.size:
        curve = pool_max(env_db, PW)
        ncv = max(1, len(curve) - 1)
        pts = [(ML + min(PW, int(round(i * PW / float(ncv)))), y_of_db(val))
               for i, val in enumerate(curve)]
        if len(pts) > 1:
            poly = pts + [(pts[-1][0], b_bot), (pts[0][0], b_bot)]
            overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(overlay).polygon(poly, fill=(26, 120, 96, 70))
            img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
            dr = ImageDraw.Draw(img)

    # rejilla en dB
    step_db = 10.0 if (db_hi - db_lo) <= 72.0 else 20.0
    v = math.ceil(db_lo / step_db) * step_db
    while v <= db_hi + 1e-6:
        y = y_of_db(v)
        dr.line([(ML, y), (ML + PW, y)], fill=grid)
        dr.text((ML - 42, y - 6), "%4.0f" % v, font=f_ax, fill=lab)
        v += step_db
    dr.text((ML - 42, b_top - 16), "dBFS", font=f_ax, fill=lab)

    # lineas y nombres de seccion
    if sections:
        for s in sections:
            x0, x1 = x_of_t(s["t0"]), x_of_t(s["t1"])
            dr.line([(x0, b_top), (x0, b_bot)], fill=(150, 82, 116), width=1)
            if x1 - x0 >= 34:
                dr.text((x0 + 4, b_names), s["name"], font=f_sec, fill=(224, 168, 202))
    else:
        for k in range(1, 8):
            x = ML + PW * k // 8
            dr.line([(x, b_top), (x, b_bot)], fill=grid)

    if env_db.size and len(pts) > 1:
        dr.line(pts, fill=(150, 238, 200), width=2)
    dr.rectangle([ML - 1, b_top - 1, ML + PW, b_bot], outline=frame)

    # ---- (c) forma de onda ----------------------------------------------
    c_title = b_bot + 26
    c_top, c_h = c_title + 16, 158
    c_bot = c_top + c_h
    dr.text((ML, c_title), "(c) forma de onda (min/max por columna)", font=f_ax, fill=lab)
    mid = c_top + c_h // 2
    dr.line([(ML, mid), (ML + PW, mid)], fill=(58, 58, 66))
    lo, hi, _ = pool_minmax(mono, PW)
    scale = max(1e-9, float(np.max(np.abs(mono)))) if mono.size else 1.0
    for i in range(len(lo)):
        x = ML + i
        y0 = mid - int(round(c_h / 2.0 * (hi[i] / scale)))
        y1 = mid - int(round(c_h / 2.0 * (lo[i] / scale)))
        if y1 < y0:
            y0, y1 = y1, y0
        dr.line([(x, y0), (x, max(y1, y0))], fill=(118, 168, 228))
    if sections:
        for s in sections:
            x0 = x_of_t(s["t0"])
            dr.line([(x0, c_top), (x0, c_bot)], fill=(74, 44, 58))
    dr.rectangle([ML - 1, c_top - 1, ML + PW, c_bot], outline=frame)
    for v in (1.0, 0.0, -1.0):
        dr.text((ML - 42, mid - int(round(c_h / 2.0 * v)) - 6), "%+.2f" % v,
                font=f_ax, fill=lab)

    # ---- eje de tiempo ---------------------------------------------------
    step_t = nice_step(dur, 10)
    t = 0.0
    while t <= dur + 1e-9:
        x = x_of_t(t)
        lbl = ("%d:%02d" % (int(t // 60), int(round(t % 60)))) if dur >= 30 else ("%.1fs" % t)
        wtxt = dr.textlength(lbl, font=f_ax)
        tx = min(max(ML, x - int(wtxt // 2)), ML + PW - int(wtxt))
        dr.line([(x, c_bot), (x, c_bot + 5)], fill=(150, 150, 160))
        dr.line([(x, b_bot), (x, b_bot + 4)], fill=(70, 70, 80))
        dr.text((tx, c_bot + 8), lbl, font=f_ax, fill=lab)
        t += step_t
    dr.text((ML + PW - 8, c_bot + 26), "t", font=f_ax, fill=lab)

    out = os.path.splitext(path)[0] + "_analisis.png"
    img.save(out)
    return out, img.size, (db_lo, db_hi)


# ---------------------------------------------------------------------------
# secciones (song_data opcional)
# ---------------------------------------------------------------------------
def load_sections():
    """Devuelve [(nombre, t0, t1)] a partir de song_data, o [] si no esta."""
    try:
        import song_data as sd
    except Exception:
        return [], None
    bar = float(getattr(sd, "BAR"))
    secs = []
    for s in getattr(sd, "SECTIONS", []):
        a, b = s["bars"]
        secs.append({"name": str(s["name"]), "t0": (a - 1) * bar, "t1": b * bar})
    return secs, float(getattr(sd, "SONG_BARS", 0) or 0)


# ---------------------------------------------------------------------------
# principal
# ---------------------------------------------------------------------------
def main(argv):
    if len(argv) < 2:
        print("uso: python verify_song.py <ruta.wav>")
        return 2
    path = os.path.abspath(argv[1])
    if not os.path.isfile(path):
        print("ERROR: no existe el fichero: %s" % path)
        return 2
    if not path.lower().endswith(".wav"):
        print("AVISO: la extension no es .wav; se intenta leer igualmente")

    data, meta = load_wav(path)
    sr = meta["sr"]
    nch = meta["nch"]
    n = meta["nframes"]
    dur = n / float(sr)
    mono = mono_of(data)
    lev = levels(data)

    print("=" * 78)
    print("VERIFICACION DE AUDIO (medida independiente del codigo que lo genero)")
    print("=" * 78)
    print("fichero            : %s" % path)
    print("titulo (song_data) : %s" % _title())

    # 1 -------------------------------------------------------------------
    print("\n[1] CABECERA (modulo wave)")
    print("  canales      : %d  (%s)" % (nch, "mono" if nch == 1 else
                                         ("estereo" if nch == 2 else "multicanal")))
    print("  bits/muestra : %d" % (meta["sampwidth"] * 8))
    print("  sample rate  : %d Hz" % sr)
    print("  frames       : %d" % n)
    print("  duracion     : %.3f s  (%d:%06.3f)" % (dur, int(dur // 60), dur % 60))
    print("  bytes        : %d en fichero, %d de PCM" % (meta["bytes_file"], meta["bytes_pcm"]))
    print("  codificacion : PCM %s" % meta["comptype"])

    # 2 -------------------------------------------------------------------
    print("\n[2] NIVELES (leidos del fichero)")
    print("  pico  L / R  : %+.2f / %+.2f dBFS   (%.4f / %.4f)" % (
        lev["peak_l_db"], lev["peak_r_db"], lev["peak_l"], lev["peak_r"]))
    print("  pico  global : %+.2f dBFS   (%.4f)" % (lev["peak_db"], lev["peak"]))
    print("  RMS   L / R  : %+.2f / %+.2f dBFS" % (lev["rms_l_db"], lev["rms_r_db"]))
    print("  RMS   global : %+.2f dBFS" % lev["rms_db"])
    if math.isnan(lev["crest_db"]):
        print("  crest factor : n/a (silencio digital)")
    else:
        print("  crest factor : %+.2f dB   (pico/RMS)" % lev["crest_db"])
    print("  DC    L / R  : %+.6f / %+.6f  (%.3f / %.3f milesimas)" % (
        lev["dc_l"], lev["dc_r"], lev["dc_l"] * 1000.0, lev["dc_r"] * 1000.0))
    print("  clipeadas    : %d muestras (>= %.5f)  [L=%d R=%d]" % (
        lev["clip"], CLIP_LEVEL, lev["clip_l"], lev["clip_r"]))
    if math.isnan(lev["corr"]):
        print("  correlacion  : n/a (mono o canal mudo)")
    else:
        print("  correlacion  : %+.4f  (L/R)" % lev["corr"])

    # 3 -------------------------------------------------------------------
    print("\n[3] ENERGIA (RMS por tramos de %.0f s)" % SEG_S)
    seg_db, seg_t = block_rms(mono, sr, SEG_S)
    print("  %8s  %8s" % ("t_inicio", "RMS_dB"))
    for t, v in zip(seg_t, seg_db):
        bar = "#" * int(max(0.0, min(1.0, (v + 60.0) / 60.0)) * 40)
        print("  %8.2f  %8.2f  |%s" % (t, v, bar))
    sil0, sil1 = edge_silence(mono, sr)
    print("  silencio inicial : %.3f s  -> %s" % (
        sil0, "SI (>%.1f s)" % SILENCE_MIN_S if sil0 > SILENCE_MIN_S else "no"))
    print("  silencio final   : %.3f s  -> %s" % (
        sil1, "SI (>%.1f s)" % SILENCE_MIN_S if sil1 > SILENCE_MIN_S else "no"))
    print("  (umbral de silencio: %.1f dBFS; suelo de medida: %.0f dBFS)" % (
        SILENCE_DB, DB_FLOOR))

    # 4 -------------------------------------------------------------------
    print("\n[4] ESPECTRO cada %.0f s (ventana %d, Hann)" % (SPEC_EVERY_S, SPEC_NFFT))
    print("  %8s  %10s  %10s  %8s" % ("t", "centro_Hz", "pico_Hz", "RMS_dB"))
    t = 0.0
    while t < dur - 1e-9:
        r = spectral_at(mono, sr, t)
        if r is None:
            print("  %8.2f  %10s  %10s  %8s" % (t, "-", "-", "-"))
        else:
            c, f, d = r
            print("  %8.2f  %10.0f  %10.0f  %8.2f" % (t, c, f, d))
        t += SPEC_EVERY_S

    # 5 -------------------------------------------------------------------
    sections, song_bars = load_sections()
    print("\n[5] SECCIONES (song_data.SECTIONS, BAR = %.4f s)" % _bar())
    if not sections:
        print("  song_data no disponible: tabla omitida")
    else:
        print("  %-9s %9s %9s %8s %8s" % ("seccion", "t_inicio", "t_fin", "RMS_dB", "pico_dB"))
        shown = 0
        for s in sections:
            if s["t0"] >= dur - 1e-6:
                continue
            t0 = s["t0"]
            t1 = min(s["t1"], dur)
            i0 = int(round(t0 * sr))
            i1 = int(round(t1 * sr))
            seg = mono[i0:i1]
            if seg.size == 0:
                continue
            name = s["name"] + ("*" if s["t1"] > dur + 1e-6 else "")
            print("  %-9s %9.2f %9.2f %8.2f %8.2f" % (
                name, t0, t1, rms_db(seg), peak_db(seg)))
            shown += 1
        if shown == 0:
            print("  el WAV es mas corto que la primera seccion")
        elif shown < len(sections):
            print("  (*) seccion cortada: el WAV acaba antes (faltan %d secciones)" % (
                len(sections) - shown))
        print("  cancion declarada: %d compases = %.2f s (+ cola)" % (
            int(song_bars), song_bars * _bar()))

    # 6 -------------------------------------------------------------------
    env_block = max(0.001, min(0.02, dur / 400.0))
    env_db, env_t = block_rms(mono, sr, env_block)
    spec = spectrogram(mono, sr)
    png, size, dbrange = make_figure(path, data, sr, meta["sampwidth"] * 8, lev,
                                     sections, env_db, spec)
    print("\n[6] FIGURA")
    print("  PNG          : %s  (nombre base del WAV + _analisis.png)" % png)
    print("  tamano       : %d x %d px" % (size[0], size[1]))
    print("  escala dB    : %.0f .. %.0f dBFS (calculada de los datos, sin estirar)" % dbrange)
    print("  paneles      : espectrograma 0-16 kHz | envolvente RMS + secciones | onda")

    # 7 -------------------------------------------------------------------
    print("\nVERIFY OK")
    return 0


_SONG = {}


def _title():
    if "title" not in _SONG:
        try:
            import song_data as sd
            _SONG["title"] = str(getattr(sd, "TITLE", "(sin titulo)"))
        except Exception:
            _SONG["title"] = "(song_data no disponible)"
    return _SONG["title"]


def _bar():
    if "bar" not in _SONG:
        try:
            import song_data as sd
            _SONG["bar"] = float(getattr(sd, "BAR", 0.0))
        except Exception:
            _SONG["bar"] = 0.0
    return _SONG["bar"]


if __name__ == "__main__":
    sys.exit(main(sys.argv))
