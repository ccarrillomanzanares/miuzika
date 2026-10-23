"""Motor DSP nativo de GPU (torch). Nada se calcula nota a nota.

El motor numpy existente recorre las notas en un bucle de Python: 735 notas de
bajo son 735 llamadas y ~63 s. Aqui cada familia de voces se renderiza entera de
una vez como un tensor (voces x muestras) y se deposita en el bus con index_add.
Eso es lo que la GPU hace bien y la CPU no.

Piezas:
  - osciladores por tabla con mipmaps (band-limited, sin aliasing por construccion)
  - percusion por sintesis modal (suma de sinusoides con decaimiento)
  - filtros: FIR en conv1d para estaticos; STFT batcheado para variables en el tiempo
  - saturacion a 16x con filtro antialias (lo que en CPU no se paga)
  - reverb por convolucion FFT con IR estereo de decaimiento por bandas
  - shimmer (+12 semitonos realimentado), congelado espectral y nube granular
  - compresor multibanda y limitador con lookahead, ambos vectorizados
"""

import math
import os
import struct

import torch

SR = 48000
DISPOSITIVO = "cuda" if torch.cuda.is_available() else "cpu"
DT = torch.float32

# --------------------------------------------------------------------- utilidades


def t_(x, dispositivo=None):
    if isinstance(x, torch.Tensor):
        return x.to(dispositivo or DISPOSITIVO)
    if isinstance(x, (list, tuple)):
        return torch.tensor(x, dtype=DT, device=dispositivo or DISPOSITIVO)
    return torch.tensor(x, dtype=DT, device=dispositivo or DISPOSITIVO)


def segundos(n):
    return torch.arange(n, dtype=DT, device=DISPOSITIVO) / SR


def db(x):
    return 10 * torch.log10(torch.clamp(x, min=1e-20))


def fir_sinc(corte_hz, taps=127, dispositivo=None, ventana="hann"):
    """FIR paso bajo (sinc con ventana de Hann), corte en Hz.

    La formula correcta lleva el factor 2*fc: h[n] = 2*fc*sinc(2*fc*n)*ventana.
    Sin el (usando sinc(fc_rel*n)) el filtro degenera en una ventana suave y, con
    cortes bajos, se come TODO lo que hay por encima de unos cientos de Hz: eso
    dejo el master a -107 dB en 2-4 kHz. Para cortes muy bajos (quitar subsonico)
    no sirve ningun FIR corto: ahi va eq_fft.
    """
    dispositivo = dispositivo or DISPOSITIVO
    n = torch.arange(taps, dtype=DT, device=dispositivo) - (taps - 1) / 2
    fc = corte_hz / SR                      # normalizado a la frecuencia de muestreo
    if ventana == "blackman":
        w = torch.blackman_window(taps, periodic=False, device=dispositivo)
    else:
        w = torch.hann_window(taps, periodic=False, device=dispositivo)
    h = 2 * fc * torch.sinc(2 * fc * n) * w
    return h / h.sum()


def filtrar(x, h):
    """Convolucion 1-D de (..., L) con un FIR, mismo tamano."""
    forma = x.shape
    plano = x.reshape(-1, 1, forma[-1])
    pad = (h.numel() - 1) // 2
    y = torch.nn.functional.conv1d(
        torch.nn.functional.pad(plano, (pad, pad), mode="replicate"), h.reshape(1, 1, -1)
    )
    return y.reshape(forma)


def eq_fft(x, forma):
    """Filtro estatico en el dominio de la frecuencia: exacto y sin diseno de FIR.

    forma(frecuencias) -> respuesta en amplitud. Se usa para el paso alto del
    master y para partir bandas, donde un FIR corto no llega.
    """
    largo = x.shape[-1]
    n = 1 << (largo - 1).bit_length()
    X = torch.fft.rfft(x, n=n, dim=-1)
    f = torch.fft.rfftfreq(n, 1.0 / SR).to(DISPOSITIVO)
    return torch.fft.irfft(X * forma(f), n=n, dim=-1)[..., :largo]


def paso_alto(x, corte_hz, orden=4):
    return eq_fft(x, lambda f: 1.0 - 1.0 / (1.0 + (f / corte_hz) ** orden))


def paso_bajo(x, corte_hz, orden=4):
    return eq_fft(x, lambda f: 1.0 / (1.0 + (f / corte_hz) ** orden))


def _bandas_fft(x, cortes):
    """Parte en bandas complementarias (suman exactamente la senal original)."""
    largo = x.shape[-1]
    n = 1 << (largo - 1).bit_length()
    X = torch.fft.rfft(x, n=n, dim=-1)
    f = torch.fft.rfftfreq(n, 1.0 / SR).to(DISPOSITIVO)
    pesos = []
    resto = torch.ones_like(f)
    for corte in cortes:
        bajo = 1.0 / (1.0 + (f / corte) ** 4)
        pesos.append(resto * bajo)
        resto = resto * (1.0 - bajo)
    pesos.append(resto)
    return [torch.fft.irfft(X * peso, n=n, dim=-1)[..., :largo] for peso in pesos]


def pasa_banda(x, f_lo, f_hi, taps=127):
    """Paso banda por diferencia de dos pasos bajo (suficiente y barato)."""
    return filtrar(filtrar(x, fir_sinc(f_hi, taps)), fir_sinc(f_lo, taps))


def normalizar_pico(x, objetivo_db=-1.0):
    pico = torch.clamp(x.abs().max(), min=1e-9)
    return x * (10 ** (objetivo_db / 20) / pico)


# ------------------------------------------------------------------- osciladores
_TABLAS = {}


def _tabla_mipmap(tipo, octavas=9, largo=4096):
    """Tabla por octava, limitada a Nyquist: sin aliasing por construccion."""
    clave = (tipo, octavas, largo)
    if clave in _TABLAS:
        return _TABLAS[clave]
    tablas = []
    for o in range(octavas):
        # frecuencia normalizada mas alta de esta octava: 2^(-o) ciclos/muestra * 2
        f_max = 0.5 * (2.0 ** (-o))
        k_max = max(int(1.0 / (2 * f_max)), 1)
        fase = torch.arange(largo, dtype=torch.float64, device=DISPOSITIVO) / largo
        onda = torch.zeros(largo, dtype=torch.float64, device=DISPOSITIVO)
        for k in range(1, min(k_max, 64) + 1):
            if tipo == "sierra":
                amp = 1.0 / k
            elif tipo == "pulso":
                amp = (1.0 / k) * (1.0 if k % 2 else 0.0)
            else:  # seno
                amp = 1.0 if k == 1 else 0.0
            onda += amp * torch.sin(2 * torch.pi * k * fase)
        onda = onda / torch.clamp(onda.abs().max(), min=1e-9)
        tablas.append(onda.to(DT))
    pila = torch.stack(tablas)
    _TABLAS[clave] = pila
    return pila


def osc(f0, n, tipo="sierra", fase_ini=0.0, vibrato=0.0):
    """Oscilador batcheado: f0 de forma (V,) -> (V, n)."""
    f0 = t_(f0).reshape(-1)
    voces = f0.numel()
    t = segundos(n)
    if vibrato > 0:
        mod = 1.0 + vibrato * torch.sin(2 * torch.pi * 5.2 * t + torch.rand(voces, 1, device=DISPOSITIVO) * 6.28)
        freq = f0[:, None] * mod
    else:
        freq = f0[:, None].expand(voces, n)
    fase = (torch.cumsum(freq, dim=1) / SR + fase_ini) % 1.0
    tablas = _tabla_mipmap(tipo)
    octavas, largo = tablas.shape
    octava = torch.clamp(torch.log2(torch.clamp(f0, min=1.0) / 20.0), 0, octavas - 1).to(torch.int64)
    idx = fase * largo
    i0 = idx.to(torch.int64) % largo
    fr = idx - torch.floor(idx)
    tabla_v = tablas[octava]  # (V, largo)
    a = torch.gather(tabla_v, 1, i0)
    b = torch.gather(tabla_v, 1, (i0 + 1) % largo)
    return a * (1 - fr) + b * fr


# ----------------------------------------------------------------------- percusion
def _env_exp(n, tau):
    return torch.exp(-segundos(n) / max(tau, 1e-4))


def percusion(f0, n, modos, taus, ruido=0.0, ruido_tau=0.02, ruido_corte=6000.0, ataque=0.001):
    """Sintesis modal: (V, n) sumando sinusoides con decaimiento + ruido opcional."""
    f0 = t_(f0).reshape(-1)
    voces = f0.numel()
    t = segundos(n)
    salida = torch.zeros(voces, n, device=DISPOSITIVO)
    for m, tau in zip(modos, taus):
        # pequeño barrido descendente de tono, como un parche de percusion real
        f = f0[:, None] * m * (1.0 + 0.6 * torch.exp(-t[None, :] / 0.02))
        fase = 2 * torch.pi * torch.cumsum(f, dim=1) / SR
        salida += torch.sin(fase) * torch.exp(-t[None, :] / tau)
    if ruido > 0:
        r = torch.randn(voces, n, device=DISPOSITIVO) * ruido
        r = pasa_banda(r, 200.0, ruido_corte)
        salida += r * torch.exp(-t[None, :] / ruido_tau)
    if ataque > 0:
        salida *= torch.clamp(t / ataque, max=1.0)
    return salida


def bombo(n=None, vel=1.0):
    n = n or int(0.45 * SR)
    x = percusion([46.0], n, [1.0, 2.05, 3.4], [0.30, 0.10, 0.05], ruido=0.25, ruido_tau=0.004, ruido_corte=3500)
    return x * vel


def caja(n=None, vel=1.0):
    n = n or int(0.30 * SR)
    x = percusion([185.0, 320.0], n, [1.0, 1.7], [0.08, 0.05], ruido=0.55, ruido_tau=0.11, ruido_corte=9000)
    return x * vel


def charles(n=None, vel=1.0, abierto=False):
    n = n or int((0.30 if abierto else 0.07) * SR)
    r = torch.randn(1, n, device=DISPOSITIVO)
    r = pasa_banda(r, 6500.0, 13000.0)
    return r * _env_exp(n, 0.16 if abierto else 0.022) * vel


def metal(n=None, vel=1.0, pitch=1.0):
    """Golpe metalico inarmonico: los 'clangs' del industrial."""
    n = n or int(1.1 * SR)
    f = 190.0 * pitch
    x = percusion([f], n, [1.0, 1.37, 2.09, 2.56, 3.31, 4.17], [0.9, 0.7, 0.5, 0.42, 0.3, 0.22],
                  ruido=0.35, ruido_tau=0.05, ruido_corte=11000)
    return x * vel


def shaker(n=None, vel=1.0):
    n = n or int(0.09 * SR)
    r = pasa_banda(torch.randn(1, n, device=DISPOSITIVO), 4500.0, 11000.0)
    return r * _env_exp(n, 0.03) * vel


# ------------------------------------------------------------------------- filtros
def stft(x, n=1024, hop=256):
    """STFT batcheada: (V, L) -> (V, F, T)."""
    ventana = torch.hann_window(n, device=DISPOSITIVO)
    return torch.stft(x, n_fft=n, hop_length=hop, window=ventana, center=True,
                      pad_mode="reflect", return_complex=True)


def istft(X, largo, n=1024, hop=256):
    ventana = torch.hann_window(n, device=DISPOSITIVO)
    return torch.istft(X, n_fft=n, hop_length=hop, window=ventana, center=True, length=largo)


def tv_filter(x, forma, n=2048, hop=256):
    """Filtro variable en el tiempo, batcheado.

    forma(frecuencias, tiempos) debe devolver (F, T) o (F,) si no depende del
    tiempo; aqui se ajusta a (F, T) antes de multiplicar.
    """
    X = stft(x, n, hop)
    freqs = torch.fft.rfftfreq(n, 1.0 / SR).to(DISPOSITIVO)
    tiempos = torch.arange(X.shape[-1], device=DISPOSITIVO) * hop / SR
    E = forma(freqs, tiempos).to(X.dtype)
    if E.dim() == 1:
        E = E[:, None]
    if E.shape[0] != freqs.numel() and E.shape[-1] == freqs.numel():
        E = E.transpose(0, 1)          # acepta tambien (T, F)
    if E.shape[-1] == 1:
        E = E.expand(-1, X.shape[-1])
    return istft(X * E.unsqueeze(0), x.shape[-1], n, hop)


# ---------------------------------------------------------------------- saturacion
def saturar(x, drive=6.0, veces=4, asimetrico=True):
    """tanh con drive alto calculada a 'veces' x y filtrada al bajar. Sin aliasing.

    Medido con un seno de 997 Hz a drive 8: 1x deja el aliasing en -44,4 dB,
    4x en -65,3 dB y 16x en -64,4 dB. O sea que 4x da todo lo que da 16x con la
    cuarta parte de calculo: el limite no es el factor, es el filtro antialias
    (Blackman de 255 taps). No subas a 16x sin medir.
    """
    if veces > 1:
        arriba = torch.zeros(*x.shape[:-1], x.shape[-1] * veces, device=DISPOSITIVO)
        arriba[..., ::veces] = x * veces
        # Blackman de 255 taps: el Hann de 127 dejaba el stopband en -44 dB y eso
        # era el limite del aliasing (-61 dB), no el sobremuestreo.
        x = filtrar(arriba, fir_sinc(SR / 2 / veces * 0.9, taps=255, ventana="blackman"))
    if asimetrico:
        y = torch.tanh(drive * x) + 0.12 * torch.tanh(2 * drive * x) ** 2
    else:
        y = torch.tanh(drive * x)
    y = y / torch.tanh(torch.tensor(drive, device=DISPOSITIVO))
    if veces > 1:
        y = filtrar(y, fir_sinc(SR / 2 / veces * 0.9, taps=255, ventana="blackman"))[..., ::veces].contiguous()
    return y


# ------------------------------------------------------------------- espacio / fx
def ir_estereo(dur=3.5, decay=0.6, corte_ini=9000.0, corte_fin=1800.0, predelay=0.02, seed=1):
    """IR por bandas con damping progresivo y decorrelacion estereo."""
    gen = torch.Generator(device=DISPOSITIVO).manual_seed(seed)
    n = int(dur * SR)
    t = segundos(n)
    canales = []
    for c in range(2):
        acc = torch.zeros(n, device=DISPOSITIVO)
        for k, (lo, hi) in enumerate([(60, 200), (200, 600), (600, 1600), (1600, 4000), (4000, 9000)]):
            tau = decay * (1.0 + 0.45 * k)
            ruido = torch.randn(n, device=DISPOSITIVO, generator=gen)
            banda = pasa_banda(ruido, lo, hi, taps=191)
            corte = corte_ini + (corte_fin - corte_ini) * (k / 4)
            banda = filtrar(banda, fir_sinc(corte, 127))
            acc += banda * torch.exp(-t / (tau * 0.9))
        canales.append(acc)
    ir = torch.stack(canales)
    # predelay
    pre = int(predelay * SR)
    if pre > 0:
        ir = torch.cat([torch.zeros(2, pre, device=DISPOSITIVO), ir[..., :-pre]], dim=-1)
    # Normalizar por ENERGIA, no por pico: asi la convolucion conserva el nivel
    # (normalizar por pico daba ganancias de x84 y el shimmer se descontrolaba).
    energia = torch.sqrt(torch.clamp((ir ** 2).sum(dim=-1, keepdim=True), min=1e-12))
    return ir / energia


def convolucion(x, ir):
    """Convolucion FFT con IR estereo: x (2, L) -> (2, L)."""
    largo = x.shape[-1] + ir.shape[-1] - 1
    n = 1 << (largo - 1).bit_length()
    X = torch.fft.rfft(x, n=n)
    H = torch.fft.rfft(ir, n=n)
    return torch.fft.irfft(X * H, n=n)[..., : largo]


def reverb(x, ir, mix=0.25):
    """x (2, L); devuelve seco+humedo recortado al largo original."""
    if x.dim() == 1:
        x = torch.stack([x, x])
    h = convolucion(x, ir)[..., : x.shape[-1]]
    return x * (1 - mix) + h * mix


def shimmer(x, ir, mix=0.18, feedback=0.35, vueltas=3):
    """+12 semitonos realimentado en la reverb: el 'casi psicodelico'."""
    if x.dim() == 1:
        x = torch.stack([x, x])
    acumulado = torch.zeros_like(x)
    actual = x
    for v in range(vueltas):
        doble = torch.fft.irfft(
            torch.fft.rfft(actual, dim=-1)[..., : actual.shape[-1] // 2], n=actual.shape[-1] // 2
        )[:2, : actual.shape[-1] // 2]
        pad = torch.zeros(2, actual.shape[-1], device=DISPOSITIVO)
        pad[:, : doble.shape[-1]] = doble
        actual = reverb(pad, ir, mix=1.0) * (feedback ** v)
        acumulado = acumulado + actual
    return x + acumulado * mix


def congelar(x, inicio, dur, ventana=0.25):
    """Congelado espectral: toma un tramo, fija la magnitud y hace derivar la fase."""
    if x.dim() == 1:
        x = torch.stack([x, x])
    n, hop = 2048, 256
    X = stft(x, n, hop)
    t0 = int(inicio * SR / hop)
    t1 = t0 + max(int(ventana * SR / hop), 1)
    # OJO: hay que congelar MAGNITUD. Promediar los complejos cancela las fases
    # entre tramas y el resultado se queda en -60 dB (paso de verdad).
    base = X[:, :, t0:t1].abs().mean(dim=2, keepdim=True)   # (2, F, 1)
    tramos = int(dur * SR / hop)
    salida = torch.zeros(2, tramos * hop, device=DISPOSITIVO)
    fase0 = torch.rand(2, base.shape[1], 1, device=DISPOSITIVO) * 6.28
    for k in range(0, tramos, 64):
        cuantos = min(64, tramos - k)
        # la fase sigue avanzando entre bloques (si no, se oye el patron periodico)
        avance = torch.arange(k, k + cuantos, device=DISPOSITIVO, dtype=DT)
        deriva = torch.exp(1j * (fase0 + 0.02 * avance))       # (2, F, cuantos)
        trozo = istft(base * deriva, cuantos * hop, n, hop)
        salida[:, k * hop : k * hop + trozo.shape[-1]] += trozo
    return salida[:, : int(dur * SR)]


def granular(x, tam=0.06, densidad=60.0, dur=None, jitter=0.4):
    """Nube granular batcheada: miles de granos de una vez (index_add)."""
    if x.dim() == 1:
        x = torch.stack([x, x])
    dur = dur or x.shape[-1] / SR
    granos = int(dur * densidad)
    largo_grano = int(tam * SR)
    ventana = torch.hann_window(largo_grano, device=DISPOSITIVO)
    origenes = (torch.rand(granos, device=DISPOSITIVO) * (x.shape[-1] - largo_grano - 1)).long()
    destinos = (torch.rand(granos, device=DISPOSITIVO) * (dur * SR - largo_grano - 1)).long()
    posiciones = torch.arange(largo_grano, device=DISPOSITIVO)
    idx_o = origenes[:, None] + posiciones[None, :]
    idx_d = destinos[:, None] + posiciones[None, :]
    salida = torch.zeros(2, int(dur * SR), device=DISPOSITIVO)
    for c in range(2):
        g = torch.gather(x[c].expand(granos, -1), 1, idx_o) * ventana
        salida[c].index_add_(0, idx_d.reshape(-1), g.reshape(-1))
    return salida


# ------------------------------------------------------------------ dinamica y master
def _envolvente(x, ms_ventana=30.0):
    """Envolvente paralela (max-pool + media movil) por canal, sin bucles."""
    n = max(int(SR * ms_ventana / 1000), 8)
    plano = x.abs().reshape(-1, 1, x.shape[-1])
    pico = torch.nn.functional.max_pool1d(plano, n, stride=1, padding=n // 2)
    suave = torch.nn.functional.avg_pool1d(pico, n, stride=1, padding=n // 2)
    # con padding la longitud sale L+2: se recorta antes de devolver la forma original
    suave = suave[..., : x.shape[-1]]
    return suave.reshape(x.shape)


def compresor(x, umbral_db=-18.0, ratio=2.5, ataque_ms=12.0, salida_ms=90.0):
    """Compresor con envolvente paralela y suavizado exponencial aproximado."""
    env = torch.clamp(_envolvente(x, ataque_ms), min=1e-6)
    sobre = db(env) - umbral_db
    ganancia_db = torch.where(sobre > 0, -sobre * (1 - 1 / ratio), torch.zeros_like(sobre))
    # suavizado del lado de salida con media movil larga
    n = max(int(SR * salida_ms / 1000), 8)
    g = torch.nn.functional.avg_pool1d(ganancia_db.reshape(1, 1, -1), n, stride=1, padding=n // 2)
    g = g.reshape(-1)[: x.shape[-1]]
    return x * (10 ** (g / 20))


def compresor_multibanda(x, cortes=(180.0, 1800.0), umbrales=(-20.0, -18.0, -16.0), ratio=2.2):
    """3 bandas complementarias por FFT; cada una con su compresor."""
    if x.dim() == 1:
        x = x.unsqueeze(0)
    bandas = _bandas_fft(x, cortes)
    salida = torch.zeros_like(x)
    for banda, umbral in zip(bandas, umbrales):
        salida += compresor(banda, umbral, ratio)
    return salida


def limitador(x, techo_db=-1.0, lookahead_ms=3.0):
    """Limitador con lookahead: max-pool centrado + suavizado de la ganancia."""
    if x.dim() == 1:
        x = x.unsqueeze(0)
    techo = 10 ** (techo_db / 20)
    ventana = max(int(SR * lookahead_ms / 1000), 8)
    plano = x.abs().reshape(-1, 1, x.shape[-1])
    # La envolvente se toma CRUDA (max deslizante). Promediarla despues -que era
    # el error- hunde los transitorios: una senal de 14,5 daba envolvente 9,2 y
    # el limitador dejaba pasar 1,4 (el master salia a +3,6 dBFS).
    env = torch.nn.functional.max_pool1d(plano, ventana, stride=1, padding=ventana // 2)
    env = env[..., : x.shape[-1]].reshape(x.shape)
    ganancia = torch.clamp(techo / torch.clamp(env, min=1e-6), max=1.0)
    # Suavizar la GANANCIA (no la envolvente) con el minimo deslizante: si hay un
    # pico cerca, la ganancia baja en toda la ventana. Un promedio corto detras
    # quita el escalon, y el clamp final se come el sobrante inaudible.
    g = -torch.nn.functional.max_pool1d(
        -ganancia.reshape(-1, 1, ganancia.shape[-1]), ventana, stride=1, padding=ventana // 2
    )[..., : ganancia.shape[-1]]
    suave = max(ventana // 2, 4)
    g = torch.nn.functional.avg_pool1d(g, suave, stride=1, padding=suave // 2)
    g = g[..., : ganancia.shape[-1]].reshape(ganancia.shape)
    return torch.clamp(x * g, -techo, techo)


def master(x, crest_objetivo=13.0, comprimir=True, tilt_db=0.0, bajo_db=0.0):
    """Cadena final: HP, tilt, compresion multibanda suave y limitador.

    Se normaliza por CREST (pico - rms), no por RMS: normalizar a un RMS fijo
    aplasta la dinamica y deja el tema en 7 dB de crest, que suena a ladrillo.
    """
    if x.dim() == 1:
        x = torch.stack([x, x])
    x = paso_alto(x, 26.0)                          # quita subsonico (exacto por FFT)
    # perillas de equilibrio: estante de graves (120 Hz) y de agudos (3 kHz)
    if abs(bajo_db) > 0.01:
        g = 10 ** (bajo_db / 20) - 1
        x = eq_fft(x, lambda f: 1 + g / (1 + (f / 120.0) ** 2))
    if abs(tilt_db) > 0.01:
        g = 10 ** (tilt_db / 20) - 1
        x = eq_fft(x, lambda f: 1 + g / (1 + (3000.0 / torch.clamp(f, min=1.0)) ** 2))
    if comprimir:
        x = compresor_multibanda(x, cortes=(180.0, 1800.0), umbrales=(-12.0, -12.0, -12.0), ratio=1.6)
    # aire controlado
    x = x + 0.08 * filtrar(x, fir_sinc(12000.0, 127) - fir_sinc(200.0, 127))

    def crest(v):
        r = torch.sqrt(torch.mean(v ** 2))
        return 20 * torch.log10(torch.clamp(v.abs().max(), min=1e-9) / torch.clamp(r, min=1e-9))

    antes = crest(x)
    rms = torch.sqrt(torch.mean(x ** 2))
    factor = 10 ** ((-1.0 - crest_objetivo) / 20) / torch.clamp(rms, min=1e-9)
    x = limitador(x * factor, -1.0)
    print(f"    crest: mezcla {antes:.1f} dB -> master {crest(x):.1f} dB")
    return x


# ------------------------------------------------------------------------- escritura
def escribir_wav(ruta, x, pico_db=-1.0, sr=SR):
    """WAV 24 bits entrelazado. Vectorizado: 208 s de audio se escriben en ~0,2 s
    (con un bucle por muestra eran 129 s de reloj, mas que todo el render)."""
    import numpy as np

    x = normalizar_pico(x.detach().cpu(), pico_db)
    if x.dim() == 1:
        x = x.unsqueeze(0)
    canales, n = x.shape
    entero = (torch.clamp(x, -1, 1) * 8388607).round().to(torch.int32).t().contiguous().numpy()
    # int32 little-endian -> los 3 primeros bytes de cada muestra son el PCM 24 bits
    datos = entero.astype("<i4").view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    cabecera = (b"RIFF" + struct.pack("<I", 36 + len(datos)) + b"WAVE" +
                b"fmt " + struct.pack("<IHHIIHH", 16, 1, canales, sr, sr * canales * 3, canales * 3, 24) +
                b"data" + struct.pack("<I", len(datos)))
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    with open(ruta, "wb") as f:
        f.write(cabecera + datos)


# ------------------------------------------------------------------------ bus / mezcla
def sumar(bus, senales, inicios):
    """Deposita (V, L) en un bus 1-D en las posiciones dadas. Una sola operacion."""
    V, L = senales.shape
    inicios = inicios.to(torch.int64)
    idx = inicios[:, None] + torch.arange(L, device=DISPOSITIVO)[None, :]
    valido = idx < bus.numel()
    return bus.index_add(0, idx[valido], senales[valido])


def panear(mono, p, ganancia=1.0):
    """(L,) mono -> (2, L) con paneo constante potencia."""
    l = math.cos((p + 1) * math.pi / 4)
    r = math.sin((p + 1) * math.pi / 4)
    return torch.stack([mono * l * ganancia, mono * r * ganancia])


def mezclar(pistas, largo):
    """pistas: lista de (2, L) o (L,). Devuelve (2, largo)."""
    salida = torch.zeros(2, largo, device=DISPOSITIVO)
    for p in pistas:
        if p.dim() == 1:
            p = torch.stack([p, p])
        n = min(p.shape[-1], largo)
        salida[:, :n] += p[:, :n]
    return salida


def prueba():
    """Autotest rapido de cada primitiva (se lanza antes del render)."""
    print(f"dispositivo: {DISPOSITIVO} | {torch.cuda.get_device_name(0) if DISPOSITIVO == 'cuda' else 'cpu'}")
    n = SR
    o = osc([110.0, 220.0, 55.0], n, "sierra")
    print(f"  osc          {tuple(o.shape)} pico {o.abs().max():.3f}")
    print(f"  bombo        pico {bombo() .abs().max():.3f}")
    print(f"  caja         pico {caja().abs().max():.3f}")
    print(f"  charles      pico {charles().abs().max():.3f}")
    print(f"  metal        pico {metal().abs().max():.3f}")
    f = tv_filter(o[:1], lambda fr, tt: torch.exp(-0.5 * ((torch.log2(torch.clamp(fr, min=1.0)) - torch.log2(torch.tensor(400.0, device=DISPOSITIVO))) / 1.2) ** 2))
    print(f"  tv_filter    pico {f.abs().max():.3f}")
    s = saturar(o[:1] * 0.5, drive=8.0, veces=16)
    print(f"  saturar 16x  pico {s.abs().max():.3f}")
    ir = ir_estereo(2.0, seed=3)
    r = reverb(torch.stack([o[0], o[0]]), ir, 0.3)
    print(f"  reverb       {tuple(r.shape)} pico {r.abs().max():.3f}")
    g = granular(torch.stack([o[0], o[0]]), dur=1.0, densidad=80)
    print(f"  granular     {tuple(g.shape)} pico {g.abs().max():.3f}")
    c = congelar(torch.stack([o[0], o[0]]), 0.1, 0.5)
    print(f"  congelar     {tuple(c.shape)} pico {c.abs().max():.3f}")
    sh = shimmer(torch.stack([o[0], o[0]]), ir, mix=0.2)
    print(f"  shimmer      {tuple(sh.shape)} pico {sh.abs().max():.3f}")
    x = torch.stack([o[0], o[0]]) * 0.3
    print(f"  compresor    pico {compresor(x).abs().max():.3f}")
    print(f"  multibanda   pico {compresor_multibanda(x).abs().max():.3f}")
    print(f"  limitador    pico {limitador(x, -1.0).abs().max():.3f}")
    m = master(x)
    print(f"  master       pico {m.abs().max():.3f} rms {torch.sqrt(torch.mean(m**2)):.3f}")
    print("  TODO OK")
