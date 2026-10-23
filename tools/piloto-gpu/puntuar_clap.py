"""Puntua audio contra descripciones de texto con CLAP (Apache-2.0, LAION).

Uso:
    python puntuar_clap.py --audio a.wav b.wav --textos "texto 1" "texto 2"

Imprime una matriz de similitud (audio x texto) y la mejor pareja de cada audio.
Sirve para medir «cuanto se parece este render al brief» con un numero, no a oido.
"""

import argparse
import time

import torch
from transformers import ClapModel, ClapProcessor

MODELO = "laion/larger_clap_music_and_speech"


def a_tensor(salida):
    """transformers 4.x devuelve un tensor; 5.x devuelve un objeto con pooler_output."""
    if isinstance(salida, torch.Tensor):
        return salida
    for atributo in ("pooler_output", "text_embeds", "audio_embeds"):
        valor = getattr(salida, atributo, None)
        if valor is not None:
            return valor
    estado = getattr(salida, "last_hidden_state", None)
    if estado is not None:
        return estado.mean(dim=1)
    raise TypeError(f"no se pudo sacar el embedding de {type(salida).__name__}")


def cargar_audio(ruta: str, sr: int = 48000):
    import soundfile as sf

    datos, origen = sf.read(ruta, dtype="float32", always_2d=True)
    # CLAP exige 1-D: con audio mono, always_2d devuelve (n, 1) y hay que aplanar.
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
    print(f"dispositivo: {dispositivo}")
    if dispositivo == "cuda":
        print(f"gpu: {torch.cuda.get_device_name(0)}")

    t0 = time.time()
    modelo = ClapModel.from_pretrained(args.modelo).to(dispositivo).eval()
    procesador = ClapProcessor.from_pretrained(args.modelo)
    print(f"modelo cargado en {time.time() - t0:.1f} s")

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
    print(f"inferencia en {time.time() - t1:.2f} s para {len(args.audio)} audio(s) x {len(args.textos)} texto(s)")

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
        print(f"mejor pareja de {ruta.split('/')[-1]}: «{args.textos[mejor]}» -> {similitud[i, mejor]:.4f}")


if __name__ == "__main__":
    main()
