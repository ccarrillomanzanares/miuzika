"""Measures a reference song: tempo, key, form and character.

    python codigo/analizar_referencia.py "<YouTube URL | path to an audio file>"

Returns a JSON with what can be measured by someone else's ear:

  tempo_bpm        beats per minute (autocorrelation of the energy envelope)
  tonalidad        tonic and mode, by correlating the chroma with major/minor profiles
  duracion_s       seconds
  compases         estimated bars in 4/4
  forma[]          per block: first bar, last bar, relative energy (0-1)
  registros        energy distribution across lows / mids / highs and mean centroid
  palabras         the character in words, derived from the measurements

What it does NOT do: extract the melody or the chords. That doesn't come from here; if the user
wants to play the song, the melody has to come from somewhere else (MIDI, or the agent
knowing it from memory).

With a URL it downloads the audio to `_referencias/` using yt-dlp and works on the file.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 22050


def descargar(url: str, carpeta: str) -> str:
    """Downloads the audio from a URL to mono WAV. Returns the path."""
    os.makedirs(carpeta, exist_ok=True)
    plantilla = os.path.join(carpeta, "%(id)s.%(ext)s")
    comando = [
        sys.executable, "-m", "yt_dlp",
        "-x", "--audio-format", "wav", "--audio-quality", "0",
        "--no-playlist", "--quiet", "--no-warnings",
        "-o", plantilla, url,
    ]
    proceso = subprocess.run(comando, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proceso.returncode != 0:
        raise SystemExit(json.dumps({"ok": False, "error": (proceso.stderr or proceso.stdout)[-400:]}))
    ficheros = sorted(
        (os.path.join(carpeta, f) for f in os.listdir(carpeta) if f.endswith(".wav")),
        key=os.path.getmtime,
    )
    if not ficheros:
        raise SystemExit(json.dumps({"ok": False, "error": "the download left no wav file"}))
    return ficheros[-1]


def decodificar(ruta: str) -> np.ndarray:
    """Any audio to mono 22050 Hz with ffmpeg (the one the project already uses)."""
    from shutil import which

    ffmpeg = which("ffmpeg") or "ffmpeg"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        salida = tmp.name
    proceso = subprocess.run(
        [ffmpeg, "-y", "-i", ruta, "-ac", "1", "-ar", str(SR), "-f", "wav", salida],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proceso.returncode != 0 or not os.path.exists(salida):
        raise SystemExit(json.dumps({"ok": False, "error": "ffmpeg could not decode: " + proceso.stderr[-300:]}))
    with wave.open(salida, "rb") as w:
        datos = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    os.unlink(salida)
    return datos


def envolvente(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Energy per frame (for the tempo) and its sampling rate."""
    hop = 512
    tramas = len(x) // hop
    if tramas < 8:
        raise SystemExit(json.dumps({"ok": False, "error": "audio too short"}))
    trozos = x[: tramas * hop].reshape(tramas, hop)
    energia = np.sqrt((trozos ** 2).mean(axis=1) + 1e-12)
    # Positive derivative: the attacks, not the sustained volume.
    ataques = np.maximum(0.0, np.diff(energia, prepend=energia[0]))
    return ataques, SR / hop


def tempo(ataques: np.ndarray, fps: float) -> tuple[float, float]:
    """BPM and confidence, with a harmonic comb and a preference for 90-150.

    Taking the plain autocorrelation maximum gave 132.5 BPM on a pattern of
    100 (measured): the highest peak was a subdivision. Each candidate is scored
    by adding the autocorrelation at the beat and at its multiples, and weighted with a
    curve around 120 BPM, which is where most music sits.
    """
    señal = ataques - ataques.mean()
    if np.allclose(señal, 0):
        return 0.0, 0.0
    autocorr = np.correlate(señal, señal, mode="full")[len(señal) - 1 :]
    autocorr = autocorr / (autocorr[0] + 1e-12)
    mejor_bpm, mejor_puntos = 0.0, -1.0
    for bpm in np.arange(60.0, 181.0, 0.5):
        puntos = 0.0
        peso = 1.0
        for armonico in (1, 2, 3, 4):
            lag = int(round(fps * 60.0 / bpm * armonico))
            if lag < len(autocorr):
                puntos += peso * float(autocorr[lag])
            peso *= 0.6
        # Logarithmic preference centred on 120 BPM (a fifth's deviation).
        prior = float(np.exp(-0.5 * (np.log2(bpm / 120.0) / 0.6) ** 2))
        puntos *= prior
        if puntos > mejor_puntos:
            mejor_bpm, mejor_puntos = float(bpm), puntos
    return round(mejor_bpm, 1), round(float(mejor_puntos), 3)


PERFILES_MAYOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
PERFILES_MENOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTAS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def croma(x: np.ndarray) -> np.ndarray:
    """Energy per pitch class, summing frames."""
    ventana = 8192
    salto = ventana // 2
    acumulado = np.zeros(12)
    for i in range(0, max(1, len(x) - ventana), salto):
        trozo = x[i : i + ventana]
        if len(trozo) < ventana:
            break
        esp = np.abs(np.fft.rfft(trozo * np.hanning(ventana)))
        fr = np.fft.rfftfreq(ventana, 1 / SR)
        util = (fr > 55) & (fr < 2000)
        esp, fr = esp[util], fr[util]
        clases = np.round(12 * np.log2(fr / 440.0) + 69).astype(int) % 12
        np.add.at(acumulado, clases, esp ** 2)
    return acumulado / (np.linalg.norm(acumulado) + 1e-12)


def tonalidad(chroma: np.ndarray) -> dict:
    # A drum pattern has no pitch: if the chroma is flat there is no key
    # to measure, and saying so is more useful than returning a made-up tonic.
    plano = float(np.max(chroma) / (np.mean(chroma) + 1e-12))
    if plano < 1.6:
        return {"tonica": None, "modo": None, "correlacion": 0.0, "aviso": "no tonal content (percussion or noise)"}
    mejor = (-2.0, "C", "mayor")
    for i in range(12):
        for perfil, modo in ((PERFILES_MAYOR, "mayor"), (PERFILES_MENOR, "menor")):
            girado = np.roll(perfil, i)
            r = float(np.corrcoef(chroma, girado)[0, 1])
            if r > mejor[0]:
                mejor = (r, NOTAS[i], modo)
    salida = {"tonica": mejor[1], "modo": mejor[2], "correlacion": round(mejor[0], 3)}
    if mejor[0] < 0.65:
        salida["aviso"] = "unclear key (little harmony or a lot of percussion)"
    return salida


def forma(x: np.ndarray, bpm: float) -> dict:
    """Energy per bar and 4-bar blocks (that's where the form is heard)."""
    seg_compas = 4 * 60.0 / bpm if bpm > 0 else 2.0
    compases = max(1, int(len(x) / SR / seg_compas))
    energia = []
    for c in range(compases):
        a = int(c * seg_compas * SR)
        b = int((c + 1) * seg_compas * SR)
        trozo = x[a:b]
        energia.append(float(np.sqrt((trozo ** 2).mean() + 1e-12)))
    energia = np.array(energia)
    relativa = energia / (energia.max() + 1e-12)
    bloques = []
    for inicio in range(0, compases, 4):
        trozo = relativa[inicio : inicio + 4]
        if len(trozo) == 0:
            break
        bloques.append(
            {"desde": inicio + 1, "hasta": min(inicio + 4, compases), "energia": round(float(trozo.mean()), 2)}
        )
    return {"compases": compases, "bloques": bloques}


def registros(x: np.ndarray) -> dict:
    """Low/mid/high energy distribution and average brightness."""
    ventana = 8192
    graves = medios = agudos = 0.0
    centroides = []
    for i in range(0, max(1, len(x) - ventana), ventana):
        trozo = x[i : i + ventana]
        if len(trozo) < ventana:
            break
        esp = np.abs(np.fft.rfft(trozo * np.hanning(ventana))) + 1e-12
        fr = np.fft.rfftfreq(ventana, 1 / SR)
        e = esp ** 2
        graves += float(e[(fr < 250)].sum())
        medios += float(e[(fr >= 250) & (fr < 2000)].sum())
        agudos += float(e[fr >= 2000].sum())
        centroides.append(float((fr * e).sum() / e.sum()))
    total = graves + medios + agudos + 1e-12
    return {
        "graves": round(graves / total, 2),
        "medios": round(medios / total, 2),
        "agudos": round(agudos / total, 2),
        "centroide_hz": round(float(np.mean(centroides)) if centroides else 0.0, 0),
    }


def palabras(tempo_bpm: float, tono: dict, reg: dict, forma_: dict) -> list[str]:
    salida = []
    salida.append("slow" if tempo_bpm < 85 else ("medium" if tempo_bpm < 125 else "fast"))
    salida.append("bass-forward" if reg["graves"] > 0.55 else ("balanced" if reg["graves"] > 0.3 else "thin"))
    salida.append("bright" if reg["centroide_hz"] > 2200 else ("dark" if reg["centroide_hz"] < 1200 else "warm"))
    energias = [b["energia"] for b in forma_["bloques"]]
    if energias:
        salida.append("with contrast" if (max(energias) - min(energias)) > 0.35 else "uniform")
    if tono.get("tonica"):
        salida.append("in " + tono["tonica"] + " " + tono["modo"])
    else:
        salida.append("no clear key")
    return salida


def main(argv):
    if not argv:
        print(json.dumps({"ok": False, "error": "usage: analizar_referencia.py <url|path>"}))
        return 1
    origen = argv[0]
    try:
        if re.match(r"^https?://", origen):
            ruta = descargar(origen, os.path.join("_referencias"))
        else:
            ruta = origen
        if not os.path.exists(ruta):
            raise SystemExit(json.dumps({"ok": False, "error": f"does not exist: {ruta}"}))
        x = decodificar(ruta)
        ataques, fps = envolvente(x)
        bpm, confianza = tempo(ataques, fps)
        croma_ = croma(x)
        tono = tonalidad(croma_)
        forma_ = forma(x, bpm)
        reg = registros(x)
        print(
            json.dumps(
                {
                    "ok": True,
                    "origen": origen,
                    "fichero": ruta,
                    "duracion_s": round(len(x) / SR, 1),
                    "tempo_bpm": bpm,
                    "confianza_tempo": confianza,
                    "tonalidad": tono,
                    "compases": forma_["compases"],
                    "forma": forma_["bloques"],
                    "registros": reg,
                    "palabras": palabras(bpm, tono, reg, forma_),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
