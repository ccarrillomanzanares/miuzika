"""Imprime la cola de gpu/motor_gpu.py (la parte que no cabe en la lectura)."""
import os

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "gpu", "motor_gpu.py")
texto = open(RUTA, encoding="utf-8").read()
i = texto.find("def reverb(")
print(texto[i:])
