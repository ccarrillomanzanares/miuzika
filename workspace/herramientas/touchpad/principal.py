"""El touchpad como instrumento de miuzika: proceso hijo del servidor.

    python herramientas/touchpad/principal.py

Lo arranca el servidor de la app (server/api/pad.ts) y habla por líneas JSON:

  salida (stdout), una línea por cosa:
    {"listo": true}                       la captura está en marcha
    {"e": "down"|"move"|"up", "id": 0, "x": 0.41, "y": 0.77}
    {"aviso": "texto"}                    para el registro
    {"error": "texto"}                    y el proceso termina

  entrada (stdin), una orden por línea:
    armar       el pad toca: se mandan los dedos y el cursor se congela mientras
                hay un dedo apoyado (si no, el pad arrastra el puntero fuera)
    desarmar    el pad vuelve a ser un ratón normal; se sueltan los dedos
    salir       termina

Si se cierra la entrada (el servidor se ha ido), el proceso termina solo: así no
queda una captura huérfana enganchada al ratón.

El mapeo a notas (teclas, pads, deslizar) NO está aquí: vive en la página
(src/core/pad.ts), que es la que sabe la tonalidad y la pista del proyecto.
"""

from __future__ import annotations

import json
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_cerrojo = threading.Lock()


def emitir(datos: dict) -> None:
    linea = json.dumps(datos, separators=(",", ":"), ensure_ascii=False)
    with _cerrojo:
        try:
            sys.stdout.write(linea + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)


def main() -> int:
    if not sys.platform.startswith("win"):
        emitir({"error": "el touchpad como instrumento sólo funciona en Windows (Precision Touchpad)"})
        return 2

    from modelo import Seguidor
    import captura_win32

    estado = {"armado": False, "soltar": False}

    def al_evento(tipo: str, id_: int, x: float, y: float) -> None:
        emitir({"e": tipo, "id": id_, "x": round(x, 4), "y": round(y, 4)})

    seguidor = Seguidor(al_evento)

    def al_informe(id_, x, y, tip, _boton):
        if estado["armado"]:
            seguidor.informe(id_, x, y, tip)

    def al_latido():
        # soltar_todo se pide desde el hilo de la entrada, pero se hace aquí, en el
        # de la captura, que es el único que toca el seguidor.
        if estado["soltar"]:
            estado["soltar"] = False
            seguidor.soltar_todo()
        seguidor.latido()

    captura = captura_win32.CapturaWin32(
        al_informe=al_informe,
        al_latido=al_latido,
        al_aviso=lambda texto: emitir({"aviso": texto}),
    )
    def desarmar_por_tecla() -> bool:
        # Ctrl+Alt+T: la salida de emergencia si la página no responde y el
        # cursor se ha quedado congelado.
        estado["armado"] = False
        captura.bloquear_cursor = False
        estado["soltar"] = True
        emitir({"desarmado": True})
        return False

    captura.alternar_bloquear_cursor = desarmar_por_tecla
    if not captura.iniciar():
        emitir({"error": "no se pudo leer el touchpad (¿es un Precision Touchpad?)"})
        return 1
    emitir({"listo": True})

    try:
        for linea in sys.stdin:
            orden = linea.strip().lower()
            if orden == "armar":
                estado["armado"] = True
                captura.bloquear_cursor = True
            elif orden == "desarmar":
                estado["armado"] = False
                captura.bloquear_cursor = False
                estado["soltar"] = True
            elif orden == "salir":
                break
    finally:
        captura.bloquear_cursor = False
        captura.parar()
    return 0


if __name__ == "__main__":
    sys.exit(main())
