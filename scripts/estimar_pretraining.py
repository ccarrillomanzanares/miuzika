#!/usr/bin/env python3
"""Estimador de coste para entrenar un modelo de musica DESDE CERO.

Modelo de coste:  C = 6 * N * D   FLOPs de entrenamiento (forward+backward),
donde N = parametros y D = tokens vistos. Es la aproximacion estandar
(Kaplan et al. / Hoffmann et al.) y se queda corta un 10-20% con atencion
de contexto largo, pero sirve para decidir si algo es viable o no.

Rendimiento real esperado: MFU (Model FLOPs Utilization) = fraccion del pico
teorico que se aprovecha. Los transformadores pequenos en una sola GPU suelen
quedarse entre 0.20 y 0.40; uso valores conservadores y optimistas para dar
un rango, no un numero unico.
"""

from __future__ import annotations

import argparse

# pico bf16 denso teorico, TFLOPs/s por GPU
GPUS = {
    # nombre                  TFLOPs   USD/h
    "A10 (24 GB)":            (125.0, 1.29),
    "A100 40GB SXM4":         (312.0, 1.99),
    "H100 PCIe (80 GB)":      (989.0, 3.29),
    "H100 SXM (80 GB)":      (989.0, 4.29),
    "B200 SXM6 (180 GB)":    (2250.0, 6.99),
}

# rangos de MFU realistas por tamano de modelo en 1 GPU
MFU_CONSERVADOR = 0.20
MFU_OPTIMISTA = 0.40


def flops(params: float, tokens: float, multiplier: float = 6.0) -> float:
    return multiplier * params * tokens


def horas(flops_total: float, tflops_pico: float, mfu: float) -> float:
    flops_por_segundo = tflops_pico * 1e12 * mfu
    return flops_total / flops_por_segundo / 3600.0


def fmt(n: float) -> str:
    for unit, div in (("Z", 1e21), ("E", 1e18), ("P", 1e15), ("T", 1e12),
                      ("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if n >= div:
            return f"{n/div:.3g}{unit}"
    return f"{n:.0f}"


# --------------------------------------------------------------- inventario
# Datos simbolicos realmente disponibles (orden de magnitud). Los tokens son
# estimaciones por pieza; el numero que importa es el de tokens totales.
DATASETS = [
    ("Nottingham (ABC, dominio publico)",        1_200,      600),
    ("The Session (ABC, tunes tradicionales)",  30_000,      700),
    ("PDMX (MusicXML, dominio publico)",       250_000,    1_500),
    ("GigaMIDI (MIDI, CC BY-NC) - eventos",  1_800_000_000, 5),  # 1.8e9 notas * 5 tok/nota
    ("Lakh MIDI (MIDI, ~176k canciones)",      176_000,    3_000),
]


def inventario() -> None:
    print("=" * 78)
    print("DATOS DISPONIBLES (orden de magnitud)")
    print("=" * 78)
    print(f"{'fuente':42s} {'piezas':>12s} {'tok/pieza':>10s} {'tokens':>10s}")
    total_abc = total_midi = 0
    for nombre, piezas, tok in DATASETS:
        t = piezas * tok
        print(f"{nombre:42s} {piezas:>12,} {tok:>10,} {fmt(t):>10s}")
        if "ABC" in nombre or "MusicXML" in nombre:
            total_abc += t
        else:
            total_midi += t
    print("-" * 78)
    print(f"{'TOTAL texto (ABC/MusicXML)':42s} {'':>12s} {'':>10s} {fmt(total_abc):>10s}")
    print(f"{'TOTAL MIDI-tokens':42s} {'':>12s} {'':>10s} {fmt(total_midi):>10s}")
    print()
    print("Lectura: con lo que hay NO se puede pretrainar a lo Chinchilla mas")
    print("alla de ~50M de parametros en ABC, o ~450M si tokenizas MIDI.")
    print("Para pasar de ahi hay que ampliar corpus (transcribir audio, sintetizar)")
    print("o aceptar sobreentrenamiento (mas pasadas por el mismo dato).")
    print()


def grid(gpu_name: str) -> None:
    pico, precio = GPUS[gpu_name]
    print("=" * 78)
    print(f"COSTE EN {gpu_name}   ({pico:.0f} TFLOPs bf16, {precio:.2f} USD/h)")
    print("=" * 78)
    print(f"{'params':>8s} {'tokens':>9s} {'ratio':>6s} {'FLOPs':>9s} "
          f"{'h (MFU .20)':>12s} {'h (MFU .40)':>12s} {'USD .20':>9s} {'USD .40':>9s}")
    for p in (50e6, 125e6, 350e6, 1e9, 3e9):
        # Chinchilla: 20 tokens por parametro
        for d, etiqueta in ((20 * p, "20x"), (5 * p, "5x")):
            f = flops(p, d)
            h_c = horas(f, pico, MFU_CONSERVADOR)
            h_o = horas(f, pico, MFU_OPTIMISTA)
            print(f"{fmt(p):>8s} {fmt(d):>9s} {etiqueta:>6s} {fmt(f):>9s} "
                  f"{h_c:12.1f} {h_o:12.1f} {h_c*precio:9.0f} {h_o*precio:9.0f}")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description="Coste de pretraining de un modelo de musica")
    ap.add_argument("--gpu", default=None, help="nombre exacto de la GPU del catalogo")
    ap.add_argument("--listar-gpus", action="store_true")
    args = ap.parse_args()

    if args.listar_gpus:
        for k, (p, c) in GPUS.items():
            print(f"{k:24s} {p:7.0f} TFLOPs  {c:5.2f} USD/h")
        return

    inventario()
    for nombre in ([args.gpu] if args.gpu else GPUS):
        grid(nombre)

    # caso concreto: el modelo del proyecto
    print("=" * 78)
    print("CONTRASTE: que cuesta alcanzar la calidad del enfoque LoRA actual")
    print("=" * 78)
    n_finetune = 1.5e9 * 0.01     # LoRA r=16 sobre un 1.5B: ~1% de parametros entrenables
    d_finetune = 30_000 * 700     # 30k piezas ABC
    f_ft = flops(n_finetune, d_finetune, multiplier=6.0 * 3)  # 3 epocas
    pico_a10, precio_a10 = GPUS["A10 (24 GB)"]
    # MFU bajo (0.10): el lote es pequeno y solo se entrena el 1% de los pesos,
    # asi que la GPU esta casi siempre esperando a la memoria, no calculando.
    h_flops = horas(f_ft, pico_a10, 0.10)
    # pero el coste real NO son los FLOPs: es el reloj de facturacion mientras
    # la maquina esta encendida. Descarga del modelo base, preparar el dataset,
    # tokenizar, evaluar y depurar ocupan mucho mas tiempo que el entrenamiento.
    overhead_h = 3.0
    print(f"Calculo puro del LoRA (1.5B, 30k piezas, 3 epocas): {h_flops:.2f} h")
    print(f"Tiempo realista de reloj, contando datos+entorno+eval: {h_flops+overhead_h:.1f} h")
    print(f"Coste realista: {(h_flops+overhead_h)*precio_a10:.2f} USD en A10")
    print()
    print("El FLOPs no es lo que decide: lo decide el reloj encendido. Por eso")
    print("conviene preparar TODO en local y usar la GPU solo para entrenar.")
    print("Comparacion: un 350M desde cero con 7B tokens sale MUCHO mas caro y")
    print("suena peor, porque no hereda nada del preentrenamiento en texto.")
    print("El preentrenamiento en texto aporta estructura musical: los LLM ya")
    print("saben que es un acorde, una tonalidad y una progresion.")


if __name__ == "__main__":
    main()
