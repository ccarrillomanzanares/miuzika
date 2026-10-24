"""Lista el contenido real de la carpeta del proyecto abierto."""
import os
import json

print("CWD:", os.getcwd())
for raiz, dirs, ficheros in os.walk("."):
    if "__pycache__" in raiz:
        continue
    nivel = raiz.count(os.sep)
    if nivel > 2:
        continue
    print(f"[{raiz}]")
    for f in sorted(ficheros):
        print("   ", f, os.path.getsize(os.path.join(raiz, f)), "B")

p = "proyecto.json"
if os.path.exists(p):
    d = json.load(open(p))
    pr = d["proyecto"]
    print("\nbpm", pr["bpm"], "| compases", pr["lengthBars"], "| pistas", len(pr["tracks"]))
    for t in pr["tracks"]:
        print("  -", t.get("name"), t.get("type"))
