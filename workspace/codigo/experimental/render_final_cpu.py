"""render_final_cpu.py - sintesis y stems de 'final' con el motor numpy.

Mismo plan musical que el script de GPU (plan_final.py), mismos eventos, mismos
.mid. Usa instruments.py y dsp.py tal cual: aqui no se define ningun instrumento
nuevo, solo se colocan los del motor y se procesan con sus efectos.

Escribe un WAV por pista en salida/ con un factor de escala COMUN (el balance
relativo entre pistas queda intacto) y una suma de referencia sin limitador.
"""

import math
import os
import sys
import time

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import plan_final as P   # noqa: E402
import cancion as C      # noqa: E402
import instruments as I  # noqa: E402
import dsp as D          # noqa: E402
import render as R       # noqa: E402

SR = D.SR
BAR = C.BAR
SPB = C.SPB
N = int(round(C.DUR * SR)) + int(1.5 * SR)
DIR_SAL = os.path.join(P.RAIZ, "proyectos", "final", "salida")
DIR_TMP = os.path.join(DIR_SAL, "_tmp")
T_INI = time.time()


def marca(msg):
    print(f"[{time.time() - T_INI:6.1f}s] {msg}", flush=True)


def nuevo():
    return np.zeros((N, 2), np.float32)


def guardar(nombre, x, picos):
    np.save(os.path.join(DIR_TMP, nombre + ".npy"), x.astype(np.float32))
    picos[nombre] = float(np.max(np.abs(x)))
    marca(f"  {nombre}: pico {20 * math.log10(max(picos[nombre], 1e-9)):6.1f} dBFS")


def principal():
    os.makedirs(DIR_SAL, exist_ok=True)
    os.makedirs(DIR_TMP, exist_ok=True)
    ev = P.eventos()
    picos = {}

    # ---------------------------------------------------------------- bateria
    marca("bateria: muestras")
    bombos = [I.kick(1.0, s) for s in range(4)]
    cajas = [I.snare(1.0, s) for s in range(4)]
    charles = [I.hat(1.0, s) for s in range(4)]
    platos = [I.hat(1.0, s, open_=True) for s in range(2)]
    metales = [I.metal_hit(1.0, s, pitch=p) for s, p in
               enumerate([1.0, 1.19, 0.84, 1.41, 0.71, 1.58])]

    marca("bombo")
    b = nuevo()
    for k, (t, v) in enumerate(ev["bombo"]):
        R.place(b, bombos[k % 4], t, 0.92 * v, 0.0)
    guardar("bombo", b, picos)
    del b

    marca("caja")
    b = nuevo()
    for k, (t, v) in enumerate(ev["caja"]):
        R.place(b, cajas[k % 4], t, 0.80 * v, 0.05)
    guardar("caja", b, picos)
    del b

    marca("charles")
    b = nuevo()
    for k, (t, v) in enumerate(ev["charles"]):
        R.place(b, charles[k % 4], t, 0.30 * v, -0.38)
    guardar("charles", b, picos)
    del b

    marca("plato")
    b = nuevo()
    for k, (t, v) in enumerate(ev["plato"]):
        R.place(b, platos[k % 2], t, 0.26 * v, 0.42)
    guardar("plato", b, picos)
    del b

    marca("percusion metalica")
    b = nuevo()
    for k, (t, v) in enumerate(ev["metal"]):
        p = -0.75 if k % 2 == 0 else 0.75
        R.place(b, metales[k % len(metales)], t, 0.20 * v, p)
    guardar("metal", b, picos)
    del b

    # ---------------------------------------------------------------- bajo
    marca("bajo: 735 notas")
    b = nuevo()
    for k, (t, dur, m, v) in enumerate(ev["bajo"]):
        sq = 1.0 if (k % 8 in (2, 7)) else 0.0
        y = I.bass_note(m, dur, vel=v, seed=k % 97, squelch=sq,
                        bright=1.0 if t < C.t_de(60) else 1.15)
        R.place(b, y, t, 0.62, 0.0)
    guardar("bajo", b, picos)
    del b

    # ---------------------------------------------------------------- drone
    marca("drone")
    b = nuevo()
    for k, (t, dur, m, v) in enumerate(ev["drone"]):
        y = I.drone_note(m, dur, vel=v, seed=k, cutoff=300.0 + 40 * (k % 3))
        R.place(b, y, t, 0.30, -0.65)
        R.place(b, np.roll(y, int(0.017 * SR)), t, 0.30, 0.65)
    guardar("drone", b, picos)
    del b

    # ---------------------------------------------------------------- organo
    marca("organo")
    b = nuevo()
    for k, (t, dur, voces, v) in enumerate(ev["organo"]):
        y = I.organ_chord(voces, dur, vel=v, seed=k)
        R.place(b, y, t, 0.26, -0.35)
        R.place(b, np.roll(y, int(0.023 * SR)), t, 0.26, 0.35)
    guardar("organo", b, picos)
    del b

    # ---------------------------------------------------------------- guitarra
    marca("guitarra")
    b = nuevo()
    loop = I.guitar_loop(16, C.BPM, C.GUITARRA, vel=1.0, seed=5, drive=8.0)
    loop = D.bp(loop, 900.0, 0.5)
    loop = D.lp(loop, 3800.0, 0.7)
    loop = D.soft_clip(loop * 1.6, 1.4)
    barras = sorted({int(round(t / BAR)) for (t, _, _, _) in ev["guitarra"]})
    for bar in barras:
        t = bar * BAR
        R.place(b, loop, t, 0.30, -0.55)
        R.place(b, np.roll(loop, int(0.031 * SR)), t, 0.30, 0.55)
    guardar("guitarra", b, picos)
    del b

    # ---------------------------------------------------------------- sint breakdown
    marca("sint breakdown")
    b = nuevo()
    for k, (t, dur, voces, v) in enumerate(ev["sint_break"]):
        y = I.organ_chord(voces, dur, vel=v, seed=1000 + k)
        y = D.soft_clip(y * 2.2, 1.6)
        R.place(b, y, t, 0.22, -0.35)
        R.place(b, np.roll(y, int(0.009 * SR)), t, 0.22, 0.35)
    guardar("sint_break", b, picos)
    del b

    # ---------------------------------------------------------------- voz
    marca("voz lead: 431 silabas")
    sil = ev["voz_lead"]
    y = I.voice(sil, seed=3, f0_base=98.0, breath=0.12, drive=1.0,
                whisper=False, jitter=0.35, tail=0.35, tilt=1.0)
    y = R.cadena_voz(y, drive=1.0, rev_mix=0.16, dly_mix=0.20, sil=sil, bright=1.0)
    b = np.zeros((N, 2), np.float32)
    n = min(len(y), N)
    b[:n] = y[:n]
    guardar("voz_lead", b, picos)
    del b, y

    marca("voz dobles y susurros")
    dob = ev["voz_dobles"]
    y = I.voice(dob, seed=11, f0_base=98.0, breath=0.35, drive=1.0,
                whisper=True, jitter=0.45, tail=0.4, tilt=0.9)
    y = R.cadena_voz(y, drive=1.0, rev_mix=0.30, dly_mix=0.0, sil=None, bright=0.9)
    b = np.zeros((N, 2), np.float32)
    n = min(len(y), N)
    b[:n] = y[:n]
    guardar("voz_dobles", b, picos)
    del b, y

    # ---------------------------------------------------------------- fx
    marca("fx")
    b = nuevo()
    ir_l = D.reverb_ir(3.2, 0.62, seed=31, lp_hz=4200.0)
    ir_r = D.reverb_ir(3.2, 0.62, seed=32, lp_hz=4200.0)
    for (tipo, t, g) in ev["fx"]:
        if tipo == "squelch":
            y = I.squelch(1.0, seed=int(t) % 13, dur=0.38)
            R.place(b, y, t, 0.55 * g, -0.2)
        elif tipo == "growl":
            y = I.feedback_growl(1.0, seed=int(t) % 17, dur=1.6, f0=196.0)
            R.place(b, y, t, 0.45 * g, 0.25)
        elif tipo == "siseo":
            n = int(6.0 * SR)
            y = D.vinyl_noise(n, seed=int(t) % 7, hiss=0.05, crackle=0.5)
            tt = np.arange(n) / SR
            env = np.clip(tt / 1.5, 0, 1) * np.clip((n / SR - tt) / 2.0, 0, 1)
            R.place(b, y * env, t, 0.30 * g, 0.0)
        elif tipo == "eco":
            y = I.organ_chord([57, 60, 64], 1.2, vel=0.8, seed=41)
            y = D.delay(y, 0.5, fb=0.45, mix=0.5, taps=5, lp_hz=3000.0)
            R.place(b, y, t, 0.35 * g, 0.3)
        elif tipo == "inv":
            src = I.organ_chord([45, 48, 52], 2.4, vel=0.8, seed=51)
            y = I.reverse_swell(src, dur=2.6)
            y = R.reverb_st(y, ir_l, ir_r, mix=0.5)
            R.place(b, y, t, 0.40 * g, -0.4)
        elif tipo == "granular":
            src = I.organ_chord([45, 52], 2.4, vel=0.8, seed=61)
            y = I.reverse_swell(src, dur=2.6)
            y = D.soft_clip(y * 1.8, 1.4)
            R.place(b, y, t, 0.35 * g, 0.0)
    guardar("fx", b, picos)
    del b

    # ---------------------------------------------------------------- piano
    marca("piano final")
    b = nuevo()
    for k, (t, dur, m, v) in enumerate(ev["piano"]):
        y = I.piano_note(m, dur, vel=v, seed=k, detune=0.0)
        R.place(b, y, t, 0.55, 0.0)
    ir_p = D.reverb_ir(2.6, 0.55, seed=71, lp_hz=6000.0)
    ir_p2 = D.reverb_ir(2.6, 0.55, seed=72, lp_hz=6000.0)
    b = R.reverb_st(b, ir_p, ir_p2, mix=0.30)
    guardar("piano", b, picos)
    del b

    # ---------------------------------------------------------------- escritura
    marca("escribiendo stems con factor comun")
    maximo = max(picos.values())
    g = 10 ** (-1.0 / 20) / maximo
    marca(f"factor comun {20 * math.log10(g):+.2f} dB (pico maximo {20 * math.log10(maximo):.2f} dBFS)")

    suma = np.zeros((N, 2), np.float32)
    for nombre in picos:
        x = np.load(os.path.join(DIR_TMP, nombre + ".npy"))
        n = min(len(x), N)
        x = x[:n].copy()
        # fade final de 5 s
        m = int(5.0 * SR)
        rampa = (np.linspace(1.0, 0.0, m) ** 1.5).astype(np.float32)
        x[-m:] *= rampa[:, None]
        objetivo = 20 * math.log10(max(g * picos[nombre], 1e-9))
        R.write_wav(os.path.join(DIR_SAL, f"final_{nombre}.wav"), x * g, width=3)
        marca(f"  final_{nombre}.wav  pico {objetivo:6.1f} dBFS")
        suma[:n] += x * g
        os.remove(os.path.join(DIR_TMP, nombre + ".npy"))
        del x

    # suma de referencia: solo balance, sin limitador ni master
    ref = np.zeros((N, 2), np.float32)
    for nombre in picos:
        x = np.load(os.path.join(DIR_TMP, nombre + ".npy")) if os.path.exists(
            os.path.join(DIR_TMP, nombre + ".npy")) else None
        del x
    # (los .npy ya se han borrado: la suma se rehace leyendo los WAV escritos)
    for nombre in picos:
        ruta = os.path.join(DIR_SAL, f"final_{nombre}.wav")
        with open(ruta, "rb") as f:
            f.seek(44)
            crudo = np.frombuffer(f.read(), dtype=np.uint8).reshape(-1, 3)
        ent = np.zeros((crudo.shape[0], 4), np.uint8)
        ent[:, :3] = crudo
        v = ent.view("<i4").reshape(-1, 2).astype(np.float32) / 8388607.0
        ref[:len(v)] += v
    R.write_wav(os.path.join(DIR_SAL, "final_suma_referencia.wav"), ref, width=3)

    mono = ref.mean(axis=1).astype(np.float64)
    est = ref.astype(np.float64)
    marca("metricas de la suma de referencia:")
    print(f"  LUFS integrados : {D.lufs_integrated(mono, fs=SR):.2f}")
    print(f"  true peak       : {D.true_peak_db(est, fs=SR):.2f} dBFS")
    print(f"  crest           : {D.crest_db(est):.2f} dB")
    print(f"  rms             : {D.rms_db(est):.2f} dBFS")
    marca("hecho")


if __name__ == "__main__":
    principal()
