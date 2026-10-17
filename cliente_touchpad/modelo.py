"""Modelo comun del cliente de touchpad: independiente del sistema operativo.

Aqui no hay nada de Windows ni de HTTP. Solo contactos, eventos y el
seguimiento del ciclo de vida de cada dedo, que es lo que comparten todos los
backends de captura (Windows hoy; Linux con evdev y macOS con
MultitouchSupport si algun dia toca).
"""

from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import asdict, dataclass

# Rango logico del touchpad, en unidades del dispositivo. Sacado del HID report
# descriptor del ELAN0712; otros pads tendran otros valores y hay que leerlos.
X_MAX = 3520
Y_MAX = 1784

# Un contacto del que no llega ningun informe durante este tiempo se da por
# levantado (el pad no manda evento de salida salvo el tip switch a 0).
TIMEOUT_CONTACTO_S = 0.08


@dataclass
class Contacto:
    id: int
    x: float  # 0..1, izquierda a derecha
    y: float  # 0..1, arriba a abajo
    t_down: float
    x0: float = 0.0
    y0: float = 0.0

    @property
    def duracion(self) -> float:
        return time.perf_counter() - self.t_down

    @property
    def recorrido(self) -> float:
        return ((self.x - self.x0) ** 2 + (self.y - self.y0) ** 2) ** 0.5


@dataclass
class Evento:
    """Lo que el resto del sistema consume: pulsar, mover, soltar, clic."""

    tipo: str  # "down" | "move" | "up" | "click"
    id: int
    x: float
    y: float
    t: float
    duracion: float = 0.0
    recorrido: float = 0.0
    n_activos: int = 1


class Seguidor:
    """Convierte informes sueltos (uno por dedo) en eventos con ciclo de vida."""

    def __init__(self, al_evento):
        self.al_evento = al_evento
        self.activos: dict[int, Contacto] = {}
        self.ultimo_visto: dict[int, float] = {}
        self.n_eventos = 0

    def informe(self, id_: int, x: float, y: float, tip: bool, boton: bool = False):
        ahora = time.perf_counter()
        if boton:
            self._emitir(Evento("click", id_, x, y, ahora, n_activos=len(self.activos) or 1))

        if not tip:
            self._soltar(id_, ahora)
            return

        c = self.activos.get(id_)
        if c is None:
            c = Contacto(id_, x, y, ahora, x0=x, y0=y)
            self.activos[id_] = c
            self._emitir(Evento("down", id_, x, y, ahora, n_activos=len(self.activos)))
        else:
            c.x, c.y = x, y
            self._emitir(Evento("move", id_, x, y, ahora, duracion=c.duracion,
                                recorrido=c.recorrido, n_activos=len(self.activos)))
        self.ultimo_visto[id_] = ahora

    def _soltar(self, id_: int, ahora: float):
        c = self.activos.pop(id_, None)
        self.ultimo_visto.pop(id_, None)
        if c is not None:
            self._emitir(Evento("up", id_, c.x, c.y, ahora, duracion=c.duracion,
                                recorrido=c.recorrido, n_activos=len(self.activos)))

    def latido(self):
        """Suelta los dedos que han dejado de informar."""
        ahora = time.perf_counter()
        for id_ in list(self.activos):
            if ahora - self.ultimo_visto.get(id_, ahora) > TIMEOUT_CONTACTO_S:
                self._soltar(id_, ahora)

    def soltar_todo(self):
        ahora = time.perf_counter()
        for id_ in list(self.activos):
            self._soltar(id_, ahora)

    def instantanea(self) -> list[dict]:
        return [
            {"id": c.id, "x": round(c.x, 5), "y": round(c.y, 5),
             "dur": round(c.duracion, 4), "rec": round(c.recorrido, 5)}
            for c in self.activos.values()
        ]

    def _emitir(self, ev: Evento):
        self.n_eventos += 1
        self.al_evento(ev)


class Publicador:
    """Reparte lineas JSON a los navegadores conectados por SSE."""

    def __init__(self):
        self.suscriptores: list[queue.Queue] = []
        self.lock = threading.Lock()
        self.n_enviados = 0
        self.n_descartados = 0

    def suscribir(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=500)
        with self.lock:
            self.suscriptores.append(q)
        return q

    def desuscribir(self, q: queue.Queue):
        with self.lock:
            if q in self.suscriptores:
                self.suscriptores.remove(q)

    def publicar(self, datos: dict):
        linea = json.dumps(datos, separators=(",", ":"))
        with self.lock:
            suscriptores = list(self.suscriptores)
        self.n_enviados += 1
        for q in suscriptores:
            try:
                q.put_nowait(linea)
            except queue.Full:
                self.n_descartados += 1  # navegador lento: se tira el cuadro

    @property
    def n_suscriptores(self) -> int:
        with self.lock:
            return len(self.suscriptores)


def evento_a_dict(ev: Evento) -> dict:
    return asdict(ev)
