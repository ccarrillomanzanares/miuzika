"""Renders the SAME note with the engine (CPU) and with a torch version (CPU/GPU).

Goal: to really compare "the sample from this laptop" with "the sample from
a Lambda instance", and also measure what temporal oversampling contributes.

    python render_gpu.py --motor /path/codigo --salida-dir out --todo

Modes:
  motor        bass_note from the real engine, numpy, as is (reference A)
  torch        faithful torch port of the same calculation (B), device cpu or cuda
  alta         same calculation with a much finer STFT (C), cpu or cuda

The wavetables and the window are taken from the engine so that A and B start from the same thing.
"""

import argparse
import json
import pathlib
import sys
import time

import numpy as np
import torch

SR = 48000  # overwritten with instruments.SR when the engine is loaded (the engine uses 44.1 kHz)
NOTA = 33          # A1, 55 Hz
DUR = 4.0
VEL = 0.9
SEED = 7
SQUELCH = 0.5
BRIGHT = 1.0


def cargar_motor(ruta):
    sys.path.insert(0, str(ruta))
    import dsp
    import instruments
    import render

    return dsp, instruments, render


# ------------------------------------------------------------------ torch version
def osc_t(freq, n, tabla, device):
    f = torch.full((n,), float(freq), dtype=torch.float64, device=device)
    ph = (torch.cumsum(f, 0) / SR) % 1.0
    idx = ph * tabla.numel()
    i0 = idx.to(torch.int64) % tabla.numel()
    i1 = (i0 + 1) % tabla.numel()
    fr = idx - torch.floor(idx)
    return tabla[i0] * (1 - fr) + tabla[i1] * fr


def stft_t(x, w, n, hop):
    pad = n
    xp = torch.cat([torch.zeros(pad, dtype=x.dtype, device=x.device), x,
                    torch.zeros(pad, dtype=x.dtype, device=x.device)])
    nf = 1 + (len(xp) - n) // hop
    idx = torch.arange(n, device=x.device)[None, :] + hop * torch.arange(nf, device=x.device)[:, None]
    return torch.fft.rfft(xp[idx] * w, dim=1), pad


def istft_t(X, w, pad, largo, n, hop):
    nf = X.shape[0]
    frames = torch.fft.irfft(X, n=n, dim=1) * w
    out = torch.zeros(hop * (nf - 1) + n, dtype=frames.dtype, device=X.device)
    wsum = torch.zeros_like(out)
    ww = w * w
    for j in range(n // hop):
        out[j * hop:j * hop + nf * hop] += frames[:, j * hop:(j + 1) * hop].reshape(-1)
        wsum[j * hop:j * hop + nf * hop] += ww[j * hop:(j + 1) * hop].repeat(nf)
    out = out / torch.clamp(wsum, min=1e-6)
    return out[pad:pad + largo]


def tv_filter_t(x, forma, n, hop, device):
    w = torch.from_numpy(_WIN[n]).to(device)
    X, pad = stft_t(x, w, n, hop)
    freqs = torch.fft.rfftfreq(n, 1.0 / SR).to(device)
    nf = X.shape[0]
    tiempos = (torch.arange(nf, device=device) * hop - pad + n / 2.0) / SR
    E = forma(tiempos[:, None], freqs[None, :])
    return istft_t(X * E.to(X.dtype), w, pad, x.numel(), n, hop)


def render_torch(instruments, dsp, device, n, hop, dur=DUR):
    tab_saw = torch.from_numpy(instruments._SAW).to(device)
    tab_pul = torch.from_numpy(instruments._PULSE).to(device)
    nt = int((dur + 0.25) * SR)
    t = torch.arange(nt, dtype=torch.float64, device=device) / SR
    f0 = float(instruments.note_hz(NOTA))
    rng = np.random.default_rng(SEED)
    det = 1.0 + rng.uniform(-0.004, 0.004)

    a = osc_t(f0 * det, nt, tab_saw, device)
    b = osc_t(f0 * det * 1.006, nt, tab_pul, device)
    sub = torch.sin(2 * torch.pi * f0 * t) * 0.9
    x = a * 0.55 + b * 0.35 + sub * 0.5

    env = torch.exp(-t / 0.16) * 0.85 + 0.15
    cut = (240.0 + 1500.0 * BRIGHT * env) * (1.0 + 2.2 * SQUELCH * torch.exp(-t / 0.05))
    cut = torch.clamp(cut, 60.0, 9000.0)

    cuerpo = tv_filter_t(x, lambda tt, ff: 1.0 / (1.0 + (ff / cut[:tt.shape[0]][:, None]) ** 4), n, hop, device)
    res = tv_filter_t(x, lambda tt, ff: torch.exp(-0.5 * ((torch.log2(torch.clamp(ff, min=1.0))
                                                          - torch.log2(cut[:tt.shape[0]][:, None])) / 0.55) ** 2) * 0.9,
                      n, hop, device)
    y = cuerpo + res * 0.55
    y = torch.tanh(1.8 * (y * 1.5)) / np.tanh(1.8)

    amp = torch.clamp(t / 0.006, max=1.0) * torch.exp(-t / (dur * 0.9 + 0.12))
    rel = torch.clamp((dur + 0.2 - t) / 0.2, 0.0, 1.0)
    y = y * amp * rel
    # static biquads are sequential: they stay on the CPU in both versions
    salida = y.detach().cpu().numpy()
    salida = dsp.lp(salida, 4200.0, 0.7)
    salida = dsp.hp(salida, 34.0, 0.7)
    return dsp.fade(salida * VEL, 1.0, 15.0)


# ------------------------------------------------------------------ utilities
_WIN = {}


def preparar_ventana(dsp):
    for n in (1024, 4096, 16384):
        _WIN[n] = dsp._win(n).astype(np.float64)


def guardar(render, ruta, onda):
    # the engine delivers peaks at +6 dBFS (normalized in the master); to be able to
    # listen without distortion all three versions are left at -1 dBFS.
    x = np.asarray(onda, dtype=np.float64)
    pico = np.max(np.abs(x)) or 1.0
    render.write_wav(str(ruta), x * (0.891 / pico), width=3)


def comparar(a, b, etiqueta):
    n = min(len(a), len(b))
    a, b = a[:n].astype(np.float64), b[:n].astype(np.float64)
    dif = a - b
    rms = float(np.sqrt(np.mean(a ** 2))) or 1e-9
    print(f"  {etiqueta}: max|dif|={np.max(np.abs(dif)):.6f}  "
          f"rms(dif)/rms(A)={np.sqrt(np.mean(dif ** 2)) / rms * 100:.2f}%")
    return {"max_dif": float(np.max(np.abs(dif))),
            "rms_rel_pct": float(np.sqrt(np.mean(dif ** 2)) / rms * 100)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--motor", required=True)
    ap.add_argument("--salida-dir", required=True)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--dur", type=float, default=DUR)
    ap.add_argument("--n", type=int, default=1024)
    ap.add_argument("--hop", type=int, default=256)
    ap.add_argument("--n-alta", type=int, default=4096)
    ap.add_argument("--hop-alta", type=int, default=128)
    ap.add_argument("--solo-tiempos", action="store_true")
    args = ap.parse_args()

    dsp, instruments, render = cargar_motor(args.motor)
    global SR
    SR = float(instruments.SR)   # 44,100: the port has to use the engine's one
    print(f"engine: SR={SR:.0f} Hz, note={NOTA}, dur={args.dur} s")
    preparar_ventana(dsp)
    out = pathlib.Path(args.salida_dir)
    out.mkdir(parents=True, exist_ok=True)
    informe = {"dispositivo": args.device}
    if args.device == "cuda":
        informe["gpu"] = torch.cuda.get_device_name(0)

    # A: the real engine, numpy, as it sounds in the track
    t0 = time.time()
    a = instruments.bass_note(NOTA, args.dur, vel=VEL, seed=SEED, squelch=SQUELCH, bright=BRIGHT)
    info_a = time.time() - t0
    guardar(render, out / "A_motor.wav", a)
    print(f"A motor (numpy): {info_a:.2f} s")
    informe["A_motor_s"] = round(info_a, 3)

    # B: port to torch, same resolution as the engine (n=1024, hop=256)
    if args.device == "cuda":
        torch.cuda.synchronize()
    t0 = time.time()
    b = render_torch(instruments, dsp, args.device, args.n, args.hop, args.dur)
    if args.device == "cuda":
        torch.cuda.synchronize()
    info_b = time.time() - t0
    guardar(render, out / "B_torch.wav", b)
    print(f"B torch ({args.device}, n={args.n} hop={args.hop}): {info_b:.2f} s")
    informe["B_torch_s"] = round(info_b, 3)

    # C: more STFT resolution (what costs dearly on CPU)
    t0 = time.time()
    c = render_torch(instruments, dsp, args.device, args.n_alta, args.hop_alta, args.dur)
    if args.device == "cuda":
        torch.cuda.synchronize()
    info_c = time.time() - t0
    guardar(render, out / "C_alta.wav", c)
    print(f"C alta ({args.device}, n={args.n_alta} hop={args.hop_alta}): {info_c:.2f} s")
    informe["C_alta_s"] = round(info_c, 3)

    print("\nDifferences (null test):")
    informe["A_vs_B"] = comparar(a, b, "A motor  vs B torch ")
    informe["A_vs_C"] = comparar(a, c, "A motor  vs C alta  ")
    informe["B_vs_C"] = comparar(b, c, "B torch  vs C alta  ")

    (out / "medidas.json").write_text(json.dumps(informe, indent=1), encoding="utf-8")
    print("\n", json.dumps(informe, indent=1))


if __name__ == "__main__":
    main()
