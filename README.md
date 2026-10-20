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

- **Chat**: si el proyecto está vacío, la primera petición planifica una canción completa; las
  siguientes editan con herramientas (`apply_ops`, `undo`, digest…).
- **Timeline**: clic para mover el playhead, Ctrl+rueda para zoom, clic en la cabecera para mute.
- **Piano roll**: doble clic en un clip MIDI. Clic añade, arrastrar mueve, clic derecho borra.
  Al aplicar se emite `replace_clip_notes` (la misma validación que usa el LLM).
- **Audio**: botón «Audio» importa WAV al playhead, dibuja la forma de onda y lo reproduce.
  Los bytes no se guardan en el JSON; al recargar hay que volver a importarlos.
- **Exportar**: WAV (mixdown offline), MIDI, proyecto openDAW (`.odw`) y JSON.

Build de producción: `npm run build:web` y `npm run preview`. La API local vive en un plugin de
Vite; para desplegar de verdad hará falta un servidor Node aparte que exponga `/api/*`.

### LLM (obligatorio)

El asistente es la ruta normal: configura `OLLAMA_API_KEY` en `.env` (ver `.env.example`).
El modelo devuelve un **plan** que pasa tres filtros antes de tocar el proyecto:

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

```
 lenguaje natural
       │
       ├─► restricciones (deterministas) ──┐
       │                                   ▼
       └─► planificador LLM ──► SongPlan (JSON)  ← validado y reintentado
                                      │
                                      ▼
                            composePlan() → Op[]
                                      │
                                      ▼
                     applyOps()  (validación + transacción + undo)
                                      │
                                      ▼
                         Project (IR canónico, beats)
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
                  export MIDI                 adaptador openDAW
```

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
  src/audio-store.ts  WAV decodificados y peaks
vite-plugin-api.ts  API local (mantiene la clave fuera del navegador)
scripts/
  bundle-run.mjs  ejecuta el SDK (imports sin extensión) con esbuild
docs/
  ARCHITECTURE.md  detalle técnico y hoja de ruta
  OPENDAW.md      integración con openDAW y licencias
```

## Limitaciones conocidas

- Solo 4/4. El motor de patrones asume 16 pasos por compás.
- Los WAV no se persisten en el proyecto: el JSON guarda metadatos, no los bytes. Al recargar hay
  que volver a importarlos (IndexedDB/OPFS es el siguiente paso).
- El export a openDAW no incluye las pistas de audio (necesita `SampleService`/`AudioFileBox`).
- El preview sintetiza los instrumentos (capas, envolventes, dinámica) y aproxima la cadena de
  FX del proyecto; no es el motor de openDAW, así que no suena idéntico al `.odw`.
- El mixdown a WAV es offline y puede tardar decenas de segundos en canciones largas.
- Sin validación musical avanzada (voz guía, conducción de voces, rango por instrumento real).
- El plan del LLM puede ser musicalmente conservador: los presets y la validación garantizan
  coherencia, no originalidad. Para hooks y forma larga hace falta intervención humana.
- El coste/latencia del planificador es de ~4-13 s y ~2-18k tokens de entrada por operación
  (medido con `deepseek-v4.1-flash:1017`).

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
