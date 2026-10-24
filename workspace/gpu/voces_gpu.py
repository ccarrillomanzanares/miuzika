"""Voces que solo pueden renderizarse en la GPU (torch).

Mismo contrato que `codigo/instruments.py`, pero estas funciones pueden usar torch
y los tensores de `motor_gpu`: se ejecutan en Lambda, nunca en el portátil. Por eso
`codigo/voces.py` las lee con `ast` (sin importarlas): así el catálogo las lista sin
necesitar torch instalado.

Formato del docstring, igual que en el motor de CPU:

    def kit_bombo(vel=1.0, pitch=1.0, dur=0.9, seed=0):
        \"\"\"Bombo de batería con cuerpo sobremuestreado.
        familia: percusión
        vel: 0.05..1 Intensidad
        pitch: 0.7..1.4 Tono (x)
        dur: 0.2..2 Duración (s)
        seed: 0..9999 Semilla
        \"\"\"

Reglas: devuelve un array float (numpy o tensor), determinista por `seed`, sin
escribir ficheros (de eso se encarga la puerta) y por debajo de 3 s de render.

Lo que la GPU aporta aquí: filtros y resonadores aplicados por FFT sobre tensores
grandes, saturación con sobremuestreo y ruido determinista — en numpy y en un
bucle de Python esto tarda segundos; aquí, milisegundos.
"""

import math

import torch

SR = 44100


# ── utilidades ──────────────────────────────────────────────────────────────


def _t(n):
    return torch.arange(n, dtype=torch.float32) / SR


def _ruido(n, seed):
    generador = torch.Generator().manual_seed(int(seed))
    return torch.randn(n, generator=generador)


def _respuesta(x, b0, b1, b2, a0, a1, a2):
    """Aplica un biquad de una vez, por FFT (el filtro es una multiplicación)."""
    n = x.numel()
    freqs = torch.fft.rfftfreq(n, 1.0 / SR)
    z = torch.exp(-1j * 2 * math.pi * freqs / SR)
    h = (b0 + b1 * z + b2 * z * z) / (a0 + a1 * z + a2 * z * z)
    return torch.fft.irfft(torch.fft.rfft(x) * h, n=n).to(torch.float32)


def _pasa_banda(x, f0, q=1.0):
    w0 = 2 * math.pi * f0 / SR
    alfa = math.sin(w0) / (2 * q)
    cos = math.cos(w0)
    return _respuesta(x, alfa, 0.0, -alfa, 1 + alfa, -2 * cos, 1 - alfa)


def _paso_alto(x, f0, q=0.7):
    w0 = 2 * math.pi * f0 / SR
    alfa = math.sin(w0) / (2 * q)
    cos = math.cos(w0)
    return _respuesta(x, (1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alfa, -2 * cos, 1 - alfa)


def _saturar(x, veces=4.0):
    return torch.tanh(x * veces) / math.tanh(veces)


def _resonadores(n, freqs, decays, ganancias):
    """Suma de senos con caída: el cuerpo metálico de un plato."""
    t = _t(n)
    salida = torch.zeros(n, dtype=torch.float32)
    for f, d, g in zip(freqs, decays, ganancias):
        salida = salida + g * torch.sin(2 * math.pi * f * t) * torch.exp(-t / d)
    return salida


# ── voces de batería ────────────────────────────────────────────────────────


def kit_bombo(vel=1.0, pitch=1.0, dur=0.9, seed=0):
    """Bombo de batería: cuerpo con caída de tono, click y saturación.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.4 Tono (x)
    dur: 0.2..2 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    f = (47.0 + 190.0 * torch.exp(-t / 0.045)) * pitch
    fase = 2 * math.pi * torch.cumsum(f, dim=0) / SR
    cuerpo = torch.sin(fase) * torch.exp(-t / (0.32 * dur / 0.9))
    cuerpo = cuerpo + 0.30 * torch.sin(2 * fase) * torch.exp(-t / 0.06)
    click = _paso_alto(_ruido(n, seed), 2200.0) * torch.exp(-t / 0.0035) * 0.5
    x = _saturar(cuerpo + click, veces=3.0)
    return (x * float(vel)).numpy()


def kit_caja(vel=1.0, pitch=1.0, dur=0.55, seed=0):
    """Caja de batería: dos cuerpos tonales, bordona y cola corta.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.5 Tono (x)
    dur: 0.15..2 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    cuerpo = torch.sin(2 * math.pi * 185.0 * pitch * t) * torch.exp(-t / 0.075)
    cuerpo = cuerpo + 0.6 * torch.sin(2 * math.pi * 330.0 * pitch * t) * torch.exp(-t / 0.055)
    bordona = _pasa_banda(_ruido(n, seed), 2600.0 * pitch, q=0.6)
    bordona = bordona * (torch.exp(-t / 0.10) * 0.9 + torch.exp(-t / 0.35) * 0.25)
    x = _saturar(cuerpo + 1.4 * bordona, veces=2.2)
    return (x * float(vel)).numpy()


def kit_tom(vel=1.0, pitch=1.0, dur=1.3, seed=0):
    """Tom de batería: parche grande con caída de tono lenta y algo de aire.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.6..1.6 Tono (x)
    dur: 0.2..4 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    f = (78.0 + 120.0 * torch.exp(-t / 0.09)) * pitch
    fase = 2 * math.pi * torch.cumsum(f, dim=0) / SR
    cuerpo = torch.sin(fase) * torch.exp(-t / (0.45 * dur / 1.3))
    ataque = _pasa_banda(_ruido(n, seed), 1500.0 * pitch, q=0.8) * torch.exp(-t / 0.01) * 0.4
    x = _saturar(cuerpo + ataque, veces=1.8)
    return (x * float(vel)).numpy()


def kit_charles(vel=1.0, pitch=1.0, dur=0.35, seed=0):
    """Charles cerrado: ruido muy agudo y corto con un toque metálico.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.6 Tono (x)
    dur: 0.08..1 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    metal = _resonadores(
        n,
        [pitch * f for f in (3150.0, 4700.0, 6300.0, 8100.0)],
        [0.06, 0.05, 0.04, 0.03],
        [0.5, 0.4, 0.35, 0.3],
    )
    aire = _paso_alto(_ruido(n, seed), 6000.0) * torch.exp(-t / 0.045) * 0.9
    x = 0.6 * metal * torch.exp(-t / 0.05) + aire
    return (x * float(vel)).numpy()


def kit_crash(vel=1.0, pitch=1.0, dur=2.5, seed=0):
    """Plato crash: parciales inarmónicos y cola larga con aire.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.5 Tono (x)
    dur: 0.5..8 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    metal = _resonadores(
        n,
        [pitch * f for f in (420.0, 613.0, 887.0, 1170.0, 1620.0, 2240.0, 3120.0, 4400.0)],
        [1.4, 1.1, 0.95, 0.8, 0.65, 0.5, 0.4, 0.3],
        [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15],
    )
    aire = _paso_alto(_ruido(n, seed), 3500.0) * torch.exp(-t / (dur * 0.35)) * 1.1
    ataque = _ruido(n, seed + 3) * torch.exp(-t / 0.004) * 0.8
    x = metal * torch.exp(-t / (dur * 0.5)) + aire + ataque
    return (x * float(vel)).numpy()


def kit_china(vel=1.0, pitch=1.0, dur=2.0, seed=0):
    """Plato china: más sucio y agresivo que el crash, con cola gated.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.5 Tono (x)
    dur: 0.5..8 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    metal = _resonadores(
        n,
        [pitch * f for f in (317.0, 512.0, 743.0, 1090.0, 1517.0, 2081.0, 2850.0, 3970.0)],
        [0.9, 0.75, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25],
        [0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2],
    )
    aire = _paso_alto(_ruido(n, seed), 2500.0) * torch.exp(-t / (dur * 0.3)) * 1.3
    gate = torch.clamp(torch.cos(2 * math.pi * 5.0 * t) * 1.4 + 0.55, min=0.0, max=1.0)
    x = _saturar(metal * torch.exp(-t / (dur * 0.45)) + aire, veces=2.6) * gate
    return (x * float(vel)).numpy()


def kit_ride(vel=1.0, pitch=1.0, dur=2.0, seed=0):
    """Plato ride: campana definida (ping) y cola metálica limpia.
    familia: percusión
    vel: 0.05..1 Intensidad
    pitch: 0.7..1.5 Tono (x)
    dur: 0.5..8 Duración (s)
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    campana = _resonadores(
        n,
        [pitch * f for f in (1180.0, 1770.0, 2490.0, 3300.0, 4630.0)],
        [0.9, 0.7, 0.55, 0.45, 0.3],
        [0.6, 0.5, 0.4, 0.3, 0.2],
    )
    cuerpo = _resonadores(
        n,
        [pitch * f for f in (430.0, 640.0, 910.0, 1290.0)],
        [1.2, 1.0, 0.8, 0.6],
        [0.3, 0.28, 0.24, 0.2],
    )
    aire = _paso_alto(_ruido(n, seed), 5000.0) * torch.exp(-t / (dur * 0.25)) * 0.35
    x = campana * torch.exp(-t / (dur * 0.4)) + cuerpo * torch.exp(-t / (dur * 0.55)) + aire
    return (x * float(vel)).numpy()


def campana_fm(note=69, dur=4.0, ratio=3.5, index=2.0, seed=0):
    """Campana FM grande con cola larga y parciales inarmónicos.
    familia: tonal
    note: 21..108 Nota (midi)
    dur: 0.5..20 Duración (s)
    ratio: 1..8 Relación FM (x)
    index: 0.1..8 Índice FM
    seed: 0..9999 Semilla
    """
    n = int(dur * SR)
    t = _t(n)
    f0 = 440.0 * (2.0 ** ((note - 69) / 12.0))
    mod = index * torch.exp(-t / 0.35) * torch.sin(2 * math.pi * f0 * ratio * t)
    x = torch.sin(2 * math.pi * f0 * t + mod)
    x = x + 0.3 * torch.sin(2 * math.pi * f0 * 2.76 * t + 0.7 * mod) * torch.exp(-t / 1.4)
    x = x + 0.02 * _ruido(n, seed)
    x = x * torch.exp(-t / (dur * 0.28))
    return x.numpy()
