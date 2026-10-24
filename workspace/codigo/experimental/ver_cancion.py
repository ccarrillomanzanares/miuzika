"""Muestra el codigo de las funciones de cancion.py que voy a usar."""
import inspect
import cancion as C

for nombre in ("silabas", "desglosar", "ajustar", "linea", "silabas_voz"):
    f = getattr(C, nombre)
    print("=" * 70)
    print(inspect.getsource(f))
