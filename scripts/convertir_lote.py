#!/usr/bin/env python3
"""Convierte en paralelo una carpeta de MIDI a nuestro corpus JSONL.

La conversion MIDI -> ABC es CPU pura, asi que se reparte entre los nucleos
de la instancia (30 vCPU en una A10). Cada proceso escribe su propio fichero
parcial y al final se concatenan: si el trabajo se corta a medias, no se
pierde lo ya hecho.

Uso (en la instancia):
    python convertir_lote.py --midis midis/ --indice indice.jsonl --out corpus.jsonl --procesos 24
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def cargar_indice(path: Path) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    if not path.exists():
        return idx
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            idx[d["fichero"]] = d
    return idx


def _trabajador(args) -> tuple[str, str, int, dict]:
    fichero, etiqueta, max_compases = args
    import pretty_midi
    from humseed import midi2abc
    diag: dict[str, int] = {}
    try:
        pm = pretty_midi.PrettyMIDI(fichero)
        r = midi2abc.midi_a_abc(pm, etiqueta=etiqueta, diagnostico=diag,
                                max_compases=max_compases)
    except Exception:
        return ("error", "excepcion al leer o convertir", 0, {})
    if r is None:
        motivo = max(diag, key=diag.get) if diag else "desconocido"
        return ("descartado", motivo, 0, {})
    return ("ok", "", r.n_notas, {
        "origen": "gigamidi",
        "etiqueta": etiqueta,
        "style": r.estilo,
        "seed": r.seed,
        "abc": r.abc,
        "n_notas": r.n_notas,
        "beats": None,
        "tempo": r.tempo,
        "key": r.key,
        "mode": r.mode,
        "patron": r.patron,
    })


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--midis", default="midis")
    ap.add_argument("--indice", default="indice.jsonl")
    ap.add_argument("--out", default="corpus.jsonl")
    ap.add_argument("--procesos", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--max-compases", type=int, default=16,
                    help="tope de compases por pieza (evita canciones enteras)")
    args = ap.parse_args()

    # importar aqui tambien, para validar el entorno antes de lanzar procesos
    from humseed import corpus, midi2abc  # noqa: F401

    indice = cargar_indice(Path(args.indice))
    print(f"entradas de indice: {len(indice):,}")

    midis = sorted(Path(args.midis).glob("*.mid"))
    if args.limite:
        midis = midis[: args.limite]
    print(f"ficheros MIDI: {len(midis):,}  procesos={args.procesos}")

    tareas = []
    sin_etiqueta = 0
    for m in midis:
        meta = indice.get(m.name, {})
        etiqueta = meta.get("estilo")
        if not etiqueta:
            sin_etiqueta += 1
        tareas.append((str(m), etiqueta, args.max_compases))
    if sin_etiqueta:
        print(f"sin etiqueta (usaran la heuristica): {sin_etiqueta:,}")

    out = Path(args.out)
    parcial = out.with_suffix(".parcial.jsonl")
    cuenta: Counter[str] = Counter()
    motivos: Counter[str] = Counter()
    estilos: Counter[str] = Counter()
    patrones: Counter[str] = Counter()
    t0 = time.time()
    n_ok = 0

    with parcial.open("w", encoding="utf-8") as fh, mp.Pool(args.procesos) as pool:
        for i, (estado, motivo, n_notas, ejemplo) in enumerate(
                pool.imap_unordered(_trabajador, tareas, chunksize=16), 1):
            cuenta[estado] += 1
            if estado != "ok" and motivo:
                motivos[motivo] += 1
            if estado == "ok":
                n_ok += 1
                estilos[ejemplo["style"]] += 1
                patrones[ejemplo["patron"]] += 1
                fh.write(json.dumps(corpus.to_chat(ejemplo, corpus.PROMPT_SISTEMA),
                                    ensure_ascii=False) + "\n")
            if i % 200 == 0 or i == len(tareas):
                v = i / max(time.time() - t0, 1e-6)
                print(f"  {i:,}/{len(tareas):,}  ok={n_ok:,}  {v:.1f}/s  "
                      f"restante ~{(len(tareas)-i)/max(v,1e-6)/60:.1f} min", flush=True)

    parcial.replace(out)
    print(f"\nresultado: {dict(cuenta)}")
    print(f"tiempo: {(time.time()-t0)/60:.1f} min")
    print(f"escrito {out}  ({n_ok:,} ejemplos)")
    print("\npor estilo:")
    for e, n in estilos.most_common():
        print(f"  {n:6,d}  {e[:70]}")
    print("\npor patron de bateria:")
    for p, n in patrones.most_common():
        print(f"  {n:6,d}  {p}")


if __name__ == "__main__":
    main()
