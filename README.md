# humseed — LLM de música que compone a partir de lo que tarareas

Tarquas o golpeas un ritmo al micrófono y sale una pieza: melodía, armonía y
batería, en MIDI editable y en audio.

## Arquitectura

```
micrófono ──► record.py ──► WAV
                             │
                             ▼
                         analyze.py  ──►  semilla musical (JSON)
                                           tempo · tonalidad · melodía MIDI
                                           · contorno · onsets de ritmo
                             │
                             ▼
                    [ LLM afinado con LoRA ]  ──►  ABC notation
                             │
                             ▼
                     abcmini.py + drums.py  ──►  MIDI
                             │
                             ▼
                        render.py  ──►  WAV (fluidsynth + soundfont)
```

## Estado

| Módulo | Estado |
|---|---|
| `record.py` — captura de micro (fijo / auto / modo tap) | hecho |
| `analyze.py` — audio → semilla musical | hecho, verificado |
| `abcmini.py` — ABC multivotz → MIDI | hecho, verificado |
| `drums.py` — motor de patrones de batería | hecho, 13 patrones |
| `render.py` — ABC → MIDI → WAV | hecho, verificado |
| Dataset + entrenamiento LoRA (Lambda) | pendiente |
| Serving del modelo | pendiente |

## Uso

```bash
# entorno
uv venv --python 3.12 .venv
uv pip install --python .venv -e .

# 1. graba (--auto corta al detectar silencio; --tap para ritmo puro)
.venv/Scripts/python.exe -m humseed.record cache/toma.wav --seconds 10

# 2. tarareo -> semilla musical
.venv/Scripts/python.exe -m humseed.analyze cache/toma.wav --conditioning

# 3. ABC -> MIDI -> WAV
.venv/Scripts/python.exe -m humseed.render examples/test_riff.abc -o cache/salida.wav

# tests
.venv/Scripts/python.exe tests/test_synthetic_hum.py
.venv/Scripts/python.exe tests/test_render.py
```

## Formato ABC que emitirá el LLM

Cabecera estándar más dos cosas nuestras:

```
%%humseed drums industrial_stomp     <- el LLM elige el patrón, no lo escribe nota a nota
V:1 name="Lead"   clef=treble program=30
V:2 name="Rhythm" clef=treble program=31
V:3 name="Bass"   clef=bass   program=33
```

**Por qué los patrones de batería son un nombre y no notas:** un compás de
batería son ~200 eventos; un LLM pequeño los degrada a los pocos compases.
Elegir entre 13 patrones con nombre es fiable, barato y editable después.

## Decisiones de diseño

- **ABC como representación** — es texto, los LLM ya lo conocen del
  preentrenamiento, y es editable a mano.
- **Batería determinista** — ver arriba.
- **Sin nombres de artistas en el dataset ni en los prompts** — se describe el
  sonido ("industrial gothic, drum machine mecánica, guitarras palm-muted
  desafinadas"), nunca la banda. Esto evita problemas legales y además
  funciona mejor como condicionamiento.
- **music21 para ABC de una voz** (folk/clásico, donde es fiable) y motor
  propio para multivotz (donde music21 desplaza las voces).

## Herramientas locales (no versionadas)

- `tools/fluidsynth-v2.6.1-win10-x64-cpp11/` — sintetizador
- `tools/MuseScore_General.sf3` — soundfont GM

## Licencias del dataset (importante)

- **Nottingham / The Session** — folk tradicional, dominio público. Uso libre.
- **GigaMIDI** (1,4 M MIDIs, todos los géneros) — **CC BY-NC 4.0**: solo
  investigación y uso no comercial. Es la vía para tener rock/metal/industrial
  de verdad, pero el modelo resultante queda restringido a uso no comercial.
