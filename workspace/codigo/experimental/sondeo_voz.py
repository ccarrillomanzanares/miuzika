"""Sondeo del formato de silabas que acepta instruments.voice."""
import numpy as np
import instruments as I
import cancion as C
from dsp import SR

print("desglosar:", C.desglosar("la noche se abre"))
try:
    print("silabas_voz:", C.silabas_voz()[:12])
except Exception as e:
    print("silabas_voz FALLO", e)

casos = [
    ("strings", ["la", "no", "che"]),
    ("tuplas", C.desglosar("la noche")),
]
for etiqueta, arg in casos:
    try:
        x = I.voice(arg, seed=1)
        print(etiqueta, "OK dur=%.3fs pico=%.3f" % (len(x) / SR, float(np.max(np.abs(x)))))
    except Exception as e:
        print(etiqueta, "FALLO", type(e).__name__, e)

try:
    ln = C.linea("la noche se abre en dos", 0, 8, 0.0, vel=0.9)
    print("linea OK, %d notas, primera=%s" % (len(ln), ln[0]))
except Exception as e:
    print("linea FALLO", type(e).__name__, e)
