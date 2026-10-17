"""Tarareo/ritmo (microfono) -> semilla musical simbolica.

Convierte un audio de entrada (tarareo monofonico, percusion o tarareo+ritmo)
en un JSON compacto que el LLM de musica puede consumir como condicionamiento:
tempo, tonalidad, melodia cuantizada a MIDI y patron ritmico.

Depende solo de CPU: librosa (pyin + onsets) y numpy. Nada de GPU.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict, field
from pathlib import Path

import librosa
import numpy as np

SR = 22050  # sample rate de trabajo para analisis

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Perfiles de Krumhansl-Schmuckler para estimar tonalidad
MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


@dataclass
class Note:
    pitch: int  # MIDI
    name: str
    start: float  # segundos
    dur: float
    beat: float  # posicion en negras desde el inicio
    beat_dur: float  # duracion en negras


@dataclass
class Seed:
    source: str
    sr: int
    duration: float
    tempo_bpm: float
    key: str
    mode: str
    confidence_key: float
    notes: list[Note] = field(default_factory=list)
    pitch_contour: list[int] = field(default_factory=list)
    onset_beats: list[float] = field(default_factory=list)
    has_rhythm: bool = False
    register: str = "mid"

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("notes")
        d["notes"] = [asdict(n) for n in self.notes]
        return d


def load_audio(path: str | Path) -> np.ndarray:
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    if y.size == 0:
        raise ValueError(f"Audio vacio: {path}")
    # normalizar pico
    peak = float(np.max(np.abs(y)))
    if peak > 0:
        y = y / peak * 0.95
    return y.astype(np.float32)


def estimate_tempo(y: np.ndarray, sample_rate: int = SR) -> tuple[float, np.ndarray, np.ndarray]:
    onset_env = librosa.onset.onset_strength(y=y, sr=sample_rate, hop_length=512)
    tempo, beats = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sample_rate, hop_length=512
    )
    tempo = float(np.atleast_1d(tempo)[0])
    if not math.isfinite(tempo) or tempo <= 0:
        tempo = 100.0
    while tempo < 60:  # normalizar a rango musical
        tempo *= 2
    while tempo > 200:
        tempo /= 2
    beat_times = librosa.frames_to_time(beats, sr=sample_rate, hop_length=512)
    return tempo, onset_env, beat_times


def estimate_key(y: np.ndarray, sample_rate: int = SR) -> tuple[str, str, float]:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sample_rate).mean(axis=1)
    if chroma.sum() <= 0:
        return "C", "major", 0.0
    chroma = chroma / chroma.sum()
    best = ("C", "major", -np.inf)
    for shift in range(12):
        maj = float(np.dot(np.roll(MAJOR_PROFILE, shift), chroma))
        minr = float(np.dot(np.roll(MINOR_PROFILE, shift), chroma))
        for score, mode in ((maj, "major"), (minr, "minor")):
            if score > best[2]:
                best = (PITCH_NAMES[shift], mode, score)
    # normalizar la confianza de forma interpretable
    conf = float(np.clip((best[2] - np.mean(chroma)) * 4, 0.0, 1.0))
    return best[0], best[1], conf


def track_pitch(y: np.ndarray, sample_rate: int = SR) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Devuelve (tiempos, f0, voiced_flag) via pyin (robusto con tarareo)."""
    hop = 256
    f0, voiced, voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sample_rate,
        hop_length=hop,
        frame_length=2048,
        fill_na=np.nan,
    )
    times = librosa.times_like(f0, sr=sample_rate, hop_length=hop)
    return times, f0, voiced


def f0_to_notes(
    times: np.ndarray, f0: np.ndarray, voiced: np.ndarray, min_dur: float = 0.06
) -> list[dict]:
    """Segmenta la pista de f0 en notas discretas con mediana de pitch (anti-vibrato)."""
    notes: list[dict] = []
    cur: list[int] = []
    cur_t0: float | None = None

    def flush(end_t: float):
        nonlocal cur, cur_t0
        if cur and cur_t0 is not None and (end_t - cur_t0) >= min_dur:
            midi = int(round(float(np.median(cur))))
            notes.append({"pitch": midi, "start": float(cur_t0), "dur": float(end_t - cur_t0)})
        cur = []
        cur_t0 = None

    for i, t in enumerate(times):
        valid = voiced[i] and not math.isnan(f0[i])
        if valid:
            midi = int(round(librosa.hz_to_midi(float(f0[i]))))
            if cur and cur_t0 is not None:
                prev = int(round(float(np.median(cur))))
                # cortar nota si salta mas de 1 semitono sostenido
                if abs(midi - prev) >= 2:
                    flush(t)
            if cur_t0 is None:
                cur_t0 = float(t)
            cur.append(midi)
        else:
            flush(float(t))
    if len(times):
        flush(float(times[-1]))
    return notes


def quantize(notes: list[dict], tempo_bpm: float, grid: float = 0.25) -> list[Note]:
    """Cuantiza a rejilla de semicorchea (grid=0.25 negras) en negras."""
    sec_per_beat = 60.0 / tempo_bpm
    out: list[Note] = []
    for n in notes:
        beat = n["start"] / sec_per_beat
        dur_beats = n["dur"] / sec_per_beat
        q_beat = round(beat / grid) * grid
        q_dur = max(grid, round(dur_beats / grid) * grid)
        out.append(
            Note(
                pitch=n["pitch"],
                name=librosa.midi_to_note(n["pitch"]),
                start=round(q_beat * sec_per_beat, 4),
                dur=round(q_dur * sec_per_beat, 4),
                beat=round(q_beat, 4),
                beat_dur=round(q_dur, 4),
            )
        )
    return out


def contour_from_notes(notes: list[Note], bins: int = 16) -> list[int]:
    """Contorno melódico reducido: 16 bins con el pitch medio (0 = silencio)."""
    if not notes:
        return [0] * bins
    end = max(n.beat + n.beat_dur for n in notes) or 1.0
    buckets: list[list[int]] = [[] for _ in range(bins)]
    for n in notes:
        idx = min(bins - 1, int((n.beat + n.beat_dur / 2) / end * bins))
        buckets[idx].append(n.pitch)
    return [int(round(np.mean(b))) if b else 0 for b in buckets]


def analyse(path: str | Path) -> Seed:
    y = load_audio(path)
    duration = float(librosa.get_duration(y=y, sr=SR))
    tempo, onset_env, beat_times = estimate_tempo(y)
    key, mode, conf = estimate_key(y)
    times, f0, voiced = track_pitch(y)
    raw = f0_to_notes(times, f0, voiced)
    notes = quantize(raw, tempo)

    # ¿hay componente ritmica? densidad de onsets fuera del tarareo
    onsets = librosa.onset.onset_detect(y=y, sr=SR, hop_length=512, units="time")
    density = len(onsets) / max(duration, 1e-6)
    has_rhythm = bool(density > 1.5 and len(beat_times) >= 4)

    pitches = [n.pitch for n in notes]
    register = "low"
    if pitches:
        med = float(np.median(pitches))
        register = "low" if med < 55 else ("high" if med > 67 else "mid")

    return Seed(
        source=str(path),
        sr=SR,
        duration=round(duration, 3),
        tempo_bpm=round(float(tempo), 2),
        key=key,
        mode=mode,
        confidence_key=round(conf, 3),
        notes=notes,
        pitch_contour=contour_from_notes(notes),
        onset_beats=[round(float(t) / (60.0 / tempo), 3) for t in onsets[:64]],
        has_rhythm=has_rhythm,
        register=register,
    )


def seed_to_conditioning(seed: Seed) -> str:
    """Texto compacto para condicionar el LLM (una linea, tokens baratos)."""
    contour = " ".join(str(c) for c in seed.pitch_contour)
    notes = " ".join(f"{n.name}:{n.beat:g}:{n.beat_dur:g}" for n in seed.notes[:48])
    rhythm = " ".join(f"{b:g}" for b in seed.onset_beats[:24])
    return (
        f"<seed> key={seed.key} mode={seed.mode} tempo={seed.tempo_bpm:g} "
        f"register={seed.register} contour=[{contour}] rhythm=[{rhythm}] "
        f"notes=[{notes}] </seed>"
    )


def melodia_a_abc(seed: "Seed", titulo: str = "transcripcion",
                  programa: int = 52) -> str:
    """Convierte las notas de la semilla en ABC monofonico, listo para renderizar.

    Es la parte que el usuario valida: NO anade nada, solo escribe lo que pyin
    detecto. El programa 52 de General MIDI es 'Choir Aahs' (coro): suena a voz,
    asi que se puede comparar de oido con el tarareo original.

    Reutiliza corpus.notes_to_voice, que ya alinea compases y resuelve
    solapamientos; reimplementarlo aqui fue un error que produjo barras mal
    puestas y hacia fallar al renderizador.
    """
    from humseed import corpus

    # SIN cuantizar y SIN barras de compas: es exactamente como se genero la
    # transcripcion que el usuario valido. Cuantizar a rejilla cambiaba alguna
    # duracion (0.25 -> 0.125 en la primera nota) y las barras hacian que
    # music21 reventara al escribir el MIDI.
    lineas: list[str] = []
    pos = 0.0
    for n in seed.notes:
        if n.beat > pos + 0.01:
            lineas.append("z" + corpus.dur_to_abc(n.beat - pos))
        lineas.append(corpus.midi_to_abc_name(n.pitch) + corpus.dur_to_abc(n.beat_dur))
        pos = n.beat + n.beat_dur
    cuerpo = " ".join(lineas)

    clave = seed.key + ("m" if seed.mode == "minor" else "")
    return (
        "X:1\n"
        f"T:{titulo}\n"
        "M:4/4\n"
        "L:1/16\n"
        f"Q:1/4={int(round(seed.tempo_bpm))}\n"
        f"K:{clave}\n"
        f'V:1 name="Tarareo" clef=treble program={programa}\n'
        f"[V:1] {cuerpo}\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Tarareo -> semilla musical (JSON)")
    ap.add_argument("audio", help="wav/mp3/flac de entrada")
    ap.add_argument("-o", "--out", help="ruta del JSON de salida")
    ap.add_argument("--conditioning", action="store_true", help="imprime la linea de condicionamiento")
    args = ap.parse_args()

    seed = analyse(args.audio)
    payload = json.dumps(seed.to_dict(), indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"escrito {args.out}")
    if args.conditioning:
        print(seed_to_conditioning(seed))
    elif not args.out:
        print(payload)


if __name__ == "__main__":
    main()
