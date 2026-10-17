"""Pruebas HTTP de la aplicación mínima de tarareo a MIDI."""
from __future__ import annotations

import sys
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
import servidor  # noqa: E402


class AppTranscripcionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), servidor.Manejador)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_transcribir_devuelve_midi_listo_para_descargar(self):
        midi = b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x00\x60"
        result = type("R", (), {"midi": midi})()
        with patch.object(servidor, "transcribir_audio", return_value=midi) as transcribe:
            req = Request(self.base + "/analizar", data=b"wav-de-prueba",
                          headers={"Content-Type": "application/octet-stream"}, method="POST")
            with urlopen(req) as res:
                self.assertEqual(res.status, 200)
                self.assertEqual(res.headers["Content-Type"], "audio/midi")
                self.assertEqual(res.read(), midi)
            self.assertEqual(transcribe.call_count, 1)

    def test_rechaza_audio_vacio(self):
        req = Request(self.base + "/analizar", data=b"",
                      headers={"Content-Type": "application/octet-stream"}, method="POST")
        with self.assertRaises(HTTPError) as err:
            urlopen(req)
        self.assertEqual(err.exception.code, 400)

    def test_pagina_solo_ofrece_grabacion_transcripcion_y_exportacion(self):
        with urlopen(self.base + "/") as res:
            page = res.read().decode()
        for text in ("Grabar tarareo", "Transcribir", "Exportar MIDI", "type=\"file\"", "getUserMedia"):
            self.assertIn(text, page)
        for text in ("Añadir pista", "Piano roll", "Instrumento", "Volumen", "metrónomo", "Renderizar", "/proyecto/wav"):
            self.assertNotIn(text, page)

    def test_endpoints_antiguos_de_editor_no_existen(self):
        req = Request(self.base + "/proyecto/midi", data=b"{}", method="POST")
        with self.assertRaises(HTTPError) as err:
            urlopen(req)
        self.assertEqual(err.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
