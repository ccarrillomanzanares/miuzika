import json, os

p = os.path.join("salida", "stahl_eventos.json")
d = json.load(open(p, encoding="utf-8"))
for nombre, ev in d["pistas"].items():
    print("\n--", nombre, "n:", len(ev))
    print("   muestra:", json.dumps(ev[0], ensure_ascii=False))
    print("   ultimo :", json.dumps(ev[-1], ensure_ascii=False))
