"""Verifica el reparador de salidas del modelo.

El LLM no devuelve siempre ABC limpio: mete prosa, se deja campos, se inventa
el nombre del patron de bateria, omite una voz o corta la ultima nota a media
palabra. Este test comprueba que cada uno de esos fallos se arregla y que el
resultado RENDERIZA, que es lo unico que importa al final.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from humseed import abcmini, generar, render  # noqa: E402

SEED = ("<seed> key=E mode=minor tempo=132 register=low "
        "contour=[40 43 45 46 43 40 46 43 40 40 43 45 40 43 45 52] "
        "rhythm=[0 0.5 1 1.5 2 2.5 3 3.5] notes=[E:0:0.5 G:0.5:0.5 B:1:0.5] </seed>")

BUENO = """X:1
T:test
M:4/4
L:1/16
Q:1/4=132
K:Em
%%humseed drums rock_standard
V:1 name="Lead"   clef=treble program=30
V:2 name="Rhythm" clef=treble program=29
V:3 name="Bass"   clef=bass   program=33
[V:1] E4 G4 B4 A4 | E4 G4 B4 E4 |
[V:2] [E,G,B,]16 | [E,G,B,]16 |
[V:3] E,,8 E,,8 | E,,8 E,,8 |
"""

CASOS = {
    "prosa_alrededor": (
        "Claro, aqui tienes la pieza:\n\n```abc\n" + BUENO + "```\n\nEspero que te guste.",
        ["sin avisos criticos"],
    ),
    "cabecera_incompleta": (
        "X:1\n%%humseed drums gallop\nV:1 name=\"Lead\" clef=treble program=30\n"
        "V:2 name=\"Rhythm\" clef=treble program=29\nV:3 name=\"Bass\" clef=bass program=33\n"
        "[V:1] E4 G4 B4 A4 | E4 G4 B4 E4 |\n[V:2] [E,G,B,]16 | [E,G,B,]16 |\n"
        "[V:3] E,,8 E,,8 | E,,8 E,,8 |\n",
        ["cabecera"],
    ),
    "patron_inventado": (
        BUENO.replace("%%humseed drums rock_standard", "%%humseed drums ultra_blast_9000"),
        ["patron desconocido"],
    ),
    "falta_el_bajo": (
        "\n".join(l for l in BUENO.splitlines() if not l.startswith("[V:3]")
                  and not l.startswith('V:3')),
        ["faltaban voces"],
    ),
    "voz_cortada": (
        BUENO.replace("[V:1] E4 G4 B4 A4 | E4 G4 B4 E4 |",
                      "[V:1] E4 G4 B4 A4 | E4 G4 B4 ^c"),
        ["voz cortada"],
    ),
    "sin_directiva_bateria": (
        BUENO.replace("%%humseed drums rock_standard\n", ""),
        ["directiva de bateria"],
    ),
}


def main() -> int:
    fails: list[str] = []
    (ROOT / "cache").mkdir(exist_ok=True)

    # el caso bueno no debe generar avisos
    abc, avisos = generar.reparar_abc(BUENO, SEED)
    ok, err = generar.validar(abc)
    print(f"[bueno] avisos={avisos or 'ninguno'}  valido={ok} {err}")
    if not ok:
        fails.append(f"el ABC correcto no valida: {err}")
    if avisos:
        fails.append(f"el ABC correcto genero avisos: {avisos}")

    for nombre, (entrada, esperados) in CASOS.items():
        abc, avisos = generar.reparar_abc(entrada, SEED)
        ok, err = generar.validar(abc)
        print(f"\n[{nombre}]")
        print(f"  avisos: {avisos or 'ninguno'}")
        print(f"  valido: {ok} {err}")
        if not ok:
            fails.append(f"{nombre}: no valida tras reparar ({err})")
            continue
        if esperados and esperados[0] != "sin avisos criticos":
            if not any(esperados[0] in a for a in avisos):
                fails.append(f"{nombre}: se esperaba un aviso con '{esperados[0]}', hubo {avisos}")

    # y que el reparado RENDERICE de verdad
    print("\n--- render del caso 'voz_cortada' ---")
    abc, _ = generar.reparar_abc(CASOS["voz_cortada"][0], SEED)
    gen = generar.Generacion(abc=abc, avisos=[], valido=True)
    gen.valido, gen.error = generar.validar(abc)
    if gen.valido:
        render.abc_to_midi(abc, ROOT / "cache" / "gen_test.mid")
        render.midi_to_wav(ROOT / "cache" / "gen_test.mid", ROOT / "cache" / "gen_test.wav")
        import soundfile as sf
        import numpy as np
        d, sr = sf.read(str(ROOT / "cache" / "gen_test.wav"))
        mono = d[:, 0] if d.ndim > 1 else d
        rms = float(np.sqrt((mono**2).mean()))
        print(f"  wav {len(mono)/sr:.2f}s rms={rms:.4f}")
        if rms < 0.005:
            fails.append("el wav reparado es silencioso")

    if fails:
        print("\nFALLOS:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nOK: el reparador arregla los fallos tipicos y el resultado renderiza")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
