#!/usr/bin/env python3
"""SFT con LoRA: semilla de tarareo -> ABC multivotz.

Se ejecuta EN LA INSTANCIA (necesita GPU). Datos en formato chat JSONL,
una linea por ejemplo: {"messages": [system, user, assistant]}.

Uso:
    python train_lora.py --data corpus_full.jsonl --out adaptador/ --epochs 2
"""

from __future__ import annotations

import argparse
import inspect
import json
import math
import os
import sys
import time
from pathlib import Path


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def cargar_datos(path: Path, limit: int = 0) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    if limit:
        rows = rows[:limit]
    return rows


def longitud_tokens(rows: list[dict], tok) -> list[int]:
    out = []
    for r in rows:
        texto = "".join(m["content"] for m in r["messages"])
        out.append(len(tok(texto, add_special_tokens=False)["input_ids"]))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--out", default="adaptador")
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=2048)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--sample-n", type=int, default=3, help="ejemplos a generar al final")
    ap.add_argument("--save-steps", type=int, default=0,
                    help="guardar cada N pasos (0 = solo al final de cada epoca)")
    args = ap.parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    log(f"torch {torch.__version__} cuda={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        log(f"GPU {torch.cuda.get_device_name(0)}  "
            f"VRAM {torch.cuda.get_device_properties(0).total_memory/2**30:.1f} GiB")

    rows = cargar_datos(Path(args.data), args.limit)
    log(f"ejemplos cargados: {len(rows)}")
    if not rows:
        log("sin datos, aborto")
        sys.exit(1)

    tok = AutoTokenizer.from_pretrained(args.model, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    largos = longitud_tokens(rows, tok)
    largos.sort()
    log(f"tokens por ejemplo: min={largos[0]} p50={largos[len(largos)//2]} "
        f"p95={largos[int(len(largos)*0.95)]} max={largos[-1]}")
    truncados = sum(1 for n in largos if n > args.max_len)
    if truncados:
        log(f"AVISO: {truncados} ejemplos ({truncados/len(largos)*100:.1f}%) "
            f"superan max_len={args.max_len} y se recortarian")

    def formatear(r: dict) -> dict:
        texto = tok.apply_chat_template(r["messages"], tokenize=False,
                                        add_generation_prompt=False)
        return {"text": texto}

    ds = Dataset.from_list([formatear(r) for r in rows])
    log(f"dataset listo: {len(ds)} ejemplos")

    log(f"cargando {args.model} ...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16,
        device_map={"": 0},
        token=os.environ.get("HF_TOKEN"),
    )
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )

    pasos = math.ceil(len(ds) / (args.batch * args.accum)) * args.epochs
    log(f"pasos optimizador estimados: {pasos:.0f}")

    # Ni transformers 5.x ni trl 1.x aceptan los nombres de argumento de antes
    # (warmup_ratio y logging_dir desaparecieron de TrainingArguments; SFTTrainer
    # ya no acepta tokenizer ni max_length -- el max_length vive en SFTConfig).
    # En lugar de fijar versiones, filtramos por la firma REAL de la clase
    # instalada: el script sobrevive a la siguiente reorganizacion de la API.
    def construir(cls, candidatos: dict, etiqueta: str):
        aceptados = set(inspect.signature(cls.__init__).parameters)
        kwargs = {k: v for k, v in candidatos.items() if k in aceptados}
        fuera = sorted(set(candidatos) - set(kwargs))
        if fuera:
            log(f"{etiqueta}: argumentos no soportados, ignorados: {fuera}")
        return cls(**kwargs)

    cfg = construir(SFTConfig, {
        "output_dir": str(Path(args.out) / "checkpoints"),
        "num_train_epochs": args.epochs,
        "per_device_train_batch_size": args.batch,
        "gradient_accumulation_steps": args.accum,
        "learning_rate": args.lr,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.03,
        "warmup_steps": max(1, int(pasos * 0.03)),
        "logging_steps": 10,
        "logging_dir": str(Path(args.out) / "tb"),
        # En una tirada de 20+ horas, guardar solo al final de la epoca es
        # jugarselo todo a una carta: si se cae en la hora 22 no queda nada.
        "save_strategy": "steps" if args.save_steps else "epoch",
        "save_steps": args.save_steps or 500,
        "save_total_limit": 3,
        "bf16": True,
        "optim": "adamw_torch",
        "gradient_checkpointing": True,
        "report_to": ["tensorboard"],
        "seed": args.seed,
        "dataloader_num_workers": 2,
        "max_length": args.max_len,          # trl 1.x
        "max_seq_length": args.max_len,      # trl 0.x
        "packing": False,
        "dataset_text_field": "text",
    }, "SFTConfig")

    trainer = construir(SFTTrainer, {
        "model": model,
        "args": cfg,
        "train_dataset": ds,
        "processing_class": tok,   # trl 1.x
        "tokenizer": tok,          # trl 0.x
        "peft_config": lora,
    }, "SFTTrainer")

    entrenables = sum(p.numel() for p in trainer.model.parameters() if p.requires_grad)
    totales = sum(p.numel() for p in trainer.model.parameters())
    log(f"parametros entrenables: {entrenables:,} de {totales:,} "
        f"({entrenables/totales*100:.2f}%)")

    log("entrenando ...")
    t0 = time.time()
    res = trainer.train()
    dur = time.time() - t0
    log(f"entrenamiento terminado en {dur/60:.1f} min")
    log(f"metricas: {json.dumps({k: v for k, v in res.metrics.items() if isinstance(v, (int, float))}, indent=1)}")
    log(f"loss final: {res.training_loss:.4f}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(out))
    tok.save_pretrained(str(out))
    log(f"adaptador guardado en {out}")

    # --- comprobacion cualitativa: generar desde semillas reales del corpus ---
    model.eval()
    muestras = rows[: args.sample_n]
    with (out / "muestras.txt").open("w", encoding="utf-8") as fh:
        for i, r in enumerate(muestras):
            entrada = [m for m in r["messages"] if m["role"] != "assistant"]
            texto = tok.apply_chat_template(entrada, tokenize=False,
                                            add_generation_prompt=True)
            ids = tok(texto, return_tensors="pt").to(model.device)
            with torch.no_grad():
                gen = model.generate(**ids, max_new_tokens=900, do_sample=True,
                                     temperature=0.8, top_p=0.95,
                                     pad_token_id=tok.pad_token_id)
            salida = tok.decode(gen[0][ids["input_ids"].shape[1]:],
                                skip_special_tokens=True)
            fh.write(f"===== MUESTRA {i} =====\n")
            fh.write("--- ENTRADA ---\n" + entrada[-1]["content"] + "\n")
            fh.write("--- GENERADO ---\n" + salida + "\n\n")
            fh.write("--- REFERENCIA (lo que habia en el corpus) ---\n")
            fh.write([m for m in r["messages"] if m["role"] == "assistant"][0]["content"])
            fh.write("\n\n")
            log(f"muestra {i} generada ({len(salida)} chars)")
    log(f"muestras en {out/'muestras.txt'}")
    log("LISTO")


if __name__ == "__main__":
    main()
