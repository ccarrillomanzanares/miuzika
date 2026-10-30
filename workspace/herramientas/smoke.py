"""Smoke test for the engine in workspace/codigo.

Imports the engine modules and renders a kick and a snare to check that it
is still usable: audio with signal, a tuned note and stereo reverb with the right shape.
Exits 0 if all is well; prints the reason if it fails.

Note: no work goes in here (obras/<slug>/cancion.py): the library has no
song and the smoke test must not depend on any.

Usage: python herramientas/smoke.py
"""

import pathlib
import sys
import traceback

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "codigo"))


def main() -> int:
    try:
        import numpy as np

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
            print(f"FAIL: kick comes out silent (peak={pico:.6f})")
            return 1
        hz = dsp.note_hz(57)
        if not (200.0 < hz < 230.0):
            print(f"FAIL: note_hz(57)={hz:.2f}, expected ~220")
            return 1
        # reverb_st must return the SAME shape as the input: reverb() adds the
        # IR tail (len(ir)-1 samples) and without trimming the mix blows up.
        golpe = np.asarray(instruments.snare(vel=1.0), dtype=np.float32)
        largo = int(2.0 * dsp.SR)
        estereo = np.zeros((largo, 2), np.float32)
        m = min(len(golpe), largo)
        estereo[:m, 0] = estereo[:m, 1] = golpe[:m]
        ir = dsp.reverb_ir(1.0, 0.3, seed=7, lp_hz=6000.0)
        mezcla = render.reverb_st(estereo, ir, ir, mix=0.3)
        if mezcla.shape != estereo.shape:
            print(f"FAIL: reverb_st returns {mezcla.shape}, expected {estereo.shape}")
            return 1
        if not np.all(np.isfinite(mezcla)) or float(np.max(np.abs(mezcla))) < 0.01:
            print("FAIL: reverb_st returns an empty signal or one with NaN/inf")
            return 1
        # Mono and stereo work everywhere (28-Oct: a stereo bus into pan,
        # reverb or a mono bus into place brought down four renders in a row).
        corto = estereo[:4000]
        for nombre, salida, forma in (
            ("dsp.pan(stereo)", dsp.pan(corto, 0.5), (4000, 2)),
            ("dsp.reverb(stereo)", dsp.reverb(corto, ir)[:4000], (4000, 2)),
            ("dsp.delay(stereo)", dsp.delay(corto, 0.05), (4000, 2)),
        ):
            if np.asarray(salida).shape != forma:
                print(f"FAIL: {nombre} returns {np.asarray(salida).shape}, expected {forma}")
                return 1
        bus_mono = np.zeros(4000, np.float32)
        render.place(bus_mono, corto, 0.0)
        if float(np.max(np.abs(bus_mono))) < 0.01:
            print("FAIL: render.place does not sum into a mono bus")
            return 1
        print(f"smoke OK: kick {len(x)} samples, rms={rms:.4f}, peak={pico:.4f}, A3={hz:.2f}Hz")
        print("modules imported: dsp, instruments, midi, render")
        return 0
    except Exception:
        print("FAIL in the smoke test:")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
