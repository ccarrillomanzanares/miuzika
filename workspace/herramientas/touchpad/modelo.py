"""Touchpad finger tracking: independent of the operating system.

Brought from humseed (cliente_touchpad/modelo.py). There is nothing Windows- or
HTTP-specific here: only contacts and the life cycle of each finger (press, move, release).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

# Logical touchpad range, in device units. Taken from the HID report
# descriptor of the ELAN0712; other pads will have other values and they must be read.
X_MAX = 3520
Y_MAX = 1784

# A contact for which no report arrives during this time is taken as
# lifted (the pad sends no exit event except the tip switch at 0).
TIMEOUT_CONTACTO_S = 0.08


@dataclass
class Contacto:
    id: int
    x: float  # 0..1, left to right
    y: float  # 0..1, top to bottom


class Seguidor:
    """Turns individual reports (one per finger) into down / move / up."""

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
        """Releases the fingers that have stopped reporting."""
        ahora = time.perf_counter()
        for id_ in list(self.activos):
            if ahora - self.ultimo_visto.get(id_, ahora) > TIMEOUT_CONTACTO_S:
                self._soltar(id_)

    def soltar_todo(self):
        for id_ in list(self.activos):
            self._soltar(id_)
