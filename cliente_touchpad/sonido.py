"""Motor de sonido con el soundfont General MIDI (fluidsynth), dentro del cliente.

Ventaja: no hace falta ningun driver MIDI virtual ni instalar nada. fluidsynth
sintetiza en este mismo proceso y saca el audio por la tarjeta.

Ojo con las trampas ya pagadas:
  - pyfluidsynth 1.4 NO trae la clase AudioDriver; hay que crear el driver de
    audio por la API de C (new_fluid_audio_driver) con el manejador de ajustes.
  - En fluidsynth FLUID_OK es 0 y FLUID_FAILED es -1 (no 1, como en la mania de C).
  - La percusion GM va en el canal 9 con el banco 128.

Solo se importa si el usuario elige este motor: si falta el soundfont o la
biblioteca, el cliente sigue funcionando con el sintetizador del navegador.
"""

from __future__ import annotations

import os
import threading
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN_FLUIDSYNTH = os.path.join(RAIZ, "tools", "fluidsynth-v2.6.1-win10-x64-cpp11", "bin")
SOUNDFONT = os.path.join(RAIZ, "tools", "MuseScore_General.sf3")

CANAL_MELODIA = 0
CANAL_PERCUSION = 9

# Los 128 instrumentos del banco General MIDI, tal cual vienen en el soundfont.
INSTRUMENTOS = (
    "Piano de cola", "Piano brillante", "Piano electrico", "Honky-tonk",
    "Piano electrico 1", "Piano electrico 2", "Clavicordio", "Celesta",
    "Caja de musica", "Vibrafono", "Marimba", "Xilofono", "Campanas", "Timbal",
    "Cajon de ritmos", "Dulcimer", "Organo Hammond", "Organo percusivo",
    "Organo de iglesia", "Organo de iglesia 2", "Organo de lenguetas",
    "Acordeon", "Armonica", "Bandoneon", "Guitarra acustica (nylon)",
    "Guitarra acustica (acero)", "Guitarra electrica (jazz)",
    "Guitarra electrica (limpia)", "Guitarra apagada", "Guitarra con saturacion",
    "Guitarra distorsionada", "Armonicos de guitarra", "Bajo acustico",
    "Bajo electrico (dedos)", "Bajo electrico (pua)", "Bajo sin trastes",
    "Bajo slap 1", "Bajo slap 2", "Bajo sintetico 1", "Bajo sintetico 2",
    "Violin", "Viola", "Violonchelo", "Contrabajo", "Tremolo de cuerdas",
    "Pizzicato de cuerdas", "Arpa", "Timpani", "Cuerdas (conjunto 1)",
    "Cuerdas (conjunto 2)", "Cuerdas sinteticas 1", "Cuerdas sinteticas 2",
    "Coro Aahs", "Voz Oohs", "Voz sintetica", "Golpe de orquesta", "Trompeta",
    "Trombon", "Tuba", "Trompeta con sordina", "Trompa francesa", "Metales",
    "Saxo soprano", "Saxo alto", "Saxo tenor", "Saxo baritono", "Oboe",
    "Corno ingles", "Fagot", "Clarinete", "Flauta piccolo", "Flauta travesera",
    "Flauta de pan", "Flauta de botella", "Shakuhachi", "Silbato", "Ocarina",
    "Onda cuadrada", "Onda de sierra", "Organo electrico (Calliope)",
    "Chiffer lead", "Charang", "Voz solista", "Quinta", "Bajo y plomo",
    "Fantasia", "Calido", "Polisintetico", "Coros", "Arco", "Metalico",
    "Halo", "Barrido", "Lluvia", "Banda sonora", "Cristal", "Atmosfera",
    "Brillo", "Duendes", "Ecos", "Ciencia-ficcion", "Sitar", "Banjo",
    "Shamisen", "Koto", "Kalimba", "Gaita", "Violin fiddle", "Shanai",
    "Campana tintineante", "Agogo", "Steel drums", "Woodblock", "Taiko",
    "Tom melodico", "Tambor sintetico", "Ruido de fondo", "Scratch",
    "Guitarra con ruido", "Respiracion", "Mar", "Canto de pajaro",
    "Timbre de telefono", "Helicoptero", "Aplausos", "Disparos",
)


class MotorSoundfont:
    """Sintetizador con el soundfont GM, arrancable y pararable en caliente."""

    def __init__(self, al_aviso=None):
        self.al_aviso = al_aviso or (lambda texto: None)
        self.synth = None
        self.banco = None
        self.driver = None
        self.instrumento = 0
        self.en_marcha = False
        self.n_notas = 0
        self._sonando: dict[int, int] = {}   # canal -> notas que suenan
        self._lock = threading.Lock()

    # -- arranque ---------------------------------------------------------
    def arrancar(self, instrumento: int | None = None) -> bool:
        if self.en_marcha:
            return True
        if not os.path.isfile(SOUNDFONT):
            self.al_aviso(f"no encuentro el soundfont: {SOUNDFONT}")
            return False
        try:
            os.add_dll_directory(BIN_FLUIDSYNTH)
            os.environ["PATH"] = BIN_FLUIDSYNTH + os.pathsep + os.environ.get("PATH", "")
            import fluidsynth
        except Exception as exc:
            self.al_aviso(f"no puedo cargar fluidsynth: {exc}")
            return False

        self._fl = fluidsynth
        self.synth = fluidsynth.Synth(samplerate=44100.0, gain=0.6)
        self.banco = self.synth.sfload(SOUNDFONT)
        if instrumento is not None:
            self.instrumento = instrumento
        self.synth.program_select(CANAL_MELODIA, self.banco, 0, self.instrumento)
        self.synth.program_select(CANAL_PERCUSION, self.banco, 128, 0)  # bateria

        if fluidsynth.fluid_settings_setstr(
                self.synth.settings, b"audio.driver", b"dsound") != 0:
            self.al_aviso("fluidsynth no acepta el driver dsound")
        self.driver = fluidsynth.new_fluid_audio_driver(self.synth.settings,
                                                         self.synth.synth)
        if not self.driver:
            self.al_aviso("el driver de audio de fluidsynth no arranca")
            self.synth = None
            return False
        self.en_marcha = True
        self.al_aviso(f"soundfont GM en marcha ({INSTRUMENTOS[self.instrumento]})")
        return True

    def parar(self):
        with self._lock:
            self.todas_fuera()
            if self.driver:
                self._fl.delete_fluid_audio_driver(self.driver)
                self.driver = None
            self.synth = None
            self.en_marcha = False
        self.al_aviso("soundfont parado")

    # -- notas ------------------------------------------------------------
    def nota_on(self, id_: int, nota: int, vel: int, percusion: bool = False):
        if not self.en_marcha or vel <= 0:
            return
        canal = CANAL_PERCUSION if percusion else CANAL_MELODIA
        with self._lock:
            self.synth.noteon(canal, nota, min(127, max(1, vel)))
            self._sonando.setdefault(canal, set()).add(nota)
            self.n_notas += 1

    def nota_off(self, id_: int, nota: int, percusion: bool = False):
        if not self.en_marcha:
            return
        canal = CANAL_PERCUSION if percusion else CANAL_MELODIA
        with self._lock:
            self.synth.noteoff(canal, nota)
            self._sonando.get(canal, set()).discard(nota)

    def todas_fuera(self):
        if self.synth is None:
            return
        for canal in (CANAL_MELODIA, CANAL_PERCUSION):
            for nota in range(128):
                self.synth.noteoff(canal, nota)

    def fijar_instrumento(self, programa: int) -> bool:
        if not self.en_marcha or not (0 <= programa < len(INSTRUMENTOS)):
            return False
        with self._lock:
            self.todas_fuera()
            self.instrumento = programa
            self.synth.program_select(CANAL_MELODIA, self.banco, 0, programa)
        self.al_aviso(f"instrumento: {INSTRUMENTOS[programa]}")
        return True

    def estado(self) -> dict:
        return {
            "en_marcha": self.en_marcha,
            "instrumento": self.instrumento,
            "nombre_instrumento": INSTRUMENTOS[self.instrumento],
            "notas_tocadas": self.n_notas,
        }
