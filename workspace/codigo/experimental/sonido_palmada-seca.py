"""Sonido «palmada-seca» — generado por miuzika desde una receta.

No editar a mano: se regenera desde proyectos/stahl/sonidos/palmada-seca.json
Voz: palmada · palabras: seco
"""
import os
import sys
import wave

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
sys.path.insert(0, os.path.join(RAIZ, "codigo"))

import dsp          # noqa: E402
import instruments  # noqa: E402

VOZ = "palmada"
ARGS = {
    "vel": 1,
    "pitch": 1,
    "dur": 0.3,
    "seed": 0,
}
REPETICIONES = 1
SALIDA = os.path.join(RAIZ, "proyectos/stahl/sonidos/palmada-seca.wav")
PEAK_DBFS = -1
FADE_MS = 25
BRILLO = 0.15
SUCIEDAD = 0
COLA = 0.5
CUERPO = 0


def postproceso(x):
    """Lo que piden las palabras: cuerpo, brillo, cola y suciedad."""
    x = np.asarray(x, dtype=float)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if REPETICIONES > 1:
        x = np.tile(x, REPETICIONES)
    x = x - x.mean()
    n = len(x)
    # Cuerpo: realce (o corte) de graves.
    if abs(CUERPO) > 1e-6:
        x = x + CUERPO * 1.2 * dsp.lp(x, 180.0, 0.7)
    # Brillo: agudos arriba (brillante) o abajo (oscuro).
    if abs(BRILLO) > 1e-6:
        x = x + BRILLO * 1.1 * dsp.hp(x, 2200.0, 0.7)
    # Cola: alarga o acorta el decaimiento siguiendo la envolvente.
    if abs(COLA - 1.0) > 1e-6 and n > 2:
        ventana = max(int(0.005 * dsp.SR), 1)
        suave = np.convolve(np.abs(x), np.ones(ventana) / ventana, mode="same")
        referencia = max(float(np.max(suave)), 1e-9)
        factor = (np.maximum(suave, 1e-9) / referencia) ** ((1.0 / COLA) - 1.0)
        x = x * np.clip(factor, 0.0, 4.0)
    # Suciedad: saturación EN PARALELO (no aplasta el transitorio) más un poco de
    # ruido con semilla fija. Mezclar en seco conserva el crest: medido, saturar en
    # serie bajaba el bombo de 6,9 a 1,4 dB de crest y sonaba a caja de ritmos rota.
    if SUCIEDAD > 1e-6:
        pico_seco = max(float(np.max(np.abs(x))), 1e-9)
        seco = x / pico_seco
        sucio = dsp.soft_clip(seco * (1.0 + 2.0 * SUCIEDAD), drive=2.0)
        sucio = sucio / max(float(np.max(np.abs(sucio))), 1e-9)
        x = ((1.0 - 0.7 * SUCIEDAD) * seco + 0.7 * SUCIEDAD * sucio) * pico_seco
        x = x + SUCIEDAD * 0.02 * np.random.default_rng(12345).standard_normal(n)
    x = x - x.mean()
    if FADE_MS > 0:
        m = min(max(int(dsp.SR * FADE_MS / 1000.0), 2), len(x))
        x[-m:] *= np.linspace(1.0, 0.0, m)
    pico = max(float(np.max(np.abs(x))), 1e-9)
    return x * (10.0 ** (PEAK_DBFS / 20.0)) / pico


def main():
    fn = getattr(instruments, VOZ, None)
    if fn is None:
        raise SystemExit(f"VOZ desconocida: {VOZ}")
    x = postproceso(fn(**ARGS))
    est = np.stack([x, x], axis=1)
    pcm = np.clip(est * 32767.0, -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with wave.open(SALIDA, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(dsp.SR)
        w.writeframes(pcm.tobytes())
    p = 20 * np.log10(max(float(np.max(np.abs(x))), 1e-12))
    r = 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))
    print(f"escrito {SALIDA}")
    print(f"voz={VOZ}  dur={len(x) / dsp.SR:.3f}s  pico={p:.2f} dBFS  rms={r:.2f} dBFS  crest={p - r:.2f} dB")


if __name__ == "__main__":
    main()
