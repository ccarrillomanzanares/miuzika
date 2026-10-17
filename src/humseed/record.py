"""Captura de microfono -> WAV, con deteccion de silencio y de ritmo por teclado.

Uso:
    python -m humseed.record salida.wav --seconds 8      # duracion fija
    python -m humseed.record salida.wav --auto           # corta cuando hay silencio
    python -m humseed.record salida.wav --tap            # modo ritmo: golpea ENTER al pulso
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
BLOCK = 512


def pick_device(sd) -> int | None:
    """Devuelve el indice del microfono por defecto, o None si el sistema decide."""
    try:
        default_in = sd.default.device[0]
        if isinstance(default_in, int) and default_in >= 0:
            return default_in
    except Exception:
        pass
    return None


def record_fixed(sd, seconds: float) -> np.ndarray:
    frames: list[np.ndarray] = []
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=BLOCK) as stream:
        n_blocks = int(seconds * SR / BLOCK)
        for i in range(n_blocks):
            block, _ = stream.read(BLOCK)
            frames.append(block.copy())
            bars = int(30 * (i + 1) / n_blocks)
            sys.stderr.write("\r[" + "#" * bars + " " * (30 - bars) + f"] {seconds * (i + 1) / n_blocks:4.1f}s")
            sys.stderr.flush()
    sys.stderr.write("\r" + " " * 45 + "\r")
    return np.concatenate(frames, axis=0)[:, 0]


def record_auto(sd, max_seconds: float = 30.0, silence_after: float = 1.2, thresh: float = 0.02) -> np.ndarray:
    """Graba hasta que el usuario deja de sonar durante `silence_after` segundos."""
    frames: list[np.ndarray] = []
    started, silent_for, t0 = False, 0.0, time.time()
    block_s = BLOCK / SR
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=BLOCK) as stream:
        while time.time() - t0 < max_seconds:
            block, _ = stream.read(BLOCK)
            rms = float(np.sqrt(np.mean(block**2)))
            frames.append(block.copy())
            if rms > thresh:
                started, silent_for = True, 0.0
            elif started:
                silent_for += block_s
                if silent_for >= silence_after:
                    break
    return np.concatenate(frames, axis=0)[:, 0]


def record_tap(sd, max_seconds: float = 20.0) -> tuple[np.ndarray, list[float]]:
    """Graba audio y marca cada ENTER como un golpe ritmico (toca el pulso)."""
    import threading

    taps: list[float] = []
    stop = threading.Event()

    def listen():
        while not stop.is_set():
            try:
                line = sys.stdin.readline()
            except Exception:
                break
            if not line or line.strip().lower() in {"q", "quit", "fin"}:
                stop.set()
                break
            taps.append(time.time())

    th = threading.Thread(target=listen, daemon=True)
    th.start()
    t0 = time.time()
    print("Toca ENTER en cada golpe. Escribe 'q' + ENTER para terminar.", file=sys.stderr)
    frames: list[np.ndarray] = []
    with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=BLOCK) as stream:
        while not stop.is_set() and time.time() - t0 < max_seconds:
            block, _ = stream.read(BLOCK)
            frames.append(block.copy())
    rel = [round(t - t0, 4) for t in taps]
    return np.concatenate(frames, axis=0)[:, 0], rel


def main() -> None:
    ap = argparse.ArgumentParser(description="Graba tarareo/ritmo desde el microfono")
    ap.add_argument("out", help="ruta del WAV de salida")
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--auto", action="store_true", help="corta al detectar silencio")
    ap.add_argument("--tap", action="store_true", help="modo ritmo: ENTER por golpe")
    args = ap.parse_args()

    try:
        import sounddevice as sd
    except ImportError:
        print("Falta sounddevice. Instala: uv pip install sounddevice", file=sys.stderr)
        raise SystemExit(2)

    dev = pick_device(sd)
    if dev is not None:
        try:
            print(f"Microfono: {sd.query_devices(dev)['name']}", file=sys.stderr)
        except Exception:
            pass

    taps: list[float] = []
    if args.tap:
        audio, taps = record_tap(sd)
    elif args.auto:
        audio = record_auto(sd)
    else:
        audio = record_fixed(sd, args.seconds)

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.out, audio, SR)
    print(f"Guardado {args.out}  {audio.size/SR:.2f}s  pico={peak:.3f}")
    if taps:
        print("Taps (s):", taps)
    if peak < 0.01:
        print("Aviso: senal muy baja, sube el volumen del microfono.", file=sys.stderr)


if __name__ == "__main__":
    main()
