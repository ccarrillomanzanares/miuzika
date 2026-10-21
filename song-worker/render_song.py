#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""render_song.py -- montaje de una canción con el motor Python disk-backed.

Uso:
    python render_song.py                  # canción completa + stems WAV + MIDI
    python render_song.py --bars 61 74     # solo ese rango de compases
    python render_song.py --no-stems       # solo master + MIDI
    python render_song.py --out out/job    # directorio de artefactos

El módulo `song_data.py` vive en el mismo directorio que este script.
Arquitectura obligada por RAM (7,7 GB totales, ~1,8 GB libres):
  PASADA A  pista a pista -> WAV estéreo en stems/<pista>.wav, POR TROZOS.
  PASADA B  mezcla por trozos de 30 s leyendo stems; reverb overlap-add.
  MASTER    ancho mid/side, glue, limitador, nivel y fades.
  MIDI      un .mid por pista + multitrack + guía de voz.
  CONTROL   relectura de stems para comprobar alineación.
"""
from __future__ import annotations

import gc
import json
import math
import os
import sys
import time
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERED = os.environ.get("MIUZIKA_RENDERED") or os.path.join(HERE, os.pardir, "rendered")
sys.path.insert(0, RENDERED)
sys.path.insert(0, HERE)

import dsp_core as dc
import midi_export as mx
import song_data as sd
import voices_extras as vx
from mix_master import bus_glue, limiter, make_ir, measure, stereo_width, write_song
from voices_drums import hat, kick, metal, snare
from voices_synths import bass, lead, pad

SR = dc.SR
RNG = np.random.default_rng(90210)
TMP_STEMS = "_stems_tmp"
OUT_DIR = os.environ.get("MIUZIKA_OUT") or HERE

# --------------------------------------------------------------------------
# PISTAS: (nombre, tipo, canal, programa GM, nota GM, ganancia, paneo, envio a reverb)
# --------------------------------------------------------------------------
TRACK_DEFS = [
    ("kick",          "drum",    9, 0,   36, 0.95,  0.00, 0.05),
    ("snare",         "drum",    9, 0,   38, 1.00,  0.00, 0.22),
    ("hats",          "drum",    9, 0,   42, 0.55,  0.00, 0.10),
    ("perc_metal",    "drum",    9, 0,   53, 0.40, -0.50, 0.34),
    ("sub",           "pitched", 0, 38,  0,  0.85,  0.00, 0.00),
    ("bass",          "pitched", 1, 38,  0,  0.95,  0.00, 0.00),
    ("drone",         "pitched", 2, 88,  0,  0.45,  0.00, 0.45),
    ("organ",         "pitched", 3, 16,  0,  0.42,  0.00, 0.50),
    ("guitar",        "pitched", 4, 29,  0,  0.48,  0.00, 0.28),
    ("squelch",       "pitched", 5, 81,  0,  0.42,  0.00, 0.35),
    ("growl",         "pitched", 6, 87,  0,  0.35, -0.35, 0.40),
    ("reverse_swell", "pitched", 7, 118, 0,  0.45,  0.00, 0.55),
    ("lead",          "pitched", 8, 81,  0,  0.45,  0.10, 0.35),
    ("piano",         "pitched", 10, 0,  0,  1.05,  0.00, 0.40),
    ("vinyl",         "pitched", 11, 120, 0, 0.45,  0.00, 0.10),
]
TRACKS = [t[0] for t in TRACK_DEFS]
VOX_TRACK, VOX_CH, VOX_PROG = "vocal_guide", 12, 52     # canal 12, Voice Oohs

REV_GAIN = 0.40
WIDTH = 0.55
PRE_GAIN = 0.62            # nivel antes del bus: el prompt pide crest 12-14 dB, no ladrillo
GLUE = dict(thresh_db=-13.0, ratio=1.6, attack=0.030, release=0.22, makeup_db=0.0)
FADE_IN, FADE_OUT = 0.05, 8.0
TARGET_PEAK_DB = -1.2       # el true peak medido era -0.7 con techo -1.0: se baja el techo
CHUNK_S = 30.0

# humanizacion: el prompt pide un bombo "unquantised", una maquina que no encaja del todo
JIT = {"kick": 0.012, "snare": 0.008, "hats": 0.004, "perc_metal": 0.006,
       "bass": 0.006, "guitar": 0.005, "organ": 0.0, "piano": 0.030, "lead": 0.004}
ALTERNOS = {"hats": 0.42, "guitar": 0.62}      # paneo alterno por evento (anchura real)

# Arco de energia por seccion: el prompt pide construirse ACUMULANDO capas. Las capas ya se
# acumulan; esto ademas sube el nivel, para que el estribillo sea el maximo y la intro respire.
# Se aplica a la VELOCIDAD del evento, asi que el arco queda igual en el WAV y en el MIDI.
SECTION_GAIN = {"intro": 0.70, "build1": 0.86, "build2": 0.95, "chorus": 1.00,
                "break": 0.94, "outro": 1.00}


# --------------------------------------------------------------------------
# utilidades de voz
# --------------------------------------------------------------------------
def midi_of(name_or_hz) -> int:
    return int(round(69 + 12 * math.log2(dc.hz_of(name_or_hz) / 440.0)))


def hz_of_midi(m) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def v2midi(v01) -> int:
    return int(np.clip(round(30 + 97 * float(v01)), 1, 127))


_CACHE: dict = {}


def _cached(fn):
    def wrapper(*a, **k):
        try:
            key = (fn.__name__, tuple(a),
                   tuple(sorted((kk, tuple(vv) if isinstance(vv, list) else vv)
                                for kk, vv in k.items())))
            hash(key)
        except TypeError:
            return fn(*a, **k)
        v = _CACHE.get(key)
        if v is None:
            v = fn(*a, **k)
            _CACHE[key] = v
        return v
    wrapper.__name__ = fn.__name__
    return wrapper


def _shaped(fn, hp_f=None, lp_f=None, ring=None, drive=None):
    """Insert por pista, aplicado DENTRO del cache (una vez por voz unica)."""
    def inner(*a, **k):
        v = fn(*a, **k)
        if ring:                                   # ring modulation: la caja del prompt
            t = np.arange(len(v)) / SR
            v = v * (1.0 + ring[1] * np.sin(2 * np.pi * ring[0] * t))
        if drive:
            v = dc.soft_clip(v, drive)
        if hp_f:
            v = dc.hp(v, hp_f)
        if lp_f:
            v = dc.lp(v, lp_f)
        return v
    inner.__name__ = fn.__name__ + "_shaped"
    return inner


kick = _cached(_shaped(kick, hp_f=30.0))
snare = _cached(_shaped(snare, ring=(137.0, 0.35), drive=1.7, hp_f=150.0))
hat = _cached(_shaped(hat, hp_f=6000.0))
metal = _cached(metal)
bass = _cached(_shaped(bass, hp_f=45.0))
organ = _cached(_shaped(vx.organ, hp_f=95.0))
piano = _cached(vx.piano)
guitar_crunch = _cached(vx.guitar_crunch)
squelch = _cached(vx.squelch)
growl = _cached(vx.growl)
vinyl = _cached(vx.vinyl)
lead_v = _cached(_shaped(lead, hp_f=180.0))


def drone_voice(freq, n, sr=SR):
    """Drone sostenido: seno grave + sierra una octava arriba, filtro que respira."""
    t = np.arange(n) / sr
    e = dc.env_sustain(n, 0.8, 1.0, sr)
    src = dc.osc("sine", freq, n, sr=sr) + 0.25 * dc.osc("saw", freq * 2.0, n, sr=sr)
    out = dc.svf(src, 220.0 + 260.0 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.06 * t)), 1.4,
                 mode="lp", sr=sr)
    return dc.soft_clip((out * e) * 0.9, 1.2)


def sub_voice(freq, n, sr=SR):
    """Refuerzo de graves: seno con segundo armonico, ataque y caida suaves."""
    e = dc.env_sustain(n, 0.06, 0.25, sr)
    return ((dc.osc("sine", freq, n, sr=sr) + 0.28 * dc.osc("sine", freq * 2.0, n, sr=sr))
            * e) * 0.62


def reverse_swell_voice(freqs, n, sr=SR):
    """Muestra melodica invertida: acorde tipo organo dado la vuelta (crece y se corta)."""
    pre = pad([dc.note(x) for x in freqs], n, attack=0.02, release=0.4, cutoff=2200.0)
    return dc.hp(pre[::-1] * (np.linspace(0.05, 1.0, n) ** 1.4), 110.0) * 0.9


drone_voice = _cached(drone_voice)
sub_voice = _cached(sub_voice)


# --------------------------------------------------------------------------
# PLAN DE EVENTOS (una sola vez: alimenta el audio Y el MIDI, asi quedan alineados)
# --------------------------------------------------------------------------
def build_schedule(bar_from, bar_to):
    ev = {name: [] for name in TRACKS}
    vox = []
    t_off = (bar_from - 1) * sd.BAR

    def T(bar, step=0.0, jit_key=None):
        t = (bar - 1) * sd.BAR + step * sd.STEP - t_off
        if jit_key and JIT.get(jit_key):
            t += float(RNG.uniform(-JIT[jit_key], JIT[jit_key]))
        return max(t, 0.0)

    for sec in sd.SECTIONS:
        a, b = sec["bars"]
        if b < bar_from or a > bar_to:
            continue
        a, b = max(a, bar_from), min(b, bar_to)
        layers = set(sec["layers"])
        prog = sd.PROG[sec["prog"]]
        sec_start = sec["bars"][0]
        energy = sec["energy"]

        if "drone" in layers:
            ev["drone"].append((T(a, 0.0), (b - a + 1) * sd.BAR, midi_of("C1"), v2midi(0.55)))
        if "vinyl" in layers:
            ev["vinyl"].append((T(a, 0.0), (b - a + 1) * sd.BAR + 1.0, midi_of("C0"),
                                v2midi(0.45)))
        if "growl" in layers:                        # trozos de 8 s (memoria y cache)
            t0 = T(a, 0.0)
            total = (b - a + 1) * sd.BAR
            k = 0
            while k * 8.0 < total:
                ev["growl"].append((t0 + k * 8.0, min(8.0, total - k * 8.0), midi_of("A0"),
                                    v2midi(0.5)))
                k += 1

        for bar in range(a, b + 1):
            ch = prog[bar - sec_start]
            c = sd.CHORDS[ch]
            root_midi = midi_of(c["bass"])
            rel = bar - sec_start

            if "kick" in layers:
                for step, vel in sd.DRUMS["base"]["kick"]:
                    ev["kick"].append((T(bar, step, "kick"), v2midi(vel * (0.95 + 0.1 * energy))))
            if "snare" in layers:
                pat = list(sd.DRUMS["base"]["snare"])
                if "snare_ghost" in layers:
                    pat += sd.DRUMS["chorus"]["snare_ghost"]
                for step, vel in pat:
                    ev["snare"].append((T(bar, step, "snare"), v2midi(vel)))
            if "hats" in layers:
                for step, vel in sd.DRUMS["hats"]:
                    ev["hats"].append((T(bar, step, "hats"), v2midi(vel)))
            if "perc_metal" in layers:
                if "lead_loop" in layers and bar % 2 == 0:
                    pat = sd.DRUMS["perc_metal_break"]
                elif bar % 4 == 0:
                    pat = sd.DRUMS["perc_metal"]
                else:
                    pat = []
                for step, vel in pat:
                    ev["perc_metal"].append((T(bar, step, "perc_metal"), v2midi(vel * 0.8)))

            if "bass" in layers:
                for step, semi, dur, vel in sd.BASS_PATTERN:
                    ev["bass"].append((T(bar, step, "bass"), dur * sd.STEP, root_midi + semi,
                                       v2midi(vel * (0.9 + 0.1 * energy))))
            if "sub" in layers:
                ev["sub"].append((T(bar, 0.0), sd.BAR * 0.90, root_midi, v2midi(0.75)))

            if "organ" in layers:
                g = 0.75 if sec["name"] == "chorus" else 0.6
                for nt in c["organ"]:
                    ev["organ"].append((T(bar, 0.0), sd.BAR * 0.99, midi_of(nt),
                                        v2midi(g * (0.85 + 0.15 * energy))))
            if "guitar" in layers:
                g = 0.55 if sec["name"] == "break" else 1.0
                # +12: medido, el guitar_crunch tiene los pasa-altos en 330 Hz, asi que una octava
                # arriba (fundamental 175-520 Hz) da mas cuerpo que en el registro grave
                for nt in c["gtr"]:
                    for step, vel in sd.GUITAR_PATTERN:
                        ev["guitar"].append((T(bar, step, "guitar"), sd.STEP * 0.95,
                                             midi_of(nt) + 12, v2midi(vel * g * 0.9)))

            if "lead" in layers:
                for bo, step, nt, dur, vel in sd.LEAD["chorus"]:
                    if rel % 16 == bo:
                        ev["lead"].append((T(bar, step, "lead"), dur * sd.STEP, midi_of(nt),
                                           v2midi(vel)))
            if "lead_loop" in layers:
                for step, semi in sd.LEAD_LOOP_PATTERN:
                    ev["lead"].append((T(bar, step, "lead"), sd.STEP * 0.55,
                                       root_midi + semi - 12, v2midi(0.42)))

            if "piano" in layers:                    # cromatismo descendente SIN CUANTIZAR
                for idx, nt, dur_beats in sd.PIANO_OUTRO:
                    if rel == idx // 2:
                        ev["piano"].append((T(bar, 0.0, "piano"), dur_beats * sd.BEAT,
                                            midi_of(nt), v2midi(0.85)))

            if sec["name"] in ("build1", "build2"):
                for bo, step, nt, dur, vel in sd.VOX_VERSE:
                    if (rel + sec.get("cyc_off", 0)) % 8 == bo:
                        vox.append((T(bar, step), dur * sd.STEP, midi_of(nt), vel))
            if sec["name"] == "chorus":
                for bo, step, nt, dur, vel in sd.VOX_CHORUS:
                    if rel % 8 == bo:
                        vox.append((T(bar, step), dur * sd.STEP, midi_of(nt), vel))
            if sec["name"] == "break":
                for bo, step, nt, dur, vel in sd.VOX_BREAK:
                    if rel % 16 == bo:
                        vox.append((T(bar, step), dur * sd.STEP, midi_of(nt), vel))

    for e in sd.EXTRAS:
        if not (bar_from <= e["bar"] <= bar_to):
            continue
        t0 = (e["bar"] - 1) * sd.BAR - t_off
        if e["kind"] == "squelch":
            ev["squelch"].append((t0, 0.30, midi_of("A1"), v2midi(e["gain"])))
        else:
            length = float(e.get("len_s", 5.0))
            ev["reverse_swell"].append((t0 - length * 0.5, length, midi_of("C3"),
                                        v2midi(e["gain"])))

    # arco de acumulacion: se escala la velocidad segun la seccion en la que cae el evento
    def sec_gain_at(t):
        for s in sd.SECTIONS:
            t0 = (s["bars"][0] - 1) * sd.BAR - t_off
            t1 = s["bars"][1] * sd.BAR - t_off
            if t0 <= t < t1:
                return SECTION_GAIN.get(s["name"], 1.0)
        return 1.0

    for k in ev:
        scaled = []
        for e in ev[k]:
            v = int(np.clip(round(e[1] * sec_gain_at(e[0])), 1, 127))
            scaled.append((e[0], v) + tuple(e[2:]) if len(e) > 2 else (e[0], v))
        ev[k] = sorted(scaled, key=lambda x: x[0])
    vox.sort(key=lambda x: x[0])
    return ev, vox


# --------------------------------------------------------------------------
# SINTESIS POR PISTA
# --------------------------------------------------------------------------
def _add(out, buf, t, gain=1.0):
    i0 = int(round(t * SR))
    if i0 < 0:
        buf = buf[-i0:]
        i0 = 0
    if i0 >= len(out):
        return
    k = min(len(buf), len(out) - i0)
    out[i0:i0 + k] += buf[:k] * gain


def render_track(name, events, n_total, gate_window=(0.0, 0.0)):
    """Pista MONO. gate_window = (t0, t1) del estribillo, donde la caja lleva gate."""
    out = np.zeros(n_total)
    for e in events:
        if name in ("kick", "snare", "hats", "perc_metal"):
            t, vel = e[0], e[1] / 127.0
            if name == "kick":
                _add(out, kick(dc.sec(0.62)), t, vel)
            elif name == "snare":
                gate = 0.16 if gate_window[0] <= t <= gate_window[1] else 0.0
                _add(out, snare(dc.sec(0.55 + gate), gate=gate), t, vel)
            elif name == "hats":
                _add(out, hat(dc.sec(0.10)), t, vel)
            else:
                _add(out, metal(dc.sec(1.8)), t, vel * 0.9)
            continue
        t, dur, note, vel = e[0], e[1], e[2], e[3] / 127.0
        f = hz_of_midi(note)
        if name == "bass":
            n = dc.sec(dur + 0.25)
            v = bass(f, n, glide=0.0, acc=min(vel, 1.0), fc_env=(170.0, 1700.0), fc_tau=0.20)
            v[min(int(dur * 0.92 * SR), n):] = 0.0
            _add(out, v, t, vel)
        elif name == "sub":
            _add(out, sub_voice(f, dc.sec(dur + 0.3)), t, vel)
        elif name == "drone":
            _add(out, drone_voice(f, dc.sec(dur)), t, vel)
        elif name == "vinyl":
            _add(out, vinyl(dc.sec(dur)), t, vel)
        elif name == "growl":
            _add(out, growl(dc.sec(dur), f=f), t, vel)
        elif name == "squelch":
            _add(out, squelch(dc.sec(dur)), t, vel)
        elif name == "lead":
            n = dc.sec(dur + 0.2)
            v = lead_v(f, n, glide=0.0, drive=2.4, wah=(0.25, 2.2))
            v[min(int(dur * 0.95 * SR), n):] = 0.0
            _add(out, v, t, vel)
            for dt, gk in ((1.5 * sd.BEAT, 0.30), (3.0 * sd.BEAT, 0.14)):
                _add(out, v, t + dt, vel * gk)     # eco de sintetizador, sin recursion
        elif name == "piano":
            _add(out, piano(f, dc.sec(dur + 2.4), velocity=vel, bright=1.0), t, vel)
    return out


def render_bed_stereo(name, events, n_total, cents=6.0):
    """Colchon ESTEREO real: la misma voz dos veces con micro-desafinado +-cents, una por canal.

    Es la forma correcta de ensanchar sostenidos: el retardo minimo (haas) afeita el centro al
    sumar en mono, el desafinado no.
    """
    out = dc.bus(n_total)
    grupos = {}
    for e in events:
        grupos.setdefault((round(e[0], 4), round(e[1], 4)), []).append((e[2], e[3]))
    for (t, dur), items in grupos.items():
        v = float(np.mean([x[1] for x in items])) / 127.0
        if name == "organ":
            base = [hz_of_midi(n) for n, _ in items]
            left = organ([f * 2.0 ** (-cents / 1200.0) for f in base], dc.sec(dur + 0.6)) * 0.75
            right = organ([f * 2.0 ** (cents / 1200.0) for f in base], dc.sec(dur + 0.6)) * 0.75
        else:
            f = hz_of_midi(items[0][0])
            left = drone_voice(f * 2.0 ** (-cents / 1200.0), dc.sec(dur))
            right = drone_voice(f * 2.0 ** (cents / 1200.0), dc.sec(dur))
        i0 = int(round(t * SR))
        if i0 < 0 or i0 >= n_total:
            continue
        k = min(len(left), n_total - i0)
        out[0, i0:i0 + k] += left[:k] * v
        out[1, i0:i0 + k] += right[:k] * v
    return out


def render_track_stereo(alt, events, n_total, pan_amt=0.42, alt_step=2):
    """Pista esterea con PANEO ALTERNO por evento: el patron de semicorcheas rebota L/R.

    Abre la imagen sin tocar los graves, y el MIDI sigue siendo una sola pista.
    """
    out = dc.bus(n_total)
    for i, e in enumerate(events):
        if alt == "hats":
            buf, t, vel = hat(dc.sec(0.10)), e[0], e[1] / 127.0
        elif alt == "guitar":
            t, dur, note, v = e
            n = dc.sec(dur + 0.35)
            buf = guitar_crunch(hz_of_midi(note), n, amp=min(v / 127.0 * 1.3, 1.0),
                                cutoff=2600.0).copy()
            buf[min(int(dur * 0.9 * SR), n):] = 0.0
            vel = v / 127.0
        else:
            continue
        st = dc.pan(buf, pan_amt if (i % alt_step) == 0 else -pan_amt)
        i0 = int(round(t * SR))
        if i0 < 0:
            st = st[:, -i0:]
            i0 = 0
        if i0 >= n_total:
            continue
        k = min(st.shape[1], n_total - i0)
        out[:, i0:i0 + k] += st[:, :k] * vel
    return out


def render_reverse_swell(events, n_total):
    out = np.zeros(n_total)
    freqs = sd.CHORDS["Cm"]["organ"][:3]
    for t, dur, note, vel in events:
        buf = reverse_swell_voice(freqs, dc.sec(dur))
        i0 = int(round(t * SR))
        if i0 < 0:
            buf = buf[-i0:]
            i0 = 0
        if i0 >= n_total:
            continue
        k = min(len(buf), n_total - i0)
        out[i0:i0 + k] += buf[:k] * (vel / 127.0)
    return out


# --------------------------------------------------------------------------
# I/O por trozos
# --------------------------------------------------------------------------
def write_stem(path, get_chunk, n_total, chunk_s=CHUNK_S):
    """Escribe un WAV estereo 16-bit por trozos. get_chunk(i0, i1) -> (2, m) float64."""
    ch = dc.sec(chunk_s)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        for i0 in range(0, n_total, ch):
            i1 = min(i0 + ch, n_total)
            blk = np.asarray(get_chunk(i0, i1), dtype=np.float64)
            inter = np.empty(blk.shape[1] * 2, dtype="<i2")
            inter[0::2] = np.clip(blk[0] * 32767.0, -32768, 32767).astype("<i2")
            inter[1::2] = np.clip(blk[1] * 32767.0, -32768, 32767).astype("<i2")
            w.writeframes(inter.tobytes())


def read_stem_chunk(path, i0, i1):
    """Lee un tramo de un stem estereo -> (2, m) float64."""
    with wave.open(path, "rb") as w:
        w.setpos(i0)
        raw = w.readframes(i1 - i0)
    return np.frombuffer(raw, dtype="<i2").astype(np.float64).reshape(-1, 2).T / 32768.0


def _next_pow2(n):
    p = 1
    while p < n:
        p <<= 1
    return p


def ola_convolve_stream(x, ir, tail):
    """Convolucion overlap-add en STREAMING: x (2,m) + cola previa -> (wet (2,m), cola nueva)."""
    m, L = x.shape[1], ir.shape[1]
    nfft = _next_pow2(m + L - 1)
    X = np.fft.rfft(np.concatenate([x, np.zeros((2, nfft - m))], axis=1), axis=1)
    H = np.fft.rfft(np.concatenate([ir, np.zeros((2, nfft - L))], axis=1), axis=1)
    y = np.fft.irfft(X * H, nfft, axis=1)[:, :m + L - 1]
    y[:, :L - 1] += tail
    return y[:, :m], y[:, m:]


def _pan_getter(mono, pan):
    """get_chunk que panea el mono al vuelo (ley de potencia)."""
    th = (pan + 1.0) * 0.25 * math.pi
    gl, gr = math.cos(th), math.sin(th)
    return lambda i0, i1: np.stack([mono[i0:i1] * gl, mono[i0:i1] * gr])


# --------------------------------------------------------------------------
# RENDER COMPLETO
# --------------------------------------------------------------------------
def render(bar_from=1, bar_to=sd.SONG_BARS, stems=True, verbose=True):
    t_start = time.perf_counter()
    os.makedirs(OUT_DIR, exist_ok=True)
    n_total = dc.sec((bar_to - bar_from + 1) * sd.BAR + sd.TAIL_S)
    ev, vox = build_schedule(bar_from, bar_to)
    if verbose:
        print("  eventos: " + ", ".join(f"{k}={len(v)}" for k, v in ev.items() if v))
        print(f"  guia de voz: {len(vox)} notas (solo MIDI)")

    t_off0 = (bar_from - 1) * sd.BAR
    gate_win = (0.0, 0.0)
    for s in sd.SECTIONS:
        if s["name"] == "chorus":
            gate_win = ((s["bars"][0] - 1) * sd.BAR - t_off0, s["bars"][1] * sd.BAR - t_off0)

    sdir = os.path.join(OUT_DIR, "stems") if stems else os.path.join(OUT_DIR, TMP_STEMS)
    mdir = os.path.join(OUT_DIR, "midi")
    os.makedirs(sdir, exist_ok=True)
    if stems:
        os.makedirs(mdir, exist_ok=True)

    # ------------------------------------------------------------- PASADA A
    for name, kind, ch, prog, gmn, gain, pan, rs in TRACK_DEFS:
        if name in ("organ", "drone"):
            arr = render_bed_stereo(name, ev[name], n_total,
                                    cents=6.0 if name == "organ" else 4.0)
        elif name in ALTERNOS:
            arr = render_track_stereo(name, ev[name], n_total, pan_amt=ALTERNOS[name])
        elif name == "reverse_swell":
            arr = render_reverse_swell(ev[name], n_total)
        else:
            arr = render_track(name, ev[name], n_total, gate_window=gate_win)
        pk = dc.peak(arr)
        if pk > 0.98:                                   # guardia: eventos solapados
            arr = arr * (0.95 / pk)
        lvl_pk, lvl_rms = dc.lin2db(dc.peak(arr)), dc.lin2db(dc.rms(arr))
        get = (lambda a: (lambda i0, i1: a[:, i0:i1]))(arr) if arr.ndim == 2 \
            else _pan_getter(arr, pan)
        write_stem(os.path.join(sdir, f"{name}.wav"), get, n_total)
        if verbose:
            print(f"    pista {name:<14} ev={len(ev[name]):>5}  pico={lvl_pk:7.2f} dB  "
                  f"rms={lvl_rms:7.2f} dB")
        del arr, get
        gc.collect()
    if verbose:
        print(f"  stems escritos en disco en {time.perf_counter() - t_start:.1f}s")

    # ------------------------------------------------------------- PASADA B
    mix = np.zeros((2, n_total))
    ir = make_ir(dur=3.2, decay=3.0, damp=4600.0, width=0.9)
    tail = np.zeros((2, ir.shape[1] - 1))
    ch = dc.sec(CHUNK_S)
    for i0 in range(0, n_total, ch):
        i1 = min(i0 + ch, n_total)
        dry = np.zeros((2, i1 - i0))
        rev = np.zeros((2, i1 - i0))
        for name, kind, c2, prog, gmn, gain, pan, rs in TRACK_DEFS:
            d = read_stem_chunk(os.path.join(sdir, f"{name}.wav"), i0, i1)
            dry += d * gain
            if rs:
                rev += d * (gain * rs)
            del d
        wet, tail = ola_convolve_stream(rev, ir, tail)
        mix[:, i0:i1] = (dry + wet * REV_GAIN) * PRE_GAIN
        del dry, rev, wet
    tail = None
    gc.collect()
    if verbose:
        print(f"  mezcla construida por trozos de {CHUNK_S:.0f} s en "
              f"{time.perf_counter() - t_start:.1f}s")

    # ------------------------------------------------------------- MASTER
    mix = stereo_width(mix, WIDTH)
    gc.collect()
    mix = bus_glue(mix, **GLUE)
    gc.collect()
    mix = limiter(mix, ceiling_db=TARGET_PEAK_DB)
    gc.collect()
    p = dc.peak(mix)
    if p > 0:
        mix = mix * (dc.db2lin(TARGET_PEAK_DB) / p)
    mix = dc.fade(mix, in_s=FADE_IN, out_s=FADE_OUT)

    hp_mix = np.stack([dc.hp(mix[0], 300.0), dc.hp(mix[1], 300.0)])
    corr_high = float(np.corrcoef(hp_mix[0], hp_mix[1])[0, 1])
    side_ratio_db = dc.lin2db(dc.rms((hp_mix[0] - hp_mix[1]) / 2.0)
                              / max(dc.rms(hp_mix.sum(axis=0) / 2.0), 1e-12))
    del hp_mix
    gc.collect()

    title_slug = "".join(
        ch if ch.isalnum() else "-" for ch in str(getattr(sd, "TITLE", "song")).lower()
    ).strip("-") or "song"
    tag = (title_slug if (bar_from, bar_to) == (1, sd.SONG_BARS)
           else f"{title_slug}_bars{bar_from}-{bar_to}")
    path = os.path.join(OUT_DIR, tag + ".wav")
    write_song(path, mix)
    m = measure(mix)
    with open(os.path.join(OUT_DIR, "render.json"), "w", encoding="utf-8") as manifest:
        json.dump({
            "title": str(getattr(sd, "TITLE", "song")),
            "key": str(getattr(sd, "KEY", "C minor")),
            "bpm": float(sd.BPM),
            "bars": int(sd.SONG_BARS),
            "barFrom": int(bar_from),
            "barTo": int(bar_to),
            "master": os.path.abspath(path),
            "midiDir": os.path.abspath(mdir),
            "stemsDir": os.path.abspath(sdir),
            "stems": bool(stems),
            "full": bool((bar_from, bar_to) == (1, sd.SONG_BARS)),
            "metrics": {
                "peakDb": m["peak_db"],
                "rmsDb": m["rms_db"],
                "crestDb": m["crest_db"],
                "clipped": m["clip_samples"],
            },
        }, manifest, ensure_ascii=False, indent=2)
    if verbose:
        print(f"\n  MASTER  pico={m['peak_db']:.2f} dBFS  rms={m['rms_db']:.2f} dB  "
              f"crest={m['crest_db']:.2f} dB  L/R={m['rms_l_db']:.2f}/{m['rms_r_db']:.2f}  "
              f"corr={m['corr']:.3f}  clipeadas={m['clip_samples']}")
        print(f"  IMAGEN  corr(>300Hz)={corr_high:.3f}  side/mid(>300Hz)={side_ratio_db:+.1f} dB")
        print(f"  WAV -> {path}  ({n_total / SR:.1f} s)")

    # --------------------------------------------------- MIDI + CONTROL
    checks = []
    if stems:
        for name, kind, c2, prog, gmn, gain, pan, rs in TRACK_DEFS:
            checks.append(mx.write_track_midi(os.path.join(mdir, f"{name}.mid"), name, kind,
                                              ev[name], bpm=sd.BPM, program=prog,
                                              gm_note=gmn, channel=c2))
        checks.append(mx.write_track_midi(os.path.join(mdir, f"{VOX_TRACK}.mid"), VOX_TRACK,
                                          "pitched", vox, bpm=sd.BPM, program=VOX_PROG,
                                          channel=VOX_CH))
        mt = [{"name": n, "kind": k, "events": ev[n], "program": pr, "gm_note": gm, "channel": c3}
              for (n, k, c3, pr, gm, g, p2, r) in TRACK_DEFS]
        mt.append({"name": VOX_TRACK, "kind": "pitched", "events": vox, "program": VOX_PROG,
                   "gm_note": 0, "channel": VOX_CH})
        checks.append(mx.write_multitrack_midi(os.path.join(mdir, "song.mid"), mt, bpm=sd.BPM))

    # CONTROL: se releen los stems del disco y se comparan con la mezcla (alineacion y contenido)
    n_chk = dc.sec(min(30.0, n_total / SR))
    ref = np.zeros((2, n_chk))
    for name, kind, c2, prog, gmn, gain, pan, rs in TRACK_DEFS:
        ref += read_stem_chunk(os.path.join(sdir, f"{name}.wav"), 0, n_chk) * gain
    a = ref.reshape(-1)
    b = (mix[:, :n_chk] / PRE_GAIN).reshape(-1)
    corr = float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 and np.std(b) > 0 else 0.0
    lvl = dc.lin2db(dc.rms(b) / max(dc.rms(a), 1e-12))
    if verbose:
        print(f"  stems: {len(TRACK_DEFS)} WAV en {sdir}")
        if stems:
            print(f"  MIDI : {len(checks)} ficheros en {mdir} "
                  f"({len(TRACK_DEFS)} pistas + multitrack + guia de voz)")
        print(f"  CONTROL suma de stems vs mezcla: corr={corr:.3f}  nivel={lvl:+.2f} dB "
              f"(sube por la reverb)")
        print(f"  tiempo total: {time.perf_counter() - t_start:.1f}s")
        if not stems:
            print(f"  los stems del fragmento se DEJAN en {sdir} (no se borra nada sin permiso)")
    return path, m


def main(argv):
    global OUT_DIR
    bar_from, bar_to = 1, sd.SONG_BARS
    full = "--bars" not in argv
    if not full:
        i = argv.index("--bars")
        bar_from, bar_to = int(argv[i + 1]), int(argv[i + 2])
    if "--out" in argv:
        OUT_DIR = os.path.abspath(argv[argv.index("--out") + 1])
    stems = full and ("--no-stems" not in argv)
    sd.validate()
    print(f"{sd.TITLE} -- {sd.KEY} -- {sd.BPM} BPM -- compases {bar_from}-{bar_to} "
          f"-- stems={'si' if stems else 'no'} -- out={OUT_DIR}")
    render(bar_from, bar_to, stems=stems)


if __name__ == "__main__":
    main(sys.argv[1:])
