#!/usr/bin/env bash
# Bootstrap de la instancia Lambda para el SFT con LoRA.
#
# Por que venv limpio: las imagenes de Lambda Stack traen torch/torchvision en
# /usr/lib/python3/dist-packages que chocan con el torch de pip. Instalamos
# torch dentro del venv para no heredar nada del sistema.
#
# Idempotente: se puede relanzar sin rehacer trabajo.
set -euo pipefail

WORK="$HOME/humseed"
VENV="$WORK/.venv"
LOG="$WORK/bootstrap.log"
mkdir -p "$WORK"

exec > >(tee -a "$LOG") 2>&1
echo "=== bootstrap $(date -Is) ==="

export DEBIAN_FRONTEND=noninteractive

echo "--- GPU ---"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

echo "--- paquetes de sistema ---"
if ! command -v ffmpeg >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg >/dev/null
fi
ffmpeg -version | head -1

echo "--- venv ---"
if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV" --without-pip
  curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
  "$VENV/bin/python" /tmp/get-pip.py -q
fi
"$VENV/bin/python" -m pip install -q --upgrade pip wheel

echo "--- torch (build CUDA) ---"
"$VENV/bin/python" -m pip install -q torch --index-url https://download.pytorch.org/whl/cu124

echo "--- librerias de entrenamiento ---"
"$VENV/bin/python" -m pip install -q \
  transformers datasets peft trl accelerate bitsandbytes \
  sentencepiece protobuf huggingface_hub tensorboard

echo "--- humseed (codigo del proyecto) ---"
if [[ -d "$WORK/humseed-src" ]]; then
  "$VENV/bin/python" -m pip install -q -e "$WORK/humseed-src"
fi

echo "--- verificacion ---"
"$VENV/bin/python" - <<'PY'
import torch, transformers, peft, trl, datasets
print(f"torch        {torch.__version__}  cuda={torch.cuda.is_available()}  "
      f"device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-'}")
print(f"transformers {transformers.__version__}")
print(f"peft         {peft.__version__}")
print(f"trl          {trl.__version__}")
print(f"datasets     {datasets.__version__}")
if torch.cuda.is_available():
    free, total = torch.cuda.mem_get_info()
    print(f"VRAM libre   {free/2**30:.1f} GiB de {total/2**30:.1f} GiB")
    a = torch.randn(4096, 4096, device="cuda", dtype=torch.bfloat16)
    b = a @ a
    torch.cuda.synchronize()
    print(f"matmul bf16  ok  (suma={b.sum().item():.3g})")
PY

echo "=== bootstrap OK $(date -Is) ==="
