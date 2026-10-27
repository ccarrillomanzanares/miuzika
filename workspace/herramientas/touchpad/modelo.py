"""Seguimiento de los dedos del touchpad: independiente del sistema operativo.

Traído de humseed (cliente_touchpad/modelo.py). Aquí no hay nada de Windows ni de
HTTP: sólo contactos y el ciclo de vida de cada dedo (pulsar, mover, soltar).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

# Rango lógico del touchpad, en unidades del dispositivo. Sacado del HID report
# descriptor del ELAN0712; otros pads tendrán otros valores y hay que leerlos.
X_MAX = 3520
Y_MAX = 1784

# Un contacto del que no llega ningún informe durante este tiempo se da por
# levantado (el pad no manda evento de salida salvo el tip switch a 0).
TIMEOUT_CONTACTO_S = 0.08


@dataclass
class Contacto:
    id: int
    x: float  # 0..1, izquierda a derecha
    y: float  # 0..1, arriba a abajo


class Seguidor:
    """Convierte informes sueltos (uno por dedo) en down / move / up."""

    def __init__(self, al_evento):
        self.al_evento = al_evento
        self.activos: dict[int, Contacto] = {}
        self.ultimo_visto: dict[int, float] = {}

    def informe(self, id_: int, x: float, y: float, tip: bool):
        ahora = time.perf_counter()
        if not tip:
            self._soltar(id_)
            return
        c = self.activos.get(id_)
        if c is None:
            self.activos[id_] = Contacto(id_, x, y)
            self.al_evento("down", id_, x, y)
        elif abs(c.x - x) > 1e-4 or abs(c.y - y) > 1e-4:
            c.x, c.y = x, y
            self.al_evento("move", id_, x, y)
        self.ultimo_visto[id_] = ahora

    def _soltar(self, id_: int):
        c = self.activos.pop(id_, None)
        self.ultimo_visto.pop(id_, None)
        if c is not None:
            self.al_evento("up", id_, c.x, c.y)

    def latido(self):
        """Suelta los dedos que han dejado de informar."""
        ahora = time.perf_counter()
        for id_ in list(self.activos):
            if ahora - self.ultimo_visto.get(id_, ahora) > TIMEOUT_CONTACTO_S:
                self._soltar(id_)

    def soltar_todo(self):
        for id_ in list(self.activos):
            self._soltar(id_)
