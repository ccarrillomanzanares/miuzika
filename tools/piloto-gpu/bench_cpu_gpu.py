"""Mide CPU vs GPU en el motor real, con presupuesto de tiempo por caso."""

import sys
import time

sys.path.insert(0, "/home/ubuntu/motor")
import torch

import render_gpu as R

PRESUPUESTO = 240.0  # segundos para todo el banco


def lote(device, notas, n, hop, dur):
    if device == "cuda":
        torch.cuda.synchronize()
    t0 = time.time()
    for _ in range(notas):
        R.render_torch(R.INS, R.DSP, device, n, hop, dur)
    if device == "cuda":
        torch.cuda.synchronize()
    return time.time() - t0


def main():
    R.DSP, R.INS, R.REND = R.cargar_motor("/home/ubuntu/motor")
    R.SR = float(R.INS.SR)
    R.preparar_ventana(R.DSP)
    print(f"SR={R.SR:.0f} Hz | {torch.cuda.get_device_name(0)}", flush=True)

    casos = [
        ("20 notas x 4 s   n=1024 hop=256 (ajustes del motor)", 20, 1024, 256, 4.0),
        ("20 notas x 4 s   n=4096 hop=128 (4x resolucion)", 20, 4096, 128, 4.0),
        ("4 notas  x 30 s  n=4096 hop=128", 4, 4096, 128, 30.0),
        ("1 nota   x 10 s  n=8192 hop=64  (resolucion extrema)", 1, 8192, 64, 10.0),
    ]

    print(f"\n{'caso':<52}{'CPU':>9}{'GPU':>9}{'CPU/GPU':>9}", flush=True)
    t_inicio = time.time()
    for etiqueta, notas, n, hop, dur in casos:
        if time.time() - t_inicio > PRESUPUESTO:
            print(f"{etiqueta:<52}   (sin tiempo, se omite)", flush=True)
            continue
        tc = lote("cpu", notas, n, hop, dur)
        tg = lote("cuda", notas, n, hop, dur)
        print(f"{etiqueta:<52}{tc:8.2f}s{tg:8.2f}s{tc/tg:8.1f}x", flush=True)


if __name__ == "__main__":
    main()
