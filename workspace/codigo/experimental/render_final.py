"""render_final.py - sintesis, procesado y stems de 'final' en el motor GPU.

Todo el material sale de cancion.py (via plan_final.py). Aqui solo se sintetiza
y se procesa: osciladores batcheados, saturacion 4x con antialias, reverb FFT,
shimmer, congelado espectral, granular y compresor multibanda.

Escribe un WAV por pista en salida/ conservando el balance relativo entre ellas
(mismo factor de escala global) y una suma de referencia SIN limitador.
"""

import math
import os
import sys
import time

import numpy as np
import torch

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import plan_final as P   # noqa: E402
import cancion as C      # noqa: E402
import motor_gpu as M    # noqa: E402

FS = M.SR
DEV = M.DISPOSITIVO
DTYPE = M.DT
NLARGO = int(round(C.DUR * FS)) + int(1.5 * FS)
DIR_SAL = os.path.join(P.RAIZ, "proyectos", "final", "salida")
T_INI = time.time()


def marca(msg):
    print(f"[{time.time() - T_INI:6.1f}s] {msg}", flush=True)


def bus_nuevo():
    return torch.zeros(NLARGO, device=DEV)


def hz_de(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def envolvente_actividad(x, ms=350.0, umbral=0.02):
    """1 donde hay senal, 0 en los huecos (suavizada). Para el delay de la voz."""
    n = max(int(FS * ms / 1000.0), 8)
    a = torch.nn.functional.max_pool1d(x.abs().reshape(-1, 1, x.shape[-1]), n, stride=1,
                                       padding=n // 2)[..., :x.shape[-1]]
    a = (a > umbral).to(DTYPE)
    a = torch.nn.functional.avg_pool1d(a, n, stride=1, padding=n // 2)[..., :x.shape[-1]]
    return a.reshape(x.shape)


def delay_largo(x, tiempos, fb=0.45):
    """Ecos con realimentacion decreciente, sin bucle (taps fijos)."""
    y = x.clone()
    for k, tt in enumerate(tiempos):
        d = int(tt * FS)
        if d <= 0 or d >= x.shape[-1]:
            continue
        y[:, d:] += x[:, :-d] * (fb ** (k + 1))
    return y


def fade_final(x, seg=5.0):
    n = min(int(seg * FS), x.shape[-1])
    rampa = torch.linspace(1.0, 0.0, n, device=DEV) ** 1.5
    x = x.clone()
    x[..., -n:] *= rampa
    return x


def render_agrupado(fn, eventos, tam=48, extra=0.0):
    """eventos [(t, dur, midi, vel)] -> bus 1-D, agrupando por duracion."""
    b = bus_nuevo()
    grupos = {}
    for (t, dur, m, vel) in eventos:
        grupos.setdefault(round(dur, 4), []).append((t, m, vel))
    for dur, lista in sorted(grupos.items()):
        n = max(int(round((dur + extra) * FS)), 128)
        for i in range(0, len(lista), tam):
            blq = lista[i:i + tam]
            f0 = torch.tensor([hz_de(m) for (_, m, _) in blq], dtype=DTYPE, device=DEV)
            vel = torch.tensor([v for (_, _, v) in blq], dtype=DTYPE, device=DEV)
            x = fn(f0, n, vel)
            ini = torch.tensor([int(round(t * FS)) for (t, _, _) in blq], dtype=torch.long, device=DEV)
            b = M.sumar(b, x, ini)
    return b


def render_perc(fn, eventos, n, tam=64):
    """eventos [(t, vel)] -> bus 1-D con un golpe de n muestras por evento."""
    b = bus_nuevo()
    for i in range(0, len(eventos), tam):
        blq = eventos[i:i + tam]
        vel = torch.tensor([v for (_, v) in blq], dtype=DTYPE, device=DEV)
        x = fn(n, vel)
        ini = torch.tensor([int(round(t * FS)) for (t, _) in blq], dtype=torch.long, device=DEV)
        b = M.sumar(b, x, ini)
    return b


# ------------------------------------------------------------------ instrumentos
def bombo_sucio(n, vel):
    """Bombo de maquina: saturado, con siseo de vinilo encima."""
    x = M.bombo(n, vel)
    x = M.saturar(x, drive=2.8, veces=4)
    r = M.pasa_banda(torch.randn(x.shape, device=DEV), 2600.0, 12000.0, taps=63)
    env = torch.exp(-M.segundos(n) / 0.045)[None, :]
    x = x + 0.11 * r * env
    return M.paso_bajo(x, 9500.0)


def caja_sucia(n, vel):
    """Caja distorsionada con ring modulation: no suena a caja, suena a prensa."""
    x = M.caja(n, vel)
    x = M.saturar(x, drive=5.5, veces=4)
    t = M.segundos(n)
    portadora = torch.sin(2 * torch.pi * 137.0 * t + 0.7)
    x = x * (0.60 + 0.40 * portadora)[None, :]
    return M.pasa_banda(x, 170.0, 11000.0, taps=63)


def charles_rigido(n, vel):
    x = M.charles(n, vel)
    return M.paso_alto(x, 5200.0)


def plato_largo(n, vel):
    x = M.charles(n, vel, abierto=True)
    return M.paso_alto(x, 4200.0)


def metal_golpe(n, vel):
    V = vel.numel()
    pitch = torch.linspace(0.82, 1.24, V, device=DEV)
    x = M.metal(n, vel, pitch)
    return M.saturar(x, drive=2.0, veces=4)


def bajo_grueso(f0, n, vel):
    """Minimoog cruzado con Oberheim: dos osciladores, filtro que escupe y satura."""
    t = M.segundos(n)
    s = M.osc(f0, n, "sierra", fase_ini=0.0)
    p = M.osc(f0 * 1.0035, n, "pulso", fase_ini=0.25)
    x = 0.62 * s + 0.38 * p

    def forma(fr, tt):
        a = torch.clamp(tt / 0.008, max=1.0)
        cierre = torch.exp(-tt / 0.20)
        corte = 170.0 + 1450.0 * a * cierre
        lf = torch.log2(torch.clamp(fr, min=20.0))[:, None]
        lc = torch.log2(torch.clamp(corte, min=20.0))[None, :]
        return torch.exp(-0.5 * ((lf - lc) / 0.85) ** 2) * 1.7 + 0.22

    x = M.tv_filter(x, forma, n=1024, hop=256)
    env = torch.clamp(t / 0.004, max=1.0) * torch.clamp((n / FS - t) / 0.045, max=1.0)
    x = x * env[None, :] * vel[:, None]
    x = M.saturar(x, drive=2.4, veces=4)
    return M.paso_bajo(x, 4200.0)


def drone_oscuro(f0, n, vel):
    t = M.segundos(n)
    x = M.osc(f0, n, "sierra", vibrato=0.004)
    x = x + 0.55 * M.osc(f0 * 0.5, n, "seno")
    x = x + 0.30 * M.osc(f0 * 1.005, n, "sierra", fase_ini=0.5)
    x = M.paso_bajo(x, 340.0)
    x = M.saturar(x, drive=1.7, veces=4)
    env = torch.clamp(t / 0.55, max=1.0) * torch.clamp((n / FS - t) / 0.9, max=1.0)
    return x * env[None, :] * vel[:, None]


def organo_colchon(f0, n, vel):
    t = M.segundos(n)
    x = M.osc(f0, n, "sierra", vibrato=0.003)
    x = x + 0.45 * M.osc(f0 * 2.0, n, "pulso", fase_ini=0.3)
    x = M.paso_bajo(x, 1500.0)
    x = M.saturar(x, drive=1.5, veces=4)
    env = torch.clamp(t / 0.35, max=1.0) * torch.clamp((n / FS - t) / 0.7, max=1.0)
    return x * env[None, :] * vel[:, None]


def guitarra_crujiente(f0, n, vel):
    t = M.segundos(n)
    x = M.osc(f0, n, "sierra", vibrato=0.006)
    x = x + 0.55 * M.osc(f0 * 1.4983, n, "sierra", fase_ini=0.4)
    x = M.saturar(x, drive=7.5, veces=4)
    x = M.pasa_banda(x, 230.0, 5200.0, taps=63)
    env = torch.clamp(t / 0.003, max=1.0) * torch.clamp((n / FS - t) / 0.06, max=1.0)
    return x * env[None, :] * vel[:, None]


def sint_break(f0, n, vel, corte=1500.0):
    t = M.segundos(n)
    x = M.osc(f0, n, "sierra", fase_ini=0.1)
    x = x + 0.5 * M.osc(f0 * 1.007, n, "pulso", fase_ini=0.6)
    x = M.paso_bajo(x, corte)
    x = M.saturar(x, drive=2.0, veces=4)
    env = torch.clamp(t / 0.006, max=1.0) * torch.clamp((n / FS - t) / 0.05, max=1.0)
    return x * env[None, :] * vel[:, None]


FORMANTES = {
    'a': [(730.0, 1.00, 90.0), (1090.0, 0.55, 110.0), (2440.0, 0.25, 160.0)],
    'e': [(530.0, 1.00, 80.0), (1840.0, 0.45, 100.0), (2480.0, 0.22, 150.0)],
    'i': [(270.0, 1.00, 70.0), (2290.0, 0.40, 100.0), (3010.0, 0.20, 150.0)],
    'o': [(570.0, 1.00, 80.0), (840.0, 0.60, 100.0), (2410.0, 0.18, 150.0)],
    'u': [(300.0, 1.00, 70.0), (870.0, 0.45, 100.0), (2240.0, 0.15, 150.0)],
}
FRICATIVAS = ('s', 'z', 'f', 'j', 'ch', 'x')
OCLUSIVAS = ('p', 't', 'k', 'b', 'd', 'g')


def voz_gpu(f0, n, vel, vocal='a', cons='', susurro=False):
    """Voz sintetica: fuente glotal + formantes. Grave, plana, seca."""
    V = f0.numel()
    t = M.segundos(n)
    fuente = M.osc(f0, n, "sierra", vibrato=0.007)
    fuente = fuente + 0.30 * M.osc(f0 * 2.0, n, "seno")
    jit = 1.0 + 0.004 * torch.sin(2 * torch.pi * 0.7 * t + torch.rand(V, 1, device=DEV) * 6.28)
    fuente = fuente * jit
    if susurro:
        fuente = 0.25 * fuente + 0.75 * torch.randn(V, n, device=DEV)

    F = FORMANTES.get(vocal, FORMANTES['a'])

    def forma(fr, tt):
        acc = torch.zeros(fr.numel(), 1, device=DEV)
        for (fc, amp, bw) in F:
            acc = acc + amp * torch.exp(-0.5 * ((fr[:, None] - fc) / bw) ** 2)
        return acc + 0.035

    x = M.tv_filter(fuente, forma, n=1024, hop=256)

    if cons in FRICATIVAS:
        r = M.pasa_banda(torch.randn(V, n, device=DEV), 3200.0, 9500.0, taps=63)
        x = x + 0.55 * r * torch.exp(-t / 0.028)[None, :]
    elif cons in OCLUSIVAS:
        r = M.pasa_banda(torch.randn(V, n, device=DEV), 900.0, 6000.0, taps=63)
        x = x + 0.45 * r * torch.exp(-t / 0.006)[None, :]

    env = torch.clamp(t / 0.012, max=1.0) * torch.clamp((n / FS - t) / 0.055, max=1.0)
    x = x * env[None, :] * vel[:, None]
    x = M.paso_alto(x, 95.0)
    return x


def piano_cromatico(f0, n, vel):
    t = M.segundos(n)
    x = torch.zeros(f0.numel(), n, device=DEV)
    for (m, tau, amp) in ((1.0, 1.7, 1.00), (2.002, 0.95, 0.42), (3.008, 0.55, 0.20),
                          (4.02, 0.34, 0.10), (5.05, 0.22, 0.05)):
        f = f0[:, None] * m
        fase = 2 * torch.pi * torch.cumsum(f, dim=1) / FS
        x = x + amp * torch.sin(fase) * torch.exp(-t[None, :] / tau)
    x = x * vel[:, None]
    return M.paso_bajo(x, 6500.0)


def squelch_gpu(n, f_lo=170.0, f_hi=1900.0, dur=0.38):
    t = M.segundos(n)
    f = f_lo + (f_hi - f_lo) * torch.clamp(t / dur, max=1.0) ** 0.6
    fase = 2 * torch.pi * torch.cumsum(f) / FS
    x = torch.sin(fase) + 0.45 * torch.sin(2 * fase) + 0.2 * torch.sin(3 * fase)
    env = torch.exp(-t / 0.16) * torch.clamp(t / 0.004, max=1.0)
    return (x * env)[None, :]


def growl_gpu(n, f0=196.0):
    t = M.segundos(n)
    x = M.osc(torch.tensor([f0], device=DEV), n, "sierra")
    x = M.saturar(x, drive=9.0, veces=4)
    d = int(0.012 * FS)
    y = x.clone()
    y[:, d:] += 0.55 * x[:, :-d]
    y = M.saturar(y, drive=4.0, veces=4)
    env = torch.clamp(t / 0.05, max=1.0) * torch.clamp((n / FS - t) / 0.4, max=1.0)
    return y * env[None, :]


# (pista, ganancia en dB para la suma de referencia)
MEZCLA_DB = [
    ("bombo", 0.0), ("caja", -1.5), ("charles", -9.0), ("plato", -13.0),
    ("metal", -12.0), ("bajo", -1.0), ("drone", -11.0), ("organo", -13.0),
    ("guitarra", -12.0), ("sint_break", -14.0), ("voz_lead", -2.0),
    ("voz_dobles", -11.0), ("fx", -15.0), ("piano", -6.0),
]


def principal():
    os.makedirs(DIR_SAL, exist_ok=True)
    marca(f"dispositivo {DEV} | {torch.cuda.get_device_name(0) if DEV == 'cuda' else 'cpu'}")
    ev = P.eventos()
    stems = {}

    # ---------------------------------------------------------------- bateria
    marca("bombo")
    b = render_perc(bombo_sucio, ev["bombo"], int(0.45 * FS))
    stems["bombo"] = M.panear(b, 0.0)

    marca("caja")
    b = render_perc(caja_sucia, ev["caja"], int(0.30 * FS))
    stems["caja"] = M.panear(b, 0.05)

    marca("charles")
    b = render_perc(charles_rigido, ev["charles"], int(0.07 * FS))
    stems["charles"] = M.panear(b, -0.38)

    marca("plato")
    b = render_perc(plato_largo, ev["plato"], int(0.70 * FS))
    stems["plato"] = M.panear(b, 0.42)

    marca("percusion metalica")
    b = render_perc(metal_golpe, ev["metal"], int(1.1 * FS))
    izq = M.panear(b, -0.72, 0.9)
    der = M.panear(torch.roll(b, int(0.011 * FS)), 0.72, 0.9)
    stems["metal"] = izq + der

    # ---------------------------------------------------------------- armonia
    marca("bajo")
    b = render_agrupado(bajo_grueso, ev["bajo"], tam=48)
    b = M.compresor(b, umbral_db=-16.0, ratio=2.2, ataque_ms=8.0, salida_ms=60.0)
    stems["bajo"] = M.panear(b, 0.0)

    marca("drone")
    b = render_agrupado(drone_oscuro, ev["drone"], tam=12)
    ir_larga = M.ir_estereo(dur=4.5, decay=0.72, corte_ini=5200.0, corte_fin=900.0, seed=11)
    d2 = M.panear(b, -0.55) + M.panear(torch.roll(b, int(0.017 * FS)), 0.55)
    d2 = M.reverb(d2, ir_larga, mix=0.30)
    d2 = M.shimmer(d2, ir_larga, mix=0.10, feedback=0.30, vueltas=2)
    stems["drone"] = d2

    marca("organo")
    b = render_agrupado(organo_colchon, ev["organo"], tam=16)
    ir_media = M.ir_estereo(dur=2.8, decay=0.62, corte_ini=7000.0, corte_fin=1400.0, seed=5)
    o2 = M.panear(b, -0.45) + M.panear(torch.roll(b, int(0.013 * FS)), 0.45)
    stems["organo"] = M.reverb(o2, ir_media, mix=0.26)

    marca("guitarra")
    b = render_agrupado(guitarra_crujiente, ev["guitarra"], tam=48)
    g2 = M.panear(b, -0.30)
    g2 = M.reverb(g2, ir_media, mix=0.18)
    stems["guitarra"] = g2

    marca("sint breakdown")
    mitad = 103 * C.BAR
    e1 = [e for e in ev["sint_break"] if e[0] < mitad]
    e2 = [e for e in ev["sint_break"] if e[0] >= mitad]
    b1 = render_agrupado(lambda f0, n, v: sint_break(f0, n, v, 1200.0), e1, tam=48)
    b2 = render_agrupado(lambda f0, n, v: sint_break(f0, n, v, 2400.0), e2, tam=48)
    b = b1 + b2
    s2 = M.panear(b, -0.35) + M.panear(torch.roll(b, int(0.009 * FS)), 0.35)
    stems["sint_break"] = M.reverb(s2, ir_media, mix=0.22)

    # ---------------------------------------------------------------- voz
    marca("voz lead")
    grupos = {}
    for (t, dur, m, v_, c_, vel) in ev["voz_lead"]:
        grupos.setdefault((round(dur, 4), v_, c_), []).append((t, m, vel))
    b = bus_nuevo()
    for (dur, v_, c_), lista in sorted(grupos.items()):
        n = max(int(round(dur * FS)), 128)
        for i in range(0, len(lista), 48):
            blq = lista[i:i + 48]
            f0 = torch.tensor([hz_de(m) for (_, m, _) in blq], dtype=DTYPE, device=DEV)
            vel = torch.tensor([v for (_, _, v) in blq], dtype=DTYPE, device=DEV)
            x = voz_gpu(f0, n, vel, v_, c_)
            ini = torch.tensor([int(round(t * FS)) for (t, _, _) in blq], dtype=torch.long, device=DEV)
            b = M.sumar(b, x, ini)
    v2 = M.panear(b, 0.0)
    est = (torch.arange(NLARGO, device=DEV) > 60 * C.BAR * FS) & (torch.arange(NLARGO, device=DEV) < 90 * C.BAR * FS)
    dist = M.saturar(v2, drive=3.2, veces=4) * est[None, :]
    v2 = v2 + 0.22 * dist
    act = envolvente_actividad(v2, ms=320.0, umbral=0.015)
    hueco = torch.clamp(1.0 - act, min=0.0, max=1.0)
    eco = delay_largo(v2, [0.667, 1.333, 2.0], fb=0.42) * hueco
    ir_voz = M.ir_estereo(dur=1.6, decay=0.55, corte_ini=8000.0, corte_fin=2200.0, seed=3)
    v2 = M.reverb(v2, ir_voz, mix=0.13) + 0.30 * eco
    stems["voz_lead"] = v2

    marca("voz dobles y susurros")
    grupos = {}
    for (t, dur, m, v_, c_, vel) in ev["voz_dobles"]:
        grupos.setdefault((round(dur, 4), v_, c_), []).append((t, m, vel))
    b = bus_nuevo()
    for (dur, v_, c_), lista in grupos.items():
        n = max(int(round(dur * FS)), 128)
        for i in range(0, len(lista), 48):
            blq = lista[i:i + 48]
            f0 = torch.tensor([hz_de(m) for (_, m, _) in blq], dtype=DTYPE, device=DEV)
            vel = torch.tensor([v for (_, _, v) in blq], dtype=DTYPE, device=DEV)
            x = voz_gpu(f0, n, vel, v_, c_, susurro=True)
            ini = torch.tensor([int(round(t * FS)) for (t, _, _) in blq], dtype=torch.long, device=DEV)
            b = M.sumar(b, x, ini)
    d2 = M.panear(b, -0.55) + M.panear(torch.roll(b, int(0.021 * FS)), 0.55)
    stems["voz_dobles"] = M.reverb(d2, ir_voz, mix=0.30)

    # ---------------------------------------------------------------- fx
    marca("fx")
    fx = torch.zeros(2, NLARGO, device=DEV)
    for (tipo, t, g) in ev["fx"]:
        i = int(round(t * FS))
        if tipo == "squelch":
            x = squelch_gpu(int(0.5 * FS))
            seg = M.panear(x[0], -0.2, g)
        elif tipo == "growl":
            x = growl_gpu(int(1.8 * FS))
            seg = M.panear(x[0], 0.25, g)
        elif tipo == "siseo":
            n = int(6.0 * FS)
            r = M.pasa_banda(torch.randn(1, n, device=DEV), 3000.0, 13000.0, taps=63)
            tt = M.segundos(n)
            env = torch.clamp(tt / 1.5, max=1.0) * torch.clamp((n / FS - tt) / 2.0, max=1.0)
            seg = M.panear((r * env)[0], 0.0, 0.35 * g)
        elif tipo == "eco":
            n = int(2.2 * FS)
            x = sint_break(torch.tensor([hz_de(57), hz_de(60), hz_de(64)], device=DEV), n,
                           torch.tensor([0.7, 0.7, 0.7], device=DEV), 1800.0)
            seg = M.panear(x.sum(0), 0.3, 0.5 * g)
            seg = M.reverb(seg, ir_media, mix=0.5)
        elif tipo == "inv":
            n = int(2.6 * FS)
            x = organo_colchon(torch.tensor([hz_de(45), hz_de(48), hz_de(52)], device=DEV), n,
                               torch.tensor([0.8, 0.8, 0.8], device=DEV))
            seg = M.panear(torch.flip(x.sum(0), dims=[0]), -0.4, 0.55 * g)
            seg = M.reverb(seg, ir_larga, mix=0.55)
            seg = M.saturar(seg, drive=2.5, veces=4)
        elif tipo == "granular":
            n = int(3.0 * FS)
            x = organo_colchon(torch.tensor([hz_de(45), hz_de(52)], device=DEV), n,
                               torch.tensor([0.8, 0.8], device=DEV))
            seg = M.panear(x.sum(0), 0.0, 0.5 * g)
            seg = M.granular(seg, tam=0.07, densidad=70.0, dur=2.6, jitter=0.45)
            seg = M.reverb(seg, ir_media, mix=0.4)
        else:
            continue
        m = min(seg.shape[-1], NLARGO - i)
        if m > 0:
            fx[:, i:i + m] += seg[:, :m]
    stems["fx"] = fx

    # ---------------------------------------------------------------- piano
    marca("piano final")
    b = render_agrupado(piano_cromatico, ev["piano"], tam=16)
    p2 = M.panear(b, 0.0)
    p2 = M.reverb(p2, ir_media, mix=0.30)
    stems["piano"] = p2

    # ---------------------------------------------------------------- escritura
    marca("escribiendo stems")
    picos = {}
    for nombre, x in stems.items():
        x = fade_final(x, 5.0)
        stems[nombre] = x
        picos[nombre] = float(x.abs().max())
    maximo = max(picos.values())
    g = 10 ** (-1.0 / 20) / maximo
    for nombre, x in stems.items():
        objetivo = 20 * math.log10(max(g * picos[nombre], 1e-9))
        M.escribir_wav(os.path.join(DIR_SAL, f"final_{nombre}.wav"), x, pico_db=objetivo)
        marca(f"  final_{nombre}.wav  pico {objetivo:6.1f} dBFS")

    suma = torch.zeros(2, NLARGO, device=DEV)
    for (nombre, gdb) in MEZCLA_DB:
        if nombre in stems:
            suma = suma + stems[nombre] * (10 ** (gdb / 20))
    M.escribir_wav(os.path.join(DIR_SAL, "final_suma_referencia.wav"), suma, pico_db=-1.0)

    import dsp
    mono = suma.mean(0).detach().cpu().numpy().astype(np.float64)
    est = suma.detach().cpu().numpy().astype(np.float64)
    marca("metricas de la suma de referencia:")
    print(f"  LUFS integrados : {dsp.lufs_integrated(mono, fs=FS):.2f}")
    print(f"  true peak       : {dsp.true_peak_db(est, fs=FS):.2f} dBFS")
    print(f"  crest           : {dsp.crest_db(est):.2f} dB")
    print(f"  rms             : {dsp.rms_db(est):.2f} dBFS")
    marca("hecho")


if __name__ == "__main__":
    principal()
