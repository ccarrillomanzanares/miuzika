"""One-shot: lee un WAV por stdin, transcribe con Basic Pitch y devuelve el MIDI.

Se ejecuta EN EL VPS. El audio entra por la entrada estandar y el MIDI sale por
la salida estandar en base64, asi que todo el trabajo va en UNA sola peticion
SSH: sin ficheros temporales que limpiar, sin subir y bajar por separado y sin
abrir ningun puerto a internet.

Uso (desde el portatil):
    ssh vps '~/transcribe/.venv/bin/python ~/transcribe/one_shot.py' < toma.wav
"""
import base64
import os
import sys
import tempfile


def main() -> int:
    datos = sys.stdin.buffer.read()
    if len(datos) < 1000:
        print("ERROR: audio vacio o demasiado corto", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        entrada = os.path.join(tmp, "in.wav")
        with open(entrada, "wb") as fh:
            fh.write(datos)

        from basic_pitch.inference import predict

        # basic_pitch escribe su progreso por la salida estandar ("Predicting
        # MIDI for...") y se mezclaria con el base64. Lo mandamos a la salida de
        # errores para que la estandar lleve SOLO el MIDI.
        real = sys.stdout
        sys.stdout = sys.stderr
        try:
            _, midi_data, _ = predict(entrada)
        finally:
            sys.stdout = real

        salida = os.path.join(tmp, "out.mid")
        midi_data.write(salida)
        with open(salida, "rb") as fh:
            sys.stdout.write(base64.b64encode(fh.read()).decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
