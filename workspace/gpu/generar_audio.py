"""Generate audio with ACE-Step 1.5 on the Lambda GPU (never on the laptop).

Chosen on 2-Nov-2026 as the first generation model (Carlos: "run the best music model
you found first"): MIT licence, whole songs with lyrics in 50+ languages, cover/repaint/
extract tasks, and the only open one whose XL (4B) variant fits the A10 (24 GB).
Stable Audio 3 Medium is the second candidate; a sibling script can follow this one.

Contract, same as every script run through `/api/run/lambda`: cwd is the project folder
on the instance, arguments arrive quoted, whatever is written under the project folder is
brought back. The output is a WAV (48 kHz, what ACE-Step produces) plus a
`<name>.lineage.json` with everything the authorship layer needs to sign: model, LM,
repo commit, prompt, lyrics, seed, metadata and GPU timings.

The script bootstraps itself: on first run it installs uv, clones ACE-Step-1.5 into
~/generadores/ and runs `uv sync` (minutes; weights download on the first generation),
then re-executes itself inside that environment. An instance that is terminated loses
all of it, so the first run after each power-on pays the install again (measured below,
in the lineage file: `bootstrap_s`).

Usage (from the project folder on the instance):
  python3 ../../gpu/generar_audio.py --prompt "..." --duracion 30 --bpm 125 \
      --tonalidad "E minor" --nombre riff --modelo acestep-v15-xl-turbo
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

REPO_URL = "https://github.com/ace-step/ACE-Step-1.5.git"
HOGAR = Path.home() / "generadores"
REPO = HOGAR / "ACE-Step-1.5"
MARCA_INSTALADO = REPO / ".miuzika-sync-ok"
DENTRO = "MIUZIKA_GENERAR_DENTRO"


def _log(texto):
    print(f"[generar_audio] {texto}", flush=True)


def _sh(cmd, **kw):
    _log("$ " + " ".join(cmd) if isinstance(cmd, list) else "$ " + cmd)
    return subprocess.run(cmd, check=True, shell=isinstance(cmd, str), **kw)


def preparar_entorno():
    """Clone + uv sync once per instance. Returns the seconds it took (0 if ready)."""
    if MARCA_INSTALADO.exists():
        return 0.0
    t0 = time.time()
    HOGAR.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        _sh("curl -LsSf https://astral.sh/uv/install.sh | sh")
    if not REPO.exists():
        _sh(["git", "clone", "--depth", "1", REPO_URL, str(REPO)])
    # uv picks the Python the project asks for (3.11/3.12) and downloads it if needed.
    _sh([uv, "sync"], cwd=str(REPO))
    MARCA_INSTALADO.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    return time.time() - t0


def reejecutar_dentro(bootstrap_s):
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    env = dict(os.environ)
    env[DENTRO] = "1"
    env["MIUZIKA_BOOTSTRAP_S"] = f"{bootstrap_s:.1f}"
    # cwd stays the project folder so the outputs land where the server fetches them.
    cmd = [uv, "run", "--project", str(REPO), "python", os.path.abspath(__file__), *sys.argv[1:]]
    _log("re-executing inside the ACE-Step environment")
    os.execve(cmd[0], cmd, env)


def commit_del_repo():
    try:
        return subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def generar(args):
    import torch
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music
    from acestep.llm_inference import LLMHandler

    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    vram_total = torch.cuda.get_device_properties(0).total_memory / 2**30 if torch.cuda.is_available() else 0
    _log(f"GPU: {gpu} ({vram_total:.1f} GB)")

    tiempos = {"bootstrap_s": float(os.environ.get("MIUZIKA_BOOTSTRAP_S", "0"))}
    t0 = time.time()
    dit = AceStepHandler()
    # XL needs offload below 20 GB; the A10 has 24, so no offload unless asked.
    kw = {"project_root": str(REPO), "config_path": args.modelo, "device": "cuda"}
    if args.offload:
        kw["offload_to_cpu"] = True
    dit.initialize_service(**kw)
    tiempos["dit_init_s"] = round(time.time() - t0, 1)
    _log(f"DiT {args.modelo} ready in {tiempos['dit_init_s']} s")

    llm = None
    if args.lm != "none":
        t1 = time.time()
        llm = LLMHandler()
        try:
            llm.initialize(checkpoint_dir=str(REPO / "checkpoints"), lm_model_path=args.lm,
                           backend=args.backend, device="cuda")
        except Exception as error:  # vllm is heavy; the plain torch backend always works
            if args.backend == "vllm":
                _log(f"vllm backend failed ({str(error)[:200]}); retrying with backend=pt")
                llm = LLMHandler()
                llm.initialize(checkpoint_dir=str(REPO / "checkpoints"), lm_model_path=args.lm,
                               backend="pt", device="cuda")
                args.backend = "pt"
            else:
                raise
        tiempos["lm_init_s"] = round(time.time() - t1, 1)
        _log(f"LM {args.lm} ({args.backend}) ready in {tiempos['lm_init_s']} s")

    params = GenerationParams(
        task_type="text2music",
        caption=args.prompt,
        lyrics=args.letra,
        instrumental=args.letra.strip().lower() in ("", "[instrumental]"),
        duration=float(args.duracion),
        bpm=args.bpm,
        keyscale=args.tonalidad or "",
        timesignature=args.compas or "",
        vocal_language=args.idioma,
        inference_steps=args.pasos,
        shift=3.0 if "turbo" in args.modelo else 1.0,
        seed=args.semilla,
        thinking=llm is not None,
    )
    config = GenerationConfig(
        batch_size=args.variantes,
        use_random_seed=args.semilla < 0,
        seeds=None if args.semilla < 0 else [args.semilla + i for i in range(args.variantes)],
        audio_format="wav",
    )
    torch.cuda.reset_peak_memory_stats()
    t2 = time.time()
    resultado = generate_music(dit, llm, params, config, save_dir=str(salida))
    tiempos["generate_s"] = round(time.time() - t2, 1)
    tiempos["vram_peak_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
    if not resultado.success:
        _log(f"FAILED: {resultado.error} / {resultado.status_message}")
        sys.exit(2)

    ficheros = []
    for i, audio in enumerate(resultado.audios):
        origen = Path(audio["path"])
        destino = salida / (f"{args.nombre}.wav" if len(resultado.audios) == 1 else f"{args.nombre}-{i + 1}.wav")
        if origen.resolve() != destino.resolve():
            shutil.move(str(origen), str(destino))
        ficheros.append({"file": destino.name, "seed": audio["params"].get("seed"),
                         "sample_rate": audio.get("sample_rate")})
    lm_meta = resultado.extra_outputs.get("lm_metadata") or {}
    linaje = {
        "schema": "org.miuzika.lineage/0.1",
        "kind": "generated-audio",
        "generator": {
            "name": "ACE-Step 1.5", "license": "MIT", "repo": REPO_URL,
            "commit": commit_del_repo(), "dit": args.modelo, "lm": args.lm,
            "lm_backend": args.backend if llm else None,
        },
        "inputs": {
            "prompt": args.prompt, "lyrics": args.letra, "duration_s": args.duracion,
            "bpm": args.bpm, "keyscale": args.tonalidad, "timesignature": args.compas,
            "inference_steps": args.pasos, "lora": None,
        },
        "lm_metadata": {k: lm_meta.get(k) for k in ("bpm", "keyscale", "duration", "caption") if k in lm_meta},
        "outputs": ficheros,
        "hardware": {"gpu": gpu, "vram_total_gb": round(vram_total, 1)},
        "timings": {**tiempos, **{k: round(float(v), 2) for k, v in
                                  (resultado.extra_outputs.get("time_costs") or {}).items()
                                  if isinstance(v, (int, float))}},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (salida / f"{args.nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False))
    _log("RESULT " + json.dumps({"files": [f["file"] for f in ficheros], **tiempos}))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--prompt", required=True, help="Caption: style, instruments, mood (max 512 chars)")
    ap.add_argument("--letra", default="[Instrumental]", help="Lyrics, or [Instrumental]")
    ap.add_argument("--idioma", default="unknown", help="Vocal language code (en, es...) when there are lyrics")
    ap.add_argument("--duracion", type=float, default=30, help="Seconds, 10-600")
    ap.add_argument("--bpm", type=int, default=None)
    ap.add_argument("--tonalidad", default="", help='e.g. "E minor"')
    ap.add_argument("--compas", default="", help='e.g. "4" for 4/4')
    ap.add_argument("--semilla", type=int, default=-1, help="-1 = random")
    ap.add_argument("--variantes", type=int, default=1, help="1-8 takes of the same prompt")
    ap.add_argument("--pasos", type=int, default=8, help="8 for turbo, 32-64 for base/sft")
    ap.add_argument("--modelo", default="acestep-v15-xl-turbo",
                    help="acestep-v15-turbo | acestep-v15-sft | acestep-v15-xl-turbo | acestep-v15-xl-sft")
    ap.add_argument("--lm", default="acestep-5Hz-lm-1.7B", help="acestep-5Hz-lm-0.6B | -1.7B | -4B | none")
    ap.add_argument("--backend", default="vllm", choices=["vllm", "pt"])
    ap.add_argument("--offload", action="store_true", help="CPU offload (GPUs under 20 GB)")
    ap.add_argument("--nombre", default="generado", help="Output name (without extension)")
    ap.add_argument("--salida", default="generado", help="Output folder, relative to the project")
    args = ap.parse_args()

    if os.environ.get(DENTRO) != "1":
        segundos = preparar_entorno()
        if segundos:
            _log(f"environment ready in {segundos:.0f} s")
        reejecutar_dentro(segundos)
    generar(args)


if __name__ == "__main__":
    main()
