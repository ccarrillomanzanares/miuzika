"""What the GPU allows and the CPU does not: oversampled saturation with no aliasing.

A saturation (tanh) with high drive generates harmonics above Nyquist that,
not being filtered, fold back down (aliasing): they sound like dirt and
harshness right in the highs. The solution is to compute at 8x/16x and filter before
downsampling. On CPU that multiplies the cost by 16 and is not done; on GPU it is pocket change.

Measures: non-harmonic energy (aliasing) at 1x, 8x and 16x, and the time of each version.
Writes the WAVs so they can be listened to.
"""

import os
import time

import numpy as np
import torch
import torch.nn.functional as F

SR = 48000
DISPOSITIVO = "cuda" if torch.cuda.is_available() else "cpu"
DRIVE = 8.0
TAPS = 127


def fir_antialias(corte_relativo: float, dispositivo, dtype=torch.float64):
    """Low-pass FIR filter (sinc with Hann window). corte_relativo in (0, 1)."""
    n = torch.arange(TAPS, dtype=dtype, device=dispositivo) - (TAPS - 1) / 2
    h = torch.sinc(2 * corte_relativo * n) * torch.hann_window(TAPS, periodic=False, dtype=dtype, device=dispositivo)
    return h / h.sum()


def filtrar(x, h):
    """1-D convolution with the same size (symmetric padding)."""
    pad = (h.numel() - 1) // 2
    return F.conv1d(F.pad(x.view(1, 1, -1), (pad, pad), mode="replicate"), h.view(1, 1, -1)).view(-1)


def sobremuestrear(x, factor, h):
    if factor == 1:
        return x
    arriba = torch.zeros(x.numel() * factor, dtype=x.dtype, device=x.device)
    arriba[::factor] = x * factor
    return filtrar(arriba, h)


def submuestrear(y, factor, h):
    if factor == 1:
        return y
    return filtrar(y, h)[::factor].contiguous()


def saturar(x, factor, h):
    """High-drive tanh, computed at 'factor' x and returned to the original rate."""
    return submuestrear(torch.tanh(DRIVE * sobremuestrear(x, factor, h)) / np.tanh(DRIVE), factor, h)


def medir_aliasing(senal, f0):
    """NON-harmonic energy relative to f0, in dB relative to the fundamental (lower = better)."""
    x = senal.detach().cpu().numpy().astype(np.float64)
    n = 1 << int(np.ceil(np.log2(len(x))))
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)), n)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    fundamental = X[(f > f0 * 0.9) & (f < f0 * 1.1)].sum() or 1e-20
    armonicos = np.zeros_like(f, dtype=bool)
    k = 1
    while k * f0 < SR / 2:
        armonicos |= (f > k * f0 * 0.97) & (f < k * f0 * 1.03)
        k += 1
    resto = X[(~armonicos) & (f > 30)].sum()
    return 10 * np.log10(max(resto, 1e-20) / fundamental)


def guardar(ruta, senal, pico_objetivo=0.89):
    x = senal.detach().cpu().numpy().astype(np.float64)
    x = x / (np.max(np.abs(x)) or 1.0) * pico_objetivo
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    # 24-bit WAV without scipy
    import struct
    pcm = (np.clip(x, -1, 1) * 8388607).astype(np.int32)
    datos = bytearray()
    for v in pcm:
        datos += struct.pack("<i", int(v))[:3]
    cabecera = (b"RIFF" + struct.pack("<I", 36 + len(datos)) + b"WAVE" +
                b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 3, 3, 24) +
                b"data" + struct.pack("<I", len(datos)))
    with open(ruta, "wb") as f:
        f.write(cabecera + bytes(datos))


def main():
    print(f"device: {DISPOSITIVO}" + (f" | {torch.cuda.get_device_name(0)}" if DISPOSITIVO == "cuda" else ""))

    # --- 1. pure tone: measures pure aliasing, with no music in between
    f0 = 1000.0
    t = torch.arange(int(2.0 * SR), dtype=torch.float64, device=DISPOSITIVO) / SR
    tono = 0.9 * torch.sin(2 * torch.pi * f0 * t)

    print("\nA. Saturated 1 kHz tone (drive 8). Non-harmonic energy vs fundamental:")
    resultados = {}
    for factor in (1, 8, 16):
        h = fir_antialias(0.5 / factor * 0.95, DISPOSITIVO)
        if DISPOSITIVO == "cuda":
            torch.cuda.synchronize()
        t0 = time.time()
        y = saturar(tono, factor, h)
        if DISPOSITIVO == "cuda":
            torch.cuda.synchronize()
        ms = (time.time() - t0) * 1000
        resultados[factor] = medir_aliasing(y, f0)
        print(f"   {factor:>2}x: {resultados[factor]:7.1f} dB   ({ms:6.1f} ms)")
        if factor != 1:
            guardar(f"salida/tono_{factor}x.wav", y)
    guardar("salida/tono_1x.wav", saturar(tono, 1, fir_antialias(0.5, DISPOSITIVO)))
    print(f"   improvement 1x -> 16x: {resultados[1] - resultados[16]:+.1f} dB less aliasing")

    # --- 2. music: a bass from the engine, saturated the same way
    import instruments
    note = instruments.bass_note(33, 4.0, vel=0.9, seed=7, squelch=0.5, bright=1.0)
    bajo = torch.from_numpy(np.asarray(note, dtype=np.float64)).to(DISPOSITIVO) * 2.0
    print("\nB. Engine bass (A1, 4 s) with the same saturation:")
    for factor in (1, 16):
        h = fir_antialias(0.5 / factor * 0.95, DISPOSITIVO)
        if DISPOSITIVO == "cuda":
            torch.cuda.synchronize()
        t0 = time.time()
        y = saturar(bajo, factor, h)
        if DISPOSITIVO == "cuda":
            torch.cuda.synchronize()
        ms = (time.time() - t0) * 1000
        x = y.detach().cpu().numpy()
        F_ = np.abs(np.fft.rfft(x)) ** 2
        freq = np.fft.rfftfreq(len(x), 1 / SR)
        agudos = 10 * np.log10(F_[(freq > 6000)].sum() / (F_.sum() or 1e-20))
        print(f"   {factor:>2}x: {ms:6.1f} ms | energy >6 kHz: {agudos:6.1f} dB of the total")
        guardar(f"salida/bajo_{factor}x.wav", y)

    # --- 3. coste a escala de cancion: 6 minutos mono a 16x
    print("\nC. Coste a escala (6 min mono, 16x):")
    largo = int(360 * SR)
    x = torch.zeros(largo, dtype=torch.float64, device=DISPOSITIVO)
    t = torch.arange(largo, dtype=torch.float64, device=DISPOSITIVO) / SR
    x = 0.5 * torch.sin(2 * torch.pi * 110 * t) + 0.3 * torch.sin(2 * torch.pi * 220 * t)
    h16 = fir_antialias(0.5 / 16 * 0.95, DISPOSITIVO)
    if DISPOSITIVO == "cuda":
        torch.cuda.synchronize()
    t0 = time.time()
    saturar(x, 16, h16)
    if DISPOSITIVO == "cuda":
        torch.cuda.synchronize()
    print(f"   16x on 6 min: {(time.time() - t0) * 1000:.0f} ms")


if __name__ == "__main__":
    main()
