"""Audio to MIDI notes with Basic Pitch (spotify/basic-pitch 0.4.0, Apache 2.0), on the CPU. "To MIDI" in the app.

8-Nov-2026: on Stable Audio's distorted takes Carlos heard "no valen nada"; on Demucs stems of a real song (Ghosts Again):
"está lejos de ser perfecta pero puede ayudar a componer". Measured there: the bass came out with the right pitch classes
(as pyin) but often doubled an octave up (polyphony median 2 on a one-note line), so "bass" keeps the lowest note.

Runs inside its own venv (.miuzika/basic-pitch, made by server/api/transcribir.ts) with the bundled ONNX model.
Usage: python -I transcribir.py <parameters.json>
  {"audio": abs path, "desde": s, "duracion": s|null, "bpm": n, "tipo": "bajo|melodia|acordes|otro",
   "sensibilidad": "baja|media|alta", "minimo_ms": n, "rejilla": 0|0.5|0.25, "programa": n, "salida_mid": abs path}
Prints one JSON line: {"notas": [{pitch, start, duration, velocity} in beats from the region's start], "resumen": {...}}.
"""

import json
import os
import sys
import tempfile
import time

# Thresholds: Basic Pitch's defaults are onset 0.5, frame 0.3. On 8-Nov 0.3/0.2 still read sense, 0.2/0.1 gave junk.
SENSIBILIDAD = {"baja": (0.6, 0.4), "media": (0.5, 0.3), "alta": (0.4, 0.25)}
# Frequency range per kind (Hz). A bass between 30 and 400 Hz; a voice or lead up to 2 kHz.
RANGO = {"bajo": (30, 400), "melodia": (80, 2000), "acordes": (40, None), "otro": (None, None)}


def una_linea(notas, criterio):
    """Of notes that overlap keep one: the lowest (bass) or the strongest (melody); the kept one cuts the previous."""
    notas = sorted(notas, key=lambda n: (n[0], n[2]))
    salida = []
    for n in notas:
        activas = [m for m in salida if m[0] <= n[0] < m[1]]
        gana = None
        for m in activas:
            if criterio == "grave" and m[2] < n[2]:
                gana = m
            if criterio == "fuerte" and m[3] >= n[3]:
                gana = m
        if gana is not None:
            continue
        for m in activas:
            m[1] = n[0]
        salida.append(n)
    return [n for n in salida if n[1] - n[0] > 0.03]


def main():
    p = json.loads(open(sys.argv[1], encoding="utf-8").read())
    import numpy as np
    import soundfile as sf
    import librosa
    import pretty_midi
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    t0 = time.time()
    # Only the part of the file the clip plays.
    y, sr = librosa.load(p["audio"], sr=None, mono=True, offset=float(p.get("desde") or 0), duration=p.get("duracion"))
    if len(y) == 0 or float(np.max(np.abs(y))) < 1e-3:
        print(json.dumps({"error": "the clip is silent: there is nothing to transcribe"}))
        return
    temporal = os.path.join(tempfile.mkdtemp(), "region.wav")
    sf.write(temporal, y, sr)
    onset, frame = SENSIBILIDAD.get(p.get("sensibilidad", "media"), SENSIBILIDAD["media"])
    fmin, fmax = RANGO.get(p["tipo"], (None, None))
    _, _, eventos = predict(temporal, Model(ICASSP_2022_MODEL_PATH), onset_threshold=onset, frame_threshold=frame,
                            minimum_note_length=float(p.get("minimo_ms") or 127.7), minimum_frequency=fmin,
                            maximum_frequency=fmax, melodia_trick=True)
    crudas = len(eventos)
    notas = [[float(e[0]), float(e[1]), int(e[2]), float(e[3])] for e in eventos]
    if p["tipo"] == "bajo":
        notas = una_linea(notas, "grave")
    elif p["tipo"] == "melodia":
        notas = una_linea(notas, "fuerte")
    bpm = float(p["bpm"])
    rejilla = float(p.get("rejilla") or 0)
    salida = []
    for ini, fin, alt, amp in sorted(notas):
        a, b = ini * bpm / 60, fin * bpm / 60
        if rejilla:
            a = round(a / rejilla) * rejilla
            b = max(a + rejilla, round(b / rejilla) * rejilla)
        salida.append({"pitch": alt, "start": round(a, 4), "duration": round(max(b - a, 0.05), 4),
                       "velocity": int(min(127, max(30, round(amp * 127))))})
    # Quantizing can stack two notes of the same pitch on one step: keep the first.
    vistas, unicas = set(), []
    for n in salida:
        clave = (n["pitch"], n["start"])
        if clave not in vistas:
            vistas.add(clave)
            unicas.append(n)
    salida = unicas
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=int(p.get("programa", 0)), name=p.get("nombre", "transcription"))
    for n in salida:
        inst.notes.append(pretty_midi.Note(velocity=n["velocity"], pitch=n["pitch"], start=n["start"] * 60 / bpm,
                                           end=(n["start"] + n["duration"]) * 60 / bpm))
    pm.instruments.append(inst)
    os.makedirs(os.path.dirname(p["salida_mid"]), exist_ok=True)
    pm.write(p["salida_mid"])
    alturas = [n["pitch"] for n in salida]
    segundos = len(y) / sr
    resumen = {"notas": len(salida), "crudas": crudas, "segundos": round(segundos, 1), "por_segundo": round(len(salida) / max(segundos, 1), 1),
               "grave": min(alturas) if alturas else None, "agudo": max(alturas) if alturas else None, "s": round(time.time() - t0, 1)}
    print(json.dumps({"notas": salida, "resumen": resumen}))


if __name__ == "__main__":
    main()
