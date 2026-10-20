# miuzika

DAW web con un asistente musical en lenguaje natural. Este repositorio es el **spike**:
la capa que convierte una petición como

> "créame una canción synth pop 80's oscura en re menor, lenta"

en un proyecto musical editable (pistas, clips, notas, efectos) y un `.mid` reproducible.

La UI y el motor de audio se delegan en [openDAW](https://opendaw.org) (AGPL-3.0). Aquí vive
lo que no existe en ningún DAW: **el puente entre el lenguaje natural y el modelo de proyecto**.

## Estado

| Pieza | Estado |
|---|---|
| Modelo de proyecto (IR) | ✅ |
| Operaciones validadas y transaccionales | ✅ |
| Teoría musical, patrones y grooves | ✅ |
| Planificador de canciones (presets + validación) | ✅ |
| Export MIDI (SMF tipo 1) | ✅ |
| Asistente con tool-calling (Ollama Cloud) | ✅ probado contra `deepseek-v4.1-flash:1017` |
| Interfaz web: chat, timeline, piano roll | ✅ |
| Adaptador openDAW (export + import) | ✅ 11 FX mapeados, ida y vuelta verificada |
| Audio WAV: import, waveform, playback | ✅ |
| Mixdown a WAV | ✅ |
| Evaluación automática (8 prompts) | ✅ 8/8 |
| Tests | ✅ 77 + integración real de openDAW |
| Audio dentro de openDAW | 📋 pendiente (necesita SampleService) |

## Arranque

Requiere **Node 24** (ejecuta TypeScript nativamente, sin build) y una clave de Ollama Cloud.

```bash
npm install
cp .env.example .env    # y pon tu OLLAMA_API_KEY
npm run dev             # abre http://127.0.0.1:5173
npm test
npm run eval
```

La web es la interfaz principal: chat a la derecha, timeline a la izquierda, piano roll con
doble clic en un clip.

Salida de la CLI en `out/`:

- `*.json` — proyecto canónico (fuente de verdad)
- `*.mid` — Standard MIDI File, para escucharlo o importarlo en openDAW
- `*.plan.json` — el plan intermedio (secciones, pistas, progresión)

### Ejemplos

```bash
# Canción completa
npm run compose -- "synth pop 80s oscuro en re menor, lenta"

# Loop de dos pistas
npm run compose -- "loop de bajo y batería estilo siniestro punk español"

# Parámetros sueltos
npm run compose -- "techno hipnótico en la menor a 132 bpm, 32 compases"

# Ver el plan sin generar nada
npm run compose -- --plan "ambient melancólico para estudiar, sin batería"

# Editar un proyecto existente con el agente
npm run compose -- --agent --project out/noche.json "sube el reverb del track 2"
```

### La app web

`npm run dev` levanta Vite y la API local (la clave del LLM nunca llega al navegador).

**Modo actual: audio-only.** `src/config.ts` fija `MIDI_ENABLED=false`: la UI oculta MIDI,
Congelar, openDAW y el planner/chat MIDI; el LLM no recibe pistas ni herramientas MIDI. El código
MIDI sigue en el repo y en los tests, pero no se usa en la ruta activa.

- **Chat**: en modo audio, pide samples (“crea un kick industrial”, “un pad ambient cálido”,
  “lo mismo para batería y bajo”). El chat planifica los samples, genera un script Python por
  sonido en el sandbox, renderiza WAV y monta las pistas de audio. El planner de canciones MIDI
  queda detrás del flag.
- **Timeline**: clic para mover el playhead, Ctrl+rueda para zoom.
- **Selección de pistas**: clic selecciona; Ctrl/Cmd+clic añade o quita; Shift+clic selecciona
  un rango. `M` y `S` son botones de mute y solo. La barra de selección permite Mute, Solo,
  Congelar, Stems de las seleccionadas, Borrar, Todas y Limpiar. Ctrl+A selecciona todo,
  Esc limpia y Supr borra con confirmación.
- **Sample Lab**: botón «Sample Lab». Describes un sonido (“kick oscuro distorsionado para punk”,
  “loop de bajo punk en mi menor”), el LLM diseña la receta, el motor la renderiza a WAV y la
  escuchas antes de insertarla como clip. Puedes **elegir o crear la pista de destino**
  (`Drums Samples`, `Bass Samples`…), así que cada sample va a su propia pista. También puedes
  **descargar el WAV** sin insertarlo. En la UI solo eliges **Sonido (one-shot)** o **Loop**;
  el motor/macro concreto lo decide el LLM según la petición.
- **Motor de sintetizador**: no es un modelo neural ni una librería fija. El LLM compone capas
  con osciladores, unísono/detune, FM, pitch envelope, filter envelope, ruido, drive, bitcrush,
  EQ, delay y reverb. Con esos primitivos puede pedir kicks, snares, bajos, plucks, pads, risers,
  texturas o impactos, en cualquier estilo. La macro industrial es un preset interno de
  one-shot, no una opción aparte en la UI.
- **Proyecto legacy mixto**: el código permite pistas de samples y MIDI, pero con
  `MIDI_ENABLED=false` las pistas MIDI se ocultan y no se reproducen ni se envían al LLM. Se
  conservan en el proyecto guardado para poder reactivarlas más adelante.
- **Deshacer/rehacer**: botones ↶ ↷ (Ctrl+Z / Ctrl+Shift+Z) con historial de las últimas 8
  versiones, persistente al recargar. Cada mensaje del chat, edición del piano roll, importación
  o generación guarda una versión.
- **Reproducibilidad**: el proyecto guardado contiene las notas, la semilla y los FX; al pulsar ▶
  suena exactamente igual. Volver a generar desde el mismo prompt crea una canción nueva (el LLM
  no es determinista); para conservar una versión concreta, exporta el JSON. Si el proyecto
  contiene audio, exporta también WAV o stems: el JSON no embebe los bytes.
- **Piano roll legacy**: doble clic en un clip MIDI. Clic añade, arrastrar mueve, clic derecho
  borra. En modo audio no hay clips MIDI visibles.
- **Congelar legacy**: convierte pistas MIDI en clips de audio. Está oculto con el flag actual;
  el código y el diálogo se conservan. Eliges pista por pista, con sus FX, sin buses ni máster.
- **Audio persistente**: los WAV importados, los del Sample Lab y las pistas congeladas se
  guardan en IndexedDB (`miuzika` / `audio-assets`) y se rehidratan al recargar, también al
  deshacer/rehacer. El JSON solo lleva metadatos: al abrirlo en otro navegador hay que reimportar
  los WAV.
- **Audio**: botón «Audio» importa WAV al playhead, dibuja la forma de onda y lo reproduce.
- **WAV**: mixdown final del proyecto con master, limitador y normalización de loudness.
- **Stems**: un WAV por pista, con sus FX y sin máster; exporta todas o solo la selección.
- **MIDI legacy**: exportación MIDI oculta en modo audio. El código sigue disponible.
- **openDAW legacy**: exportación `.odw` oculta; solo soporta MIDI y el audio sigue pendiente
  (`SampleService`/`AudioFileBox`).
- **JSON**: proyecto canónico con notas, FX, semilla y metadatos. No incluye los WAV; esos viven
  en IndexedDB. Para mover el proyecto a otro navegador hay que reimportar el audio.

### Sandbox Python

El chat audio-only usa `/api/sound/create`: el LLM escribe un script Python con
`render(sr, duration, params, seed)`, y un contenedor lo ejecuta y devuelve un WAV validado.

- Imagen: `sandbox/sound/Dockerfile` (Python + numpy, usuario sin privilegios).
- Construir: `npm run sandbox:build` (en Windows usa WSL2 Ubuntu; en Linux, Docker).
- Ejecución: `--network none`, `--read-only`, `/tmp` tmpfs, `--cap-drop ALL`,
  `--security-opt no-new-privileges`, 512 MB, 1 CPU, límites de procesos, timeout.
- El runner valida imports permitidos (`numpy`, `math`, `random`), prohíbe I/O/red/exec,
  comprueba forma, NaN, duración y normaliza a −1 dBFS.
- Contrato de salida: array mono o estéreo; el navegador lo decodifica y monta los clips.
- El modelo usa `reasoning_effort: low` para no gastar todo el presupuesto en razonamiento.
- Si Docker/WSL no está disponible, `/api/sound/create` devuelve error; no hay fallback a
  ejecutar Python en Windows.

Build de producción: `npm run build:web` y `npm run preview`. La API local vive en un plugin de
Vite; para desplegar de verdad hará falta un servidor Node aparte que exponga `/api/*` y un
runner de contenedores separado.

### LLM (obligatorio)

Configura `OLLAMA_API_KEY` en `.env` (ver `.env.example`). En modo audio el modelo devuelve un
**plan de samples** y scripts DSP. El plan de canción MIDI (SongPlan) sigue existiendo solo como
código legacy detrás del flag.

El plan MIDI legacy pasaba tres filtros antes de tocar el proyecto:

1. **zod** — forma del JSON.
2. **normalizePlan** — sinónimos de parámetros (`size`→`decay`, `mix`→`wet`, `amount`→`width`) y rangos.
3. **validatePlan + checkConstraints** — estilos válidos, roles con pista, acordes, octavas y las
   restricciones duras del prompt (tonalidad, BPM, compases, "sin batería", loops).

Si algo falla, el error vuelve al modelo y se reintenta (máximo 3 intentos). No hay fallback
silencioso: si el plan no es válido, el comando falla.

`--offline` sigue existiendo solo para depurar el motor de patrones y para el harness de
evaluación; no es una ruta del producto. También funciona con Ollama local:
`OLLAMA_BASE_URL=http://localhost:11434/v1`.

## Cómo está pensado

Modo audio actual:

```
 lenguaje natural
       │
       └─► planificador de samples (LLM) ──► SamplePlan
                                      │
                                      ▼
                    diseñador DSP (LLM) ──► script Python
                                      │
                                      ▼
                 sandbox Docker/WSL (sin red, read-only) ──► WAV
                                      │
                                      ▼
                     renderSample/audio → pistas + clips
                                      │
                                      ▼
                         WAV / Stems / JSON
```

El pipeline MIDI (`SongPlan` → `composePlan` → `Op[]` → MIDI/openDAW) se conserva en el repo,
pero no es la ruta activa con `MIDI_ENABLED=false`.

Decisiones clave:

1. **El LLM no escribe notas.** Elige rol, estilo, progresión, densidad y estructura. Un motor
   determinista (semilla incluida) genera las notas. Así cabe en contexto, suena coherente y es
   reproducible.
2. **Un único vocabulario de cambio** (`Op`), validado con zod y aplicado en transacción. Si algo
   falla, no se aplica nada y el modelo recibe el error para corregir.
3. **El IR es la fuente de verdad.** openDAW es un ejecutor/vista, no el almacén. Eso permite
   cambiar de motor sin reescribir el cerebro y exportar a DAWproject.
4. **Todo reversible.** La sesión de herramientas mantiene pila de undo; el proyecto es un valor
   inmutable entre operaciones.

## Estructura

```
src/
  core/
    types.ts      modelo (Project, Track, Clip, Note, Device)
    theory.ts     escalas, acordes, voicings, armaduras
    patterns.ts   expansión determinista de grooves a notas
    ops.ts        esquema zod + aplicación transaccional
    project.ts    creación y validación
    plan.ts       SongPlan, presets, normalización, validación, composePlan()
    parse.ts      restricciones del prompt + intérprete offline (español)
    digest.ts     resumen compacto para el LLM
    midi.ts       exportador SMF tipo 1
  agent/
    client.ts     cliente OpenAI-compatible (Ollama Cloud/local)
    prompts.ts    system prompt + prompts del planificador
    tools.ts      get_project_digest / apply_ops / check_project / undo
    planner.ts    plan JSON validado + reintento
    agent.ts      bucle de tool-calling
  cli/
    index.ts      compose
    eval.ts       harness de evaluación
  host/opendaw/
    mapping.ts    IR → dispositivos/instrumentos (puro, testeable)
    adapter.ts    SDK real: export e import del proyecto
    check.ts      verificación de ida y vuelta
web/
  index.html
  src/main.ts     chat, estado, exportaciones
  src/timeline.ts timeline + piano roll de clips
  src/editor.ts   editor de notas (modal)
  src/player.ts   reproducción WebAudio
  src/render.ts   mixdown offline a WAV
  src/synth.ts    síntesis compartida preview/mixdown
  src/audio-store.ts  WAV decodificados, peaks y rehidratación
  src/audio-db.ts IndexedDB de bytes WAV
  src/industrial.ts   motor DSP de one-shot industrial (Sample Lab)
  src/config.ts       flag MIDI_ENABLED / AUDIO_ONLY
src/agent/
  sample-plan.ts      petición → lista de samples
  sound-script.ts     LLM → script Python de DSP
  sound-sandbox.ts    Node → contenedor Docker/WSL
sandbox/sound/
  Dockerfile          imagen Python + numpy
  runner.py           contrato render(), validación y WAV
vite-plugin-api.ts  API local (mantiene la clave fuera del navegador)
scripts/
  bundle-run.mjs  ejecuta el SDK (imports sin extensión) con esbuild
  build-sound-sandbox.mjs  construye la imagen del sandbox
docs/
  ARCHITECTURE.md  detalle técnico y hoja de ruta
  OPENDAW.md      integración con openDAW y licencias
```

## Limitaciones conocidas

- Solo 4/4. El motor de patrones legacy asume 16 pasos por compás; el audio no depende de eso.
- El sandbox Python necesita Docker (Linux) o Docker dentro de WSL2 (Windows). Si no está,
  `/api/sound/create` falla; no se ejecuta Python arbitrario en el host.
- El LLM tarda y consume tokens: con `deepseek-v4.1-flash:1017`, un script DSP puede necesitar
  10–20k tokens de salida y decenas de segundos. Tres samples pueden tardar varios minutos.
- El script Python que genera cada sample **aún no se guarda como receta** en el proyecto; se
  persiste el WAV, no el código. Rehacer el sonido requiere volver a pedirlo.
- Los loops Python no tienen validación de continuidad sample-perfect; pueden necesitar crossfade.
- El modo MIDI está oculto y fuera del LLM, pero su código y tests siguen en el repositorio.
- El JSON del proyecto no embebe los WAV: los bytes viven en IndexedDB, en el navegador y perfil
  actuales. Si se abre el JSON en otro navegador, se borran los datos del sitio o cambia el perfil,
  hay que reimportar el audio. Exportar un proyecto autocontenido está pendiente.
- IndexedDB puede llenarse con proyectos largos (un stem de 2:40 ronda 30 MB); el navegador puede
  pedir más espacio o rechazar la escritura, y en ese caso la app avisa y mantiene el audio solo en
  la sesión.
- El export legacy a openDAW no incluye las pistas de audio y está oculto en modo audio.
- El preview legacy sintetiza instrumentos MIDI; en modo audio reproduce los clips de audio y su
  mezcla WebAudio.
- El motor de sintetizador es procedural, no neural: no imita instrumentos acústicos reales ni
  tiene capas de velocidad/round-robin. Para guitarras, voces o pianos reales hace falta una
  librería multimuestra o un modelo de audio con licencia adecuada.
- El mixdown a WAV es offline y puede tardar decenas de segundos en canciones largas.
- Sin validación musical avanzada (voz guía, conducción de voces, rango por instrumento real).
- El plan MIDI legacy puede ser musicalmente conservador; en audio, la calidad depende del
  script DSP y del sandbox, no de presets de notas.
- El coste/latencia del planificador MIDI legacy es de ~4-13 s y ~2-18k tokens de entrada por
  operación (medido con `deepseek-v4.1-flash:1017`).

## Verificado de punta a punta

| Prueba | Resultado |
|---|---|
| Canción completa ("synth pop 80s oscuro...") | 84 BPM, Re menor, 44 compases, 5 pistas, 1.385 notas, 12,6 s (web) |
| Loop ("bajo y batería, siniestro punk") | 160 BPM, Mi menor, 4 compases, 2 pistas exactas, 4,4 s |
| Edición ("sube el reverb del track 2") | Añadió reverb al bajo, 4,3 s (web) |
| Edición de audio ("mueve el audio al compás 9") | Movió el clip de 0 a 32 beats, 5,2 s |
| Piano roll manual | Añadir nota + aplicar → 468 → 469 notas, sin errores |
| Export openDAW (navegador) | 5 pistas, 25 clips, 1.385 notas, 10 FX, 2 s |
| Ida y vuelta openDAW (Node) | 6 pistas, 24 clips, 666 notas preservadas, 11 FX |
| Mixdown WAV | 2:06 → 21,5 MB, cabecera RIFF/PCM válida |

El adaptador de openDAW está implementado y verificado: `npm run test:opendaw`,
`npm run export:opendaw -- out/noche.json`.
