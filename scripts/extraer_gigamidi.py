#!/usr/bin/env python3
"""Extrae del parquet de GigaMIDI solo los MIDI que nos interesan.

El parquet de all-instruments-with-drums son 4,4 GB y trae TODAS las piezas
(171.552). De ahi solo queremos las 3.371 que pasaron el filtro de genero e
instrumentacion, asi que cruzamos por md5 y escribimos unicamente esas.

Se lee por lotes (iter_batches) para no cargar 4 GB en memoria.

Uso (en la instancia):
    python extraer_gigamidi.py --objetivo objetivo.jsonl --out midis/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cargar_objetivo(path: Path) -> dict[str, dict]:
    obj: dict[str, dict] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            obj[d["md5"]] = d
    return obj


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--objetivo", required=True, help="objetivo.jsonl con los md5")
    ap.add_argument("--parquet", default="parquet", help="carpeta con los .parquet")
    ap.add_argument("--out", default="midis", help="carpeta de salida de .mid")
    ap.add_argument("--lote", type=int, default=2000, help="filas por lote")
    args = ap.parse_args()

    import pyarrow.parquet as pq

    objetivo = cargar_objetivo(Path(args.objetivo))
    print(f"piezas buscadas: {len(objetivo):,}", flush=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # no repetir trabajo: los MIDI ya escritos en una pasada anterior se dan
    # por hechos (los parquet se solapan entre si)
    escritos_previos = {f.stem for f in out.glob("*.mid")}
    if escritos_previos:
        print(f"ya extraidos antes: {len(escritos_previos):,}")

    ficheros = sorted(Path(args.parquet).rglob("*.parquet"))
    if not ficheros:
        print(f"no hay parquet en {args.parquet}", file=sys.stderr)
        sys.exit(1)

    escritos: set[str] = set(escritos_previos)
    leidas = 0
    indice: list[dict] = []

    for pf in ficheros:
        meta = pq.ParquetFile(pf)
        n = meta.metadata.num_rows
        print(f"{pf.name}: {n:,} filas, {meta.metadata.num_row_groups} grupos", flush=True)
        for batch in meta.iter_batches(batch_size=args.lote):
            cols = batch.to_pydict()
            md5s = cols["md5"]
            musicas = cols["music"]
            leidas += len(md5s)
            for md5, musica in zip(md5s, musicas):
                if md5 in objetivo and md5 not in escritos:
                    (out / f"{md5}.mid").write_bytes(musica)
                    escritos.add(md5)
                    d = dict(objetivo[md5])
                    d["fichero"] = f"{md5}.mid"
                    indice.append(d)
            if leidas % 40000 < args.lote:
                print(f"  leidas {leidas:,}  escritas {len(escritos):,}", flush=True)

    indice_path = out.parent / "indice.jsonl"
    with indice_path.open("w", encoding="utf-8") as fh:
        for d in indice:
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")

    print(f"\nfilas leidas del parquet: {leidas:,}")
    print(f"MIDI escritos: {len(escritos):,} de {len(objetivo):,} buscados")
    faltan = set(objetivo) - escritos
    if faltan:
        print(f"no encontradas: {len(faltan):,} (normal: el CSV cubre v1 y v2)")
    print(f"indice: {indice_path}")


if __name__ == "__main__":
    main()
