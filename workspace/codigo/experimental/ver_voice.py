"""Muestra el codigo de instruments.voice y render.cadena_voz."""
import inspect
import instruments as I
import render as R

print(inspect.getsource(I.voice))
print("=" * 70)
print(inspect.getsource(R.cadena_voz))
