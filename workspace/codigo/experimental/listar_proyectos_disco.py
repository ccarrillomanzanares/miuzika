"""Lista los proyectos del disco y cuenta sus pistas leyendo el JSON del DAW."""
import json
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PROY = os.path.join(RAIZ, "proyectos")

if not os.path.isdir(PROY):
    print("no existe proyectos/ en", RAIZ)
    print("contenido de la raiz:", sorted(os.listdir(RAIZ))[:40])
    raise SystemExit(0)

for nombre in sorted(os.listdir(PROY)):
    d = os.path.join(PROY, nombre)
    if not os.path.isdir(d):
        continue
    jsons = [f for f in os.listdir(d) if f.lower().endswith(".json")]
    info = []
    for j in jsons:
        ruta = os.path.join(d, j)
        try:
            with open(ruta, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as e:
            info.append(f"{j}: ilegible ({e})")
            continue
        pistas = None
        candidatos = [data]
        if isinstance(data, dict) and isinstance(data.get("proyecto"), dict):
            candidatos.insert(0, data["proyecto"])
        for obj in candidatos:
            if not isinstance(obj, dict):
                continue
            for clave in ("tracks", "pistas", "clips", "pistas_audio"):
                if isinstance(obj.get(clave), list):
                    pistas = len(obj[clave])
                    break
            if pistas is not None:
                break
        info.append(f"{j}: {pistas} pistas" if pistas is not None else f"{j}: sin clave de pistas")
    n_wav = sum(1 for f in os.listdir(d) if f.lower().endswith(".wav"))
    n_mid = sum(1 for f in os.listdir(d) if f.lower().endswith(".mid"))
    print(f"{nombre} | wav={n_wav} mid={n_mid} | " + "; ".join(info))
