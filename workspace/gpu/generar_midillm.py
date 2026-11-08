"""MIDI-LLM on the Lambda GPU: multitrack MIDI from a description, notes to edit.

Brought from miuzika's proponer_midi.py on 8-Nov-2026 (Carlos: "vamos primero con proponer_midi", named "MIDI-LLM").
There, 2-Nov: 4 multitrack proposals in 38 s on the A10, 92-100 % of the notes in the asked key, the kit on channel 10;
never heard as music. MIDI-LLM = Llama 3.2 1B with the Anticipatory Music Transformer vocabulary added (ISMIR 2026).
Licence: Llama 3.2 Community License (weights), "Built with Llama".

Same contract as the other module scripts: cwd is the project folder, `--parametros <file>` holds the recipe, outputs go to
generado/ (`<name>.mid` or `<name>-<k>.mid` + `<name>.lineage.json`) and the last line is `RESULT {...}`.

Changes against proponer_midi.py: the repo and the weights are pinned; the generation is driven from here through the repo's
own `generate_from_prompts_hf` (same tokenizing, sampling and decoding) so a seed can be set and recorded (its script has none);
versions pinned to the repo's requirements.txt, without vllm.
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

# Tied to MIDILLM_COMMIT / MIDILLM_PESOS in src/modulos/midillm/receta.ts by a test.
COMMIT = "93c660c"
REVISION = "8b82ab9ec144348900e9ea4623b123e0b12f60b3"
REPO_URL = "https://github.com/slSeanWU/MIDI-LLM.git"
MODELO = "slseanwu/MIDI-LLM_Llama-3.2-1B"
HOGAR = Path.home() / "generadores"
REPO = HOGAR / "MIDI-LLM"
VENV = REPO / ".venv-miuzika"
MARCA = HOGAR / f".midillm-{COMMIT}-ok"
DENTRO = "MIUZIKA_MIDILLM_DENTRO"
LICENCIA = "Llama 3.2 Community License (weights; Built with Llama); code of MIDI-LLM as in its repo"
# From the repo's requirements.txt at COMMIT (torch from the cu128 index: on 2-Nov PyPI's default wheel failed with
# "NVIDIA driver too old" on Lambda's CUDA 12.8 driver). vllm and its ~170 packages are left out: only the transformers path.
PAQUETES = [
    "transformers==4.57.1", "tokenizers==0.22.1", "safetensors==0.6.2", "sentencepiece==0.2.1", "mido==1.3.3",
    "numpy==2.2.6", "tqdm",
    "anticipation @ git+https://github.com/jthickstun/anticipation.git@af37397922665a0fb8d474d7988b0f3755a38d45",
]


def log(t):
    print(f"[generar_midillm] {t}", flush=True)


def sh(cmd, **kw):
    log("$ " + " ".join(map(str, cmd)))
    subprocess.run(list(map(str, cmd)), check=True, **kw)


def preparar():
    if MARCA.exists():
        return 0.0
    t0 = time.time()
    HOGAR.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        subprocess.run("curl -LsSf https://astral.sh/uv/install.sh | sh", shell=True, check=True)
    if not (REPO / ".git").exists():
        sh(["git", "clone", "--quiet", REPO_URL, REPO])
    sh(["git", "-C", REPO, "fetch", "--quiet", "origin"])
    sh(["git", "-C", REPO, "checkout", "--quiet", "--force", COMMIT])
    # A half-built venv from an earlier failed run makes `uv venv` fail (seen 2-Nov): start clean.
    shutil.rmtree(VENV, ignore_errors=True)
    sh([uv, "venv", "--quiet", "--python", "3.11", VENV])
    py = VENV / "bin" / "python"
    sh([uv, "pip", "install", "--quiet", "--python", py, "--index-url", "https://download.pytorch.org/whl/cu128", "torch==2.8.0"])
    sh([uv, "pip", "install", "--quiet", "--python", py, *PAQUETES])
    MARCA.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"))
    return time.time() - t0


def poner_tempo(ruta, bpm):
    """Stamp the project tempo on a .mid, leaving every tick where it is.

    MIDI-LLM writes no set_tempo (so readers assume 120). The notes are meant in beats: a 92 BPM project should read
    them at 92 (on 2-Nov the 120-vs-125 mismatch made the import warn and the material had to be re-timed by hand).
    """
    import mido

    midi = mido.MidiFile(str(ruta))
    for pista in midi.tracks:
        for i in [i for i, m in enumerate(pista) if m.type == "set_tempo"][::-1]:
            if i + 1 < len(pista):
                pista[i + 1].time += pista[i].time  # keep the delta of a removed event on the next one
            del pista[i]
    midi.tracks[0].insert(0, mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    midi.save(str(ruta))


def resumen(ruta):
    """Tracks, notes and length of a .mid, for the lineage and the Log."""
    import mido

    midi = mido.MidiFile(str(ruta))
    pistas, notas = 0, 0
    for pista in midi.tracks:
        n = sum(1 for m in pista if m.type == "note_on" and m.velocity > 0)
        notas += n
        pistas += 1 if n else 0
    return {"tracks": pistas, "notes": notas, "seconds": round(midi.length, 1)}


def generar(receta, bootstrap_s):
    sys.path.insert(0, str(REPO))
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import generate_transformers as gt

    p = receta["parametros"]
    nombre = p["nombre"]
    semilla = int(p["semilla"]) if int(p["semilla"]) >= 0 else random.randint(0, 2**31 - 1)
    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODELO, revision=REVISION)
    model = AutoModelForCausalLM.from_pretrained(MODELO, revision=REVISION, dtype=torch.bfloat16).to("cuda").eval()
    carga_s = time.time() - t0
    log(f"GPU: {torch.cuda.get_device_name(0)} · seed {semilla} · model ready in {carga_s:.1f} s")
    temporal = Path("generado") / f".midillm-{nombre}"
    shutil.rmtree(temporal, ignore_errors=True)
    torch.manual_seed(semilla)
    torch.cuda.manual_seed_all(semilla)
    torch.cuda.reset_peak_memory_stats()
    t1 = time.time()
    stats = gt.generate_from_prompts_hf(
        model=model, tokenizer=tokenizer, prompts=[p["prompt"]], output_dir=temporal, model_path=MODELO,
        synthesize=False, temperature=float(p["temperatura"]), top_p=float(p["top_p"]),
        max_tokens=int(p["max_tokens"]), n_outputs=int(p["propuestas"]),
    )
    generate_s = time.time() - t1
    mids = sorted(temporal.rglob("gen_*.mid"), key=lambda f: int(f.stem.split("_")[1]))
    # The repo drops a proposal with more than 64 simultaneous notes (its own validation): say how many were dropped.
    descartadas = int(p["propuestas"]) - len(mids)
    if not mids:
        sys.exit(f"MIDI-LLM produced no valid MIDI ({descartadas} dropped by its own validation)")
    ficheros, detalle = [], []
    for k, mid in enumerate(mids, 1):
        destino = Path("generado") / (f"{nombre}.mid" if len(mids) == 1 else f"{nombre}-{k}.mid")
        shutil.move(str(mid), str(destino))
        if p.get("bpm"):
            poner_tempo(destino, float(p["bpm"]))
        ficheros.append(destino.name)
        detalle.append({"file": destino.name, "seed": semilla, "batch_index": k - 1, **resumen(destino)})
    shutil.rmtree(temporal, ignore_errors=True)
    vram = torch.cuda.max_memory_allocated() / 1e9
    linaje = {
        "schema": "org.miuzika.lineage/0.1", "kind": "generated-midi", "recipe": receta,
        "generator": {"name": "MIDI-LLM", "model": MODELO, "revision": REVISION, "repo": REPO_URL, "commit": COMMIT,
                      "license": LICENCIA, "backend": "transformers"},
        "outputs": detalle, "dropped_by_validation": descartadas, "upstream_stats": stats,
        "bootstrap_s": round(bootstrap_s, 1), "load_s": round(carga_s, 1), "generate_s": round(generate_s, 1),
        "vram_peak_gb": round(vram, 2), "gpu": torch.cuda.get_device_name(0), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    Path(f"generado/{nombre}.lineage.json").write_text(json.dumps(linaje, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    log("RESULT " + json.dumps({"files": ficheros, "seed": semilla, "dropped": descartadas, "outputs": detalle,
                                "generate_s": round(generate_s, 1), "load_s": round(carga_s, 1), "vram_peak_gb": round(vram, 2)}))


def main():
    receta = json.loads(Path(sys.argv[sys.argv.index("--parametros") + 1]).read_text(encoding="utf-8"))
    if os.environ.get(DENTRO) != "1":
        b = preparar()
        py = str(VENV / "bin" / "python")
        env = dict(os.environ, **{DENTRO: "1", "MIUZIKA_BOOTSTRAP_S": f"{b:.1f}"})
        log("re-executing inside the MIDI-LLM environment")
        os.execve(py, [py, os.path.abspath(__file__), *sys.argv[1:]], env)
    generar(receta, float(os.environ.get("MIUZIKA_BOOTSTRAP_S", "0")))


if __name__ == "__main__":
    main()
