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
| Playback MIDI con el engine WASM de openDAW | ✅ `WasmEngine` + `EngineWorklet`; batería Playfield con samples |
| Strudel: código → pistas MIDI editables | ✅ `note`/`s`/`stack`/`slow`/`fast`/`euclid`; worker aislado |
| Audio WAV: import, waveform, playback | ✅ |
| Mixdown a WAV | ✅ |
| Evaluación automática (8 prompts) | ✅ 8/8 |
| Tests | ✅ 113 + integración real de openDAW |
| Pistas/clips de audio dentro de openDAW | ✅ `AudioFileBox` + `AudioRegionBox`, WAV partidos en bloques de 2 min |

## Arranque

Requiere **Node 24** (ejecuta TypeScript nativamente, sin build) y una clave de Ollama Cloud.

```bash
npm install
cp .env.example .env    # y pon tu OLLAMA_API_KEY
npm run dev             # abre http://localhost:5173
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

`npm run dev` levanta Vite y la API local en **`http://localhost:5173`** (la clave del LLM
nunca llega al navegador). El servidor escucha solo en `localhost`; `127.0.0.1` no es un origen
válido para no separar el almacenamiento.

**Modo actual: híbrido.** `src/config.ts` tiene `MIDI_ENABLED=true`: MIDI es la capa de
composición/edición y el audio (samples + Rendered) la capa de sonido. Si se pone a `false`
queda el modo audio-only anterior, sin MIDI visible ni enviado al LLM.

- **Reproducción**: ▶ carga el proyecto en el engine WASM de openDAW (`WasmEngine` +
  `EngineWorklet`), no en un reproductor WebAudio casero. Las pistas de
  batería usan Playfield y un `SampleProvider` con el kit WAV de `web/public/drums`. Las pistas
  de audio (incluidos los `[Rendered]`) se cargan como `AudioFileBox`/`AudioRegionBox`; los WAV
  largos se parten en bloques de 2 minutos porque el engine no carga samples de canción completa
  de forma fiable. No hay reproductor WebAudio alternativo. Mute, solo, volumen y pan se aplican
  en caliente al proyecto vivo del engine. El servidor de Vite envía `COOP/COEP` para habilitar
  `SharedArrayBuffer`.
- **Chat**: los prompts de samples (“crea un kick industrial”, “lo mismo para batería y bajo”)
  van al planificador de samples + sandbox Python; los prompts de canción/edición MIDI van al
  planner/agente. También puede cambiar una sección: “cambia los compases 25 a 29 del Bass con
  otra melodía” genera una variación de audio, corta los clips existentes en ese rango y deja el
  resto igual.
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
- **Código / Strudel**: botón «Código». Escribes un patrón Strudel y se compila en el worker a
  pistas MIDI normales (`note`, `s`, `stack`, `slow`, `fast`, `euclid`…). Un ciclo Strudel = un
  compás. Las notas quedan editables en el piano roll y se reproducen/renderizan como cualquier
  otra pista. La fuente, el número de compases y los ids de pista se guardan en el proyecto; al
  recompilar se sustituyen esas pistas. No se ejecuta el motor de audio de Strudel. El LLM también
  puede escribir la fuente: usa la op `add_code_source` y el navegador la compila al recibir la
  respuesta. El digest incluye las fuentes `CODE` para que pueda editarlas.
- **Motor de sintetizador**: no es un modelo neural ni una librería fija. El LLM compone capas
  con osciladores, unísono/detune, FM, pitch envelope, filter envelope, ruido, drive, bitcrush,
  EQ, delay y reverb. Con esos primitivos puede pedir kicks, snares, bajos, plucks, pads, risers,
  texturas o impactos, en cualquier estilo. La macro industrial es un preset interno de
  one-shot, no una opción aparte en la UI.
- **Proyecto híbrido**: pistas MIDI editables y pistas de audio conviven en la timeline. Las
  pistas MIDI se pueden renderizar a audio con Rendered y comparar; las pistas de audio se
  reproducen como clips WAV.
- **Deshacer/rehacer**: botones ↶ ↷ (Ctrl+Z / Ctrl+Shift+Z) con historial de las últimas 8
  versiones, persistente al recargar. Cada mensaje del chat, edición del piano roll, importación
  o generación guarda una versión.
- **Reproducibilidad**: el proyecto guardado contiene las notas, la semilla y los FX; al pulsar ▶
  suena exactamente igual. Volver a generar desde el mismo prompt crea una canción nueva (el LLM
  no es determinista); para conservar una versión concreta, exporta el JSON. Si el proyecto
  contiene audio, exporta también WAV o stems: el JSON no embebe los bytes.
- **Piano roll**: doble clic en un clip MIDI. Clic añade, arrastrar mueve, clic derecho borra.
- **Congelar**: convierte pistas MIDI en clips de audio con el motor WebAudio, sin buses ni
  máster. Eliges pista por pista con sus FX.
- **Rendered**: con pistas MIDI seleccionadas, renderiza una pista Python por track con las
  voces de Rendered, añade una pista `[Rendered]` y silencia la MIDI original para comparar.
  Es el A/B contra el motor WebAudio; se puede deshacer.
- **Proyecto persistente**: el proyecto y el historial se guardan en `localStorage` y también en
  IndexedDB (`miuzika-projects`). Si `localStorage` falla por cuota, la copia de IndexedDB sigue.
  Al arrancar, si no hay proyecto local, se recupera la última copia de IndexedDB.
- **WAV persistentes**: los importados, los del Sample Lab y los de Congelar/Rendered viven en
  IndexedDB (`miuzika` / `audio-assets`) y se rehidratan al recargar. Si se perdió el proyecto
  pero quedan WAV, se crea un proyecto de recuperación con una pista por WAV al inicio (la
  disposición original no se reconstruye). El JSON solo lleva metadatos.
- **Audio**: botón «Audio» importa WAV al playhead, dibuja la forma de onda y lo reproduce.
- **WAV**: mixdown final del proyecto con master, limitador y normalización de loudness.
- **Stems**: un WAV por pista, con sus FX y sin máster; exporta todas o solo la selección.
- **MIDI**: exportación Standard MIDI de las pistas MIDI.
- **openDAW**: exportación `.odw`; solo soporta MIDI y avisa de que el audio sigue pendiente
  (`SampleService`/`AudioFileBox`).
- **JSON**: proyecto canónico con notas, FX, semilla y metadatos. No incluye los WAV; esos viven
  en IndexedDB. Para mover el proyecto a otro navegador hay que reimportar el audio.

### Sandbox Python

El sandbox de samples usa `/api/sound/create`: el LLM escribe un script Python con
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
- **Rendered track**: `/api/rendered/track` renderiza una pista MIDI completa con las voces de
  `rendered/` (`voices_drums`, `voices_synths`) y devuelve WAV. La UI añade la pista
  `[Rendered]` y silencia la MIDI original. Es independiente del LLM y del planner.

Build de producción: `npm run build:web` y `npm run preview`. La API local vive en un plugin de
Vite; para desplegar de verdad hará falta un servidor Node aparte que exponga `/api/*` y un
runner de contenedores separado.

### LLM (obligatorio)

Configura `OLLAMA_API_KEY` en `.env` (ver `.env.example`). En modo híbrido el modelo puede
devolver un **plan de canción MIDI** (SongPlan) o un **plan de samples + scripts DSP**.

El plan MIDI pasa tres filtros antes de tocar el proyecto:

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

El pipeline MIDI (`SongPlan` → `composePlan` → `Op[]` → MIDI/openDAW) es la capa de composición
con `MIDI_ENABLED=true`; con `false` queda aparcado y la app funciona solo con audio.

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
  src/opendaw-engine.ts playback único con WasmEngine + EngineWorklet
  src/code-lab.ts editor Strudel
  src/strudel-compiler.ts patrón Strudel → notas MIDI
  src/strudel-worker.ts worker aislado de Strudel
  src/strudel-client.ts puente UI ↔ worker
  public/drums/   kit WAV para Playfield
  public/opendaw-wasm/  engine.wasm + plugins del engine
  src/render.ts   mixdown offline a WAV
  src/synth.ts    síntesis compartida preview/mixdown
  src/audio-store.ts  WAV decodificados, peaks y rehidratación
  src/audio-db.ts IndexedDB de bytes WAV
  src/project-db.ts IndexedDB de proyecto + historial
  src/industrial.ts   motor DSP de one-shot industrial (Sample Lab)
  src/config.ts       flag MIDI_ENABLED / AUDIO_ONLY
rendered/             motor Python Rendered (dsp_core + voces + mezcla)
  dsp_core.py
  voices_drums.py
  voices_synths.py
  mix_master.py
  reference/          canción/contrato de referencia
src/agent/
  sample-plan.ts      petición → lista de samples
  sound-script.ts     LLM → script Python de DSP
  sound-sandbox.ts    Node → contenedor Docker/WSL
  rendered-track.ts   pista MIDI → WAV con Rendered
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
- El cambio de sección funciona con clips alineados al compás; si un clip de audio empieza a
  mitad de compás, todavía no se corta con precisión. Tampoco hay crossfade automático en los
  empalmes.
- Rendered es offline y usa 1 CPU: una pista de 3 minutos puede tardar bastante; el WAV sale a
  44,1 kHz/16 bits y se reinserta como clip de audio.
- Rendered mapea el tipo de instrumento de la pista a sus voces (batería, bajo, pad, strings,
  choir, lead, pluck); no reproduce articulaciones MIDI avanzadas ni samplea un instrumento real.
- En el A/B, la pista MIDI original se silencia y se añade `[Rendered]`; los niveles pueden
  diferir y hay que ajustar gain/pan a oído.
- El JSON del proyecto no embebe los WAV: los bytes viven en IndexedDB, en el navegador y perfil
  actuales. Si se abre el JSON en otro navegador, se borran los datos del sitio o cambia el perfil,
  hay que reimportar el audio. Exportar un proyecto autocontenido está pendiente.
- IndexedDB puede llenarse con proyectos largos (un stem de 2:40 ronda 30 MB); el navegador puede
  pedir más espacio o rechazar la escritura, y en ese caso la app avisa y mantiene el audio solo en
  la sesión.
- El proyecto se guarda por origen. Usa siempre `http://localhost:5173`; `127.0.0.1` y otros
  puertos tienen otro almacenamiento. Si se borran los datos del sitio, no hay recuperación.
- Si solo sobreviven los WAV, el recuperador los coloca al inicio como pistas sueltas; no puede
  reconstruir la posición original de los clips.
- El export a openDAW no incluye las pistas de audio (`SampleService`/`AudioFileBox` pendiente).
- Todo el playback (MIDI, batería y WAV) usa openDAW. Los WAV largos se copian a memoria y se
  parten en bloques: el primer ▶ de una canción con 10 stems puede tardar varios segundos.
  Rendered es un motor distinto y no lee la cadena de FX de la pista MIDI.
- Strudel está integrado como compilador de patrones, no como motor de audio: no soporta
  samples/efectos propios de `superdough` ni señales continuas. Sonidos desconocidos se avisan.
- El motor de sintetizador es procedural, no neural: no imita instrumentos acústicos reales ni
  tiene capas de velocidad/round-robin. Para guitarras, voces o pianos reales hace falta una
  librería multimuestra o un modelo de audio con licencia adecuada.
- El mixdown a WAV es offline y puede tardar decenas de segundos en canciones largas.
- Sin validación musical avanzada (voz guía, conducción de voces, rango por instrumento real).
- El plan MIDI puede ser musicalmente conservador; en audio, la calidad depende de las voces de
  Rendered y del script DSP, no de presets de notas.
- El coste/latencia del planificador MIDI es de ~4-13 s y ~2-18k tokens de entrada por
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
| Playback engine openDAW | “La estática como oración”: 10 pistas MIDI, 6.192 notas; ▶ sin fallback, batería sampleada, pico de máster ≈0,46 |
| Ida y vuelta openDAW (Node) | 6 pistas, 24 clips, 666 notas preservadas, 11 FX |
| Mixdown WAV | 2:06 → 21,5 MB, cabecera RIFF/PCM válida |

El adaptador de openDAW está implementado y verificado: `npm run test:opendaw`,
`npm run export:opendaw -- out/noche.json`.
