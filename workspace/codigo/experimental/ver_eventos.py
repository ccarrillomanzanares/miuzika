import json, os

p = os.path.join("salida", "stahl_eventos.json")
d = json.load(open(p, encoding="utf-8"))
print("tipo:", type(d).__name__)
if isinstance(d, dict):
    for k, v in d.items():
        if isinstance(v, (list, dict)):
            print(" ", k, type(v).__name__, "len", len(v))
        else:
            print(" ", k, "=", v)
    for k, v in d.items():
        if isinstance(v, list) and v:
            print("\nmuestra de", k, ":", json.dumps(v[0], ensure_ascii=False)[:300])
