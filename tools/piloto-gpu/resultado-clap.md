# Piloto 1 — Puntuación perceptual con CLAP

Fecha: 2026-10-23. Máquina: Lambda `gpu_1x_a10` (24 GB, us-east-1, 1,29 $/h) →
`21f9c4ba5a194aa387e42df18e3352bf`, IP 129.80.188.34.

## Qué se mide

Similitud coseno entre el embedding de audio (CLAP) y el de una descripción de
texto. Modelo: `laion/larger_clap_music_and_speech`, **Apache-2.0** (verificado en
la ficha de HuggingFace el 2026-10-23), así que sirve para uso comercial.

No mide calidad musical: mide **si el audio se parece a lo que pediste**.

## Material

Extractos de 90 s, mono, 48 kHz, del centro de cada tema (audio propio, sin
material de terceros):

- `sacramento.wav` — render del motor numpy (140 compases, 90 BPM).
- `religion.wav` — render anterior (`religion_de_maquina_92bpm_Dm.wav`).

## Resultado

| Audio | industrial/claustrofóbico | dark synth pop | drone | pop alegre | metal | cuerdas |
|---|---|---|---|---|---|---|
| sacramento | **0,4054** | 0,4048 | 0,0570 | 0,2306 | 0,0204 | 0,0607 |
| religion | 0,3744 | **0,3745** | 0,0468 | 0,2712 | 0,0316 | 0,3044 |

- Ambas se parecen más a las dos descripciones del brief que a cualquier control.
- Los controles negativos caen a 0,02-0,06 (metal, drone): **el modelo discrimina**,
  no dice «amén» a todo.
- `religion` puntúa 0,3044 en «cuerdas románticas», coherente con su colchón de
  órgano; `sacramento` baja ahí a 0,0607: el tema nuevo está menos «orquestal».
- `sacramento` supera a `religion` en la descripción principal (0,4054 vs 0,3744).

## Coste

Instancia encendida ~15 min ≈ **0,32 $**. Inferencia: 0,52 s para 2 audios × 6 textos;
carga del modelo 0,8 s. A ese ritmo, puntuar un render cuesta **céntimos de céntimo**.

## Reproducir

```bash
pip install "transformers==4.46.3" torch soundfile librosa "numpy<2" "pillow>=10"
python puntuar_clap.py --audio sacramento.wav religion.wav --textos "..." "..."
```

Aviso: con `transformers 5.x` el `ClapProcessor` viene sin tokenizador y el
`get_text_features` devuelve un objeto. Fijar la 4.46.3 evita las dos cosas.

## Pendiente

- [ ] Calibrar el techo: puntuar 3-5 temas **CC** del mismo estilo (Jamendo/FMA) para
      saber qué número corresponde a «esto suena a disco». Sin eso, 0,40 no dice si
      vamos bien o mal.
- [ ] Repetir por secciones (intro, estribillo, outro) en vez del extracto central.
