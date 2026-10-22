"""Smoke test del motor de workspace/codigo.

Importa todos los modulos y renderiza 0,5 s de un bombo para comprobar que el motor
sigue usable. Sale 0 si todo va bien; imprime el motivo si falla.

Uso: python herramientas/smoke.py
"""

import pathlib
import sys
import traceback

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "codigo"))


def main() -> int:
    try:
        import numpy as np

        import cancion
        import dsp
        import instruments
        import midi
        import render

        x = np.asarray(instruments.kick(vel=1.0), dtype=float)
        if x.ndim > 1:
            x = x.mean(axis=1)
        rms = float(np.sqrt(np.mean(x ** 2)))
        pico = float(np.max(np.abs(x)))
        if not (pico > 0.01):
            print(f"FALLO: kick sale en silencio (pico={pico:.6f})")
            return 1
        hz = dsp.note_hz(57)
        if not (200.0 < hz < 230.0):
            print(f"FALLO: note_hz(57)={hz:.2f}, se esperaba ~220")
            return 1
        spb = 60.0 / float(cancion.BPM)
        if abs(dsp.SPB - spb) > 1e-9 or abs(dsp.BAR - 4.0 * spb) > 1e-9:
            print(
                f"FALLO: tempo desincronizado. dsp.SPB={dsp.SPB:.6f} BAR={dsp.BAR:.6f} "
                f"pero cancion.BPM={cancion.BPM} implica SPB={spb:.6f}"
            )
            return 1
        print(f"smoke OK: kick {len(x)} muestras, rms={rms:.4f}, pico={pico:.4f}, A3={hz:.2f}Hz")
        print("modulos importados: cancion, dsp, instruments, midi, render")
        return 0
    except Exception:
        print("FALLO en el smoke test:")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
