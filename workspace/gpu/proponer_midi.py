"""Propose MIDI material from text with MIDI-LLM, on the Lambda GPU.

Approved by Carlos on 2-Nov-2026 (point 3 of docs/PLAN-MODELOS-MUSICA.md): a symbolic
model fits miuzika better than any audio model for *material*, because the agent composes
in notes. MIDI-LLM = Llama 3.2 1B with the Anticipatory Music Transformer vocabulary
added (multitrack text-to-MIDI; ISMIR '26). Licence: Llama 3.2 Community (LEGAL.md §6).

Same contract as `generar_audio.py`: cwd is the project folder on the instance, outputs
go under it (`propuestas/<name>-<k>.mid` + `<name>.lineage.json`) and the server brings
them back. The agent then reads the .mid with its usual tools and decides what to keep.

First run per instance: clones the official repo and builds a uv environment with
Python 3.11, torch, transformers and `anticipation` (the MIDI tokenizer). The pinned
requirements.txt of the repo drags vllm + ray (~170 packages); the transformers path
only needs a handful, so that is what we install (measured in `bootstrap_s`).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch  # noqa: F401  (the server only powers the GPU on for scripts that import torch)

REPO_URL = "https://github.com/slSeanWU/MIDI-LLM.git"
MODELO = "slseanwu/MIDI-LLM_Llama-3.2-1B"
HOGAR = Path.home() / "generadores"
REPO = HOGAR / "MIDI-LLM"
VENV = REPO / ".venv"
MARCA = REPO / ".miuzika-sync-ok-cu128"
DENTRO = "MIUZIKA_PROPONER_DENTRO"


def _log(texto):
    print(f"[proponer_midi] {texto}", flush=True)


def _sh(cmd, **kw):
    _log("$ " + (" ".join(cmd) if isinstance(cmd, list) else cmd))
    return subprocess.run(cmd, check=True, shell=isinstance(cmd, str), **kw)


def _uv():
    return shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")


def preparar_entorno():
    if MARCA.exists():
        return 0.0
    t0 = time.time()
    HOGAR.mkdir(parents=True, exist_ok=True)
    if not Path(_uv()).exists():
        _sh("curl -LsSf https://astral.sh/uv/install.sh | sh")
    if not REPO.exists():
        _sh(["git", "clone", "--depth", "1", REPO_URL, str(REPO)])
    # A half-built venv from an earlier failed run makes `uv venv` exit 2 (seen 2-Nov):
    # start clean every time the marker is missing.
    shutil.rmtree(VENV, ignore_errors=True)
    _sh([_uv(), "venv", "--clear", "--python", "3.11", str(VENV)])
    # torch from the cu128 index: the Lambda driver reports CUDA 12.8 and PyPI's default
    # wheel (built for a newer CUDA) failed with "NVIDIA driver too old" on 2-Nov-2026.
    _sh([_uv(), "pip", "install", "--python", str(VENV / "bin" / "python"),
         "--index-url", "https://download.pytorch.org/whl/cu128", "torch"])
    _sh([_uv(), "pip", "install", "--python", str(VENV / "bin" / "python"),
         "transformers", "accelerate", "mido", "numpy", "safetensors", "sentencepiece",
         "git+https://github.com/jthickstun/anticipation.git"])
    MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    return time.time() - t0


def reejecutar_dentro(bootstrap_s):
    env = dict(os.environ)
    env[DENTRO] = "1"
    env["MIUZIKA_BOOTSTRAP_S"] = f"{bootstrap_s:.1f}"
    python = str(VENV / "bin" / "python")
    os.execve(python, [python, os.path.abspath(__file__), *sys.argv[1:]], env)


def commit_del_repo():
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def poner_tempo(ruta, bpm):
    """Stamp the project tempo on a .mid, leaving every tick where it is.

    MIDI-LLM writes no set_tempo (so readers assume 120) at 50 ticks per beat. The notes
    are meant in beats, so a 125 BPM project should read them at 125: on 2-Nov the 120-vs-125
    mismatch made anadir_pistas warn and the agent re-timed the material by hand.
    """
    import mido

    midi = mido.MidiFile(str(ruta))
    for pista in midi.tracks:
        for i in [i for i, m in enumerate(pista) if m.type == "set_tempo"][::-1]:
            # Keep the delta of a removed event on the next one, so nothing moves.
            if i + 1 < len(pista):
                pista[i + 1].time += pista[i].time
            del pista[i]
    midi.tracks[0].insert(0, mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    midi.save(str(ruta))


def proponer(args):
    import torch

    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    temporal = salida / ".midi-llm-tmp"
    shutil.rmtree(temporal, ignore_errors=True)
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    _log(f"GPU: {gpu}")

    t0 = time.time()
    # The repo's own script does the tokenizing, sampling and AMT decoding; we only
    # drive it, so a change upstream does not silently diverge from what we measured.
    cmd = [sys.executable, "generate_transformers.py", "--model", MODELO,
           "--prompt", args.prompt, "--n_outputs", str(args.variantes),
           "--temperature", str(args.temperatura), "--top_p", str(args.top_p),
           "--max_tokens", str(args.max_tokens), "--output_root", str(temporal.resolve()),
           "--no-synthesize"]
    _sh(cmd, cwd=str(REPO))
    generar_s = round(time.time() - t0, 1)

    mids = sorted(temporal.rglob("gen_*.mid"))
    if not mids:
        _log("FAILED: the script produced no .mid")
        sys.exit(2)
    ficheros = []
    for k, mid in enumerate(mids, 1):
        destino = salida / f"{args.nombre}-{k}.mid"
        shutil.move(str(mid), str(destino))
        if args.bpm:
            poner_tempo(destino, args.bpm)
        ficheros.append(destino.name)
    stats = next(temporal.rglob("generation_stats.json"), None)
    estadisticas = json.loads(stats.read_text()) if stats else {}
    shutil.rmtree(temporal, ignore_errors=True)

    linaje = {
        "schema": "org.miuzika.lineage/0.1",
        "kind": "generated-midi",
        "generator": {"name": "MIDI-LLM", "model": MODELO, "license": "Llama 3.2 Community License",
                      "repo": REPO_URL, "commit": commit_del_repo(), "backend": "transformers"},
        "inputs": {"prompt": args.prompt, "bpm": args.bpm, "temperature": args.temperatura, "top_p": args.top_p,
                   "max_tokens": args.max_tokens, "n_outputs": args.variantes},
        "outputs": ficheros,
        "hardware": {"gpu": gpu},
        "timings": {"bootstrap_s": float(os.environ.get("MIUZIKA_BOOTSTRAP_S", "0")),
                    "generate_s_including_model_load": generar_s},
        "upstream_stats": estadisticas,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (salida / f"{args.nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False))
    _log("RESULT " + json.dumps({"files": ficheros, "generate_s": generar_s}))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--prompt", required=True, help="Description: style, instruments, tempo, key, mood")
    ap.add_argument("--variantes", type=int, default=4, help="How many MIDI proposals")
    ap.add_argument("--temperatura", type=float, default=1.0)
    ap.add_argument("--top_p", type=float, default=0.98)
    ap.add_argument("--max_tokens", type=int, default=2046)
    ap.add_argument("--nombre", default="propuesta")
    ap.add_argument("--bpm", type=float, default=None, help="Project tempo stamped on the .mid (ticks unchanged)")
    ap.add_argument("--salida", default="propuestas", help="Output folder, relative to the project")
    args = ap.parse_args()
    if os.environ.get(DENTRO) != "1":
        segundos = preparar_entorno()
        if segundos:
            _log(f"environment ready in {segundos:.0f} s")
        reejecutar_dentro(segundos)
    proponer(args)


if __name__ == "__main__":
    main()
