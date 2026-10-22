# -*- coding: utf-8 -*-
"""render.py - genera el tema completo: stems WAV, master WAV y MIDI."""
import os
import sys
import time
import struct
import shutil

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cancion as C
import instruments as I
import dsp as D
from dsp import (SR, BAR, SPB, note_hz, hp, lp, bp, filt, biquad, pan, soft_clip,
                 reverb_ir, reverb, delay, compress, moving_avg, db2lin, lin2db,
                 lufs_integrated, true_peak_db, rms_db, crest_db, vinyl_noise,
                 tape_hiss, fade, white)
from midi import write_midi

OUT = 'audio'
N = int(round(C.DUR * SR))
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


def write_wav(path, x, width=3):
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    data = pcm_bytes(x, width)
    with open(path, 'wb') as f:
        f.write(riff_header(SR, 2, width, len(data)))
        f.write(data)


# ------------------------------------------------------------------ utilidades
def env_fn(pts):
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    return lambda t: np.interp(t, xs, ys)


def place(dst, sig, t, gain=1.0, panp=0.0):
    s = int(round(t * SR))
    sig = np.asarray(sig, np.float32)
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
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        w = reverb(x, ir_l)
        y = reverb(x, ir_r)
        wet = np.stack([w, y], axis=1)
        dry = np.stack([x, x], axis=1)
    else:
        wet = np.stack([reverb(x[:, 0], ir_l), reverb(x[:, 1], ir_r)], axis=1)
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


# ================================================================== BATERIA
def gen_bateria(stem, master):
    log('bateria: muestras')
    kick_pool = [I.kick(1.0, s) for s in range(4)]
    snare_pool = [I.snare(1.0, s) for s in range(4)]
    hat_pool = [I.hat(1.0, s) for s in range(4)]
    hat_open = [I.hat(1.0, s, open_=True) for s in range(2)]
    metal_pool = [I.metal_hit(1.0, s, pitch=p) for s, p in
                  enumerate([1.0, 1.19, 0.84, 1.41, 0.71, 1.58])]
    shaker_pool = [I.shaker(1.0, s) for s in range(3)]

    buf = np.zeros((N, 2), np.float32)

    # --- bombo y caja: negras y 2/4, de bar 0 a bar 115
    for bar in range(0, 116):
        intro = bar < 11
        for beat in range(4):
            t = (bar * 4 + beat) * SPB
            g = 0.62 if intro else 0.92
            place(buf, kick_pool[(bar * 4 + beat) % 4], t, g, 0.0)
            midi_add('Bateria', bar * 4 + beat, 0.25, 36, 110 if not intro else 88)
        for beat in (1, 3):
            t = (bar * 4 + beat) * SPB
            g = 0.55 if intro else 0.80
            place(buf, snare_pool[(bar * 4 + beat) % 4], t, g, 0.02)
            midi_add('Bateria', bar * 4 + beat, 0.25, 38, 104 if not intro else 82)

    # --- charles en semicorcheas: rigido, sin variaciones
    for bar in range(11, 116):
        for k in range(16):
            t = (bar * 4 + k * 0.25) * SPB
            acc = 0.95 if k % 4 == 0 else (0.80 if k % 2 == 0 else 0.70)
            place(buf, hat_pool[(bar * 16 + k) % 4], t, 0.30 * acc, 0.12)
            midi_add('Bateria', bar * 4 + k * 0.25, 0.12, 42, int(70 * acc))

    # --- percusion metalica: entra en bar 34, muy paneada
    for bar in range(34, 116):
        for j, (beat, v) in enumerate(C.METAL_PAT):
            t = (bar * 4 + beat) * SPB
            idx = (bar + j) % len(metal_pool)
            p = -0.75 if (bar + j) % 2 == 0 else 0.75
            place(buf, metal_pool[idx], t, 0.20 * v, p)
            midi_add('Bateria', bar * 4 + beat, 0.5, 56, int(60 * v))

    # --- shaker: desde el estribillo
    for bar in range(60, 116):
        for k in range(16):
            if k % 2 == 0:
                continue
            t = (bar * 4 + k * 0.25) * SPB
            place(buf, shaker_pool[(bar + k) % 3], t, 0.10, -0.45)
            midi_add('Bateria', bar * 4 + k * 0.25, 0.1, 70, 50)

    stem.write_at(0, buf)
    master += buf
    del buf
    log('bateria: ok')


# ================================================================== BAJO
def gen_bajo(stem, master):
    log('bajo: sintesis')
    buf = np.zeros((N, 2), np.float32)
    n = 0
    for bar in range(11, 116):
        root = C.ACORDES[C.acorde_de(bar)][0]
        for i, off in enumerate(C.PATRON_BAJO):
            if off is None:
                continue
            t = (bar * 4 + i * 0.5) * SPB
            d = C.DUR_BAJO[i] * SPB
            m = root + off
            sq = 1.0 if (i == 2 or i == 7) else 0.0
            y = I.bass_note(m, d, vel=1.0, seed=(bar * 8 + i) % 97,
                            squelch=sq, bright=1.0 if bar < 60 else 1.15)
            place(buf, y, t, 0.62, 0.0)
            midi_add('Bajo', bar * 4 + i * 0.5, C.DUR_BAJO[i], m, 100 if sq else 92)
            n += 1
    # envolvente global: entra en 0:30, cae en 5:09
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, C.t_de(11), C.t_de(13), C.t_de(60), C.t_de(90),
                       C.t_de(112), C.t_de(116), C.DUR],
                  [0, 0, 0.85, 0.95, 1.0, 0.95, 0, 0])
    buf *= g[:, None].astype(np.float32)
    stem.write_at(0, buf)
    master += buf
    del buf
    log('bajo: %d notas' % n)


# ================================================================== DRONE
def gen_drone(stem, master):
    log('drone: sintesis')
    buf = np.zeros((N, 2), np.float32)
    for bar in range(0, 116, 8):
        root = C.ACORDES[C.acorde_de(bar)][0] - 12
        dur = 8 * BAR + 1.5
        y = I.drone_note(root, dur, vel=1.0, seed=bar, cutoff=300.0 + 40 * (bar % 3))
        t = bar * BAR
        # estereo ancho: dos copias desafinadas
        place(buf, y, t, 0.30, -0.65)
        place(buf, np.roll(y, int(0.017 * SR)), t, 0.30, 0.65)
        midi_add('Drone', bar * 4, 32, root, 70)
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, 2.0, C.t_de(11), C.t_de(34), C.t_de(60), C.t_de(90),
                       C.t_de(114), C.t_de(116), C.DUR],
                  [0, 0.55, 0.75, 0.85, 0.95, 1.0, 0.9, 0, 0])
    buf *= g[:, None].astype(np.float32)
    stem.write_at(0, buf)
    master += buf
    del buf
    log('drone: ok')


# ================================================================== ORGANO
def gen_organo(stem, master):
    log('organo: sintesis')
    buf = np.zeros((N, 2), np.float32)
    for bar in range(34, 116, 2):
        ac = C.acorde_de(bar)
        voces = C.ACORDES[ac][1]
        dur = 2 * BAR + 0.35
        y = I.organ_chord(voces, dur, vel=1.0, seed=bar)
        t = bar * BAR
        place(buf, y, t, 0.26, -0.35)
        place(buf, np.roll(y, int(0.023 * SR)), t, 0.26, 0.35)
        for v in voces:
            midi_add('Organo', bar * 4, 8, v, 72)
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, C.t_de(34), C.t_de(40), C.t_de(60), C.t_de(90),
                       C.t_de(113), C.t_de(116), C.DUR],
                  [0, 0, 0.6, 0.85, 1.0, 0.9, 0, 0])
    buf *= g[:, None].astype(np.float32)
    stem.write_at(0, buf)
    master += buf
    del buf
    log('organo: ok')


# ================================================================== GUITARRA
def gen_guitarra(stem, master):
    log('guitarra: bucle')
    buf = np.zeros((N, 2), np.float32)
    loop = I.guitar_loop(16, C.BPM, C.GUITARRA, vel=1.0, seed=5, drive=8.0)
    # textura: filtro fijo, sin solos
    loop = bp(loop, 900.0, 0.5)
    loop = lp(loop, 3800.0, 0.7)
    loop = soft_clip(loop * 1.6, 1.4)
    bars = [34, 40, 46, 52, 62, 68, 74, 80, 92, 98, 104, 110]
    for b in bars:
        t = b * BAR
        place(buf, loop, t, 0.30, -0.55)
        place(buf, np.roll(loop, int(0.031 * SR)), t, 0.30, 0.55)
        for (bt, db, m, v, mute) in C.GUITARRA:
            midi_add('Guitarra', b * 4 + bt, db, m, int(70 * v))
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, C.t_de(34), C.t_de(36), C.t_de(60), C.t_de(90),
                       C.t_de(113), C.t_de(116), C.DUR],
                  [0, 0, 0.7, 0.9, 1.0, 0.85, 0, 0])
    buf *= g[:, None].astype(np.float32)
    stem.write_at(0, buf)
    master += buf
    del buf
    log('guitarra: ok')


# ================================================================== VOZ
def cadena_voz(x, drive=1.0, rev_mix=0.16, dly_mix=0.20, sil=None, bright=1.0):
    y = hp(x, 95.0, 0.7)
    y = filt(y, *biquad('peak', 2600.0, 1.0, 3.5))
    y = filt(y, *biquad('peak', 6200.0, 2.2, -4.5))
    y = filt(y, *biquad('hshelf', 7500.0, 0.7, -2.0))
    y = filt(y, *biquad('peak', 220.0, 1.2, 1.5))
    y = compress(y, -24.0, 2.6, 30.0, 4.0)
    if drive != 1.0:
        y = soft_clip(y * drive, 1.5)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
    ir_l = reverb_ir(2.2, 0.42, seed=21, lp_hz=5200.0)
    ir_r = reverb_ir(2.2, 0.42, seed=22, lp_hz=5200.0)
    out = reverb_st(y, ir_l, ir_r, mix=rev_mix)
    if sil is not None and dly_mix > 0:
        d = delay(y, 0.5, fb=0.42, mix=0.5, taps=6, lp_hz=3200.0)
        a = actividad(sil, len(y))
        gap = 1.0 - np.clip(moving_avg(a, 140.0), 0.0, 1.0)
        d = d * gap
        out = out + np.stack([d, np.roll(d, int(0.011 * SR))], axis=1) * dly_mix
    return out


def gen_voz(stem, master):
    log('voz: silabas')
    sil = C.silabas_voz()
    t_est = C.t_de(60)
    s1 = [s for s in sil if s[0] < t_est]
    s2 = [s for s in sil if s[0] >= t_est]
    log('voz: %d silabas (estrofa %d / estribillo %d)' % (len(sil), len(s1), len(s2)))

    buf = np.zeros((N, 2), np.float32)

    # --- lead estrofas: plano, grave, casi hablado
    y1 = I.voice(s1, seed=11, f0_base=98.0, breath=0.13, drive=1.0, jitter=0.4)
    y1 = cadena_voz(y1, drive=1.0, rev_mix=0.13, dly_mix=0.22, sil=s1)
    place(buf, y1, 0.0, 0.95, 0.0)
    for (t, d, m, v, c, vel) in s1:
        midi_add('Voz lead', t / SPB, d / SPB, m, int(90 * vel))
    del y1

    # --- lead estribillo: mas abierto y desesperado
    y2 = I.voice(s2, seed=12, f0_base=98.0, breath=0.17, drive=1.7, jitter=0.5)
    y2 = cadena_voz(y2, drive=1.5, rev_mix=0.22, dly_mix=0.26, sil=s2)
    place(buf, y2, 0.0, 1.0, 0.0)
    for (t, d, m, v, c, vel) in s2:
        midi_add('Voz lead', t / SPB, d / SPB, m, int(96 * vel))
    del y2

    # --- doblaje: misma altura, 18 ms, ligeramente a la izquierda
    d1 = I.voice(s1, seed=31, f0_base=98.0, breath=0.15, drive=1.2, jitter=0.5)
    d1 = cadena_voz(d1, drive=1.1, rev_mix=0.18, dly_mix=0.0)
    place(buf, d1, 0.018, 0.42, -0.18)
    del d1
    d2 = I.voice(s2, seed=32, f0_base=98.0, breath=0.18, drive=1.9, jitter=0.6)
    d2 = cadena_voz(d2, drive=1.6, rev_mix=0.24, dly_mix=0.0)
    place(buf, d2, 0.018, 0.50, -0.18)
    del d2

    # --- susurros: capas anchas detras
    w1 = I.voice(s1, seed=41, f0_base=98.0, breath=0.5, whisper=True, jitter=0.8)
    w1 = hp(w1, 320.0, 0.7)
    w1 = cadena_voz(w1, drive=1.0, rev_mix=0.45, dly_mix=0.0)
    place(buf, w1, 0.030, 0.20, -0.70)
    place(buf, np.roll(w1, int(0.041 * SR)), 0.030, 0.20, 0.70)
    del w1
    w2 = I.voice(s2, seed=42, f0_base=98.0, breath=0.5, whisper=True, jitter=0.8)
    w2 = hp(w2, 320.0, 0.7)
    w2 = cadena_voz(w2, drive=1.0, rev_mix=0.5, dly_mix=0.0)
    place(buf, w2, 0.030, 0.26, -0.70)
    place(buf, np.roll(w2, int(0.041 * SR)), 0.030, 0.26, 0.70)
    del w2

    # --- respuestas de fondo en el estribillo: octava grave + quinta
    s2b = [(t, d, m - 12, v, c, vel) for (t, d, m, v, c, vel) in s2]
    b1 = I.voice(s2b, seed=51, f0_base=98.0, breath=0.2, drive=1.4, jitter=0.6)
    b1 = cadena_voz(b1, drive=1.3, rev_mix=0.35, dly_mix=0.0)
    place(buf, b1, 0.5 * SPB, 0.30, 0.0)
    del b1
    s2c = [(t, d, m + 7, v, c, vel) for (t, d, m, v, c, vel) in s2]
    b2 = I.voice(s2c, seed=52, f0_base=98.0, breath=0.3, whisper=True, jitter=0.7)
    b2 = cadena_voz(b2, drive=1.0, rev_mix=0.5, dly_mix=0.0)
    place(buf, b2, 0.5 * SPB, 0.16, -0.55)
    place(buf, np.roll(b2, int(0.037 * SR)), 0.5 * SPB, 0.16, 0.55)
    del b2

    stem.write_at(0, buf)
    master += buf
    del buf
    log('voz: ok')


# ================================================================== PIANO
def gen_piano(stem, master):
    log('piano: final')
    buf = np.zeros((N, 2), np.float32)
    rng = np.random.default_rng(7)
    t = C.t_de(116) + 0.35
    drift = 1.0
    mel = C.PIANO_MEL
    seq = [(m, 1.75) for m in mel] + [(m - 12, 2.15) for m in mel]
    for i, (m, dur) in enumerate(seq):
        jit = rng.normal(0, 0.045)
        tt = t + jit
        if tt > C.DUR - 1.2:
            break
        y = I.piano_note(m, dur * 0.95, vel=0.9, seed=i, detune=rng.normal(0, 0.0016))
        place(buf, y, tt, 0.55, rng.uniform(-0.25, 0.25))
        midi_add('Piano', tt / SPB, dur * 0.95 / SPB, m, 80)
        t += dur * drift * (1.0 + rng.normal(0, 0.012))
        drift *= 1.004
    # aire: reverb larga y siseo de cinta
    ir_l = reverb_ir(3.2, 0.7, seed=61, lp_hz=4200.0)
    ir_r = reverb_ir(3.2, 0.7, seed=62, lp_hz=4200.0)
    buf = reverb_st(buf, ir_l, ir_r, mix=0.30).astype(np.float32)
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, C.t_de(116), C.t_de(117), C.t_de(134), C.DUR],
                  [0, 0, 1.0, 0.85, 0.0])
    buf *= g[:, None].astype(np.float32)
    stem.write_at(0, buf)
    master += buf
    del buf
    log('piano: ok')


# ================================================================== FX
def gen_fx(stem, master):
    log('fx: squelch, growl, reversos, siseo')
    buf = np.zeros((N, 2), np.float32)

    # squelch de bajo
    for bar in [36, 44, 52, 62, 70, 78, 92, 100, 108]:
        y = I.squelch(1.0, seed=bar, dur=0.32)
        place(buf, y, (bar * 4 + 3.5) * SPB, 0.30, -0.3)
        midi_add('FX', bar * 4 + 3.5, 0.5, 40, 90)

    # gruñido de realimentacion
    for bar in [64, 72, 80, 94, 104]:
        y = I.feedback_growl(1.0, seed=bar, dur=1.5, f0=note_hz(52))
        place(buf, y, (bar * 4 + 2.0) * SPB, 0.16, 0.6)
        midi_add('FX', bar * 4 + 2.0, 2.0, 52, 80)

    # muestras melodicas invertidas: swells antes de cada cambio
    for bar, root in [(33, 45), (59, 45), (89, 41), (115, 45)]:
        src = I.organ_chord(C.ACORDES['Am'][1], 2.2, vel=1.0, seed=bar)
        sw = I.reverse_swell(src, 2.2)
        sw = bp(sw, 1200.0, 0.6)
        place(buf, sw, bar * BAR + 0.4, 0.22, -0.6)
        place(buf, np.roll(sw, int(0.027 * SR)), bar * BAR + 0.4, 0.22, 0.6)

    # breakdown: muestra melodica invertida enterrada, mecanica
    for i, bar in enumerate(range(92, 116, 2)):
        m = [57, 60, 62, 59, 57, 55, 53, 52, 57, 60, 62, 64][i % 12]
        src = I.piano_note(m, 1.1, vel=0.9, seed=200 + i)
        sw = I.reverse_swell(src, 1.6)
        sw = bp(sw, 900.0, 0.5)
        sw = lp(sw, 2600.0, 0.7)
        place(buf, sw, bar * BAR, 0.16, -0.5)
        place(buf, np.roll(sw, int(0.019 * SR)), bar * BAR, 0.16, 0.5)
        midi_add('FX', bar * 4, 2.4, m, 60)

    # siseo de cinta y ruido de vinilo de fondo
    hiss = tape_hiss(N, seed=3, level=0.010)
    vin = vinyl_noise(N, seed=4, hiss=0.006, crackle=0.5)
    bed = hiss + vin
    tt = np.arange(N) / SR
    g = np.interp(tt, [0, 1.0, C.t_de(116), C.DUR], [0, 1.0, 0.8, 0.0])
    bed = bed * g
    place(buf, bed, 0.0, 1.0, -0.3)
    place(buf, np.roll(bed, int(0.013 * SR)), 0.0, 1.0, 0.3)

    stem.write_at(0, buf)
    master += buf
    del buf
    log('fx: ok')


# ================================================================== MASTER
def masterizar(master):
    log('master: cadena')
    x = master.astype(np.float64)
    x = hp(x, 26.0, 0.7)
    x = compress(x, -20.0, 1.7, 60.0, 1.5)
    x = filt(x, *biquad('lshelf', 70.0, 0.7, 1.5))
    x = filt(x, *biquad('peak', 380.0, 1.0, -1.2))
    x = filt(x, *biquad('peak', 3000.0, 0.9, 1.0))
    x = filt(x, *biquad('hshelf', 9000.0, 0.7, -1.5))

    l = lufs_integrated(x)
    log('master: LUFS antes de ganancia = %.2f' % l)
    x *= db2lin(-10.5 - l)

    # limitador suave solo en los picos (no ladrillo)
    t = 0.86
    a = np.abs(x)
    over = a > t
    if over.any():
        y = x.copy()
        s = np.sign(x)
        y[over] = (s * (t + (1.0 - t) * np.tanh((a[over] - t) / (1.0 - t))))[over]
        x = y

    tp = true_peak_db(x)
    x *= db2lin(-1.0 - tp)
    return x


def main():
    os.makedirs(OUT, exist_ok=True)
    free = shutil.disk_usage('.').free
    width = 3 if free > 2.2e9 else 2
    log('espacio libre: %.2f GB -> stems a %d bits' % (free / 1e9, width * 8))

    master = np.zeros((N, 2), np.float32)
    stems = {}

    def stem(name):
        p = os.path.join(OUT, name + '.wav')
        stems[name] = StemWriter(p, N, width)
        return stems[name]

    gen_bateria(stem('01_bateria'), master)
    gen_bajo(stem('02_bajo'), master)
    gen_drone(stem('03_drone'), master)
    gen_organo(stem('04_organo'), master)
    gen_guitarra(stem('05_guitarra'), master)
    gen_voz(stem('06_voz'), master)
    gen_piano(stem('07_piano'), master)
    gen_fx(stem('08_fx'), master)

    for s in stems.values():
        s.close()
    log('stems escritos')

    x = masterizar(master)
    del master
    write_wav(os.path.join(OUT, 'miuzika_tema_master.wav'), x, width)

    l = lufs_integrated(x)
    tp = true_peak_db(x)
    cr = crest_db(x)
    log('MASTER  LUFS=%.2f  TP=%.2f dBTP  crest=%.2f dB  dur=%.2f s'
        % (l, tp, cr, len(x) / SR))

    # ---- MIDI
    orden = ['Bateria', 'Bajo', 'Drone', 'Organo', 'Guitarra', 'Voz lead', 'Piano', 'FX']
    canales = {'Bateria': 9, 'Bajo': 0, 'Drone': 1, 'Organo': 2, 'Guitarra': 3,
               'Voz lead': 4, 'Piano': 5, 'FX': 6}
    programas = {'Bateria': 0, 'Bajo': 38, 'Drone': 89, 'Organo': 16, 'Guitarra': 30,
                 'Voz lead': 53, 'Piano': 0, 'FX': 96}
    tracks = []
    for name in orden:
        if name not in MIDI:
            continue
        tracks.append({'name': name, 'channel': canales[name],
                       'program': programas[name], 'notes': MIDI[name]})
        write_midi(os.path.join(OUT, 'midi_%s.mid' % name.replace(' ', '_')),
                   [{'name': name, 'channel': canales[name],
                     'program': programas[name], 'notes': MIDI[name]}],
                   bpm=C.BPM, name=name)
    write_midi(os.path.join(OUT, 'miuzika_tema_multitrack.mid'), tracks,
               bpm=C.BPM, name='miuzika - quiereme despacio')

    log('MIDI escrito: %d pistas, %d notas'
        % (len(tracks), sum(len(t['notes']) for t in tracks)))
    log('FIN')


if __name__ == '__main__':
    main()
