import json, os

p = os.path.join("salida", "stahl_eventos.json")
d = json.load(open(p, encoding="utf-8"))
print("bpm", d["bpm"], "compases", d["compases"])
for nombre, info in d["pistas"].items():
    if isinstance(info, dict):
        claves = list(info.keys())
        n = None
        for k in ("notas", "eventos", "notes"):
            if k in info and isinstance(info[k], list):
                n = len(info[k])
                muestra = info[k][0]
                break
        print("\n--", nombre, "claves:", claves, "n:", n)
        if n:
            print("   muestra:", json.dumps(muestra, ensure_ascii=False)[:200])
    else:
        print("\n--", nombre, type(info).__name__, len(info) if hasattr(info, "__len__") else "")
