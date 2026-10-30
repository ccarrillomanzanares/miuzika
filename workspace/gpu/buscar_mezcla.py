"""Mix searcher: N variants rendered and scored on the GPU.

This is what the GPU really buys: not "the same render faster", but
trying 60 different settings of the same base in two minutes and keeping the
ones that measure best. A human would do three or four by hand in an afternoon.

Each variant moves: gain of each stem, bass shelf, treble shelf,
crest target and whether it compresses or not. It is scored with objective metrics
(crest, spectral balance, stereo width, level) and the best ones are saved.
"""

import json
import math
import os
import random
import sys
import time

import torch

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, "..", "proyectos", "vitrina"))

import base as V          # noqa: E402  (the composition)
import motor_gpu as M     # noqa: E402

SALIDA = os.path.join(AQUI, "..", "proyectos", "vitrina", "salida")
N_VARIANTES = 80
SEMILLA = 7

# Targets, taken from the measurements of the CC references and the brief
OBJETIVO = {
    "crest": 13.0,          # the brief asks for 12-14
    "sub_vs_medio": 4.0,    # 20-100 Hz must not exceed 100-500 by more than 4 dB
    "medios": -20.0,        # 500-2000 Hz
    "agudos": -29.0,        # 2-8 kHz
    "aire": -50.0,          # 8-16 kHz
    "anchura": 0.30,        # side/mid
    "nivel": -14.0,         # rms in dBFS
}


def metricas(x, sr=M.SR):
    """Measures the COMPLETE track. Measuring only a central chunk was misleading: it lands
    on the break (no drums) and the crest came out 3 dB below the real one."""
    l, r = x[0], x[1]
    mono = (l + r) / 2
    rms = torch.sqrt(torch.mean(mono ** 2))
    pico = mono.abs().max()
    crest = 20 * torch.log10(torch.clamp(pico, min=1e-9) / torch.clamp(rms, min=1e-9))

    espectro = torch.fft.rfft(mono * torch.hann_window(mono.numel(), device=mono.device))
    P = (espectro.abs() ** 2)
    f = torch.fft.rfftfreq(mono.numel(), 1.0 / sr).to(P.device)
    total = torch.clamp(P.sum(), min=1e-20)

    def banda(lo, hi):
        return 10 * torch.log10(torch.clamp(P[(f >= lo) & (f < hi)].sum(), min=1e-20) / total)

    sub = banda(20, 100)
    medio = banda(100, 500)
    medios = banda(500, 2000)
    agudos = banda(2000, 8000)
    aire = banda(8000, 16000)

    lado = (l - r) / 2
    centro = (l + r) / 2
    anchura = torch.sqrt(torch.mean(lado ** 2)) / torch.clamp(torch.sqrt(torch.mean(centro ** 2)), min=1e-9)

    return {
        "crest": float(crest), "pico": float(20 * torch.log10(torch.clamp(pico, min=1e-9))),
        "rms": float(20 * torch.log10(torch.clamp(rms, min=1e-9))),
        "sub": float(sub), "medio": float(medio), "medios": float(medios),
        "agudos": float(agudos), "aire": float(aire), "anchura": float(anchura),
    }


def puntuar(m):
    """The lower, the better. Each deviation weighs according to how audible it is."""
    p = 0.0
    p += 1.5 * abs(m["crest"] - OBJETIVO["crest"])
    p += 1.2 * max(0.0, (m["sub"] - m["medio"]) - OBJETIVO["sub_vs_medio"])
    p += 1.0 * abs(m["medios"] - OBJETIVO["medios"])
    p += 0.8 * abs(m["agudos"] - OBJETIVO["agudos"])
    p += 0.5 * abs(m["aire"] - OBJETIVO["aire"])
    p += 2.0 * abs(m["anchura"] - OBJETIVO["anchura"])
    p += 0.6 * abs(m["rms"] - OBJETIVO["nivel"])
    if m["pico"] > -1.0:                     # the ceiling is non-negotiable
        p += 10.0 * (m["pico"] + 1.0)
    return p


def main():
    print(f"GPU engine: {M.DISPOSITIVO}")
    t0 = time.time()
    stems = V.construir_stems(verboso=False)
    nombres = list(stems.keys())
    largo = V.N
    print(f"stems: {len(nombres)} ({', '.join(nombres)}) in {time.time() - t0:.1f} s")

    # stack (S, 2, N) to sum all at once with gains
    pila = torch.stack([stems[n] for n in nombres])
    rng = random.Random(SEMILLA)
    resultados = []

    t0 = time.time()
    for k in range(N_VARIANTES):
        ganancias = torch.tensor([rng.uniform(-3.0, 3.0) for _ in nombres], device=M.DISPOSITIVO)
        if k == 0:
            ganancias = torch.zeros(len(nombres), device=M.DISPOSITIVO)   # the current mix
        tilt = 0.0 if k == 0 else rng.uniform(-2.0, 2.0)
        bajo = 0.0 if k == 0 else rng.uniform(-3.0, 2.0)
        crest_obj = 13.0 if k == 0 else rng.uniform(11.5, 14.5)
        comprimir = True if k == 0 else rng.random() > 0.5

        mezcla = (pila * (10 ** (ganancias / 20))[:, None, None]).sum(dim=0)[:, :largo]
        master = M.master(mezcla, crest_objetivo=crest_obj, comprimir=comprimir, tilt_db=tilt, bajo_db=bajo)
        m = metricas(master)
        m["puntuacion"] = puntuar(m)
        m["variante"] = k
        m["ganancias"] = {n: round(float(g), 2) for n, g in zip(nombres, ganancias)}
        m["tilt_db"] = round(tilt, 2)
        m["bajo_db"] = round(bajo, 2)
        m["crest_objetivo"] = round(crest_obj, 2)
        m["comprime"] = comprimir
        resultados.append((m, master))
        if k % 10 == 0:
            print(f"  {k:>2}/{N_VARIANTES} score {m['puntuacion']:.2f} "
                  f"(crest {m['crest']:.1f}, rms {m['rms']:.1f})", flush=True)

    print(f"\n{N_VARIANTES} variants in {time.time() - t0:.1f} s "
          f"({(time.time() - t0) / N_VARIANTES * 1000:.0f} ms each)")

    resultados.sort(key=lambda par: par[0]["puntuacion"])
    mejores = resultados[:3]
    for puesto, (m, master) in enumerate(mejores, 1):
        M.escribir_wav(os.path.join(SALIDA, f"vitrina_mezcla_{puesto}.wav"), master, pico_db=-1.0)

    print(f"\n{'#':<3}{'score':>7}{'crest':>7}{'rms':>7}{'sub':>7}{'mids':>8}{'highs':>8}{'air':>7}{'wide':>7}")
    for puesto, (m, _) in enumerate(mejores, 1):
        print(f"{puesto:<3}{m['puntuacion']:7.2f}{m['crest']:7.1f}{m['rms']:7.1f}{m['sub']:7.1f}"
              f"{m['medios']:8.1f}{m['agudos']:8.1f}{m['aire']:7.1f}{m['anchura']:7.2f}")

    print("\nSettings of the three best:")
    for puesto, (m, _) in enumerate(mejores, 1):
        activos = {k: v for k, v in m["ganancias"].items() if abs(v) >= 0.5}
        print(f"  {puesto}: tilt {m['tilt_db']:+.1f} dB | graves {m['bajo_db']:+.1f} dB | "
              f"crest obj {m['crest_objetivo']:.1f} | comprime {m['comprime']}")
        print(f"     stems moved: {activos if activos else 'none'}")

    with open(os.path.join(SALIDA, "vitrina_busqueda.json"), "w", encoding="utf-8") as f:
        json.dump({"objetivo": OBJETIVO, "mejores": [m for m, _ in mejores],
                   "todas": sorted([m for m, _ in resultados], key=lambda z: z["puntuacion"])},
                  f, indent=1, ensure_ascii=False)
    print(f"\nreport: {os.path.join(SALIDA, 'vitrina_busqueda.json')}")


if __name__ == "__main__":
    main()
