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
from modelo import Publicador, Seguidor, evento_a_dict  # noqa: E402

PAGINA = r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Touchpad como instrumento</title>
<style>
 :root{--fg:#e8e8ec;--bg:#14141a;--panel:#1c1c24;--borde:#33333f;--acento:#5ac8ff;--ok:#48d17a;--parado:#6b6b7a}
 *{box-sizing:border-box}
 body{margin:0;padding:18px;background:var(--bg);color:var(--fg);
      font:14px/1.45 system-ui,-apple-system,sans-serif}
 h1{font-size:17px;margin:0 0 14px;font-weight:600}
 .barra{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
 button{font:inherit;font-weight:600;padding:9px 18px;border-radius:8px;border:1px solid var(--borde);
        background:#262631;color:var(--fg);cursor:pointer}
 button:hover:not(:disabled){background:#31313f}
 button:disabled{opacity:.4;cursor:default}
 #bEmpezar{background:#1f4d33;border-color:#2c6b47}
 #bParar{background:#4d2a2a;border-color:#6b3838}
 .piloto{display:inline-flex;align-items:center;gap:8px;font-weight:600}
 .punto{width:11px;height:11px;border-radius:50%;background:var(--parado)}
 .punto.on{background:var(--ok);box-shadow:0 0 10px var(--ok)}
 label.chk{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
 .fila{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
 canvas{background:var(--panel);border:1px solid var(--borde);border-radius:10px;touch-action:none}
 .caja{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:12px;min-width:190px}
 .caja h2{font-size:12px;margin:0 0 8px;color:#9a9aab;text-transform:uppercase;letter-spacing:.06em}
 .num{font-family:ui-monospace,SFMono-Regular,monospace;font-size:22px;font-weight:600}
 .sub{font-size:11px;color:#8b8b9c}
 #log{margin-top:14px;height:170px;overflow:auto;background:var(--panel);border:1px solid var(--borde);
      border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre}
 .n{color:var(--acento)} .d{color:#ffd479} .u{color:#8b8b9c} .c{color:#c88bff}
 .nota{color:#8b8b9c;font-size:12px;margin-top:10px;max-width:640px}
</style></head><body>
<h1>Touchpad como instrumento</h1>

<div class="barra">
  <button id="bEmpezar">Empezar prueba</button>
  <button id="bParar" disabled>Parar prueba</button>
  <span class="piloto"><span class="punto" id="punto"></span><span id="estado">PARADO</span></span>
  <span id="zona" style="color:#8b8b9c;font-size:12px">zona inactiva</span>
  <label class="chk"><input type="checkbox" id="cursor" checked> el pad no mueve el cursor (Ctrl+Alt+T)</label>
  <label class="chk"><input type="checkbox" id="sonido" checked> sonido</label>
</div>

<div class="fila">
  <canvas id="pad" width="470" height="265"></canvas>
  <div class="fila">
    <div class="caja"><h2>Dedos activos</h2><div class="num" id="nActivos">0</div></div>
    <div class="caja"><h2>Informes/s</h2><div class="num" id="nTasa">0</div>
      <div class="sub" id="nInformes">total 0</div></div>
    <div class="caja"><h2>Eventos</h2><div class="num" id="nEventos">0</div>
      <div class="sub" id="nErrores">errores 0</div></div>
  </div>
</div>

<div id="log">Esperando...</div>
<div class="nota">El pad manda un informe por dedo y no tiene presion: la posicion
es absoluta (X 0..3520, Y 0..1784). El pitido suena en cada pulsacion, con la
altura segun X y el volumen segun Y. Si congelas el cursor, para volver a la
pagina pulsa Ctrl+Alt+T.</div>

<script>
// BASE la inyecta el servidor: si la pagina se abre a traves de un panel o
// proxy, las rutas relativas irian al origen equivocado.
const BASE = "__BASE__";
const $ = id => document.getElementById(id);
const pad = $('pad'), ctx = pad.getContext('2d');
let contactos = {}, ac = null, eventos = 0;

function pitido(x, y){
  if(!$('sonido').checked) return;
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  if(ac.state === 'suspended') ac.resume();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle';
  o.frequency.value = 220 * Math.pow(2, x * 2);
  g.gain.value = 0.04 + 0.22 * (1 - y);
  o.connect(g); g.connect(ac.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + 0.28);
  o.stop(ac.currentTime + 0.29);
}

function pintar(){
  const w = pad.width, h = pad.height;
  ctx.fillStyle = '#1c1c24'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#2c2c38'; ctx.lineWidth = 1;
  for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(i*w/8,0);ctx.lineTo(i*w/8,h);ctx.stroke();}
  for(let j=1;j<4;j++){ctx.beginPath();ctx.moveTo(0,j*h/4);ctx.lineTo(w,j*h/4);ctx.stroke();}
  for(const c of Object.values(contactos)){
    const px = c.x*w, py = c.y*h, col = c.id % 2 ? '#ffaa5a' : '#5ac8ff';
    ctx.beginPath(); ctx.arc(px, py, 16, 0, 6.3);
    ctx.fillStyle = col + '44'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('id'+c.id, px+20, py+4);
  }
}

function traza(txt, clase){
  const l = $('log');
  const linea = document.createElement('div');
  linea.className = clase || '';
  linea.textContent = txt;
  l.prepend(linea);
  while(l.childElementCount > 60) l.lastChild.remove();
}

async function accion(url){
  try {
    const r = await fetch(BASE + url);
    if(!r.ok) traza('el servidor respondio ' + r.status, 'u');
    else traza('mando enviado: ' + url, 'c');
  } catch(e) {
    traza('no se pudo hablar con el servidor: ' + e, 'u');
    $('estado').textContent = 'SIN CONEXION CON EL SERVIDOR';
    refrescar();
    return;
  }
  refrescar();
}

$('bEmpezar').onclick = () => accion('/iniciar');
$('bParar').onclick = () => accion('/parar');
$('cursor').onchange = () => accion('/cursor?bloquear=' + ($('cursor').checked ? 1 : 0));

async function refrescar(){
  let d;
  try { d = await (await fetch(BASE + '/estado')).json(); } catch(e) {
    $('estado').textContent = 'SIN CONEXION CON EL SERVIDOR';
    $('punto').className = 'punto';
    $('bEmpezar').disabled = true;
    $('bParar').disabled = true;
    return;
  }
  $('punto').className = 'punto' + (d.en_marcha ? ' on' : '');
  $('estado').textContent = d.en_marcha ? 'EN MARCHA' : 'PARADO';
  $('bEmpezar').disabled = d.en_marcha;
  $('bParar').disabled = !d.en_marcha;
  $('nTasa').textContent = d.tasa.toFixed(0);
  $('nInformes').textContent = 'total ' + d.informes;
  $('nErrores').textContent = 'errores ' + d.errores;
  $('nEventos').textContent = eventos;
  $('nActivos').textContent = Object.keys(contactos).length;
  if($('cursor').checked !== !!d.bloquear_cursor) $('cursor').checked = !!d.bloquear_cursor;
  let txt = d.zona_activa
      ? 'ZONA ARMADA: el pad toca'
      : 'zona inactiva: acerca el raton al recuadro del pad';
  if(d.cursor_bloqueado) txt += '  ·  CURSOR CONGELADO con ' + d.dedos + ' dedo(s)';
  else if(d.bloquear_cursor) txt += '  ·  al tocar se congela el cursor';
  $('zona').textContent = txt;
  $('zona').style.color = d.zona_activa ? '#48d17a' : '#8b8b9c';
  pad.style.borderColor = d.zona_activa ? '#48d17a' : '#33333f';
  if(!d.en_marcha && Object.keys(contactos).length){ contactos = {}; pintar(); }
}

const es = new EventSource(BASE + '/eventos');
es.onmessage = e => {
  const d = JSON.parse(e.data);
  if(d.tipo === 'cuadro'){
    contactos = {};
    for(const c of d.contactos) contactos[c.id] = c;
    pintar();
  } else if(d.tipo === 'evento'){
    const ev = d.evento;
    eventos++;
    if(ev.tipo === 'down') pitido(ev.x, ev.y);
    if(ev.tipo !== 'move'){
      traza(ev.tipo.toUpperCase().padEnd(5) + ' id' + ev.id +
            '  x=' + ev.x.toFixed(3) + '  y=' + ev.y.toFixed(3) +
            '  dur=' + ev.duracion.toFixed(3) + '  rec=' + ev.recorrido.toFixed(3) +
            '  activos=' + ev.n_activos,
            ev.tipo === 'down' ? 'd' : (ev.tipo === 'up' ? 'u' : 'c'));
    }
  } else if(d.tipo === 'aviso'){
    traza('· ' + d.texto, 'u');
  }
};
es.onerror = () => traza('· sin conexion con el servidor', 'u');

// El pad solo cuenta como instrumento cuando el puntero esta ENCIMA del pad.
// Asi el touchpad no se sale del contexto de la aplicacion (Carlos usa raton USB).
function armarZona(v){
  fetch(BASE + '/zona?activa=' + (v ? 1 : 0)).catch(() => {});
}
pad.addEventListener('pointerenter', () => armarZona(true));
pad.addEventListener('pointerleave', () => armarZona(false));
document.addEventListener('visibilitychange', () => { if(document.hidden) armarZona(false); });
window.addEventListener('blur', () => armarZona(false));

pintar();
refrescar();
setInterval(refrescar, 500);
</script></body></html>
"""

ESTADO = {
    "iniciado": time.time(),
    "avisos": [],
}
BASE_URL = "http://127.0.0.1:8771"
# El pad solo cuenta cuando el puntero esta dentro de la zona del pad.
ZONA = {"activa": False}
INYECTAR = None  # gancho de pruebas
PUBLICADOR = Publicador()
SEGUIDOR: Seguidor | None = None
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
        if ruta.path in ("/iniciar", "/parar", "/cursor", "/zona"):
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
            cuerpo = PAGINA.replace("__BASE__", BASE_URL).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
        elif ruta.path == "/estado":
            est = CAPTURA.estado()
            est.update({
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
    global SEGUIDOR, CAPTURA

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

    SEGUIDOR = Seguidor(al_evento)

    def al_informe(id_, x, y, tip, boton):
        if not ZONA["activa"]:
            return  # fuera de la zona del pad no se toca nada
        SEGUIDOR.informe(id_, x, y, tip, boton)

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
