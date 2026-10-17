"""Mapeo de los contactos del pad a notas.

Vive en el cliente (y no en la pagina) a proposito: asi el mismo mapeo sirve para
hacer sonar el sintetizador del navegador, para tocar el soundfont GM mas adelante
y para grabar lo tocado como pista MIDI. La pagina solo dibuja y suena lo que le
llega.

Modos:
  teclas    el ancho del pad son dos octavas afinadas; deslizar el dedo de una
            tecla a otra toca la nueva (glissando) y nunca desafina.
  pads      rejilla de 4x2 con sonidos de percusion (numeros GM, para poder
            mandarlos al soundfont sin tocar nada).
  deslizar  altura continua, pegada a la escala o libre.

Convenio: Y manda la dinamica, abajo (cerca del usuario) fuerte.
"""

from __future__ import annotations

ESCALA_MAYOR = (0, 2, 4, 5, 7, 9, 11)
NOMBRES_ES = ("Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La",
              "La#", "Si")

# Numeros de percusion del banco General MIDI: si algun dia suena el soundfont,
# estos son los que usa tal cual.
PADS = (
    (36, "Bombo"), (38, "Caja"), (42, "Charles"), (46, "Charl. ab."),
    (45, "Tom bajo"), (50, "Tom alto"), (39, "Palmas"), (49, "Platillo"),
)
PAD_COLS, PAD_FILAS = 4, 2

VEL_MIN, VEL_MAX = 45, 127


def nombre_nota(midi: int) -> str:
    return f"{NOMBRES_ES[midi % 12]}{midi // 12 - 1}"


def nombre_por_nota(midi: int) -> str:
    for numero, nombre in PADS:
        if numero == midi:
            return nombre
    return nombre_nota(midi)


class Mapeo:
    """Convierte la posicion de cada dedo en una nota, segun el modo activo."""

    def __init__(self, al_nota, modo: str = "teclas", raiz: int = 60, octavas: int = 2,
                 escala=ESCALA_MAYOR, pegar_escala: bool = True):
        self.al_nota = al_nota
        self.modo = modo
        self.raiz = raiz
        self.octavas = octavas
        self.escala = escala
        self.pegar_escala = pegar_escala
        self._sonando: dict[int, int] = {}  # contacto -> nota que tiene sonando
        self.n_eventos = 0

    # -- teclas ----------------------------------------------------------
    @property
    def notas(self) -> list[int]:
        """Notas de las teclas, de izquierda a derecha (dos octavas + el Do final)."""
        out = [self.raiz + 12 * oct_ + d
               for oct_ in range(self.octavas) for d in self.escala]
        out.append(self.raiz + 12 * self.octavas)
        return out

    def tecla(self, x: float) -> int:
        notas = self.notas
        idx = min(int(x * len(notas)), len(notas) - 1)
        return notas[max(idx, 0)]

    # -- pads ------------------------------------------------------------
    def pad(self, x: float, y: float) -> tuple[int, int]:
        """Devuelve (nota GM del pad, velocidad) segun donde caiga el dedo."""
        col = min(int(x * PAD_COLS), PAD_COLS - 1)
        fila = min(int(y * PAD_FILAS), PAD_FILAS - 1)
        idx = fila * PAD_COLS + col
        local = min(max(y * PAD_FILAS - fila, 0.0), 1.0)  # lo abajo que cae dentro
        return PADS[idx][0], int(VEL_MIN + (VEL_MAX - VEL_MIN) * local)

    # -- deslizar --------------------------------------------------------
    def altura(self, x: float) -> int:
        bruto = self.raiz + x * 12 * self.octavas
        if not self.pegar_escala:
            return int(round(bruto))
        return min(self.notas, key=lambda n: abs(n - bruto))

    # -- ciclo de vida ---------------------------------------------------
    def informe(self, id_: int, x: float, y: float, tip: bool = True):
        if not tip:
            self.soltar(id_)
            return
        if self.modo == "pads":
            nota, vel = self.pad(x, y)
        elif self.modo == "deslizar":
            nota, vel = self.altura(x), int(VEL_MIN + (VEL_MAX - VEL_MIN) * y)
        else:
            nota, vel = self.tecla(x), int(VEL_MIN + (VEL_MAX - VEL_MIN) * y)

        anterior = self._sonando.get(id_)
        if anterior == nota:
            return  # sigue en la misma tecla: no se repite la nota
        if anterior is not None:
            self._emitir("off", id_, anterior, 0)
        self._sonando[id_] = nota
        self._emitir("on", id_, nota, vel)

    def soltar(self, id_: int):
        nota = self._sonando.pop(id_, None)
        if nota is not None:
            self._emitir("off", id_, nota, 0)

    def soltar_todo(self):
        for id_ in list(self._sonando):
            self.soltar(id_)

    def fijar_modo(self, modo: str) -> bool:
        if modo not in ("teclas", "pads", "deslizar"):
            return False
        self.soltar_todo()
        self.modo = modo
        return True

    def _emitir(self, accion: str, id_: int, nota: int, vel: int):
        self.n_eventos += 1
        self.al_nota({
            "accion": accion, "id": id_, "nota": nota, "vel": vel,
            "nombre": nombre_por_nota(nota), "modo": self.modo,
        })

    # -- lo que necesita la pagina ---------------------------------------
    def layout(self) -> dict:
        """Zonas del pad para que la pagina dibuje lo mismo que suena."""
        zonas: list[dict] = []
        if self.modo == "pads":
            for fila in range(PAD_FILAS):
                for col in range(PAD_COLS):
                    idx = fila * PAD_COLS + col
                    zonas.append({
                        "x0": col / PAD_COLS, "x1": (col + 1) / PAD_COLS,
                        "y0": fila / PAD_FILAS, "y1": (fila + 1) / PAD_FILAS,
                        "etiqueta": PADS[idx][1], "nota": PADS[idx][0],
                    })
        elif self.modo == "teclas":
            notas = self.notas
            for i, nota in enumerate(notas):
                zonas.append({
                    "x0": i / len(notas), "x1": (i + 1) / len(notas),
                    "y0": 0.0, "y1": 1.0,
                    "etiqueta": nombre_nota(nota), "nota": nota,
                })
        return {
            "modo": self.modo,
            "zonas": zonas,
            "notas": self.notas if self.modo == "teclas" else [],
            "deslizar_pega_escala": self.pegar_escala,
        }
