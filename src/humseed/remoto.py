"""Puente con el modelo servido en el VPS.

El servidor escucha en 127.0.0.1:8091 dentro del VPS, asi que NO hace falta
abrir puertos a internet: se manda la peticion por SSH y se lee la respuesta.
Es mas seguro que exponer el puerto y no necesita tunel persistente.

Uso:
    python -m humseed.remoto --seed "<seed> ..." --estilo "hard rock riff"
    python -m humseed.remoto --audio toma.wav --out cache/tema
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from humseed import abcmini, generar, render

HOST = "vps"                      # alias de ~/.ssh/config
PUERTO = 8091                     # llama-server dentro del VPS
MODELO = "humseed-3b-q8_0.gguf"


def componer_remoto(seed: str, estilo: str, host: str = HOST, puerto: int = PUERTO,
                    temperatura: float = 0.8, max_tokens: int = 1400,
                    timeout: int = 300) -> str:
    """Manda la semilla al VPS por SSH y devuelve el ABC generado."""
    peticion = {
        "messages": [
            {"role": "system", "content": generar.PROMPT_SISTEMA},
            {"role": "user", "content": f"{seed}\nstyle={estilo}"},
        ],
        "temperature": temperatura,
        "top_p": 0.95,
        "max_tokens": max_tokens,
    }
    cuerpo = json.dumps(peticion)

    # el JSON viaja por stdin del ssh; la respuesta vuelve por stdout
    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host,
           f"curl -s -m {timeout - 20} -X POST "
           f"http://127.0.0.1:{puerto}/v1/chat/completions "
           f"-H 'Content-Type: application/json' --data-binary @-"]
    proc = subprocess.run(cmd, input=cuerpo, capture_output=True, text=True,
                          timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"ssh/curl fallo (rc={proc.returncode}): {proc.stderr[:400]}")
    if not proc.stdout.strip():
        raise RuntimeError("respuesta vacia del servidor")

    try:
        d = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"respuesta no es JSON: {proc.stdout[:300]}") from e

    if "choices" not in d:
        raise RuntimeError(f"respuesta sin 'choices': {str(d)[:300]}")
    return d["choices"][0]["message"]["content"]


def generar_tema(seed: str, estilo: str, out_dir: Path, nombre: str = "tema",
                 host: str = HOST) -> dict:
    """Circuito completo: semilla -> (VPS) -> ABC -> MIDI -> WAV."""
    out_dir.mkdir(parents=True, exist_ok=True)
    bruto = componer_remoto(seed, estilo, host=host)
    abc, avisos = generar.reparar_abc(bruto, seed)
    valido, error = generar.validar(abc)

    res = {"abc": abc, "avisos": avisos, "valido": valido, "error": error,
           "bruto": bruto, "midi": None, "wav": None}
    if not valido:
        return res

    midi = out_dir / f"{nombre}.mid"
    wav = out_dir / f"{nombre}.wav"
    render.abc_to_midi(abc, midi)
    render.midi_to_wav(midi, wav)
    res["midi"], res["wav"] = midi, wav
    s = abcmini.parse_abc(abc)
    res["notas"] = sum(len(v.notes) for v in s.voices)
    res["beats"] = s.total_beats()
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description="Tarareo/semilla -> tema, via modelo del VPS")
    ap.add_argument("--seed")
    ap.add_argument("--audio", help="wav de un tarareo; se analiza primero")
    ap.add_argument("--estilo", default="classic hard rock, riff-driven, live drums, overdriven guitars")
    ap.add_argument("--out", default="cache/tema")
    ap.add_argument("--host", default=HOST)
    args = ap.parse_args()

    if args.audio:
        from humseed.analyze import analyse, seed_to_conditioning
        seed = seed_to_conditioning(analyse(args.audio))
        print(f"semilla de {args.audio}:")
        print(f"  {seed[:220]}...")
    elif args.seed:
        seed = args.seed
    else:
        ap.error("hace falta --seed o --audio")

    out = Path(args.out)
    res = generar_tema(seed, args.estilo, out.parent, out.name, host=args.host)

    for a in res["avisos"]:
        print(f"  aviso: {a}")
    if not res["valido"]:
        print(f"NO VALIDO: {res['error']}")
        print(res["bruto"][:500])
        sys.exit(1)
    print(f"  notas={res['notas']}  beats={res['beats']:.0f}")
    print(f"  MIDI: {res['midi']}")
    print(f"  WAV:  {res['wav']}")


if __name__ == "__main__":
    main()
