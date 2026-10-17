#!/usr/bin/env bash
# Lambda Cloud: capacidad, lanzar, estado, ssh, terminar.
#
# REGLA: lanzar una instancia cuesta dinero desde que arranca. Este script
# NUNCA lanza por su cuenta en un flujo automatico: `launch` es siempre una
# accion explicita del usuario.
#
# Uso:
#   scripts/lambda.sh capacity              # que GPU hay libre y a que precio
#   scripts/lambda.sh launch [tipo] [region]  # lanza (pide confirmacion)
#   scripts/lambda.sh status                # instancias vivas
#   scripts/lambda.sh ssh                   # ssh a la instancia mas reciente
#   scripts/lambda.sh terminate <id|all>    # termina (pide confirmacion)
set -euo pipefail

API="https://cloud.lambda.ai/api/v1"
ENV_FILE="$LOCALAPPDATA/hermes/profiles/llm-musica/.env"
SSH_KEY="$HOME/.ssh/humseed-lambda"
KEY_NAME="humseed-llm-musica"
DEFAULT_TYPE="gpu_1x_a10"
DEFAULT_REGION="us-east-1"

if [[ ! -f "$ENV_FILE" ]]; then echo "Falta $ENV_FILE" >&2; exit 1; fi
set -a; . "$ENV_FILE"; set +a
if [[ -z "${LAMBDA_API_KEY:-}" ]]; then echo "Falta LAMBDA_API_KEY en $ENV_FILE" >&2; exit 1; fi

api() { # api METHOD PATH [BODY_FILE]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -s -X "$method" "$API$path" -H "Authorization: Bearer $LAMBDA_API_KEY" \
      -H "Content-Type: application/json" --data-binary "@$body" -w '\n%{http_code}'
  else
    curl -s -X "$method" "$API$path" -H "Authorization: Bearer $LAMBDA_API_KEY" -w '\n%{http_code}'
  fi
}

cmd_capacity() {
  mkdir -p cache; local tmp; tmp="cache/.lambda_tmp.$$"
  api GET /instance-types | head -n -1 > "$tmp"
  python - "$tmp" <<'PY'
import json, re, sys
d = json.load(open(sys.argv[1]))["data"]
rows = []
for name, v in d.items():
    it = v["instance_type"]
    regs = [r["name"] for r in (v.get("regions_with_capacity_available") or [])]
    specs = it.get("specs") or {}
    # la VRAM de la GPU viene dentro de gpu_description ("A10 (24 GB PCIe)");
    # specs.memory_gib es la RAM del sistema, no la de la tarjeta.
    m = re.search(r"(\d+)\s*GB", it.get("gpu_description", ""))
    vram = m.group(1) if m else "-"
    rows.append((it["price_cents_per_hour"] / 100, name, it.get("gpu_description", ""),
                 vram, specs.get("memory_gib", ""), regs))
rows.sort()
print(f"{'USD/h':>7}  {'tipo':26} {'GPU':30} {'VRAM':>5} {'RAM':>5}  regiones con capacidad")
for price, name, desc, vram, ram, regs in rows:
    flag = ", ".join(regs) if regs else "SIN CAPACIDAD"
    print(f"{price:7.2f}  {name:26} {desc[:30]:30} {str(vram):>4}G {str(ram):>4}G  {flag}")
PY
  rm -f "$tmp"
}

cmd_status() {
  mkdir -p cache; local tmp; tmp="cache/.lambda_tmp.$$"
  api GET /instances | head -n -1 > "$tmp"
  python - "$tmp" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])).get("data", [])
if not d:
    print("sin instancias")
for i in d:
    print(f"{i['id']}  {i['instance_type']['name']:22} {i['status']:12} {i.get('ip') or '-':15} {i.get('name') or ''}")
PY
  rm -f "$tmp"
}

cmd_launch() {
  local type="${1:-$DEFAULT_TYPE}" region="${2:-$DEFAULT_REGION}"
  echo "Vas a lanzar: $type en $region con la clave $KEY_NAME"
  echo "Coste aproximado: consulta 'scripts/lambda.sh capacity'"
  read -r -p "Escribe 'lanza' para confirmar: " ok
  [[ "$ok" == "lanza" ]] || { echo "cancelado"; exit 1; }

  mkdir -p cache; local body; body="cache/.lambda_body.$$"
  printf '{"region_name":"%s","instance_type_name":"%s","ssh_key_names":["%s"],"name":"humseed-train"}' \
    "$region" "$type" "$KEY_NAME" > "$body"
  api POST /instance-operations/launch "$body"
  rm -f "$body"
  echo
  echo "Esperando a que este 'active' (3-15 min)..."
  for _ in $(seq 1 60); do
    local ip
    ip=$(cmd_status | awk '$3=="active" && $5=="humseed-train" {print $4}' | head -1)
    if [[ -n "$ip" ]]; then
      echo "lista: $ip"
      echo "  ssh -i ~/.ssh/humseed-lambda ubuntu@$ip"
      return 0
    fi
    sleep 15
  done
  echo "sigue sin estar activa; mira 'scripts/lambda.sh status'" >&2
}

cmd_ssh() {
  local ip
  ip=$(cmd_status | awk '$3=="active" {print $4}' | head -1)
  [[ -n "$ip" ]] || { echo "no hay instancia active" >&2; exit 1; }
  exec ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new ubuntu@"$ip"
}

cmd_terminate() {
  local id="${1:-}"
  [[ -n "$id" ]] || { echo "uso: lambda.sh terminate <id|all>" >&2; exit 1; }
  local ids
  if [[ "$id" == "all" ]]; then
    ids=$(cmd_status | awk '{print $1}')
  else
    ids="$id"
  fi
  echo "Se van a TERMINAR: $ids"
  read -r -p "Escribe 'termina' para confirmar: " ok
  [[ "$ok" == "termina" ]] || { echo "cancelado"; exit 1; }
  for i in $ids; do
    mkdir -p cache; local body; body="cache/.lambda_body.$$"
    printf '{"instance_ids":["%s"]}' "$i" > "$body"
    api POST /instance-operations/terminate "$body"
    rm -f "$body"
    echo " -> $i"
  done
}

case "${1:-}" in
  capacity)  cmd_capacity ;;
  launch)    shift; cmd_launch "$@" ;;
  status)    cmd_status ;;
  ssh)       cmd_ssh ;;
  terminate) shift; cmd_terminate "$@" ;;
  *) sed -n '2,16p' "$0" ;;
esac
