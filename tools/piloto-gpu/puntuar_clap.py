"""Scores audio against text descriptions with CLAP (Apache-2.0, LAION).

Usage:
    python puntuar_clap.py --audio a.wav b.wav --textos "text 1" "text 2"

Prints a similarity matrix (audio x text) and the best pair for each audio.
It is useful to measure "how much this render resembles the brief" with a number, not by ear.
"""

import argparse
import time

import torch
from transformers import ClapModel, ClapProcessor

MODELO = "laion/larger_clap_music_and_speech"


def a_tensor(salida):
    """transformers 4.x returns a tensor; 5.x returns an object with pooler_output."""
    if isinstance(salida, torch.Tensor):
        return salida
    for atributo in ("pooler_output", "text_embeds", "audio_embeds"):
        valor = getattr(salida, atributo, None)
        if valor is not None:
            return valor
    estado = getattr(salida, "last_hidden_state", None)
    if estado is not None:
        return estado.mean(dim=1)
    raise TypeError(f"could not extract the embedding from {type(salida).__name__}")


def cargar_audio(ruta: str, sr: int = 48000):
    import soundfile as sf

    datos, origen = sf.read(ruta, dtype="float32", always_2d=True)
    # CLAP requires 1-D: with mono audio, always_2d returns (n, 1) and it has to be flattened.
    if datos.ndim > 1:
        datos = datos.mean(axis=1)
    if origen != sr:
        import librosa

        datos = librosa.resample(datos, orig_sr=origen, target_sr=sr)
    return datos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", nargs="+", required=True)
    ap.add_argument("--textos", nargs="+", required=True)
    ap.add_argument("--modelo", default=MODELO)
    args = ap.parse_args()

    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {dispositivo}")
    if dispositivo == "cuda":
        print(f"gpu: {torch.cuda.get_device_name(0)}")

    t0 = time.time()
    modelo = ClapModel.from_pretrained(args.modelo).to(dispositivo).eval()
    procesador = ClapProcessor.from_pretrained(args.modelo)
    print(f"model loaded in {time.time() - t0:.1f} s")

    t1 = time.time()
    with torch.no_grad():
        entradas_texto = procesador(text=args.textos, return_tensors="pt", padding=True).to(dispositivo)
        emb_texto = a_tensor(modelo.get_text_features(**entradas_texto))
        emb_texto = emb_texto / emb_texto.norm(dim=-1, keepdim=True)

        emb_audios = []
        for ruta in args.audio:
            onda = cargar_audio(ruta)
            entradas = procesador(audios=[onda], sampling_rate=48000, return_tensors="pt").to(dispositivo)
            emb = a_tensor(modelo.get_audio_features(**entradas))
            emb_audios.append(emb / emb.norm(dim=-1, keepdim=True))
        emb_audio = torch.cat(emb_audios, dim=0)

    similitud = (emb_audio @ emb_texto.T).cpu().numpy()
    print(f"inference in {time.time() - t1:.2f} s for {len(args.audio)} audio(s) x {len(args.textos)} text(s)")

    ancho = max(len(t) for t in args.textos) + 2
    cabecera = "audio".ljust(28) + "".join(t[:ancho].ljust(ancho) for t in args.textos)
    print()
    print(cabecera)
    for i, ruta in enumerate(args.audio):
        fila = ruta.split("/")[-1][:26].ljust(28)
        for j in range(len(args.textos)):
            fila += f"{similitud[i, j]:.4f}".ljust(ancho)
        print(fila)

    print()
    for i, ruta in enumerate(args.audio):
        mejor = int(similitud[i].argmax())
        print(f"best pair for {ruta.split('/')[-1]}: \"{args.textos[mejor]}\" -> {similitud[i, mejor]:.4f}")


if __name__ == "__main__":
    main()
