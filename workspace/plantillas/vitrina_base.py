"""Base industrial: oscura, minimalista, seductora y casi psicodelica por momentos.

90 BPM, re menor, 76 compases (3:22). Todo se sintetiza con el motor GPU nuevo
(workspace/gpu/motor_gpu.py): voces batcheadas, saturacion a 16x, reverb FFT,
shimmer, congelado espectral y nubes granulares.

Escribe los stems y el master en salida/, todo 24 bits.
"""

import math
import os
import sys
import time

import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "gpu"))
import motor_gpu as M

BPM = 90
NEGRA = 60.0 / BPM
COMPAS = 4 * NEGRA
COMPASES = 76
LARGO_S = COMPASES * COMPAS
N = int(LARGO_S * M.SR) + int(6 * M.SR)
LOTE = 24  # voces por lote: mantiene la memoria y sigue siendo batcheado

t_ini = time.time()


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def nuevo_bus():
    return torch.zeros(N, device=M.DISPOSITIVO)


def pon(bus, senal, t, ganancia=1.0):
    """Inserta una senal mono en el bus en el segundo t."""
    x = senal.reshape(-1) * ganancia
    inicio = int(round(t * M.SR))
    if inicio >= N:
        return bus
    if inicio < 0:
        x = x[-inicio:]
        inicio = 0
    x = x[: N - inicio]
    idx = torch.arange(inicio, inicio + x.numel(), device=M.DISPOSITIVO)
    return bus.index_add(0, idx, x)


def por_lotes(total, lote=LOTE):
    for i in range(0, total, lote):
        yield i, min(i + lote, total)


# --------------------------------------------------------------------- voces
def voz_bajo(midis, duraciones, vels, squelch=0.55, bright=1.0, drive=6.0, sat=4):
    """Bajo batcheado: sierra+pulso+sub con filtro que se abre y saturacion 16x."""
    largo = int(max(duraciones) * M.SR) + int(0.25 * M.SR)
    t = M.segundos(largo)
    env_corte = torch.exp(-t / 0.16) * 0.85 + 0.15
    corte = torch.clamp((240.0 + 1500.0 * bright * env_corte) * (1.0 + 2.2 * squelch * torch.exp(-t / 0.05)), 60, 9000)

    salida = torch.zeros(len(midis), largo, device=M.DISPOSITIVO)
    for i0, i1 in por_lotes(len(midis)):
        f0 = torch.tensor([hz(m) for m in midis[i0:i1]], dtype=M.DT, device=M.DISPOSITIVO)
        a = M.osc(f0, largo, "sierra")
        b = M.osc(f0 * 1.006, largo, "pulso")
        sub = M.osc(f0, largo, "seno")
        x = a * 0.55 + b * 0.28 + sub * 0.45
        y = M.tv_filter(x, lambda fr, tt, c=corte: 1.0 / (1.0 + (fr[:, None] / c[: tt.numel()][None, :]) ** 4), n=1024, hop=256)
        y = M.saturar(y * 0.9, drive=drive, veces=sat)
        dur = torch.tensor(duraciones[i0:i1], dtype=M.DT, device=M.DISPOSITIVO)
        amp = torch.clamp(t[None, :] / 0.006, max=1.0) * torch.exp(-t[None, :] / (dur[:, None] * 0.9 + 0.12))
        vel = torch.tensor(vels[i0:i1], dtype=M.DT, device=M.DISPOSITIVO)
        salida[i0:i1] = y * amp * vel[:, None]
    return salida, largo


def voz_pad(acordes, dur, vel=1.0, corte=900.0):
    """Colchon de sierras desafinadas con filtro que respira."""
    notas = sorted({n for a in acordes for n in a})
    if not notas:
        return torch.zeros(int(dur * M.SR), device=M.DISPOSITIVO)
    n = int(dur * M.SR)
    t = M.segundos(n)
    f0 = torch.tensor([hz(m) for m in notas], dtype=M.DT, device=M.DISPOSITIVO)
    x = M.osc(f0, n, "sierra") * 0.5 + M.osc(f0 * 1.004, n, "sierra") * 0.3
    respira = corte * (0.75 + 0.35 * torch.sin(2 * torch.pi * t / (4 * COMPAS)))
    y = M.tv_filter(x, lambda fr, tt, c=respira: torch.exp(
        -0.5 * ((torch.log2(torch.clamp(fr, min=1.0))[:, None] - torch.log2(c[: tt.numel()][None, :])) / 1.1) ** 2))
    rampa = torch.clamp(t / 1.2, max=1.0) * torch.clamp((dur - t) / 1.5, max=1.0).clamp(min=0)
    return (y.sum(dim=0) * rampa * vel / max(len(notas), 1))


def voz_voz(f0=110.0, dur=1.6, vel=1.0, susurro=0.5):
    """Voz sintetica: formantes + aire. Sin muestras, todo generado."""
    n = int(dur * M.SR)
    t = M.segundos(n)
    x = M.osc([f0], n, "sierra")[0] * 0.6 + M.osc([f0 * 2.0], n, "seno")[0] * 0.2
    formantes = torch.zeros(n, device=M.DISPOSITIVO)
    for fc, ancho, ganancia in ((520.0, 110.0, 1.0), (1180.0, 160.0, 0.6), (2600.0, 240.0, 0.35)):
        formantes += M.filtrar(x, M.fir_sinc(fc + ancho, 127) - M.fir_sinc(max(fc - ancho, 40.0), 127)) * ganancia
    aire = M.pasa_banda(torch.randn(n, device=M.DISPOSITIVO), 2200.0, 9000.0) * 0.25
    env = torch.clamp(t / 0.12, max=1.0) * torch.exp(-t / (dur * 0.55))
    mod = 1.0 + 0.25 * torch.sin(2 * torch.pi * 1.7 * t)
    return (formantes + aire * susurro) * env * mod * vel


# -------------------------------------------------------------------- percusion
def banco(gen, cantidad, semilla=0):
    """Banco de variantes: se generan una vez y se reutilizan."""
    torch.manual_seed(semilla)
    return [gen() for _ in range(cantidad)]


def patron_bateria(buscas):
    """Devuelve bus de bombo, caja, charles y metal segun la seccion."""
    bombo = nuevo_bus()
    caja = nuevo_bus()
    charles = nuevo_bus()
    metal = nuevo_bus()
    kicks = banco(lambda: M.bombo(vel=1.0), 12, 11)
    snares = banco(lambda: M.caja(vel=1.0), 8, 22)
    cerrados = banco(lambda: M.charles(vel=1.0), 10, 33)
    abiertos = banco(lambda: M.charles(vel=0.8, abierto=True), 6, 44)
    metales = [M.metal(vel=1.0, pitch=p) for p in (0.62, 0.78, 1.0, 1.28)]

    for compas, seccion in buscas:
        base = compas * COMPAS
        if seccion == "intro":
            if compas % 4 == 2:
                bombo = pon(bombo, metales[compas % 4], base + 0.5, 0.35)
            continue
        if seccion in ("A", "C"):
            golpes = [0.0, 1.5, 2.0, 3.25] if seccion == "C" else [0.0, 2.75]
            for k, golpe in enumerate(golpes):
                bombo = pon(bombo, kicks[(compas * 3 + k) % len(kicks)], base + golpe * NEGRA, 1.0 if k == 0 else 0.82)
            if compas % 8 == 7:
                bombo = pon(bombo, kicks[(compas + 5) % len(kicks)], base + 3.5 * NEGRA, 0.7)
        if seccion in ("B", "C"):
            for golpe in (1.0, 3.0):
                caja = pon(caja, snares[(compas + int(golpe)) % len(snares)], base + golpe * NEGRA, 0.55 if seccion == "B" else 0.8)
            if compas % 4 == 3:
                caja = pon(caja, snares[(compas + 2) % len(snares)], base + 3.75 * NEGRA, 0.32)
        if seccion in ("A", "B", "C"):
            subdivisiones = 8 if seccion != "C" else 16
            for s in range(subdivisiones):
                if s % 2 == 0 or seccion == "C":
                    charles = pon(charles, cerrados[(compas + s) % len(cerrados)],
                                  base + s * (4.0 / subdivisiones) * NEGRA, 0.35 + 0.25 * (s % 3 == 0))
            if compas % 4 == 3:
                charles = pon(charles, abiertos[compas % len(abiertos)], base + 3.5 * NEGRA, 0.5)
        if seccion == "C" and compas % 4 == 0:
            metal = pon(metal, metales[(compas // 4) % len(metales)], base + 2.0 * NEGRA, 0.4)
    return bombo, caja, charles, metal


def patron_bajo(buscas):
    """Pedal en re con escape a mi bemol (color frigio) y acordes en C."""
    midis, durs, vels, inicios = [], [], [], []
    for compas, seccion in buscas:
        base = compas * COMPAS
        if seccion == "intro":
            continue
        if seccion == "A":
            figura = [(0.0, 1.0, 26), (1.5, 0.5, 26), (2.0, 1.0, 26), (3.25, 0.75, 27)]
        elif seccion == "B":
            figura = [(0.0, 1.5, 26), (1.75, 0.75, 26), (2.75, 1.25, 29)]
        elif seccion == "C":
            figura = [(0.0, 0.75, 26), (0.75, 0.5, 26), (1.5, 0.5, 27), (2.0, 1.0, 26), (3.0, 0.75, 29)]
        elif seccion == "descanso":
            figura = [(0.0, 3.0, 26)]
        else:
            figura = [(0.0, 2.0, 26)]
        for t_beat, dur_beat, midi in figura:
            midis.append(midi)
            durs.append(dur_beat * NEGRA * 0.95)
            vels.append(0.95 if t_beat == 0.0 else 0.8)
            inicios.append(base + t_beat * NEGRA)
    return midis, durs, vels, inicios


def patron_pad(buscas):
    """Acordes sostenidos: re menor con novena; luego Bb, Gm y A."""
    acordes = {
        "Dm": [50, 53, 57, 64],
        "Bb": [46, 50, 53, 62],
        "Gm": [43, 50, 53, 58],
        "A": [45, 49, 52, 57],
    }
    progresion = ["Dm", "Dm", "Bb", "Bb", "Gm", "Gm", "A", "A"]
    tramos = []
    for compas, seccion in buscas:
        if seccion not in ("B", "C", "descanso"):
            continue
        if compas % 4 == 0:
            nombre = progresion[(compas // 4) % len(progresion)] if seccion == "C" else "Dm"
            tramos.append((compas * COMPAS, 4 * COMPAS, acordes[nombre]))
    return tramos


def voces_y_aire(buscas):
    """Susurros y golpes de aire: la parte seductora."""
    bus = nuevo_bus()
    frases = [
        (11, 2.0, 110.0, 0.5), (13, 3.0, 98.0, 0.45), (19, 1.0, 116.5, 0.55),
        (27, 2.0, 110.0, 0.5), (31, 3.25, 98.0, 0.4), (35, 1.5, 130.8, 0.5),
        (41, 2.0, 110.0, 0.35), (44, 0.0, 87.3, 0.3),
        (49, 1.0, 116.5, 0.55), (53, 2.5, 110.0, 0.5), (57, 3.0, 98.0, 0.45),
        (61, 1.5, 130.8, 0.5), (67, 2.0, 110.0, 0.35),
    ]
    for compas, beat, f0, vel in frases:
        v = voz_voz(f0=f0, dur=1.8, vel=vel, susurro=0.6)
        bus = pon(bus, v, compas * COMPAS + beat * NEGRA, 1.0)
    return bus


def disenos_psicodelicos(buscas, pad_total, bajo_total):
    """Shimmer, congelado y nubes: lo que la CPU no se permite."""
    ir = M.ir_estereo(dur=3.8, decay=0.62, corte_ini=8000.0, corte_fin=1500.0, predelay=0.03, seed=5)
    shimmer = M.shimmer(pad_total, ir, mix=0.22, feedback=0.42, vueltas=3)

    # congelado espectral del pad en el descanso: deriva sin pulso
    inicio_descanso = [c for c, s in buscas if s == "descanso"][0] * COMPAS
    congelado = M.congelar(pad_total, inicio_descanso + 1.0, 8 * COMPAS)
    congelado = M.reverb(congelado, ir, mix=0.45)

    # nube granular del propio bajo, muy tenue, en el descanso y el final
    nube = M.granular(bajo_total, tam=0.09, densidad=90.0, dur=LARGO_S, jitter=0.5)
    envolvente = torch.zeros(N, device=M.DISPOSITIVO)
    for compas, seccion in buscas:
        if seccion in ("descanso", "outro"):
            a = int(compas * COMPAS * M.SR)
            b = min(a + int(COMPAS * M.SR), N)
            envolvente[a:b] = 1.0
    # la nube dura LARGO_S (sin la cola): se recorta la envolvente a su longitud
    nube = nube * envolvente[: nube.shape[-1]].unsqueeze(0)
    return shimmer, congelado, nube, ir


def estructura():
    plan = []
    for c in range(COMPASES):
        if c < 8:
            plan.append((c, "intro"))
        elif c < 24:
            plan.append((c, "A"))
        elif c < 40:
            plan.append((c, "B"))
        elif c < 48:
            plan.append((c, "descanso"))
        elif c < 64:
            plan.append((c, "C"))
        else:
            plan.append((c, "outro"))
    return plan


def construir_stems(verboso=True):
    """Sintetiza la pieza y devuelve los stems mezclados (sin masterizar).

    Se separa de main() para que el buscador de mezclas pueda reutilizar los
    stems en memoria en vez de volver a sintetizarlos o leerlos del disco.
    """
    def log(texto):
        if verboso:
            print(texto, flush=True)

    log(f"motor GPU: {M.DISPOSITIVO} | {LARGO_S:.1f} s, {COMPASES} compases a {BPM} BPM")
    plan = estructura()

    # ---- percusion
    t0 = time.time()
    bombo, caja, charles, metal = patron_bateria(plan)
    log(f"  bateria ............ {time.time() - t0:6.2f} s")

    # ---- bajo (batcheado)
    t0 = time.time()
    midis, durs, vels, inicios = patron_bajo(plan)
    notas_bajo, largo_bajo = voz_bajo(midis, durs, vels)
    bajo = nuevo_bus()
    for i, inicio in enumerate(inicios):
        bajo = pon(bajo, notas_bajo[i, : int(durs[i] * M.SR) + int(0.2 * M.SR)], inicio, 1.0)
    log(f"  bajo ............... {time.time() - t0:6.2f} s ({len(midis)} notas de una vez)")

    # ---- pad
    t0 = time.time()
    pad = nuevo_bus()
    for inicio, dur, acorde in patron_pad(plan):
        trozo = voz_pad([acorde], dur, vel=0.7, corte=780.0)
        pad = pon(pad, trozo, inicio, 1.0)
    log(f"  pad ................ {time.time() - t0:6.2f} s")

    # ---- voz / aire
    t0 = time.time()
    voz = voces_y_aire(plan)
    log(f"  voz ................ {time.time() - t0:6.2f} s")

    # ---- psicodelia
    t0 = time.time()
    pad_st = torch.stack([pad, pad])
    bajo_st = torch.stack([bajo, bajo])
    shimmer, congelado, nube, ir = disenos_psicodelicos(plan, pad_st, bajo_st)
    log(f"  shimmer/freeze/nube  {time.time() - t0:6.2f} s")

    # ---- espacio
    t0 = time.time()
    bajo_st = M.reverb(bajo_st, ir, mix=0.10)
    bombo_st = M.reverb(torch.stack([bombo, bombo]), ir, mix=0.06)
    caja_st = M.reverb(torch.stack([caja, caja]), ir, mix=0.22)
    voz_st = M.reverb(torch.stack([voz, voz]), ir, mix=0.35)
    metal_st = M.reverb(torch.stack([metal, metal]), ir, mix=0.40)
    log(f"  reverb ............. {time.time() - t0:6.2f} s")

    # ---- mezcla (con paneo y anchura). Todos los stems se ajustan a N para que
    # la suma y los ficheros que van al DAW tengan exactamente la misma duracion.
    def ajustar(x):
        if x.dim() == 1:
            x = torch.stack([x, x])
        if x.shape[-1] >= N:
            return x[..., :N]
        return torch.cat([x, torch.zeros(2, N - x.shape[-1], device=M.DISPOSITIVO)], dim=-1)

    stems = {
        "bombo": ajustar(bombo_st),
        "caja": ajustar(caja_st) * 0.55,
        "charles": ajustar(M.panear(charles, 0.35, 0.45)),
        "metal": ajustar(metal_st) * 0.5,
        "bajo": ajustar(bajo_st) * 0.95 + ajustar(nube) * 0.22,
        "pad": ajustar(M.panear(pad, -0.15, 0.5)) * 0.9,
        "shimmer": ajustar(shimmer) * 0.30,
        "congelado": ajustar(congelado) * 0.22,
        "voz": ajustar(M.panear(voz, 0.1, 0.75)),
    }

    return stems


def main():
    global t_ini
    t_ini = time.time()
    salida = os.path.join(os.path.dirname(__file__), "salida")
    os.makedirs(salida, exist_ok=True)
    stems = construir_stems()

    t0 = time.time()
    mezcla = M.mezclar(list(stems.values()), N)
    master = M.master(mezcla, crest_objetivo=13.0)
    print(f"  master ............. {time.time() - t0:6.2f} s")

    # ---- escritura
    for nombre, senal in stems.items():
        M.escribir_wav(os.path.join(salida, f"vitrina_{nombre}.wav"), senal, pico_db=-1.5)
    M.escribir_wav(os.path.join(salida, "vitrina_master.wav"), master, pico_db=-1.0)

    rms = torch.sqrt(torch.mean(master ** 2)).item()
    pico = master.abs().max().item()
    print(f"\n  master: pico {20 * math.log10(pico):.2f} dBFS | rms {20 * math.log10(rms):.2f} dBFS "
          f"| crest {20 * math.log10(pico / rms):.2f} dB | {N / M.SR:.1f} s")
    print(f"  TOTAL {time.time() - t_ini:.1f} s | ficheros en {salida}")


if __name__ == "__main__":
    main()
