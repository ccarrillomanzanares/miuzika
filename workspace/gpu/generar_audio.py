"""Generate audio with ACE-Step 1.5 on the Lambda GPU (never on the laptop).

Chosen on 2-Nov-2026 as the first generation model (Carlos: "run the best music model
you found first"): MIT licence, whole songs with lyrics in 50+ languages, cover/repaint/
extract tasks, and the only open one whose XL (4B) variant fits the A10 (24 GB).
Stable Audio 3 Medium is the second candidate; a sibling script can follow this one.

Contract, same as every script run through `/api/run/lambda`: cwd is the project folder
on the instance, arguments arrive quoted, whatever is written under the project folder is
brought back. The output is a WAV (48 kHz, what ACE-Step produces) plus a
`<name>.lineage.json` with everything the authorship layer needs to sign: model, LM,
repo commit, prompt, lyrics, seed, metadata, GPU timings and, for the tasks that work
from a source audio, the SHA-256 of that source (a cover or a stem is derived from it).

Tasks (4-Nov-2026, Carlos: every checkpoint with every task it has). The strings are
ACE-Step's own (`acestep/constants.py`, `main`, read 4-Nov; only text2music has run here):
  text2music   caption (+ lyrics)                      -> 1-8 new takes
  cover        --audio + caption + --fuerza            -> the source regenerated (1.0 faithful, 0.2 style only)
  cover-nofsq  same inputs as cover; undocumented variant
  repaint      --audio + --desde/--hasta (seconds)     -> the source with that range redone
  extract      --audio + --pista                        -> one stem                 (base only)
  lego         --audio + --pista + caption              -> a new stem over the source (base only)
  complete     --audio + caption (+ --pista list)       -> accompaniment            (base only)
The six source tasks last what the source lasts and skip the 5 Hz LM (the handler's
DIRECT_CONDITIONING_TASKS), so `--lm none` is the sensible value for them.

The script bootstraps itself: on first run it installs uv, clones ACE-Step-1.5 into
~/generadores/ and runs `uv sync` (minutes; weights download on the first generation),
then re-executes itself inside that environment. An instance that is terminated loses
all of it, so the first run after each power-on pays the install again (measured below,
in the lineage file: `bootstrap_s`).

Usage (from the project folder on the instance):
  python3 ../../gpu/generar_audio.py --prompt "..." --duracion 30 --bpm 125 \
      --tonalidad "E minor" --nombre riff --modelo acestep-v15-xl-turbo
  python3 ../../gpu/generar_audio.py --tarea extract --audio entrada/mix.wav --pista drums \
      --nombre bateria --modelo acestep-v15-xl-base --lm none
"""

import argparse
import hashlib
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

# Mirror of src/core/generacion.ts (MODELOS), from the ACE-Step README tables: which
# checkpoint knows which task, and the family's steps. Checked here too because the script
# can be run by hand from the instance.
TAREAS_TURBO = ("text2music", "cover", "cover-nofsq", "repaint")
TAREAS_BASE = TAREAS_TURBO + ("extract", "lego", "complete")
MODELOS = {
    "acestep-v15-turbo": ("turbo", TAREAS_TURBO),
    "acestep-v15-sft": ("sft", TAREAS_TURBO),
    "acestep-v15-base": ("base", TAREAS_BASE),
    "acestep-v15-xl-turbo": ("turbo", TAREAS_TURBO),
    "acestep-v15-xl-sft": ("sft", TAREAS_TURBO),
    "acestep-v15-xl-base": ("base", TAREAS_BASE),
}
PASOS_POR_FAMILIA = {"turbo": 8, "sft": 50, "base": 50}
# TASK_INSTRUCTIONS in acestep/constants.py, verbatim. The handler does not fill the track
# name by itself: without it extract/lego get the "_default" wording, which is a guess.
INSTRUCCIONES = {
    "text2music": "Fill the audio semantic mask based on the given conditions:",
    "repaint": "Repaint the mask area based on the given conditions:",
    "cover": "Generate audio semantic tokens based on the given conditions:",
    "cover-nofsq": "Generate audio semantic tokens based on the given conditions:",
    "extract": "Extract the {pista} track from the audio:",
    "extract_default": "Extract the track from the audio:",
    "lego": "Generate the {pista} track based on the audio context:",
    "lego_default": "Generate the track based on the audio context:",
    "complete": "Complete the input track with {pistas}:",
    "complete_default": "Complete the input track:",
}
PISTAS_MODELO = (
    "woodwinds", "brass", "fx", "synth", "strings", "percussion",
    "keyboard", "guitar", "bass", "drums", "backing_vocals", "vocals",
)


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


def sha256_de(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def comprobar(args):
    """What the core already refused on the laptop, repeated for runs by hand. Exit 2 with a reason."""
    if args.modelo not in MODELOS:
        sys.exit(f"unknown --modelo {args.modelo}: one of {', '.join(MODELOS)}")
    familia, tareas = MODELOS[args.modelo]
    if args.tarea not in tareas:
        capaces = [m for m, (_, t) in MODELOS.items() if args.tarea in t]
        sys.exit(f"{args.modelo} cannot do {args.tarea} (only {', '.join(tareas)}); use {' or '.join(capaces)}")
    if args.tarea != "text2music":
        if not args.audio:
            sys.exit(f"--tarea {args.tarea} needs --audio (a WAV relative to the project folder)")
        if not Path(args.audio).exists():
            sys.exit(f"--audio {args.audio} does not exist in {os.getcwd()}")
    elif args.audio:
        _log("--audio is ignored by text2music (flow-edit is not wired here)")
    pistas = [p.strip() for p in (args.pista or "").split(",") if p.strip()]
    if args.tarea in ("extract", "lego") and len(pistas) != 1:
        sys.exit(f"--tarea {args.tarea} needs exactly one --pista: {', '.join(PISTAS_MODELO)}")
    malas = [p for p in pistas if p not in PISTAS_MODELO]
    if malas:
        sys.exit(f"the model has no track {', '.join(malas)}: {', '.join(PISTAS_MODELO)}")
    if args.tarea != "extract" and not args.prompt.strip():
        sys.exit(f"--tarea {args.tarea} needs --prompt (the caption)")
    return familia, pistas


def instruccion_de(tarea, pistas):
    if tarea in ("extract", "lego"):
        return INSTRUCCIONES[tarea].format(pista=pistas[0]) if pistas else INSTRUCCIONES[f"{tarea}_default"]
    if tarea == "complete":
        return INSTRUCCIONES[tarea].format(pistas=", ".join(pistas)) if pistas else INSTRUCCIONES["complete_default"]
    return INSTRUCCIONES[tarea]


def generar(args):
    import torch
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music
    from acestep.llm_inference import LLMHandler

    familia, pistas = comprobar(args)
    pasos = args.pasos or PASOS_POR_FAMILIA[familia]
    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    vram_total = torch.cuda.get_device_properties(0).total_memory / 2**30 if torch.cuda.is_available() else 0
    _log(f"GPU: {gpu} ({vram_total:.1f} GB) · {args.tarea} with {args.modelo} ({familia}, {pasos} steps)")

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

    # The LM (caption/metadata chain of thought) only takes part in text2music: the handler
    # skips it for the source tasks (DIRECT_CONDITIONING_TASKS). Loading it there is VRAM for nothing.
    llm = None
    if args.lm != "none" and args.tarea == "text2music":
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
    elif args.lm != "none":
        _log(f"LM not loaded: {args.tarea} does not use it")

    fuente = None
    if args.tarea != "text2music":
        fuente = {"path": args.audio, "sha256": sha256_de(args.audio), "bytes": os.path.getsize(args.audio)}
        _log(f"source {args.audio} ({fuente['bytes']} bytes, sha256 {fuente['sha256'][:12]}…)")

    # extract: the default lyrics "[Instrumental]" told the model the result has no voice while
    # the instruction asked for the vocals. Measured 5-Nov on still-here bars 1-32 (xl-base, 50
    # steps): the output was the source again, RMS flat at -19..-14 dBFS through the intro and
    # 5 dB above it. ACE-Step's inference.py warns that conditioning which conflicts with the
    # extract instruction makes the DiT "reconstruct input audio instead of extracting stems".
    # So a VOCAL extract only gets lyrics the caller really passed, and never the instrumental
    # flag. With that, "voz2" came out voice-only (heard by Carlos, 5-Nov 11:55). The same
    # empty lyrics on a drums extract gave "un pego de cosas sin sentido" (Carlos, 12:25):
    # a stem without words keeps "[Instrumental]", which describes its target. Hypothesis
    # under test from 5-Nov afternoon; the lineage records what was sent.
    VOCALES = ("vocals", "backing_vocals")
    letra = args.letra
    extract_vocal = args.tarea == "extract" and bool(pistas) and pistas[0] in VOCALES
    if extract_vocal and letra.strip().lower() in ("", "[instrumental]"):
        letra = ""
    instrumental = not extract_vocal and letra.strip().lower() in ("", "[instrumental]")

    params = GenerationParams(
        task_type=args.tarea,
        instruction=instruccion_de(args.tarea, pistas),
        caption=args.prompt,
        lyrics=letra,
        instrumental=instrumental,
        # The source tasks lock the length to the source; -1 is the handler's "auto".
        duration=float(args.duracion) if args.tarea == "text2music" else -1.0,
        bpm=args.bpm,
        keyscale=args.tonalidad or "",
        timesignature=args.compas or "",
        vocal_language=args.idioma,
        inference_steps=pasos,
        # Turbo is distilled without CFG (the handler forces guidance 1.0 anyway); the README
        # recommends shift 3 for turbo and 7.0 of guidance for base/sft.
        shift=3.0 if familia == "turbo" else 1.0,
        guidance_scale=1.0 if familia == "turbo" else args.guia,
        seed=args.semilla,
        thinking=llm is not None,
        src_audio=os.path.abspath(args.audio) if fuente else None,
        repainting_start=float(args.desde) if args.desde is not None else 0.0,
        repainting_end=float(args.hasta) if args.hasta is not None else -1,
        audio_cover_strength=float(args.fuerza) if args.fuerza is not None else 1.0,
        # ACE-Step peak-normalises every output to -1 dBFS by default. Measured 5-Nov: a cover
        # (x), a lego stem (x2) and an extract (voz) all peaked at exactly -1.0 while their source
        # peaked at -7. A stem or a cover has to keep the source's level to sit in the mix; only a
        # new song is free to be loud.
        enable_normalization=args.tarea == "text2music",
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
        "task": args.tarea,
        "generator": {
            "name": "ACE-Step 1.5", "license": "MIT", "repo": REPO_URL,
            "commit": commit_del_repo(), "dit": args.modelo, "family": familia,
            "lm": args.lm if llm else None, "lm_backend": args.backend if llm else None,
        },
        "inputs": {
            "prompt": args.prompt, "lyrics": letra, "instrumental": instrumental,
            "normalized_to_db": params.normalization_db if params.enable_normalization else None,
            "duration_s": args.duracion if args.tarea == "text2music" else None,
            "bpm": args.bpm, "keyscale": args.tonalidad, "timesignature": args.compas,
            "inference_steps": pasos, "guidance_scale": params.guidance_scale, "shift": params.shift,
            "instruction": params.instruction, "track": pistas or None,
            "source_audio": fuente,
            "cover_strength": params.audio_cover_strength if args.tarea.startswith("cover") else None,
            "range_s": [params.repainting_start, params.repainting_end] if args.tarea in ("repaint", "lego") else None,
            "lora": None,
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
    _log("RESULT " + json.dumps({"files": [f["file"] for f in ficheros], "task": args.tarea, **tiempos}))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tarea", default="text2music", choices=sorted(TAREAS_BASE),
                    help="text2music | cover | cover-nofsq | repaint | extract | lego | complete")
    ap.add_argument("--prompt", default="", help="Caption: style, instruments, mood (max 512 chars); extract needs none")
    ap.add_argument("--letra", default="[Instrumental]",
                    help="Lyrics, or [Instrumental]; extract ignores the default (pass the song's real lyrics to help a vocals extract)")
    ap.add_argument("--idioma", default="unknown", help="Vocal language code (en, es...) when there are lyrics")
    ap.add_argument("--duracion", type=float, default=30, help="Seconds, 10-600 (text2music only)")
    ap.add_argument("--bpm", type=int, default=None)
    ap.add_argument("--tonalidad", default="", help='e.g. "E minor"')
    ap.add_argument("--compas", default="", help='e.g. "4" for 4/4')
    ap.add_argument("--semilla", type=int, default=-1, help="-1 = random")
    ap.add_argument("--variantes", type=int, default=1, help="1-8 takes of the same prompt")
    ap.add_argument("--pasos", type=int, default=None, help="Diffusion steps (default: 8 turbo, 50 base/sft)")
    ap.add_argument("--guia", type=float, default=7.0, help="Classifier-free guidance for base/sft (turbo ignores it)")
    ap.add_argument("--modelo", default="acestep-v15-xl-turbo", help=" | ".join(MODELOS))
    ap.add_argument("--lm", default="acestep-5Hz-lm-1.7B", help="acestep-5Hz-lm-0.6B | -1.7B | -4B | none")
    ap.add_argument("--backend", default="vllm", choices=["vllm", "pt"])
    ap.add_argument("--offload", action="store_true", help="CPU offload (GPUs under 20 GB)")
    ap.add_argument("--audio", default=None, help="Source WAV, relative to the project folder (every task but text2music)")
    ap.add_argument("--fuerza", type=float, default=None, help="cover: 1.0 faithful to the source, 0.2 style only")
    ap.add_argument("--desde", type=float, default=None, help="repaint/lego: start of the range, seconds into the source")
    ap.add_argument("--hasta", type=float, default=None, help="repaint/lego: end of the range, seconds (-1 = to the end)")
    ap.add_argument("--pista", default=None,
                    help="extract/lego: the instrument; complete: comma list. " + ", ".join(PISTAS_MODELO))
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
