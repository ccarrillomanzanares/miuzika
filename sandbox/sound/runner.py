#!/usr/bin/env python3
"""Runner de scripts de sonido dentro de un contenedor sin red ni escritura.

Entrada (stdin, JSON):
  {"code": "...", "sampleRate": 48000, "duration": 2.4, "params": {}, "seed": 1}

El script debe definir:
  def render(sr, duration, params, seed):
      return array  # (frames,) o (frames, 2), float

Salida (stdout, JSON): WAV en base64 + métricas.
"""

import ast
import base64
import contextlib
import io
import json
import math
import sys
import wave

import numpy as np

MAX_CODE = 50_000
MAX_FRAMES = 32 * 48_000
ALLOWED_IMPORTS = {"numpy", "math", "random"}
FORBIDDEN_NAMES = {
    "__builtins__",
    "__import__",
    "breakpoint",
    "builtins",
    "compile",
    "ctypes",
    "delattr",
    "eval",
    "exec",
    "exit",
    "getattr",
    "globals",
    "importlib",
    "input",
    "locals",
    "marshal",
    "open",
    "pickle",
    "quit",
    "setattr",
    "subprocess",
    "sys",
    "vars",
}


class ScriptError(Exception):
    pass


def validate(code: str) -> ast.Module:
    if len(code) > MAX_CODE:
        raise ScriptError(f"El script supera {MAX_CODE} caracteres")
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        raise ScriptError(f"Sintaxis Python inválida: {error}") from error

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_IMPORTS:
                    raise ScriptError(f"Import no permitido: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in ALLOWED_IMPORTS:
                raise ScriptError(f"Import no permitido: {node.module}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise ScriptError(f"Nombre no permitido: {node.id}")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ScriptError("Acceso a atributos internos no permitido")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise ScriptError(f"Llamada no permitida: {node.func.id}")

    functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
    if "render" not in functions:
        raise ScriptError("El script debe definir render(sr, duration, params, seed)")
    return tree


def run(code: str, sample_rate: int, duration: float, params: dict, seed: int):
    if not (0.05 <= duration <= 32):
        raise ScriptError("Duración fuera de rango (0.05–32 s)")
    if sample_rate not in (44_100, 48_000):
        raise ScriptError("sampleRate debe ser 44100 o 48000")

    tree = validate(code)
    scope: dict = {}
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        exec(compile(tree, "<sound>", "exec"), scope, scope)
        render = scope.get("render")
        if not callable(render):
            raise ScriptError("render no es invocable")
        data = render(sample_rate, duration, params or {}, seed)

    audio = np.asarray(data, dtype=np.float64)
    if audio.ndim == 1:
        audio = np.repeat(audio[:, None], 2, axis=1)
    if audio.ndim != 2:
        raise ScriptError(f"render debe devolver 1D o 2D; llegó {audio.shape}")
    if audio.shape[0] < audio.shape[1] and audio.shape[0] == 2:
        audio = audio.T
    if audio.shape[1] != 2:
        raise ScriptError(f"render debe devolver mono o estéreo; llegó {audio.shape}")
    max_frames = min(MAX_FRAMES, int(math.ceil(duration * sample_rate)) + 1)
    if audio.shape[0] > max_frames:
        raise ScriptError(f"render devuelve {audio.shape[0]} frames; máximo {max_frames}")
    if audio.shape[0] < 1:
        raise ScriptError("render devolvió una señal vacía")
    if not np.isfinite(audio).all():
        raise ScriptError("render contiene NaN o infinito")

    peak = float(np.max(np.abs(audio)))
    if peak < 1e-8:
        raise ScriptError("render devolvió silencio")
    # Nivel común de -1 dBFS; no altera el balance estéreo.
    audio = audio * (10 ** (-1 / 20) / peak)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = np.round(audio * 32_767).astype("<i2")

    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())

    rms = float(np.sqrt(np.mean(audio**2)))
    return {
        "wav": base64.b64encode(output.getvalue()).decode("ascii"),
        "duration": audio.shape[0] / sample_rate,
        "sampleRate": sample_rate,
        "channels": 2,
        "frames": int(audio.shape[0]),
        "peakDbfs": 20 * math.log10(float(np.max(np.abs(audio)))),
        "rmsDbfs": 20 * math.log10(max(rms, 1e-12)),
    }


def main():
    try:
        raw = sys.stdin.buffer.read(1_000_000)
        request = json.loads(raw.decode("utf-8"))
        code = str(request.get("code", ""))
        sample_rate = int(request.get("sampleRate", 48_000))
        duration = float(request.get("duration", 2.0))
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        seed = int(request.get("seed", 1))
        result = run(code, sample_rate, duration, params, seed)
        sys.stdout.write(json.dumps({"ok": True, **result}))
    except Exception as error:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
