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

## Calibracion: contra 6 referencias CC (2a sesion)

Misma maquina (A10, 1,29 $/h), `f122b5b0...`, 6 temas con licencia permisiva de
Internet Archive (netlabel), extractos de 90 s desde el minuto 1. **4 pasadas por
audio** porque el extractor de CLAP recorta ventanas al azar (`rand_trunc`) y una
sola medida no vale:

| Audio | Media | Desv. | Rango |
|---|---|---|---|
| **sacramento** (nuestro) | **0,4408** | 0,0200 | 0,419-0,472 |
| religion (nuestro) | 0,3984 | 0,0111 | 0,379-0,407 |
| 5_Falaxia (CC0) | 0,3726 | 0,0084 | 0,359-0,381 |
| 3_gt529 (CC0) | 0,3512 | 0,0498 | 0,286-0,420 |
| 1_gt290 (CC0) | 0,3175 | 0,0128 | 0,300-0,335 |
| 2_wmri (CC-BY-SA) | 0,2864 | 0,0275 | 0,261-0,330 |
| 6_various (CC-BY-SA) | 0,2838 | 0,0404 | 0,241-0,335 |
| 4_draw (CC-BY-SA) | 0,1802 | 0,0299 | 0,139-0,223 |

Media de las 6 referencias CC: **0,2986**.

- `sacramento` queda **+0,068 por encima de la mejor referencia** y **+0,142 sobre
  la media**. Su desviación (0,020) es del orden de la de la mejor referencia
  (0,008), así que la diferencia es robusta, no ruido.
- Las 6 referencias están citadas aquí para poder reproducir la medida. Licencias:
  CC0 (`gt290`, `gt529`, `Falaxia`) y CC-BY-SA (`wmri`, `draw_002`, `various`).
  Sólo se usaron para medir, no se distribuyen ni se entrenó con ellas.

### Qué significa y qué no

- **No** significa que suene mejor que esos temas: CLAP mide *parecido entre audio
  y texto*, no calidad de mezcla.
- Estas referencias son de netlabel, no másters comerciales. El «techo» medido es
  el de la escena amateur, no el de un disco de NIN.
- Significa que **el estilo no es el punto débil**: el motor ya produce algo que se
  reconoce como industrial claustrofóbico, por encima de referencias publicadas.
  El margen está en mezcla/máster (crest 8,28 frente a 12-14 pedidos) y en el
  realismo de los instrumentos, cosas que esta métrica no ve.

## Coste

Instancia encendida ~15 min ≈ **0,32 $** (calibración: otros ~15 min ≈ 0,32 $; total del día ≈ 0,75 $). Inferencia: 0,52 s para 2 audios × 6 textos;
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
