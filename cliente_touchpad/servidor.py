"""Aplicacion local del touchpad como instrumento: servidor web con botones.

Arranque:
    .venv/Scripts/python.exe cliente_touchpad/servidor.py --puerto 8771

Y se abre http://127.0.0.1:8771

La pagina tiene:
  - Empezar prueba / Parar prueba (enciende y apaga la captura en caliente)
  - congelar el cursor (o Ctrl+Alt+T) para que el puntero no baile al tocar
  - dibujo en vivo de los contactos y pitido en cada pulsacion
  - contadores: informes, informes/s, eventos

El nucleo (contactos y eventos) esta en modelo.py y es independiente del
sistema operativo; la captura la pone entrada_win32.py (solo Windows hoy).
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import modelo  # noqa: E402
from mapeo import Mapeo  # noqa: E402
from modelo import Publicador, Seguidor, evento_a_dict  # noqa: E402


ESTADO = {
    "iniciado": time.time(),
    "avisos": [],
}
BASE_URL = "http://127.0.0.1:8771"
PAGINA_ARCHIVO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pagina.html")


def pagina_html() -> str:
    """Se lee en cada peticion: editar el HTML no obliga a reiniciar la app."""
    try:
        with open(PAGINA_ARCHIVO, encoding="utf-8") as f:
            texto = f.read()
    except OSError as exc:
        return f"<h1>Falta cliente_touchpad/pagina.html</h1><pre>{exc}</pre>"
    return texto.replace("__BASE__", BASE_URL)
# El pad solo cuenta cuando el puntero esta dentro de la zona del pad.
ZONA = {"activa": False}
INYECTAR = None  # gancho de pruebas
PUBLICADOR = Publicador()
SEGUIDOR: Seguidor | None = None
MAPEO: Mapeo | None = None
CAPTURA = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # silencio: el log util es el de la pagina
        pass

    def handle_one_request(self):
        # Si el navegador cierra la conexion keep-alive de golpe (al recargar la
        # pagina, por ejemplo) el servidor escupe un traceback inofensivo.
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def _json(self, datos: dict, codigo: int = 200):
        cuerpo = json.dumps(datos).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_POST(self):
        ruta = urlparse(self.path)
        if not self._mando(ruta.path, ruta.query):
            self.send_error(404)

    def _mando(self, camino: str, consulta: str = "") -> bool:
        if camino == "/modo":
            modo = parse_qs(consulta).get("nombre", ["teclas"])[0]
            if MAPEO.fijar_modo(modo):
                PUBLICADOR.publicar({"tipo": "layout", "layout": MAPEO.layout()})
                PUBLICADOR.publicar({"tipo": "aviso", "texto": f"modo: {modo}"})
                self._json({"modo": modo})
            else:
                self._json({"error": f"modo desconocido: {modo}"}, 400)
            return True
        """Ejecuta un mando. Sirve tanto por GET como por POST: algunos paneles o
        proxies solo dejan pasar GET, y con POST el boton no llegaba."""
        if camino == "/zona":
            activa = parse_qs(consulta).get("activa", ["0"])[0] == "1"
            ZONA["activa"] = activa
            if not activa:
                SEGUIDOR.soltar_todo()  # si sale de la zona, no dejar notas colgadas
            self._json({"zona_activa": activa})
            return True
        if camino == "/iniciar":
            ok = CAPTURA.iniciar()
            self._json({"ok": ok, "estado": CAPTURA.estado()})
            return True
        if camino == "/parar":
            SEGUIDOR.soltar_todo()
            ok = CAPTURA.parar()
            self._json({"ok": ok, "estado": CAPTURA.estado()})
            return True
        if camino == "/cursor":
            quiere = parse_qs(consulta).get("bloquear", ["1"])[0] == "1"
            if quiere != CAPTURA.bloquear_cursor:
                CAPTURA.alternar_bloquear_cursor()
            self._json({"bloquear_cursor": CAPTURA.bloquear_cursor})
            return True
        return False

    def do_GET(self):
        ruta = urlparse(self.path)
        if ruta.path in ("/iniciar", "/parar", "/cursor", "/zona", "/modo"):
            self._mando(ruta.path, ruta.query)
            return
        if ruta.path == "/_test/informe":
            # Gancho para verificar el circuito entero sin tocar el pad de verdad.
            q = parse_qs(ruta.query)
            if INYECTAR is not None:
                INYECTAR(int(q.get("id", ["0"])[0]), float(q.get("x", ["0.5"])[0]),
                         float(q.get("y", ["0.5"])[0]), q.get("tip", ["1"])[0] == "1",
                         q.get("boton", ["0"])[0] == "1")
            self._json({"ok": True})
            return
        if ruta.path in ("/", "/index.html"):
            cuerpo = pagina_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
        elif ruta.path == "/estado":
            est = CAPTURA.estado()
            est.update({
                "modo": MAPEO.modo if MAPEO else None,
                "notas_sonando": MAPEO.n_eventos if MAPEO else 0,
                "zona_activa": ZONA["activa"],
                "suscriptores": PUBLICADOR.n_suscriptores,
                "eventos": SEGUIDOR.n_eventos,
                "enviados": PUBLICADOR.n_enviados,
                "descartados": PUBLICADOR.n_descartados,
            })
            self._json(est)
        elif ruta.path == "/eventos":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = PUBLICADOR.suscribir()
            try:
                while True:
                    try:
                        linea = q.get(timeout=15)
                        self.wfile.write(f"data: {linea}\n\n".encode("utf-8"))
                    except queue.Empty:
                        self.wfile.write(b": latido\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                PUBLICADOR.desuscribir(q)
        else:
            self.send_error(404)


def main(argv=None):
    global SEGUIDOR, CAPTURA, MAPEO

    # Un fallo duro del interprete (segfault) no imprime nada por si solo: dejamos
    # un volcado para saber por que se muere la aplicacion.
    import atexit

    import faulthandler

    _dir = os.path.dirname(os.path.abspath(__file__))
    _log = open(os.path.join(_dir, "cliente.log"), "a", buffering=1, encoding="utf-8")
    _log.write(f"\n===== arranque {time.strftime('%H:%M:%S')} =====\n")

    # El proceso corre desligado de cualquier consola: si no desviamos la salida
    # aqui, cualquier traceback se pierde en el vacio.
    sys.stdout = sys.stderr = _log

    def _excepcion_en_hilo(args):
        import traceback
        _log.write(f"[hilo {args.thread.name}] excepcion no capturada:\n")
        traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback, file=_log)
        _log.flush()

    threading.excepthook = _excepcion_en_hilo

    _fh = open(os.path.join(_dir, "faulthandler.log"), "a", encoding="utf-8")
    faulthandler.enable(_fh)
    if hasattr(faulthandler, "register"):  # solo existe en Unix
        try:
            faulthandler.register(signal.SIGTERM, all_threads=True)
        except Exception:
            pass

    def _al_salir():
        _fh.write(f"[cliente] salida limpia {time.strftime('%H:%M:%S')}\n")
        _fh.flush()

    atexit.register(_al_salir)

    ap = argparse.ArgumentParser(description="Touchpad como instrumento (cliente local)")
    ap.add_argument("--puerto", type=int, default=8771)
    ap.add_argument("--congelar-raton", action="store_true",
                    help="arrancar ya con el cursor congelado al tocar")
    args = ap.parse_args(argv)

    if not sys.platform.startswith("win"):
        print("De momento este cliente solo tiene backend de captura para Windows.",
              file=sys.stderr)
        return 2
    import entrada_win32

    def aviso(texto: str):
        print(f"[cliente] {texto}", flush=True)
        ESTADO["avisos"].append(texto)
        PUBLICADOR.publicar({"tipo": "aviso", "texto": texto})

    def al_evento(ev):
        PUBLICADOR.publicar({"tipo": "evento", "evento": evento_a_dict(ev)})
        if ev.tipo == "up":
            MAPEO.soltar(ev.id)  # el dedo se ha ido: que no quede nota colgada

    def al_nota(datos: dict):
        PUBLICADOR.publicar({"tipo": "nota", **datos})

    SEGUIDOR = Seguidor(al_evento)

    def al_informe(id_, x, y, tip, boton):
        if not ZONA["activa"]:
            return  # fuera de la zona del pad no se toca nada
        MAPEO.informe(id_, x, y, tip)     # primero la nota...
        SEGUIDOR.informe(id_, x, y, tip, boton)  # ...y luego el dibujo

    MAPEO = Mapeo(al_nota=al_nota, modo="teclas")
    CAPTURA = entrada_win32.CapturaWin32(
        al_informe=al_informe, al_latido=lambda: None, al_aviso=aviso)
    if args.congelar_raton:
        CAPTURA.congelar_raton = True

    ultimo_envio = [0.0]

    def al_latido():
        ahora = time.perf_counter()
        SEGUIDOR.latido()
        dt = ahora - ultimo_envio[0]
        if dt >= 1 / 120:
            ultimo_envio[0] = ahora
            PUBLICADOR.publicar({"tipo": "cuadro", "dt": round(dt, 5),
                                 "contactos": SEGUIDOR.instantanea()})

    CAPTURA.al_latido = al_latido
    global INYECTAR
    INYECTAR = al_informe
    PUBLICADOR.publicar({"tipo": "layout", "layout": MAPEO.layout()})

    global BASE_URL
    BASE_URL = f"http://127.0.0.1:{args.puerto}"
    servidor = ThreadingHTTPServer(("127.0.0.1", args.puerto), Handler)
    print(f"[cliente] abre http://127.0.0.1:{args.puerto} "
          f"y pulsa «Empezar prueba»", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if CAPTURA.en_marcha:
            CAPTURA.parar()
        servidor.server_close()
    print("\n[cliente] cerrado", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
