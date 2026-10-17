#!/usr/bin/env python3
"""Servidor local de la app de tarareo.

Cero dependencias: usa http.server de la biblioteca estandar. Sirve una pagina
que graba desde el microfono del navegador y le manda el WAV; aqui se analiza
con pyin y se devuelve la transcripcion en ABC, MIDI y audio.

La grabacion la hace el NAVEGADOR, no Python: asi no dependemos de sounddevice
ni de los nombres raros de dispositivos de Windows.

Uso:
    python app/servidor.py            # abre en http://127.0.0.1:8770
    python app/servidor.py --puerto 9000
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import abcmini, analyze, render  # noqa: E402

TOMAS = ROOT / "cache" / "tomas"      # grabaciones y resultados
APP = Path(__file__).resolve().parent

MAX_BYTES = 40 * 1024 * 1024          # tope de subida: 40 MB


def analizar_toma(datos: bytes, nombre: str) -> dict:
    """Guarda el WAV y devuelve el analisis completo."""
    TOMAS.mkdir(parents=True, exist_ok=True)
    wav_in = TOMAS / f"{nombre}_original.wav"
    wav_in.write_bytes(datos)

    t0 = time.time()
    seed = analyze.analyse(wav_in)
    t_analisis = time.time() - t0

    abc = analyze.melodia_a_abc(seed, titulo=f"Transcripcion {nombre}")
    midi = TOMAS / f"{nombre}.mid"
    wav_out = TOMAS / f"{nombre}_transcrito.wav"

    render.abc_to_midi(abc, midi)
    render.midi_to_wav(midi, wav_out)

    s = abcmini.parse_abc(abc)
    notas = [{"nombre": n.name, "midi": n.pitch, "beat": n.beat,
              "dur": n.beat_dur, "seg": round(n.start, 3)} for n in seed.notes]

    return {
        "nombre": nombre,
        "duracion": seed.duration,
        "bpm": round(seed.tempo_bpm, 1),
        "key": seed.key,
        "mode": seed.mode,
        "confianza_tonalidad": seed.confidence_key,
        "n_notas": len(seed.notes),
        "motor": seed.motor,
        "notas": notas,
        "seed": analyze.seed_to_conditioning(seed),
        "abc": abc,
        "segundos_analisis": round(t_analisis, 2),
        "midi_b64": base64.b64encode(midi.read_bytes()).decode(),
        "wav_b64": base64.b64encode(wav_out.read_bytes()).decode(),
        "original_b64": base64.b64encode(datos).decode(),
        "nombre_midi": f"{nombre}.mid",
    }


class Manejador(BaseHTTPRequestHandler):
    server_version = "humseed/0.1"

    def log_message(self, fmt, *args):        # menos ruido en consola
        if "/analizar" not in self.path:
            sys.stderr.write("  %s\n" % (fmt % args))

    def _enviar(self, codigo: int, cuerpo: bytes, tipo: str) -> None:
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self) -> None:                  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._enviar(200, (APP / "index.html").read_bytes(),
                         "text/html; charset=utf-8")
        elif self.path == "/salud":
            self._enviar(200, b'{"ok":true}', "application/json")
        else:
            self._enviar(404, b"no encontrado", "text/plain; charset=utf-8")

    def do_POST(self) -> None:                 # noqa: N802
        if self.path != "/analizar":
            self._enviar(404, b"no encontrado", "text/plain")
            return

        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > MAX_BYTES:
            self._enviar(400, b"tamano invalido", "text/plain")
            return
        datos = self.rfile.read(n)

        nombre = time.strftime("toma_%Y%m%d_%H%M%S")
        try:
            res = analizar_toma(datos, nombre)
        except Exception as e:
            traceback.print_exc()
            self._enviar(500, json.dumps({"error": str(e)}).encode(),
                         "application/json")
            return

        cuerpo = json.dumps(res).encode()
        self._enviar(200, cuerpo, "application/json")


def main() -> None:
    ap = argparse.ArgumentParser(description="App web de tarareo -> MIDI")
    ap.add_argument("--puerto", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--abrir", action="store_true", help="abrir el navegador")
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.puerto), Manejador)
    url = f"http://{args.host}:{args.puerto}"
    print(f"  escuchando en {url}")
    print(f"  grabaciones en {TOMAS}")
    print("  Ctrl+C para parar")
    if args.abrir:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  parado")


if __name__ == "__main__":
    main()
