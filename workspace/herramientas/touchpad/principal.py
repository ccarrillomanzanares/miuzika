"""The touchpad as a miuzika instrument: the server's child process.

    python herramientas/touchpad/principal.py

The app server (server/api/pad.ts) starts it and it talks over JSON lines:

  output (stdout), one line per thing:
    {"listo": true}                       capture is running
    {"e": "down"|"move"|"up", "id": 0, "x": 0.41, "y": 0.77}
    {"aviso": "text"}                     for the log
    {"error": "text"}                     and the process ends

  input (stdin), one command per line:
    armar       the pad plays: fingers are sent and the cursor freezes while
                a finger is resting (otherwise the pad drags the pointer away)
    desarmar    the pad becomes a normal mouse again; fingers are released
    salir       exits

If the input is closed (the server has gone), the process ends by itself: that way
no orphaned capture is left hooked to the mouse.

The mapping to notes (keys, pads, swipe) is NOT here: it lives in the page
(src/core/pad.ts), which is the one that knows the key and the project track.
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
        emitir({"error": "the touchpad as an instrument only works on Windows (Precision Touchpad)"})
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
        # soltar_todo is requested from the input thread, but it is done here, in the
        # capture one, which is the only one that touches the tracker.
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
        # Ctrl+Alt+T: the emergency exit if the page does not respond and the
        # cursor has got stuck.
        estado["armado"] = False
        captura.bloquear_cursor = False
        estado["soltar"] = True
        emitir({"desarmado": True})
        return False

    captura.alternar_bloquear_cursor = desarmar_por_tecla
    if not captura.iniciar():
        emitir({"error": "could not read the touchpad (is it a Precision Touchpad?)"})
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
