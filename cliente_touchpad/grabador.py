"""Graba lo que se toca en el pad y lo escribe como archivo MIDI.

El MIDI es lo que se lleva a OpenDAW (o a cualquier DAW): melodia por el canal 0
con el instrumento elegido y percusion por el canal 9, que es como lo entiende el
banco General MIDI.

Los tiempos son los reales del toque (nada de cuantizar a rejilla: eso ya nos
costo caro con el tarareo).
"""

from __future__ import annotations

import os
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, "cache", "pad")
ARCHIVO = os.path.join(CARPETA, "pad.mid")

DURACION_MINIMA = 0.03      # el pad informa a ~150 Hz: una nota nunca dura cero
DURACION_PERCUSION = 0.25


class Grabador:
    """Apunta las notas tocadas mientras graba y las vuelca a un .mid."""

    def __init__(self, ruta: str = ARCHIVO):
        self.ruta = ruta
        self.grabando = False
        self.t_inicio = 0.0
        self.n_notas = 0
        self.ultimo_archivo: str | None = None
        self.instrumento = 0
        self._abiertas: dict[int, tuple[int, int, float]] = {}  # dedo -> (nota, vel, t)
        self._notas: list[tuple[float, float, int, int]] = []  # inicio, fin, nota, vel
        self._percu: list[tuple[float, float, int, int]] = []

    # -- control ----------------------------------------------------------
    def iniciar(self, instrumento: int = 0) -> bool:
        if self.grabando:
            return False
        self.grabando = True
        self.instrumento = instrumento
        self.t_inicio = time.perf_counter()
        self.n_notas = 0
        self._abiertas.clear()
        self._notas.clear()
        self._percu.clear()
        return True

    def parar(self) -> str | None:
        if not self.grabando:
            return None
        self._cerrar_abiertas(time.perf_counter() - self.t_inicio)
        self.grabando = False
        if not self._notas and not self._percu:
            return None
        self.ultimo_archivo = self._escribir()
        return self.ultimo_archivo

    def cancelar(self):
        self.grabando = False
        self._abiertas.clear()
        self._notas.clear()
        self._percu.clear()

    # -- lo que llega del mapeo -------------------------------------------
    def registrar(self, accion: str, id_: int, nota: int, vel: int, modo: str):
        if not self.grabando:
            return
        t = time.perf_counter() - self.t_inicio
        if modo == "pads":
            if accion == "on":
                self._percu.append((t, t + DURACION_PERCUSION, nota, max(vel, 1)))
                self.n_notas += 1
            return
        if accion == "on":
            # si el dedo venia de otra tecla, la anterior ya se cerro con su "off"
            self._abiertas[id_] = (nota, max(vel, 1), t)
            self.n_notas += 1
            return
        abierta = self._abiertas.pop(id_, None)
        if abierta is not None:
            self._cerrar(*abierta, t)

    def _cerrar(self, nota: int, vel: int, t0: float, t1: float):
        self._notas.append((t0, max(t1, t0 + DURACION_MINIMA), nota, vel))

    def _cerrar_abiertas(self, t_fin: float):
        """Dedos que seguian apoyados cuando se paro la grabacion."""
        for nota0, vel0, t0 in self._abiertas.values():
            self._notas.append((t0, max(t_fin, t0 + DURACION_MINIMA), nota0, vel0))
        self._abiertas.clear()

    # -- volcado ----------------------------------------------------------
    def _escribir(self) -> str:
        import pretty_midi

        os.makedirs(CARPETA, exist_ok=True)
        pm = pretty_midi.PrettyMIDI(initial_tempo=120.0)

        melodia = pretty_midi.Instrument(program=int(self.instrumento),
                                         name="pad")
        for inicio, fin, nota, vel in self._notas:
            melodia.notes.append(pretty_midi.Note(velocity=int(vel), pitch=int(nota),
                                                  start=float(inicio), end=float(fin)))
        if melodia.notes:
            pm.instruments.append(melodia)

        bateria = pretty_midi.Instrument(program=0, is_drum=True, name="bateria")
        for inicio, fin, nota, vel in self._percu:
            bateria.notes.append(pretty_midi.Note(velocity=int(vel), pitch=int(nota),
                                                  start=float(inicio), end=float(fin)))
        if bateria.notes:
            pm.instruments.append(bateria)

        pm.write(self.ruta)
        return self.ruta

    def estado(self) -> dict:
        return {
            "grabando": self.grabando,
            "segundos": round(time.perf_counter() - self.t_inicio, 1) if self.grabando else 0.0,
            "notas_grabadas": self.n_notas,
            "archivo": os.path.basename(self.ultimo_archivo) if self.ultimo_archivo else None,
        }
