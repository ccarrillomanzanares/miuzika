"""Demucs on the Lambda GPU: separates a mix into stems (drums, bass, other, vocals; six with htdemucs_6s).

Built 8-Nov-2026 (the user: "adelante con demucs"): ACE-Step's extract failed on drums ("pegote con restos").
Same contract as generar_audio.py: cwd is the project folder, `--parametros <file>`, outputs under generado/.

Licence: MIT (code and pretrained models). Pinned: demucs 4.0.1 with torch/torchaudio 2.5.1 in its own venv,
because newer torchaudio needs torchcodec to save audio (seen 8-Nov with heartlib). Models download on first use.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import torch  # noqa: F401  (the server only powers the GPU on for scripts that import torch)

# Tied to DEMUCS_VERSION in src/modulos/demucs/receta.ts by a test.
VERSION = "4.0.1"
HOGAR = Path.home() / "generadores"
VENV = HOGAR / "demucs-venv"
MARCA = HOGAR / f".demucs-{VERSION}-ok"
MODELOS = {"htdemucs", "htdemucs_ft", "htdemucs_6s"}


def log(t):
    print(f"[separar_demucs] {t}", flush=True)


def sh(cmd, **kw):
    log("$ " + " ".join(map(str, cmd)))
    subprocess.run(list(map(str, cmd)), check=True, **kw)


def preparar():
    t0 = time.time()
    HOGAR.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        subprocess.run("curl -LsSf https://astral.sh/uv/install.sh | sh", shell=True, check=True)
    py = VENV / "bin" / "python"
    if not MARCA.exists():
        if not py.exists():
            sh([uv, "venv", "--quiet", "--python", "3.10", VENV])
        sh([uv, "pip", "install", "--quiet", "--python", py, f"demucs=={VERSION}", "torch==2.5.1", "torchaudio==2.5.1", "soundfile"])
        MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    return time.time() - t0


def main():
    ruta = sys.argv[sys.argv.index("--parametros") + 1]
    receta = json.loads(Path(ruta).read_text(encoding="utf-8"))
    p = receta["parametros"]
    if p["modelo"] not in MODELOS:
        sys.exit(f"unknown model {p['modelo']}: one of {', '.join(sorted(MODELOS))}")
    fuente = Path(p["audio"])
    if not fuente.exists():
        sys.exit(f"{fuente} does not exist")
    bootstrap_s = preparar()
    nombre = p["nombre"]
    Path("generado").mkdir(exist_ok=True)
    log(f"GPU: {torch.cuda.get_device_name(0)} · demucs {VERSION} · {p['modelo']} · shifts {p['shifts']}")
    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        sh([VENV / "bin" / "python", "-m", "demucs", "-n", p["modelo"], "--shifts", p["shifts"], "-d", "cuda",
            "-o", tmp, "--filename", "{stem}.{ext}", fuente])
        salidas = sorted(Path(tmp).rglob("*.wav"))
        ficheros = []
        for s in salidas:
            destino = Path("generado") / f"{nombre}-{s.stem}.wav"
            shutil.move(str(s), destino)
            ficheros.append(destino.name)
    separate_s = time.time() - t0
    if not ficheros:
        sys.exit("demucs wrote no stems")
    linaje = {
        "schema": "org.miuzika.lineage/0.1", "kind": "separated-audio", "task": "separate", "recipe": receta,
        "generator": {"name": "Demucs", "version": VERSION, "model": p["modelo"], "license": "MIT"},
        "inputs": {"audio": p["audio"]}, "outputs": [{"file": f} for f in ficheros],
        "bootstrap_s": round(bootstrap_s, 1), "separate_s": round(separate_s, 1),
        "gpu": torch.cuda.get_device_name(0), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    Path(f"generado/{nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False), encoding="utf-8")
    log("RESULT " + json.dumps({"files": ficheros, "separate_s": round(separate_s, 1), "bootstrap_s": round(bootstrap_s, 1)}))


if __name__ == "__main__":
    main()
