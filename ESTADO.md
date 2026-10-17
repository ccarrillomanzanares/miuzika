# Estado del proyecto — traspaso

Documento de arranque para la siguiente sesión. Resume **qué es el proyecto
ahora**, **qué está decidido**, **qué está descartado** y **qué trampas ya nos
costaron tiempo**. No repetir lo descartado.

---

## 1. Qué es esto ahora

Una aplicación web **local** donde tarareas al micrófono y sale una pista MIDI
que puedes **editar a mano**, con banco de sonidos General MIDI.

El objetivo inmediato es un **multitrack sencillo**: tararear cada pista,
editarla, copiar, pegar, duplicar, y elegirle instrumento y volumen.

## 2. La idea de fondo (por qué el editor es el centro)

**La transcripción no va a ser nunca 100 % perfecta, y menos con tarareo.**
Por eso el editor no es un complemento: es la pieza que hace útil al resto. El
flujo de trabajo asumido es *tararear → el modelo propone → tú corriges*. Todo
lo que se construya debe dar por hecho que habrá que retocar a mano.

Corolario práctico: **no vale la pena seguir afinando el transcriptor a ciegas.**
Lo que haya que arreglar, se arregla en el editor.

## 3. Qué funciona hoy (verificado)

```bash
.venv/Scripts/python.exe app/servidor.py --puerto 8770   # la app
# -> http://127.0.0.1:8770
```

- **Tarareo → MIDI**: `POST /analizar` con el WAV devuelve notas, tonalidad,
  tempo, ABC, MIDI y audio. Verificado: 68 notas, 7 alturas, E menor, 129 BPM,
  **28 s por HTTP** de punta a punta.
- **6 suites de tests en verde** (`tests/`).
- **Banco de sonidos**: 128 instrumentos General MIDI, ya funcionando. Prueba:
  `python scripts/probar_banco.py <midi> <segundos> <programa...>`
  (escucha `cache/banco/prog_*.mp3`).

## 4. Arquitectura: dónde corre cada cosa

```
   PORTÁTIL (i5, sin GPU)                 VPS 31.220.80.78 (16 núcleos)
   ┌─────────────────────┐               ┌──────────────────────────┐
   │ app/servidor.py     │  audio stdin  │ ~/transcribe/one_shot.py │
   │   :8770             │ ─────SSH────► │   Basic Pitch   6,7 s    │
   │ app/index.html      │ ◄───MIDI b64──│                          │
   │ el micrófono        │               │ llama-server    :8091    │
   └─────────────────────┘               └──────────────────────────┘
```

**Decisión tomada: opción B.** La app vive en el portátil (tiene que estar ahí:
el micro es local) y **todo el trabajo pesado va al VPS por SSH**. No se abre
ningún puerto a internet. Publicar (opción A) queda para más adelante, y el
usuario pidió explícitamente **no preparar nada para eso ahora**.

### Por qué el trabajo va al VPS

Medido con la misma toma: Basic Pitch tarda **19 s en el VPS y 100 s en el
portátil**. Cinco veces más.

## 5. Lo que hay que construir ahora: el editor multitrack

Decisiones ya tomadas con el usuario:

- **Modo de grabación con botón para elegir** entre:
  - **metrónomo + compases fijos**: suena un clic, tarareas encima, la toma se
    corta a compás. Las pistas cuadran solas.
  - **tarareo libre**: grabas cuando quieras y alineas después a mano.
- **Edición obligatoria**: mover, borrar, copiar, pegar, duplicar.
- **Instrumento por pista**: desplegable con los 128 del banco GM.
- **Volumen por pista desde el principio**: medido, entre instrumentos GM hay
  **hasta 18 dB de diferencia** de pico (bajo −13,7 dB contra warm pad −31,8 dB).
  Si esto se deja para después, cada cambio de sonido descuadra la mezcla.
- **Motor de audio**: empezar por el **render en el servidor** (fluidsynth,
  ~1 s por cambio; lo que oyes es exactamente lo que exportas). Si la espera
  molesta al editar, se cambia a síntesis en el navegador — es una pieza
  intercambiable y no debe condicionar el diseño del editor.

## 6. Descartado o en pausa (no reabrir sin motivo)

- **El LLM de música: EN PAUSA** por decisión del usuario.
- **Nuestro transcriptor propio** (`pyin` + ataques): sustituido por Basic
  Pitch. Se conserva solo como respaldo (`analyse(..., motor="propio")`).
- **El ABC como fuente del audio**: el ABC queda únicamente como notación para
  el LLM (si algún día se retoma). **El audio sale del MIDI crudo.**
- **Cuantizar como norma**: destruye el ritmo (ver trampas).

## 7. Trampas que ya costaron tiempo (no volver a caer)

1. **La cuantización a rejilla mueve los ataques 543 ms de mediana** y desplaza
   el primer acento. Fue la causa de "no suena como la prueba que hicimos".
   Para oír, usar el MIDI crudo de Basic Pitch; el ABC cuantizado es solo para
   el LLM.
2. **Segmentar notas por saltos de tono fusiona las notas repetidas**: 64 notas
   iguales se convertían en 3. Hay que cortar por **ataques de amplitud**
   (ver `tests/test_notas_repetidas.py`).
3. **Afinar parámetros con el fichero en crudo y no con el audio real**: el
   fichero era de 44.100 Hz y el analizador trabaja a 22.050, así que `hop` y
   `wait` (que van en *frames*) significaban el doble. La misma toma pasaba de
   64 a 23 notas. Afinar siempre con `load_audio()`.
4. **El detector por flujo espectral se engancha al vibrato**: partía una
   melodía legato de 9 notas en 19-23. Con envolvente de amplitud da 9.
5. **`basic_pitch` imprime su progreso por stdout** y se mezcla con el base64
   del MIDI. Se redirige a stderr en `vps/one_shot.py`.
6. **Basic Pitch necesita Python 3.11**: `tensorflow<2.15` no tiene ruedas para
   3.12. Y **NumPy 2 rompe TF 2.14** → `numpy<2`.
7. **`setuptools>=81` ya no trae `pkg_resources`**, y `resampy` (dependencia de
   Basic Pitch) lo necesita → `setuptools<81`.
8. **`music21` revienta al escribir MIDI con varias voces**; para multivoz se
   usa el motor propio (`abcmini`).
9. **Portátil**: sin GPU y con ~1 GB de RAM libre. No entrenar ni fusionar nada
   aquí.
10. **VPS: no tocar sus servicios.** `aios-llama` en 8080 y ollama en 11434 son
    suyos y tienen modelos residentes. Puertos libres: 8081, 8091, 8092, 8093.
    El disco está al 90 % (~32 GB libres).

## 8. Entorno, en corto

| Cosa | Dónde |
|---|---|
| App | `app/servidor.py --puerto 8770`, venv `.venv` (Python 3.12) |
| Transcripción | VPS `~/transcribe/.venv` (Python 3.11) + `~/transcribe/one_shot.py` |
| Soundfont | `tools/MuseScore_General.sf3` (GM, 128 instrumentos) |
| fluidsynth | `tools/fluidsynth-v2.6.1-win10-x64-cpp11/bin/fluidsynth.exe` |
| Claves | `LAMBDA_API_KEY` y `HF_TOKEN` en el `.env` del perfil. **Nunca imprimirlas** |
| Acceso VPS | `ssh vps` (clave `~/.ssh/id_rsa`) |

## 9. Cómo arrancar la próxima sesión

1. `cd ~/proyectos/llm-musica` y `git log --oneline` (el trabajo está commiteado).
2. Levantar la app y probarla en el navegador.
3. Empezar por el **modelo de datos de pistas** y los endpoints del servidor;
   la interfaz después.

Nada de esto necesita al LLM. El LLM está en pausa.
