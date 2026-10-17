"""Generacion: semilla de tarareo -> ABC del modelo -> MIDI -> WAV.

Es la pieza que cierra el circuito:
    micro -> analyze.py -> <seed> -> [modelo afinado] -> ABC -> abcmini -> MIDI -> WAV

El modelo NO es de fiar al 100%: puede cortar la partitura a medias, inventarse
una directiva o dejar una voz vacia. Por eso todo lo que sale pasa por
reparar_abc(), que intenta arreglarlo, y por una validacion con nuestro motor
antes de renderizar. Si no se puede arreglar, se devuelve el error en vez de un
MIDI roto.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

from humseed import abcmini, corpus, drums, render

PROMPT_SISTEMA = corpus.PROMPT_SISTEMA

# Cierre que se le pide al modelo. El ABC se corta solo si el modelo se lio.
CAMPOS_OBLIGATORIOS = ["X:", "M:", "L:", "Q:", "K:"]
VOCES_OBLIGATORIAS = ["V:1", "V:2", "V:3"]

PATRONES_VALIDOS = None  # se rellena en tiempo de ejecucion


def _patrones() -> set[str]:
    global PATRONES_VALIDOS
    if PATRONES_VALIDOS is None:
        PATRONES_VALIDOS = set(drums.list_patterns())
    return PATRONES_VALIDOS


def extraer_abc(texto: str) -> str:
    """Se queda solo con el ABC, por si el modelo anadio prosa alrededor."""
    texto = texto.strip()
    # quitar vallas de codigo si las puso
    texto = re.sub(r"^```[a-zA-Z]*\s*", "", texto)
    texto = re.sub(r"\s*```$", "", texto)
    # empezar en la cabecera
    m = re.search(r"(?m)^X:\s*\d+", texto)
    if m:
        texto = texto[m.start():]
    return texto.strip()


def reparar_abc(texto: str, seed: str = "") -> tuple[str, list[str]]:
    """Arregla los fallos tipicos del modelo. Devuelve (abc, avisos)."""
    avisos: list[str] = []
    abc = extraer_abc(texto)

    # 1. cabeceera minima: si falta algo, se rellena desde la semilla
    campos = {c[0] for c in re.findall(r"(?m)^([A-Z]):", abc)}
    valores = {"X": "1", "M": "4/4", "L": "1/16", "Q": "1/4=120", "K": "C"}
    for campo in ("X", "M", "L", "Q", "K"):
        if campo not in campos:
            valor = valores[campo]
            if seed:
                if campo == "K":
                    mk = re.search(r"key=([A-G][#b]?)", seed)
                    mm = re.search(r"mode=(\w+)", seed)
                    if mk:
                        valor = mk.group(1) + ("m" if mm and mm.group(1) == "minor" else "")
                elif campo == "Q":
                    mq = re.search(r"tempo=([\d.]+)", seed)
                    if mq:
                        valor = f"1/4={int(float(mq.group(1)))}"
            abc = f"{campo}:{valor}\n" + abc
            avisos.append(f"cabecera {campo} anadida")

    # 2. directiva de bateria
    md = re.search(r"(?m)^\s*%%humseed\s+drums\s+(\S+)", abc)
    if not md:
        abc = re.sub(r"(?m)^(K:.*)$", r"\1\n%%humseed drums rock_standard", abc, count=1)
        avisos.append("directiva de bateria anadida (rock_standard)")
    else:
        pat = md.group(1)
        if pat not in _patrones():
            # el modelo se invento el nombre: lo mas parecido por texto
            candidato = next(
                (p for p in _patrones() if pat.lower() in p or p in pat.lower()),
                "rock_standard")
            abc = abc.replace(md.group(0), f"%%humseed drums {candidato}")
            avisos.append(f"patron desconocido '{pat}' -> '{candidato}'")

    # 3. voces: si falta alguna, se duplica la melodia una octava abajo
    faltan = [v for v in VOCES_OBLIGATORIAS if not re.search(rf"(?m)^\[?{v}\b", abc)]
    if faltan:
        avisos.append(f"faltaban voces {faltan}: se anaden desde V:1")
        mel = _linea_de_voz(abc, "V:1")
        if mel:
            for v in faltan:
                prog = "33" if v == "V:3" else "29"
                clef = "bass" if v == "V:3" else "treble"
                nombre = "Bass" if v == "V:3" else "Rhythm"
                abc += f'\n{v} name="{nombre}" clef={clef} program={prog}\n[{v}] {mel}\n'

    # 4. el ABC debe terminar en barra: si quedo cortado a media nota, se corta
    #    la ultima palabra suelta para que el parser no se atragante
    lineas = []
    for linea in abc.splitlines():
        if linea.startswith("[V:") or linea.startswith("V:"):
            cuerpo = linea[linea.index("]") + 1:].strip() if "]" in linea else ""
            if cuerpo and not re.search(r"[\|\s]$", cuerpo):
                cuerpo = cuerpo.rsplit(" ", 1)[0]
                linea = linea[: linea.index("]") + 1] + " " + cuerpo
                avisos.append("voz cortada a media nota: ultimo fragmento eliminado")
        lineas.append(linea)
    return "\n".join(lineas).strip() + "\n", avisos


def _linea_de_voz(abc: str, voz: str) -> str:
    m = re.search(rf"(?m)^\[{voz}\]\s*(.*)$", abc)
    return m.group(1).strip() if m else ""


@dataclass
class Generacion:
    abc: str
    avisos: list[str]
    valido: bool
    error: str = ""
    midi: Path | None = None
    wav: Path | None = None


def validar(abc: str) -> tuple[bool, str]:
    try:
        score = abcmini.parse_abc(abc)
    except Exception as e:
        return False, f"no parsea: {e}"
    if not score.voices:
        return False, "sin voces"
    con_notas = [v for v in score.voices if v.notes]
    if len(con_notas) < 2:
        return False, f"solo {len(con_notas)} voz(es) con notas"
    if sum(len(v.notes) for v in score.voices) < 12:
        return False, "menos de 12 notas en total"
    return True, ""


# ------------------------------------------------------------------ modelo

class Compositor:
    """Envuelve modelo + adaptador LoRA y cachea la carga."""

    def __init__(self, base: str, adaptador: str | None = None, max_new: int = 1400,
                 temperatura: float = 0.85):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        self.max_new = max_new
        self.temperatura = temperatura
        self.tok = AutoTokenizer.from_pretrained(base)
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(base, dtype=torch.bfloat16,
                                                          device_map={"": 0})
        if adaptador:
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, adaptador)
        self.model.eval()

    def componer(self, seed: str, estilo: str) -> str:
        entrada = [{"role": "system", "content": PROMPT_SISTEMA},
                   {"role": "user", "content": f"{seed}\nstyle={estilo}"}]
        texto = self.tok.apply_chat_template(entrada, tokenize=False,
                                             add_generation_prompt=True)
        ids = self.tok(texto, return_tensors="pt").to(self.model.device)
        with self.torch.no_grad():
            salida = self.model.generate(
                **ids, max_new_tokens=self.max_new,
                do_sample=self.temperatura > 0,
                temperature=max(self.temperatura, 1e-5), top_p=0.95,
                repetition_penalty=1.05,
                pad_token_id=self.tok.pad_token_id,
                eos_token_id=self.tok.eos_token_id,
            )
        return self.tok.decode(salida[0][ids["input_ids"].shape[1]:],
                               skip_special_tokens=True)


def generar_desde_semilla(comp: Compositor, seed: str, estilo: str,
                          out_dir: Path, nombre: str = "tema") -> Generacion:
    bruto = comp.componer(seed, estilo)
    abc, avisos = reparar_abc(bruto, seed)
    ok, error = validar(abc)
    gen = Generacion(abc=abc, avisos=avisos, valido=ok, error=error)
    if not ok:
        return gen

    out_dir.mkdir(parents=True, exist_ok=True)
    midi = out_dir / f"{nombre}.mid"
    wav = out_dir / f"{nombre}.wav"
    try:
        render.abc_to_midi(abc, midi)
        render.midi_to_wav(midi, wav)
        gen.midi, gen.wav = midi, wav
    except Exception as e:
        gen.valido = False
        gen.error = f"render fallo: {e}"
    return gen


def main() -> None:
    ap = argparse.ArgumentParser(description="Semilla -> ABC -> MIDI -> WAV")
    ap.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--adaptador", default=None)
    ap.add_argument("--seed", help="linea <seed> ... </seed>")
    ap.add_argument("--audio", help="en su lugar: un wav que se analiza primero")
    ap.add_argument("--estilo", default="classic hard rock, riff-driven, live drums, overdriven guitars")
    ap.add_argument("--out", default="cache/generado")
    ap.add_argument("--n", type=int, default=1, help="cuantas variantes generar")
    args = ap.parse_args()

    if args.audio:
        from humseed.analyze import analyse, seed_to_conditioning
        seed = seed_to_conditioning(analyse(args.audio))
        print(f"semilla extraida de {args.audio}:\n  {seed[:200]}...")
    elif args.seed:
        seed = args.seed
    else:
        ap.error("hace falta --seed o --audio")

    comp = Compositor(args.base, args.adaptador)
    for i in range(args.n):
        gen = generar_desde_semilla(comp, seed, args.estilo, Path(args.out), f"tema{i}")
        print(f"\n--- variante {i} ---")
        for a in gen.avisos:
            print(f"  aviso: {a}")
        if not gen.valido:
            print(f"  NO VALIDO: {gen.error}")
            print(gen.abc[:400])
            continue
        print(f"  midi: {gen.midi}")
        print(f"  wav:  {gen.wav}")


if __name__ == "__main__":
    main()
