"""Convierte un instrumento de VCSL (.sfz) en un .sf2 dentro del proyecto.

    python sfz_a_proyecto.py "<ruta/al.sfz>" "<carpeta del proyecto>" "<nombre>"

Por qué existe: la alternativa —coger UN sample y estirarlo para cubrir dos
octavas— suena a armónica y desafina (medido: +1054 cents, formantes arrastrados).
Un instrumento se toca con sus regiones: 46 muestras, una cada dos semitonos, cada
una con la raíz que declara el SFZ.

Escribe `instrumentos/<nombre>.sf2` y devuelve el JSON que espera la herramienta:
    {ok, nombre, archivo, zonas, notas, bytes}
"""

import json
import os
import subprocess
import sys


def main(argv):
    if len(argv) < 3:
        print(json.dumps({"ok": False, "error": "uso: sfz_a_proyecto.py <sfz> <carpeta> <nombre>"}))
        return 1
    sfz, carpeta, nombre = argv[0], argv[1], argv[2]
    if not os.path.exists(sfz):
        print(json.dumps({"ok": False, "error": f"no existe el SFZ: {sfz}"}))
        return 1
    destino_dir = os.path.join(carpeta, "instrumentos")
    os.makedirs(destino_dir, exist_ok=True)
    limpio = "".join(c if c.isalnum() or c in "-_" else "-" for c in nombre.lower()).strip("-") or "instrumento"
    salida = os.path.join(destino_dir, f"{limpio}.sf2")

    aqui = os.path.dirname(os.path.abspath(__file__))
    convertidor = os.path.join(aqui, "sfz2sf2.py")
    proceso = subprocess.run(
        [sys.executable, convertidor, sfz, salida],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proceso.returncode != 0:
        print(json.dumps({"ok": False, "error": (proceso.stderr or proceso.stdout)[-500:]}))
        return 1
    try:
        datos = json.loads(proceso.stdout.strip().splitlines()[-1])
    except Exception:
        datos = {}

    print(
        json.dumps(
            {
                "ok": True,
                "nombre": nombre,
                "archivo": f"instrumentos/{os.path.basename(salida)}",
                "zonas": datos.get("zonas", 0),
                "notas": datos.get("notas", []),
                "bytes": os.path.getsize(salida),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
