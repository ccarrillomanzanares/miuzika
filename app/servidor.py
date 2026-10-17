#!/usr/bin/env python3
"""Servidor local mínimo de tarareo a MIDI."""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from humseed import transcribir  # noqa: E402

APP = Path(__file__).resolve().parent
MAX_BYTES = 40 * 1024 * 1024


def transcribir_audio(datos: bytes) -> bytes:
    """Guarda el WAV de entrada temporalmente y devuelve el MIDI crudo."""
    with tempfile.TemporaryDirectory(prefix="humseed-") as tmp:
        wav = Path(tmp) / "tarareo.wav"
        wav.write_bytes(datos)
        return transcribir.transcribir(wav).midi


class Manejador(BaseHTTPRequestHandler):
    server_version = "humseed/0.2"

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _enviar(self, codigo: int, cuerpo: bytes, tipo: str) -> None:
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html", "/transcribir.html"):
            self._enviar(200, (APP / "transcribir.html").read_bytes(),
                         "text/html; charset=utf-8")
        elif self.path == "/salud":
            self._enviar(200, b'{"ok":true}', "application/json")
        else:
            self._enviar(404, b"no encontrado", "text/plain; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/analizar":
            self._enviar(404, b"no encontrado", "text/plain; charset=utf-8")
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BYTES:
            self._enviar(400, b'{"error":"tamano de audio invalido"}',
                         "application/json; charset=utf-8")
            return
        try:
            midi = transcribir_audio(self.rfile.read(n))
            self._enviar(200, midi, "audio/midi")
        except Exception as e:
            traceback.print_exc()
            body = json.dumps({"error": str(e)}, ensure_ascii=False).encode()
            self._enviar(500, body, "application/json; charset=utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="Tarareo a MIDI")
    ap.add_argument("--puerto", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--abrir", action="store_true", help="abrir el navegador")
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.puerto), Manejador)
    url = f"http://{args.host}:{args.puerto}"
    print(f"  escuchando en {url}")
    print("  Ctrl+C para parar")
    if args.abrir:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  parado")


if __name__ == "__main__":
    main()
