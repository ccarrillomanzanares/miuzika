"""MuLaCover on the Lambda GPU: a cover from reference audio, or from melody/chord MIDI, with new lyrics and style.

Built 8-Nov-2026 from the trial that Carlos heard ("el cover está bien, con la letra y todo, es más pop").
Same contract as generar_audio.py: cwd is the project folder, `--parametros <file>` holds the recipe written
by the browser, and everything written under generado/ comes back.

Licence: code Apache-2.0, **weights and outputs CC BY-NC 4.0** (MuLaCover's LICENSING.md). The lineage records it.

Install (first run on an instance, ~1 min on 8-Nov): MuLaCover pinned to COMMIT in its own venv (Python 3.10, uv),
the default PyPI torch (its guide asks for the cu130 index; the default build ran on the A10), and `pyarrow<18`:
torchtune 0.4.0 pulls an old `datasets` that uses pa.PyExtensionType, gone from current pyarrow (8-Nov, heartlib).
Models (~16 GB): MuLaCover, Qwen3-Embedding-0.6B, HeartCodec-oss-20260123, YourMT3 and five ChordNet folds.
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

# Tied to MULACOVER_COMMIT in src/modulos/mulacover/receta.ts by a test.
COMMIT = "e27fa7f"
REPO_URL = "https://github.com/HeartMuLa/MuLaCover.git"
HOGAR = Path.home() / "generadores"
REPO = HOGAR / "MuLaCover"
VENV = HOGAR / "mulacover-venv"
CKPT = HOGAR / "mulacover-ckpt"
MARCA = HOGAR / f".mulacover-{COMMIT}-ok"
YOURMT3 = ("https://huggingface.co/spaces/mimbres/YourMT3/resolve/main/amt/logs/2024/"
           "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops/checkpoints/last.ckpt")
CHORD = ("https://raw.githubusercontent.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition/master/cache_data/"
         "joint_chord_net_ismir_naive_v1.0_reweight(0.0,10.0)_s{}.best.sdict")
LICENCIA = "CC-BY-NC-4.0 (MuLaCover weights and outputs; code Apache-2.0)"


def log(t):
    print(f"[generar_mulacover] {t}", flush=True)


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
        if shutil.which("ffmpeg") is None:
            sh(["sudo", "apt-get", "install", "-y", "-qq", "ffmpeg", "libsndfile1"])
        if not (REPO / ".git").exists():
            sh(["git", "clone", "--quiet", REPO_URL, REPO])
        sh(["git", "-C", REPO, "fetch", "--quiet", "origin"])
        sh(["git", "-C", REPO, "checkout", "--quiet", "--force", COMMIT])
        if not py.exists():
            sh([uv, "venv", "--quiet", "--python", "3.10", VENV])
        sh([uv, "pip", "install", "--quiet", "--python", py, "-e", f"{REPO}[audio]", "huggingface_hub", "pyarrow<18"])
        MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    for repo, destino in [("HeartMuLa/MuLaCover", CKPT / "MuLaCover"), ("Qwen/Qwen3-Embedding-0.6B", CKPT / "Qwen3-Embedding-0.6B"),
                          ("HeartMuLa/HeartCodec-oss-20260123", CKPT / "HeartCodec-oss")]:
        hecho = destino / ".ok"
        if not hecho.exists():
            sh([py, "-c", f"from huggingface_hub import snapshot_download; snapshot_download({repo!r}, local_dir={str(destino)!r})"])
            hecho.write_text("ok")
    st = CKPT / "SymbolicTranscriptor"
    (st / "yourmt3").mkdir(parents=True, exist_ok=True)
    (st / "chord").mkdir(parents=True, exist_ok=True)
    if not (st / "yourmt3" / "last.ckpt").exists():
        sh(["curl", "-fsSL", YOURMT3, "-o", st / "yourmt3" / "last.ckpt"])
    for fold in range(5):
        url = CHORD.format(fold)
        destino = st / "chord" / url.rsplit("/", 1)[1]
        if not destino.exists():
            sh(["curl", "-fsSL", url, "-o", destino])
    return time.time() - t0


def main():
    ruta = sys.argv[sys.argv.index("--parametros") + 1]
    receta = json.loads(Path(ruta).read_text(encoding="utf-8"))
    p = receta["parametros"]
    for clave in ("audio", "melodia", "acordes", "bateria"):
        if p.get(clave) and not Path(p[clave]).exists():
            sys.exit(f"{clave} {p[clave]} does not exist in {os.getcwd()}")
    bootstrap_s = preparar()
    py = str(VENV / "bin" / "python")
    # A random seed is drawn here and passed fixed, so the lineage records the one used (ACE-Step's bug 20).
    semilla = int(p["semilla"]) if int(p["semilla"]) >= 0 else random.randint(0, 2**31 - 1)
    nombre = p["nombre"]
    Path("generado").mkdir(exist_ok=True)
    Path("entrada").mkdir(exist_ok=True)
    # Files, not the command line: the text must cross ssh and bash untouched.
    Path(f"entrada/{nombre}.letra.txt").write_text(p["letra"], encoding="utf-8")
    Path(f"entrada/{nombre}.estilo.txt").write_text(p["estilo"], encoding="utf-8")
    wav = f"generado/{nombre}.wav"
    cmd = [py, REPO / "examples" / "run_cover_song_generation.py", "--model_path", CKPT,
           "--lyrics", f"entrada/{nombre}.letra.txt", "--tags", f"entrada/{nombre}.estilo.txt", "--save_path", wav,
           "--device", "cuda:0", "--seed", semilla, "--temperature", p["temperatura"], "--topk", p["topk"],
           "--cfg_scale", p["cfg"], "--disable_progress"]
    carpeta_midi = None
    if p["tipo"] == "audio":
        carpeta_midi = f"generado/{nombre}-midi"
        cmd += ["--ref_audio", p["audio"], "--symbolic_save_dir", carpeta_midi]
        if p.get("bpm") is not None:
            cmd += ["--bpm", p["bpm"]]
    else:
        cmd += ["--melody_midi", p["melodia"], "--chord_midi", p["acordes"]]
        if p.get("bateria"):
            cmd += ["--drum_midi", p["bateria"]]
    log(f"GPU: {torch.cuda.get_device_name(0)} · MuLaCover {COMMIT} · seed {semilla}")
    t0 = time.time()
    sh(cmd)
    generate_s = time.time() - t0
    midi = sorted(str(f.relative_to("generado")).replace(os.sep, "/") for f in Path(carpeta_midi).glob("*.mid")) if carpeta_midi and Path(carpeta_midi).exists() else []
    linaje = {
        "schema": "org.miuzika.lineage/0.1", "kind": "generated-audio", "task": "cover", "recipe": receta,
        "generator": {"name": "MuLaCover", "repo": REPO_URL, "commit": COMMIT, "license": LICENCIA},
        "inputs": {k: p.get(k) for k in ("audio", "melodia", "acordes", "bateria", "bpm")},
        "outputs": [{"file": Path(wav).name, "seed": semilla}], "midi": midi,
        "bootstrap_s": round(bootstrap_s, 1), "generate_s": round(generate_s, 1),
        "gpu": torch.cuda.get_device_name(0), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    Path(f"generado/{nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False), encoding="utf-8")
    log("RESULT " + json.dumps({"wav": Path(wav).name, "midi": midi, "seed": semilla, "generate_s": round(generate_s, 1), "bootstrap_s": round(bootstrap_s, 1)}))


if __name__ == "__main__":
    main()
