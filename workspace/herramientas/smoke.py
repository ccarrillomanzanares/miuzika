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

        # reverb_st debe devolver la MISMA forma que la entrada: reverb() añade la
        # cola del IR (len(ir)-1 muestras) y sin recortar la mezcla revienta.
        golpe = np.asarray(instruments.snare(vel=1.0), dtype=np.float32)
        largo = int(2.0 * dsp.SR)
        estereo = np.zeros((largo, 2), np.float32)
        m = min(len(golpe), largo)
        estereo[:m, 0] = estereo[:m, 1] = golpe[:m]
        ir = dsp.reverb_ir(1.0, 0.3, seed=7, lp_hz=6000.0)
        mezcla = render.reverb_st(estereo, ir, ir, mix=0.3)
        if mezcla.shape != estereo.shape:
            print(f"FALLO: reverb_st devuelve {mezcla.shape}, se esperaba {estereo.shape}")
            return 1
        if not np.all(np.isfinite(mezcla)) or float(np.max(np.abs(mezcla))) < 0.01:
            print("FALLO: reverb_st devuelve señal vacia o con NaN/inf")
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
