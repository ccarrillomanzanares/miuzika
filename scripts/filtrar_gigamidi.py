#!/usr/bin/env python3
"""Filtra el CSV de metadatos de GigaMIDI por estilo, para no descargar 30 GB a ciegas.

Paso 1 del pipeline de datos:
    python scripts/filtrar_gigamidi.py --vocabulario        # que estilos existen de verdad
    python scripts/filtrar_gigamidi.py --seleccionar        # escribe objetivo.jsonl

El CSV tiene ~1,19 GB, asi que se lee en streaming y no se carga entero.

Columnas que importan:
    file_path            ruta dentro del dataset
    md5                  clave para cruzarlo con el parquet
    Type                 drums-only | all-instruments-with-drums | no-drums
    tempo                "Tempo(time=0, qpm=113.93, ...)"
    NOMML_Instrument     instrumentos reales de la pieza
    music_styles_curated etiqueta de estilo curada a mano  <-- la buena
    music_style_audio_text_Lastfm / Discogs / Tagtraum     <-- etiquetas raspadas
    title, artist
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

csv.field_size_limit(10**8)


def _norm(t: str) -> str:
    return re.sub(r"[_\-]+", " ", t.strip().strip("'\"").lower()).strip()

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "data" / "gigamidi_metadata.csv"

# ---------------------------------------------------------------------------
# Paleta objetivo: lo que se le va a pedir al modelo.
#
# Son etiquetas reales de Last.fm/Discogs, no nombres de grupo: describen el
# SONIDO. Cada lista es un "parecido a" amplio a proposito, porque las
# etiquetas de la gente son ruidosas y una sola palabra dejaria fuera material
# que sirve.
# El vocabulario real de GigaMIDI es GRUESO: ~29 etiquetas con guion bajo, y
# no incluye "gothic rock", "post-punk", "darkwave", "thrash" ni "stoner".
# Lo comprobamos con --vocabulario en vez de suponerlo. Por eso la paleta se
# apoya en lo que EXISTE, y el resto del material se selecciona por rasgos.
# Paleta decidida por el usuario: rock, punk, heavy_metal, alternative_rock.
# Son etiquetas que EXISTEN de verdad en el vocabulario de GigaMIDI (comprobado
# con --vocabulario: 29 etiquetas de Last.fm y 25 curadas, con guion bajo).
# Se incluyen las variantes obvias del mismo genero o se quedaria fuera
# material que sirve.
PALETA = {
    "heavy_metal": [
        "heavy_metal", "heavy metal", "metal", "thrash_metal", "speed_metal",
        "power_metal", "death_metal", "black_metal", "groove_metal",
        "nu_metal", "doom_metal", "metalcore",
    ],
    "alternative_rock": [
        "alternative_rock", "alternative", "indie_rock", "grunge",
        "contemporary_rock", "post_grunge",
    ],
    "punk": [
        "punk", "punk_rock", "hardcore_punk", "hardcore", "street_punk",
        "oi", "ska_punk",
    ],
    "rock": [
        "rock", "classic_rock", "rock_n_roll", "hard_rock", "blues_rock",
        "southern_rock", "psychedelic_rock", "progressive_rock",
    ],
}
TODAS = {_norm(t) for lista in PALETA.values() for t in lista}

# instrumentos que delatan banda de rock (NOMML_Instrument)
INSTR_ROCK = {"Guitar", "Bass", "Drums"}
INSTR_SYNTH = {"Synth", "Synthesizer", "Piano", "Organ", "Ensemble", None}


def parsear_estilos(valor: str) -> list[str]:
    """Las etiquetas vienen como \"['a', 'b']\" o separadas por comas."""
    if not valor:
        return []
    v = valor.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    partes = re.split(r"',\s*'|\",\s*\"|,", v)
    return [_norm(p) for p in partes if p.strip().strip("'\"")]


def parsear_tempo(valor: str) -> float | None:
    m = re.search(r"qpm=([\d.]+)", valor or "")
    return float(m.group(1)) if m else None


def parsear_lista(valor: str) -> list[str]:
    if not valor:
        return []
    v = valor.strip()
    if v.startswith("["):
        v = v[1:-1]
    return [p.strip().strip("'\"").strip() for p in v.split(",") if p.strip().strip("'\"")]


def recorrer(limite: int = 0):
    with CSV.open(encoding="utf-8", errors="replace") as fh:
        r = csv.DictReader(fh)
        for i, row in enumerate(r):
            if limite and i >= limite:
                break
            yield row


def vocabulario(minimo: int = 20) -> None:
    cuenta: Counter[str] = Counter()
    cuenta_cur: Counter[str] = Counter()
    total = 0
    tipos: Counter[str] = Counter()
    for row in recorrer():
        total += 1
        tipos[row.get("Type", "?")] += 1
        for t in parsear_estilos(row.get("music_style_audio_text_Lastfm", "")):
            cuenta[t] += 1
        for t in parsear_estilos(row.get("music_styles_curated", "")):
            cuenta_cur[t] += 1
        if total % 100000 == 0:
            print(f"  ... {total:,} filas leidas", file=sys.stderr)
    print(f"filas totales: {total:,}")
    print(f"tipos: {dict(tipos)}")
    print(f"\netiquetas distintas (Last.fm): {len(cuenta)}")
    print(f"etiquetas distintas (curadas): {len(cuenta_cur)}")

    print("\n=== TOP 60 etiquetas de Last.fm ===")
    for t, n in cuenta.most_common(60):
        marca = " <-- OBJETIVO" if t in TODAS else ""
        print(f"  {t:36s} {n:7,d}{marca}")

    print("\n=== TOP 60 etiquetas CURADAS ===")
    for t, n in cuenta_cur.most_common(60):
        marca = " <-- OBJETIVO" if t in TODAS else ""
        print(f"  {t:36s} {n:7,d}{marca}")

    # interseccion con la paleta
    print("\n=== de nuestra paleta, cuantas piezas hay ===")
    for estilo, etiquetas in PALETA.items():
        n = sum(cuenta.get(t, 0) for t in etiquetas)
        nc = sum(cuenta_cur.get(t, 0) for t in etiquetas)
        print(f"  {estilo:20s} Last.fm {n:7,d}   curadas {nc:7,d}")


def seleccionar(out: Path, con_bateria: bool = True, max_por_estilo: int = 0) -> None:
    """Escribe objetivo.jsonl con las piezas que queremos del parquet."""
    por_estilo: dict[str, list[dict]] = {e: [] for e in PALETA}
    vistos: set[str] = set()
    total = 0

    for row in recorrer():
        total += 1
        if total % 100000 == 0:
            print(f"  ... {total:,} filas", file=sys.stderr)
        if con_bateria and row.get("Type") != "all-instruments-with-drums":
            continue
        md5 = row.get("md5", "").strip()
        if not md5 or md5 in vistos:
            continue

        etiquetas = set()
        for col in ("music_styles_curated", "music_style_audio_text_Lastfm",
                    "music_style_audio_text_Discogs", "music_style_scraped"):
            etiquetas |= set(parsear_estilos(row.get(col, "")))
        if not etiquetas & TODAS:
            continue

        instr = set(parsear_lista(row.get("NOMML_Instrument", "")))
        # exigimos banda: guitarra, bajo y bateria. Es lo que separa rock de
        # una pieza de piano con etiqueta de rock puesta por cualquiera.
        if not INSTR_ROCK.issubset(instr):
            continue
        if not (instr & INSTR_SYNTH):
            pass  # el sintetizador es deseable pero no obligatorio

        tempo = parsear_tempo(row.get("tempo", ""))
        if tempo is None or not (45 <= tempo <= 240):
            continue

        for estilo, etq in PALETA.items():
            if etiquetas & set(etq):
                vistos.add(md5)
                por_estilo[estilo].append({
                    "md5": md5,
                    "estilo": estilo,
                    "tempo": tempo,
                    "instrumentos": sorted(i for i in instr if i),
                    "titulo": row.get("title", ""),
                    "artista": row.get("artist", ""),
                    "etiquetas": sorted(etiquetas & TODAS),
                    "n_tracks": row.get("num_tracks", ""),
                    "n_notas": row.get("total_notes", ""),
                })
                break

    out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with out.open("w", encoding="utf-8") as fh:
        for estilo, filas in por_estilo.items():
            if max_por_estilo:
                filas = filas[:max_por_estilo]
            print(f"  {estilo:20s} {len(filas):7,d} piezas")
            for f in filas:
                fh.write(json.dumps(f, ensure_ascii=False) + "\n")
                n += 1
    print(f"\nfilas totales leidas: {total:,}")
    print(f"piezas seleccionadas: {n:,}  ->  {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocabulario", action="store_true",
                    help="listar que estilos existen de verdad en el CSV")
    ap.add_argument("--seleccionar", action="store_true",
                    help="escribir objetivo.jsonl con las piezas elegidas")
    ap.add_argument("--out", default=str(ROOT / "data" / "objetivo.jsonl"))
    ap.add_argument("--sin-filtro-bateria", action="store_true")
    ap.add_argument("--max-por-estilo", type=int, default=0)
    args = ap.parse_args()

    if not CSV.exists():
        print(f"falta {CSV} (descarga el CSV de metadatos de GigaMIDI)")
        return
    print(f"CSV: {CSV.stat().st_size/2**30:.2f} GB")

    if args.vocabulario:
        vocabulario()
    if args.seleccionar:
        seleccionar(Path(args.out), not args.sin_filtro_bateria, args.max_por_estilo)
    if not (args.vocabulario or args.seleccionar):
        ap.print_help()


if __name__ == "__main__":
    main()
