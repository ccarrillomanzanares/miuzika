"""Mide una canción de referencia: tempo, tonalidad, forma y carácter.

    python codigo/analizar_referencia.py "<url de YouTube | ruta de un audio>"

Devuelve un JSON con lo que se puede medir de oído ajeno:

  tempo_bpm        pulsos por minuto (autocorrelación de la envolvente de energía)
  tonalidad        tónica y modo, por correlación del croma con perfiles mayores/menores
  duracion_s       segundos
  compases         compases estimados a 4/4
  forma[]          por bloques: compás inicial, compás final, energía relativa (0-1)
  registros        reparto de energía en graves / medios / agudos y centroide medio
  palabras         el carácter en palabras, derivado de las medidas

Lo que NO hace: sacar la melodía ni los acordes. Eso no sale de aquí; si el usuario
quiere tocar el tema, la melodía tiene que venir de otro sitio (MIDI o que la sepa
el agente de memoria).

Con una URL descarga el audio a `_referencias/` con yt-dlp y trabaja sobre el fichero.
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
    """Baja el audio de una URL a WAV mono. Devuelve la ruta."""
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
        raise SystemExit(json.dumps({"ok": False, "error": "la descarga no dejó ningún wav"}))
    return ficheros[-1]


def decodificar(ruta: str) -> np.ndarray:
    """Cualquier audio a mono 22050 Hz con ffmpeg (el que ya usa el proyecto)."""
    from shutil import which

    ffmpeg = which("ffmpeg") or "ffmpeg"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        salida = tmp.name
    proceso = subprocess.run(
        [ffmpeg, "-y", "-i", ruta, "-ac", "1", "-ar", str(SR), "-f", "wav", salida],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proceso.returncode != 0 or not os.path.exists(salida):
        raise SystemExit(json.dumps({"ok": False, "error": "ffmpeg no pudo decodificar: " + proceso.stderr[-300:]}))
    with wave.open(salida, "rb") as w:
        datos = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    os.unlink(salida)
    return datos


def envolvente(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Energía por trama (para el tempo) y su frecuencia de muestreo."""
    hop = 512
    tramas = len(x) // hop
    if tramas < 8:
        raise SystemExit(json.dumps({"ok": False, "error": "audio demasiado corto"}))
    trozos = x[: tramas * hop].reshape(tramas, hop)
    energia = np.sqrt((trozos ** 2).mean(axis=1) + 1e-12)
    # Derivada positiva: los ataques, no el volumen sostenido.
    ataques = np.maximum(0.0, np.diff(energia, prepend=energia[0]))
    return ataques, SR / hop


def tempo(ataques: np.ndarray, fps: float) -> tuple[float, float]:
    """BPM y confianza, con peine de armónicos y preferencia por 90-150.

    Coger el máximo de la autocorrelación a secas daba 132,5 BPM en un patrón de
    100 (medido): el pico más alto era un subdivisión. Se puntúa cada candidato
    sumando la autocorrelación en el pulso y en sus múltiplos, y se pondera con una
    curva alrededor de 120 BPM, que es donde está la mayoría de la música.
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
        # Preferencia logarítmica centrada en 120 BPM (desviación de una quinta).
        prior = float(np.exp(-0.5 * (np.log2(bpm / 120.0) / 0.6) ** 2))
        puntos *= prior
        if puntos > mejor_puntos:
            mejor_bpm, mejor_puntos = float(bpm), puntos
    return round(mejor_bpm, 1), round(float(mejor_puntos), 3)


PERFILES_MAYOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
PERFILES_MENOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTAS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def croma(x: np.ndarray) -> np.ndarray:
    """Energía por clase de altura, sumando tramas."""
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
    # Un patrón de batería no tiene altura: si el croma es plano, no hay tonalidad
    # que medir y decirlo es más útil que devolver una tónica inventada.
    plano = float(np.max(chroma) / (np.mean(chroma) + 1e-12))
    if plano < 1.6:
        return {"tonica": None, "modo": None, "correlacion": 0.0, "aviso": "sin contenido tonal (percusión o ruido)"}
    mejor = (-2.0, "C", "mayor")
    for i in range(12):
        for perfil, modo in ((PERFILES_MAYOR, "mayor"), (PERFILES_MENOR, "menor")):
            girado = np.roll(perfil, i)
            r = float(np.corrcoef(chroma, girado)[0, 1])
            if r > mejor[0]:
                mejor = (r, NOTAS[i], modo)
    salida = {"tonica": mejor[1], "modo": mejor[2], "correlacion": round(mejor[0], 3)}
    if mejor[0] < 0.65:
        salida["aviso"] = "tonalidad poco clara (poca armonía o mucha percusión)"
    return salida


def forma(x: np.ndarray, bpm: float) -> dict:
    """Energía por compás y bloques de 4 compases (la forma se oye ahí)."""
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
    """Reparto de energía graves/medios/agudos y brillo medio."""
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
    salida.append("lento" if tempo_bpm < 85 else ("medio" if tempo_bpm < 125 else "rápido"))
    salida.append("graves por delante" if reg["graves"] > 0.55 else ("equilibrado" if reg["graves"] > 0.3 else "fino"))
    salida.append("brillante" if reg["centroide_hz"] > 2200 else ("oscuro" if reg["centroide_hz"] < 1200 else "cálido"))
    energias = [b["energia"] for b in forma_["bloques"]]
    if energias:
        salida.append("con contraste" if (max(energias) - min(energias)) > 0.35 else "uniforme")
    if tono.get("tonica"):
        salida.append("en " + tono["tonica"] + " " + tono["modo"])
    else:
        salida.append("sin tonalidad clara")
    return salida


def main(argv):
    if not argv:
        print(json.dumps({"ok": False, "error": "uso: analizar_referencia.py <url|ruta>"}))
        return 1
    origen = argv[0]
    try:
        if re.match(r"^https?://", origen):
            ruta = descargar(origen, os.path.join("_referencias"))
        else:
            ruta = origen
        if not os.path.exists(ruta):
            raise SystemExit(json.dumps({"ok": False, "error": f"no existe: {ruta}"}))
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
