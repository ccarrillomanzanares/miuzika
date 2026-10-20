#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""render_song.py -- montaje completo de "Static Prayer" (dark synth-pop industrial).

Uso:
    python render_song.py                 # cancion completa (~3:03, tarda unos minutos)
    python render_song.py --bars 17 24    # solo ese rango de compases (iteracion rapida)
    python render_song.py --out nombre.wav

Une:
  - song_data.py   (armonia, secciones, patrones)  -> DISENO MUSICAL
  - voices_drums   (perfusion) / voices_synths (voces) -> material
  - mix_master     (reverb FFT, delay ping-pong, bus, limitador, escritura)
El master (niveles, envíos a reverb/delay, ducking y cadena final) se define aquí, en MIX.
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dsp_core as dc
import song_data as sd
from mix_master import (bus_glue, convolve_fft, limiter, make_ir, measure,
                        pingpong, stereo_width, write_song)
from voices_drums import clap, hat, impact, kick, metal, rev_cymbal, snare, sweep
from voices_synths import bass, choir, lead, pad, pluck, strings

# --------------------------------------------------------------------------
# Cache de voces: las voces son DETERMINISTAS (seed fija), asi que la misma
# llamada devuelve el mismo buffer. En 68 compases el patron se repite cientos de
# veces: sin cache el render pasa de ~100 s a ~8 min. Nunca se modifica in situ
# un buffer cacheado (gate_tail y add_voice devuelven/copian).
# --------------------------------------------------------------------------
_CACHE: dict = {}


def _cached(fn):
    def wrapper(*a, **k):
        try:
            key = (fn.__name__, a,
                   tuple(sorted((kk, tuple(vv) if isinstance(vv, list) else vv)
                                for kk, vv in k.items())))
            hash(key)
        except TypeError:                     # argumento no hasheable: sin cache
            return fn(*a, **k)
        v = _CACHE.get(key)
        if v is None:
            v = fn(*a, **k)
            _CACHE[key] = v
        return v
    wrapper.__name__ = fn.__name__
    return wrapper


kick, snare, hat, clap = _cached(kick), _cached(snare), _cached(hat), _cached(clap)
metal, sweep, impact, rev_cymbal = (_cached(metal), _cached(sweep),
                                    _cached(impact), _cached(rev_cymbal))
bass, pad, strings = _cached(bass), _cached(pad), _cached(strings)
choir, lead, pluck = _cached(choir), _cached(lead), _cached(pluck)

# EQ de insert por pista: separa bombo/bajo, quita barro al pad y limpia cuerdas/arp


def _shaped(fn, hp_f=None, lp_f=None):
    """Insert por pista aplicado DENTRO del cache (una vez por voz unica).

    Es lo que separa bombo y bajo (que ocupan la misma zona) y lo que quita el barro
    del pad/cuerdas. Sobre buffers cortos (una voz), asi que el coste es despreciable.
    """
    def inner(*a, **k):
        v = fn(*a, **k)
        if hp_f:
            v = dc.hp(v, hp_f)
        if lp_f:
            v = dc.lp(v, lp_f)
        return v
    inner.__name__ = fn.__name__ + "_shaped"
    return inner


kick = _cached(_shaped(kick, hp_f=32.0))
bass = _cached(_shaped(bass, hp_f=45.0))
snare = _cached(_shaped(snare, hp_f=160.0))
impact = _cached(_shaped(impact, hp_f=25.0, lp_f=6000.0))
choir = _cached(_shaped(choir, hp_f=150.0))
strings = _cached(_shaped(strings, hp_f=190.0))
pluck = _cached(_shaped(pluck, hp_f=300.0))
lead = _cached(_shaped(lead, hp_f=260.0))


# --------------------------------------------------------------------------
# MEZCLA: ganancia, paneo y envios (reverb 'rev', delay 'dly') por pista
# --------------------------------------------------------------------------
MIX = {
    "kick":    {"g": 0.88, "pan":  0.00, "rev": 0.05, "dly": 0.00},
    "snare":   {"g": 0.78, "pan":  0.00, "rev": 0.24, "dly": 0.05},
    "hat":     {"g": 0.30, "pan":  0.22, "rev": 0.10, "dly": 0.03},
    "clap":    {"g": 0.32, "pan": -0.18, "rev": 0.30, "dly": 0.00},
    "metal":   {"g": 0.42, "pan":  0.00, "rev": 0.34, "dly": 0.10,},
    "perc_fx": {"g": 0.50, "pan":  0.00, "rev": 0.28, "dly": 0.00},
    "bass":    {"g": 0.90, "pan":  0.00, "rev": 0.00, "dly": 0.00},
    "pad":     {"g": 0.50, "pan":  0.00, "rev": 0.55, "dly": 0.00},
    "choir":   {"g": 0.55, "pan":  0.00, "rev": 0.60, "dly": 0.06},
    "strings": {"g": 0.44, "pan": -0.10, "rev": 0.30, "dly": 0.05},
    "arp":     {"g": 0.40, "pan":  0.28, "rev": 0.25, "dly": 0.55},
    "pluck":   {"g": 0.40, "pan": -0.28, "rev": 0.22, "dly": 0.45},
    "lead":    {"g": 0.58, "pan":  0.05, "rev": 0.32, "dly": 0.42},
}
TRACKS = list(MIX)

DUCK_DEPTH = 0.22          # cuanto baja el pad cuando pega el bombo
DUCK_ATT, DUCK_HOLD, DUCK_REL = 0.004, 0.030, 0.22
REV_GAIN = 0.34            # cantidad de reverb en la mezcla
DLY_GAIN = 0.30
WIDTH = 0.35               # anchura mid/side final (0 = sin cambios; >0 abre)
HAAS_TRACKS = (("pad", 0.9), ("choir", 1.5))   # ensanchado por retardo minimo (ms)
GLUE = dict(thresh_db=-15.0, ratio=2.0, attack=0.025, release=0.20, makeup_db=1.0)
FADE_IN, FADE_OUT = 1.6, 6.5
TARGET_PEAK_DB = -1.0

RNG = np.random.default_rng(20261020)


# --------------------------------------------------------------------------
# helpers de montaje
# --------------------------------------------------------------------------
def add_voice(dst, src, t_sec, gain=1.0, pan_value=0.0):
    """Suma una voz (mono o estereo) a un bus (2, n) recortando al final del bus."""
    a = np.asarray(src, dtype=np.float64)
    if a.ndim == 2:
        st = a if a.shape[0] == 2 else a.T
    else:
        st = dc.pan(a, pan_value)
    i0 = int(round(t_sec * dc.SR))
    if i0 < 0:
        st = st[:, -i0:]
        i0 = 0
    if i0 >= dst.shape[1]:
        return
    k = min(st.shape[1], dst.shape[1] - i0)
    dst[:, i0:i0 + k] += st[:, :k] * gain


def gate_tail(note, gate_s, release_s=0.03):
    """Articula una nota: meseta 'gate_s' y release rapido (evita colas que se pisan)."""
    n = len(note)
    g = min(int(gate_s * dc.SR), n)
    r = min(int(release_s * dc.SR), max(n - g, 0))
    e = np.zeros(n)
    e[:g] = 1.0
    if r > 1:
        e[g:g + r] = np.linspace(1.0, 0.0, r)
    return note * e


def hum(t, amount=0.004):
    """Jitter humano de tiempo (los patrones de máquina no respiran)."""
    return t + float(RNG.uniform(-amount, amount))


def vhum(v, amount=0.06):
    return float(np.clip(v * (1.0 + RNG.uniform(-amount, amount)), 0.02, 1.0))


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------
def render(bar_from=1, bar_to=sd.SONG_BARS, out_name="static_prayer.wav", verbose=True):
    t_start = time.perf_counter()
    n_bars = bar_to - bar_from + 1
    span = n_bars * sd.BAR
    n_total = dc.sec(span + sd.TAIL_S)
    t_off = (bar_from - 1) * sd.BAR          # tiempo absoluto del primer compas renderizado

    tracks = {k: dc.bus(n_total) for k in TRACKS}
    duck = np.ones(n_total)

    def n_of(seconds, extra=0.30):
        return dc.sec(seconds + extra)

    # ---------------------------------------------------------------- arreglo
    for sec in sd.SECTIONS:
        a, b = sec["bars"]
        if b < bar_from or a > bar_to:
            continue
        a, b = max(a, bar_from), min(b, bar_to)
        prog = sd.PROG[sec["prog"]]
        layers = set(sec["layers"])
        energy = sec["energy"]
        if verbose:
            print(f"  [{sec['name']:<8}] compases {a}-{b}  energia {energy:.2f}  "
                  f"t={((a-1)*sd.BAR - t_off):7.1f}s")

        # --- patron de bateria de la seccion
        drum_key = None
        for cand in ("drums_chorus", "drums_verse", "drums_bridge"):
            if cand in layers:
                drum_key = cand.split("_")[1]
        # --- runs de acorde (voces sostenidas: pad y coro, sin re-ataque por compas)
        run_start, run_chord = a, prog[a - sec["bars"][0]]
        runs = []
        for bar in range(a, b + 1):
            ch = prog[bar - sec["bars"][0]]
            if ch != run_chord:
                runs.append((run_start, bar - 1, run_chord))
                run_start, run_chord = bar, ch
        runs.append((run_start, b, run_chord))

        # --- voces sostenidas por run
        if "pad" in layers:
            for (b0, b1, ch) in runs:
                bars = b1 - b0 + 1
                dur = bars * sd.BAR
                freqs = [dc.note(x) for x in sd.CHORDS[ch]["pad"]]
                v = pad(freqs, n_of(dur, 1.6), attack=0.65, release=1.5,
                        cutoff=1500.0 + 1900.0 * energy, detune=7.0 + 3.0 * energy)
                add_voice(tracks["pad"], v, (b0 - 1) * sd.BAR - t_off, gain=1.0)
        if "choir_ooh" in layers or "choir_ah" in layers:
            vowel = "ah" if "choir_ah" in layers else "ooh"
            g = 0.55 if vowel == "ooh" else 1.0
            for (b0, b1, ch) in runs:
                bars = b1 - b0 + 1
                dur = bars * sd.BAR
                freqs = [dc.note(x) for x in sd.CHORDS[ch]["choir"]]
                v = choir(freqs, n_of(dur, 1.4), vowel=vowel, attack=0.45,
                          release=1.1, breath=0.18 if vowel == "ooh" else 0.12)
                add_voice(tracks["choir"], v, (b0 - 1) * sd.BAR - t_off, gain=g)

        # --- compas a compas
        for bar in range(a, b + 1):
            ch = prog[bar - sec["bars"][0]]
            c = sd.CHORDS[ch]
            t0 = (bar - 1) * sd.BAR - t_off
            root_hz = dc.note(c["bass"])

            # bateria
            if drum_key:
                pat = sd.DRUMS[drum_key]
                for step, vel in pat.get("kick", []):
                    n = dc.sec(0.65)
                    v = kick(n)
                    add_voice(tracks["kick"], v, hum(t0 + step * sd.STEP), gain=vhum(vel))
                    # ducking del pad/bajo con el bombo
                    d = dc.env_duck(22050, DUCK_ATT, DUCK_HOLD, DUCK_REL)
                    i0 = int((t0 + step * sd.STEP) * dc.SR)
                    k = min(len(d), n_total - i0)
                    if i0 >= 0 and k > 0:
                        duck[i0:i0 + k] = np.minimum(duck[i0:i0 + k],
                                                     1.0 - (1.0 - d[:k]) * DUCK_DEPTH)
                for step, vel in pat.get("snare", []):
                    gate = 0.14 if drum_key == "chorus" else 0.0
                    add_voice(tracks["snare"], snare(dc.sec(0.6 + max(gate, 0.0)), gate=gate),
                              hum(t0 + step * sd.STEP), gain=vhum(vel))
                for step, vel in pat.get("hat", []):
                    add_voice(tracks["hat"], hat(dc.sec(0.09)), hum(t0 + step * sd.STEP, 0.003),
                              gain=vhum(vel))
                for step, vel in pat.get("hat_open", []):
                    add_voice(tracks["hat"], hat(dc.sec(0.30), open=True),
                              hum(t0 + step * sd.STEP, 0.003), gain=vhum(vel) * 0.8)
                for step, vel in pat.get("clap", []):
                    add_voice(tracks["clap"], clap(dc.sec(0.35)), hum(t0 + step * sd.STEP),
                              gain=vhum(vel))
                for step, vel in pat.get("metal", []):
                    add_voice(tracks["metal"], metal(dc.sec(1.6)), hum(t0 + step * sd.STEP),
                              gain=vhum(vel) * 0.8, pan_value=0.35 if step % 2 else -0.35)

            # metal de acentos (chorus): al principio de cada 4 compases + pickup
            if "metal_acc" in layers:
                rel = (bar - sec["bars"][0]) % 4
                if rel == 0:
                    add_voice(tracks["metal"], metal(dc.sec(2.0)), t0, gain=0.55,
                              pan_value=0.45 if (bar // 4) % 2 else -0.45)
                if rel == 3:
                    add_voice(tracks["metal"], metal(dc.sec(1.2)), t0 + 14 * sd.STEP,
                              gain=0.32, pan_value=-0.3)

            # pulso industrial (intro/outro)
            if "metal_pulse" in layers:
                step = 0 if (bar % 2) else 8
                add_voice(tracks["metal"], metal(dc.sec(2.2)),
                          t0 + step * sd.STEP, gain=0.34,
                          pan_value=0.4 if step else -0.4)

            # bajo
            bkey = None
            if "bass" in layers:
                bkey = "chorus" if sec["prog"] == "chorus" else ("intro" if sec["prog"] == "intro"
                                                                 else "verse")
            elif "bass_sparse" in layers:
                bkey = "bridge"
            if bkey:
                for step, semi, dur, vel in sd.BASS[bkey]:
                    dur_s = dur * sd.STEP
                    f = dc.shift(root_hz, semi)
                    v = bass(f, n_of(dur_s), glide=0.06, acc=min(vel, 1.0),
                             fc_env=(160.0, 2100.0 + 700.0 * energy), fc_tau=0.20)
                    v = gate_tail(v, dur_s * 0.92)
                    add_voice(tracks["bass"], v, hum(t0 + step * sd.STEP, 0.002),
                              gain=vhum(vel) * 0.95)
            elif "sub_pulse" in layers:
                for step in (0, 8):
                    f = root_hz
                    n = dc.sec(0.9)
                    v = dc.osc("sine", f, n) * dc.env_ad(n, 0.005, 0.45, shape=1.4)
                    v += 0.35 * dc.osc("sine", f * 2.0, n) * dc.env_ad(n, 0.003, 0.30, shape=1.6)
                    add_voice(tracks["bass"], dc.soft_clip(v, 1.4), t0 + step * sd.STEP,
                              gain=0.75)

            # stabs de cuerda (chorus)
            if "strings" in layers:
                freqs = [dc.note(x) for x in c["pad"]]
                for step, vel in ((0, 1.0), (8, 0.78)):
                    v = strings(freqs, dc.sec(1.0), drive=2.0)
                    v = gate_tail(v, 0.30, 0.10)
                    add_voice(tracks["strings"], v, t0 + step * sd.STEP, gain=vel * 0.9)

            # arpegio suave y pluck
            if "arp_soft" in layers:
                for step, idx in enumerate(sd.ARP["intro" if sec["prog"] == "intro" else "soft"]):
                    if idx is None:
                        continue
                    f = dc.note(c["arp"][idx])
                    v = pluck(f, dc.sec(0.55), decay=0.34, cutoff=1900.0)
                    add_voice(tracks["arp"], v, hum(t0 + step * sd.STEP, 0.002), gain=0.55)
            if "pluck" in layers:
                for step, idx in enumerate(sd.ARP["drive"]):
                    if idx is None:
                        continue
                    f = dc.note(c["arp"][idx]) * (2.0 if step % 2 else 1.0)
                    v = pluck(f, dc.sec(0.40), decay=0.26, cutoff=2400.0)
                    add_voice(tracks["pluck"], v, hum(t0 + step * sd.STEP, 0.002), gain=0.42)

        # --- lead (frases por seccion, en tiempo absoluto de compas)
        lead_keys = [k for k in (sec["name"], sec["name"].rstrip("123")) if k in sd.LEAD]
        for key in lead_keys[:1]:
            oct_shift = 12 if "lead_chorus_hi" in layers else 0
            for bo, step, nt, dur, vel in sd.LEAD[key]:
                bar_abs = sec["bars"][0] + bo
                if not (bar_from <= bar_abs <= bar_to):
                    continue
                f = dc.shift(dc.note(nt), oct_shift)
                dur_s = dur * sd.STEP
                v = lead(f, n_of(dur_s, 0.25), glide=0.04, drive=2.6,
                         wah=(0.35 + 0.25 * energy, 2.6))
                v = gate_tail(v, dur_s * 0.95, 0.18)
                add_voice(tracks["lead"], v, (bar_abs - 1) * sd.BAR - t_off + step * sd.STEP,
                          gain=vel)
        if "choir_melody" in layers:
            for bo, step, nt, dur, vel in sd.LEAD["chorus"]:
                bar_abs = sec["bars"][0] + bo
                if not (bar_from <= bar_abs <= bar_to):
                    continue
                dur_s = dur * sd.STEP
                v = choir([dc.note(nt)], n_of(dur_s, 0.5), vowel="ah", attack=0.18,
                          release=0.5, breath=0.10)
                add_voice(tracks["choir"], v, (bar_abs - 1) * sd.BAR - t_off + step * sd.STEP,
                          gain=vel * 0.55)

    # ------------------------------------------------------------- one-shots
    for e in sd.EXTRAS:
        if not (bar_from <= e["bar"] <= bar_to):
            continue
        t0 = (e["bar"] - 1) * sd.BAR - t_off + e["step"] * sd.STEP
        dur = e["dur"]
        if e["kind"] == "sweep":
            v = sweep(dc.sec(dur), f_start=180.0, f_end=6800.0, res=2.2)
        elif e["kind"] == "impact":
            v = impact(dc.sec(dur))
        elif e["kind"] == "rev_cym":
            v = rev_cymbal(dc.sec(dur))
        else:
            v = metal(dc.sec(dur))
        add_voice(tracks["perc_fx"], v, t0, gain=e["gain"], pan_value=e["pan"])

    # ------------------------------------------------- ensanchado de sostenidos
    # pad y coro son mono-centro: un retardo minimo en un canal los abre sin tocar los graves
    for name, d_ms in HAAS_TRACKS:
        if dc.peak(tracks[name]) > 0:
            tracks[name] = dc.haas(tracks[name][0], d_ms)

    # ---------------------------------------------------------------- mezcla
    dry = dc.bus(n_total)
    rev_send = dc.bus(n_total)
    dly_send = np.zeros(n_total)
    for k in TRACKS:
        m = MIX[k]
        g = m["g"]
        if k in ("pad", "choir"):                 # ducking suave con el bombo
            tracks[k] = tracks[k] * duck
        dry += tracks[k] * g
        if m["rev"]:
            rev_send += tracks[k] * (g * m["rev"])
        if m["dly"]:
            dly_send += dc.mono_sum(tracks[k]) * (g * m["dly"])

    if verbose:
        print(f"  voces renderizadas en {time.perf_counter() - t_start:.1f}s")
        for k in TRACKS:
            print(f"    pista {k:<8} pico={dc.lin2db(dc.peak(tracks[k])):7.2f} dB  "
                  f"rms={dc.lin2db(dc.rms(tracks[k])):7.2f} dB")

    ir = make_ir(dur=3.0, decay=3.2, damp=4800.0, width=0.9)
    wet = convolve_fft(rev_send, ir)
    dly = pingpong(dly_send, time_s=1.5 * sd.BEAT, feedback=0.42, mix=1.0)

    mix = dry + wet * REV_GAIN + dly * DLY_GAIN
    # stereo_width ya deja el side <140 Hz a cero (graves mono); no hace falta EQ extra
    mix = stereo_width(mix, WIDTH)

    mix = bus_glue(mix, **GLUE)
    mix = limiter(mix, ceiling_db=TARGET_PEAK_DB)

    # normalizacion conjunta (una sola ganancia para los dos canales) y fades al final
    p = dc.peak(mix)
    if p > 0:
        mix = mix * (dc.db2lin(TARGET_PEAK_DB) / p)
    mix = dc.fade(mix, in_s=FADE_IN, out_s=FADE_OUT)

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out_name)
    info = write_song(path, mix)
    m = measure(mix)
    if verbose:
        print(f"\n  MASTER  pico={m['peak_db']:.2f} dBFS  rms={m['rms_db']:.2f} dB  "
              f"crest={m['crest_db']:.2f} dB  L/R={m['rms_l_db']:.2f}/{m['rms_r_db']:.2f} dB  "
              f"corr={m['corr']:.3f}  clipeadas={m['clip_samples']}")
        print(f"  WAV -> {path}  ({info['frames'] / dc.SR:.1f} s, {info['frames']} frames)")
        print(f"  tiempo total de render: {time.perf_counter() - t_start:.1f}s")
    return path, m


def main(argv):
    bar_from, bar_to, out = 1, sd.SONG_BARS, "static_prayer.wav"
    if "--bars" in argv:
        i = argv.index("--bars")
        bar_from, bar_to = int(argv[i + 1]), int(argv[i + 2])
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    sd.validate()
    print(f"{sd.TITLE} -- {sd.KEY} -- {sd.BPM} BPM -- compases {bar_from}-{bar_to}")
    render(bar_from, bar_to, out)


if __name__ == "__main__":
    main(sys.argv[1:])
