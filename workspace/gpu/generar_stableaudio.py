"""Stable Audio 3 on the Lambda GPU: text to audio, audio to audio, repaint a region, continue a clip.

Built 8-Nov-2026 after Carlos heard the trial: an instrumental song at cfg 1 "es super industrial... wow!!!".
Same contract as generar_audio.py: cwd is the project folder, `--parametros <file>`, outputs under generado/.

Licence: code MIT; weights under the Stability AI Community License (outputs owned by the user; commercial use free
under US$1M annual revenue, with registration). The weights are gated: the server writes the Hugging Face token to
~/.cache/huggingface/token before running this (server/api/gpu.ts, SCRIPTS_CON_HF); it never travels in the recipe.

Install (first run on an instance, measured 8-Nov: ~13 s beyond the boot, ~10 GB of weights on first use): the repo
pinned to COMMIT, `uv sync`, and a prebuilt Flash Attention 2 wheel (medium "outputs static" without it, says its README).
"""

import json
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch  # noqa: F401  (the server only powers the GPU on for scripts that import torch)

# Tied to SA3_COMMIT in src/modulos/stableaudio/receta.ts by a test.
COMMIT = "790793b"
REPO_URL = "https://github.com/Stability-AI/stable-audio-3.git"
FLASH = ("https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.16/"
         "flash_attn-2.6.3+cu126torch2.7-cp310-cp310-linux_x86_64.whl")
HOGAR = Path.home() / "generadores"
REPO = HOGAR / "stable-audio-3"
MARCA = HOGAR / f".stableaudio-{COMMIT}-ok"
TOKEN = Path.home() / ".cache" / "huggingface" / "token"
DENTRO = "MIUZIKA_STABLEAUDIO_DENTRO"
LICENCIA = "Stability AI Community License (weights; outputs owned by the user); code MIT; text encoder under Gemma Terms"


def log(t):
    print(f"[generar_stableaudio] {t}", flush=True)


def sh(cmd, **kw):
    log("$ " + " ".join(map(str, cmd)))
    subprocess.run(list(map(str, cmd)), check=True, **kw)


def preparar():
    t0 = time.time()
    HOGAR.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        subprocess.run("curl -LsSf https://astral.sh/uv/install.sh | sh", shell=True, check=True)
    if not MARCA.exists():
        if not (REPO / ".git").exists():
            sh(["git", "clone", "--quiet", REPO_URL, REPO])
        sh(["git", "-C", REPO, "fetch", "--quiet", "origin"])
        sh(["git", "-C", REPO, "checkout", "--quiet", "--force", COMMIT])
        sh([uv, "sync", "--quiet", "--inexact"], cwd=REPO)
        sh([uv, "pip", "install", "--quiet", "--python", REPO / ".venv" / "bin" / "python", FLASH], cwd=REPO)
        MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    return time.time() - t0


def cargar(ruta):
    import torchaudio
    onda, sr = torchaudio.load(ruta)
    return (sr, onda)


def generar(receta, bootstrap_s):
    import torchaudio
    from stable_audio_3 import StableAudioModel

    p = receta["parametros"]
    nombre = p["nombre"]
    # A random seed is drawn here and passed fixed, so the lineage records the one used (ACE-Step's bug 20).
    semilla = int(p["semilla"]) if int(p["semilla"]) >= 0 else random.randint(0, 2**31 - 1)
    t0 = time.time()
    model = StableAudioModel.from_pretrained(p["modelo"])
    carga_s = time.time() - t0
    tomas = int(p["tomas"])
    # One prompt per take when the window sent variations (model.py broadcasts or takes a list of batch_size).
    prompts = p.get("prompts")
    if prompts is not None and len(prompts) != tomas:
        sys.exit(f"{len(prompts)} prompts for {tomas} takes")
    args = dict(prompt=prompts if prompts else p["prompt"], duration=float(p["duracion"]), steps=int(p["steps"]),
                cfg_scale=float(p["cfg"]), seed=semilla, batch_size=tomas)
    if p.get("negativo"):
        args["negative_prompt"] = p["negativo"]
    if "apg" in p:
        args["apg_scale"] = float(p["apg"])
    if p.get("sampler"):
        args["sampler_type"] = p["sampler"]  # goes through **sampler_kwargs; only -base models have more than one
    tarea = p["tarea"]
    if tarea == "audio":
        args["init_audio"] = cargar(p["audio"])
        args["init_noise_level"] = float(p["ruido"])
    elif tarea in ("repintar", "continuar"):
        args["inpaint_audio"] = cargar(p["audio"])
        # Several regions in one pass go as lists (inference.md); recipes from before 9-Nov have desde/hasta.
        regiones = p.get("regiones") or [[p["desde"], p["hasta"]]]
        args["inpaint_mask_start_seconds"] = [float(a) for a, _ in regiones]
        args["inpaint_mask_end_seconds"] = [float(b) for _, b in regiones]
    log(f"GPU: {torch.cuda.get_device_name(0)} · {p['modelo']} · {tarea} · seed {semilla} · model ready in {carga_s:.1f} s")
    torch.cuda.reset_peak_memory_stats()
    t1 = time.time()
    with torch.no_grad():
        audio = model.generate(**args)
    generate_s = time.time() - t1
    sr = model.model.sample_rate
    Path("generado").mkdir(exist_ok=True)
    ficheros = []
    for i in range(audio.shape[0]):
        f = f"generado/{nombre}.wav" if audio.shape[0] == 1 else f"generado/{nombre}-{i + 1}.wav"
        torchaudio.save(f, audio[i].float().cpu(), sr)
        ficheros.append(Path(f).name)
    vram = torch.cuda.max_memory_allocated() / 1e9
    linaje = {
        "schema": "org.miuzika.lineage/0.1", "kind": "generated-audio", "task": tarea, "recipe": receta,
        "generator": {"name": "Stable Audio 3", "model": p["modelo"], "repo": REPO_URL, "commit": COMMIT, "license": LICENCIA},
        "inputs": {"audio": p.get("audio")},
        "outputs": [{"file": f, "seed": semilla, "batch_index": i, "prompt": prompts[i] if prompts else p["prompt"]} for i, f in enumerate(ficheros)],
        "sample_rate": sr, "bootstrap_s": round(bootstrap_s, 1), "load_s": round(carga_s, 1), "generate_s": round(generate_s, 1),
        "vram_peak_gb": round(vram, 2), "gpu": torch.cuda.get_device_name(0), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    Path(f"generado/{nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False), encoding="utf-8")
    log("RESULT " + json.dumps({"files": ficheros, "seed": semilla, "generate_s": round(generate_s, 1), "load_s": round(carga_s, 1), "vram_peak_gb": round(vram, 2)}))


def main():
    receta = json.loads(Path(sys.argv[sys.argv.index("--parametros") + 1]).read_text(encoding="utf-8"))
    if os.environ.get(DENTRO) != "1":
        p = receta["parametros"]
        if p.get("audio") and not Path(p["audio"]).exists():
            sys.exit(f"audio {p['audio']} does not exist in {os.getcwd()}")
        if not TOKEN.exists():
            sys.exit("no Hugging Face token on the instance: save one in Settings")
        b = preparar()
        py = str(REPO / ".venv" / "bin" / "python")
        env = dict(os.environ, **{DENTRO: "1", "MIUZIKA_BOOTSTRAP_S": f"{b:.1f}"})
        log("re-executing inside the Stable Audio 3 environment")
        os.execve(py, [py, os.path.abspath(__file__), *sys.argv[1:]], env)
    generar(receta, float(os.environ.get("MIUZIKA_BOOTSTRAP_S", "0")))


if __name__ == "__main__":
    main()
