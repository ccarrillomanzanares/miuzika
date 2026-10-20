# Arquitectura

## Principio

El DAW no es el problema. Lo difícil es que una frase en español se convierta en un cambio
musical **válido, coherente y reversible**. Por eso el sistema separa tres capas y solo una
usa el LLM.

```
[1] Intención      lenguaje natural → SongPlan / lista de Op
[2] Símbolos       Project (beats) → notas, clips, dispositivos
[3] Audio          motor del host → samples, síntesis, render
```

`[1]` es probabilístico y barato de regenerar. `[2]` es determinista y testeable. `[3]` es lo
único que suena, y se delega en openDAW.

## Modelo de tiempo

Todo el IR usa **beats** (negras) en coma flotante. No hay samples ni ticks en el modelo.
La conversión ocurre solo al exportar:

- MIDI: `tick = beat × 960`
- openDAW: `position = beat × PPQN` (constante de `@opendaw/lib-dsp`)

Así el mismo proyecto se puede renderizar a cualquier sample rate y el modelo no arrastra
decisiones del motor.

## IR

`src/core/types.ts`

```
Project
 ├─ bpm, key {tonic, mode}, timeSignature, lengthBars, seed
 ├─ master {gainDb}
 └─ Track[]
     ├─ id, name, kind (midi|audio), instrument
     ├─ gainDb, pan, muted, solo
     ├─ Device[]  (reverb, delay, chorus, distortion, filter, eq, compressor, bitcrusher, gate, width)
     └─ Clip[]
         ├─ start, length (beats absolutos)
         ├─ Note[]  (pitch, start relativo, duration, velocity)
         └─ audio?  (assetId, offset, gainDb) ← reservado para WAV
```

Invariantes que se validan en cada cambio (`src/core/project.ts`):

- pitch 0..127 entero, velocity 1..127, duración > 0
- ganancias -60..12 dB, pan -1..1
- parámetros de dispositivo dentro de rango y **con nombre conocido**
- ids únicos, clips no solapados (aviso), máximo 64 pistas y 200k notas
- si hay errores, la transacción no se aplica

## Operaciones

`src/core/ops.ts`. Es el **único** vocabulario de cambio, compartido por UI, LLM y tests.

| Op | Uso |
|---|---|
| `set_song` | nombre, bpm, tonalidad, compases, semilla |
| `add_track` / `remove_track` / `set_track` | alta, baja, gain/pan/mute/solo |
| `generate_part` | **la importante**: rol + estilo + compases + densidad + acordes → notas |
| `add_notes` / `replace_clip_notes` / `remove_clip` | edición quirúrgica |
| `add_device` / `set_device` / `remove_device` | cadena de efectos |
| `set_master` | ganancia global |

`generate_part` es lo que hace viable la canción completa: el modelo manda ~10 números por
sección y el motor genera cientos de notas.

```json
{"op":"generate_part","trackId":"trk_bass","startBar":12,"section":"chorus",
 "pattern":{"role":"bass","style":"driving8","bars":8,"octave":2,
            "chords":["Dm","Bb","F","C"],"density":0.8}}
```

### Resolución de referencias

El modelo ve ids (`trk_bass`) y también puede usar nombre exacto o índice 1-based (`"2"`).
La resolución está centralizada y los errores enumeran las alternativas, lo que permite que
el bucle de reparación funcione con modelos pequeños.

## Determinismo

`expandPattern` usa `mulberry32(hash(seed, pattern.seed, rol, estilo))`.

- misma entrada → mismas notas (tests, diffs, undo)
- semilla distinta → variación musical (botón "otra versión")
- el `seed` del proyecto se guarda en el JSON

Esto es también lo que permite evaluar el pipeline sin LLM (`--offline`): es el mismo motor,
solo cambia quién escribe el plan. No es una ruta del producto.

## Estrategia LLM

### Fase 1 — plan

`src/agent/planner.ts`

El modelo devuelve un `SongPlan` (JSON) que pasa tres filtros antes de aplicarse:

1. **zod** (`parseSongPlan`): forma y tipos.
2. **normalizePlan**: sinónimos de parámetros de DAW (`size`→`decay`, `mix`→`wet`,
   `amount`→`width`…) y recorte a rango. El modelo no tiene que adivinar nuestro vocabulario.
3. **validatePlan + checkConstraints**: estilos existentes, parámetros conocidos, roles con
   pista, acordes parseables, octavas razonables, y las **restricciones duras** del prompt.

Las restricciones (`extractConstraints`) se extraen de forma determinista: tonalidad explícita,
BPM exacto o rango por adjetivo ("lenta"), compases, "sin batería", loops y roles mencionados.
El LLM decide la música; esto impide que ignore lo que el usuario pidió.

Si algún filtro falla, el error se devuelve al modelo como feedback y se reintenta (máximo 3
intentos, temperatura 0.8 → 0.4). No hay fallback silencioso.

### Fase 2 — expansión

`composePlan(plan)` → `Op[]` → `applyOps` → `Project`. Cero tokens.

### Fase 3 — edición conversacional

`src/agent/agent.ts` + `src/agent/tools.ts`

Cuatro herramientas: `get_project_digest`, `apply_ops`, `check_project`, `undo`.

- el *digest* es un resumen (~2 KB), nunca el proyecto entero
- `apply_ops` es transaccional; el error vuelve al modelo con las pistas disponibles
- máximo 8 pasos y 200 ops por llamada
- si el modelo se queda sin texto final, se le pide un resumen

El esquema JSON de las ops se genera desde zod (`z.toJSONSchema`): una sola fuente de verdad
para validación y tool-calling.

### Por qué no dejamos que escriba notas

Una canción de 3 minutos son ~90 compases y ~5.000 eventos. En JSON son >100k tokens, el modelo
pierde la forma global y el resultado es incoherente. Con plan + patrones, el modelo toma las
decisiones de alto nivel (donde es bueno) y el código resuelve el detalle (donde es fiable).

## Evaluación

`src/cli/eval.ts` ejecuta 8 prompts dorados y comprueba:

- proyecto válido, sin pistas vacías, notas en rango
- tonalidad, modo, duración y género esperados
- presencia/ausencia de batería y distorsión
- que el MIDI se genere con cabecera válida

Es el mismo arnés que se usaría para comparar modelos o prompts. Para el LLM habría que añadir
una métrica subjetiva (A/B a ciegas) y una de coste/latencia.

## Host: openDAW

Dos capas para que el SDK no contamine el núcleo:

- `src/host/opendaw/mapping.ts`: funciones puras (beats→pulsos, dB, parámetros, instrumentos).
  Se testea con `node:test` y sobrevive a cambios del SDK.
- `src/host/opendaw/adapter.ts`: imports dinámicos del SDK, transacción `editing.modify`,
  serialización y lectura.

Decisiones:

- `Project.new(env)` funciona **sin navegador** con shims mínimos (`shims.ts`): se puede exportar
  y verificar en Node, no solo en la web.
- openDAW usa **960 PPQN**, igual que nuestro export MIDI: la conversión es directa.
- Los parámetros se traducen a unidades reales (dB, ms, Hz); los nombres de dispositivo no
  coinciden, así que la tabla es explícita y falla si no hay mapeo.
- Dispositivos sin equivalente exacto se aproximan: chorus → delay corto modulado; filtro → low-pass
  de Revamp; EQ → tres bandas de Revamp.
- El import lee `AudioUnitBoxAdapter` + `NoteRegionBoxAdapter`; los FX no se reconstruyen todavía.
- El audio no se exporta a openDAW: requiere `AudioFileBox` y `SampleService`.

## Audio

Implementado en el spike:

- IR: `project.audioAssets` (metadatos) + `clip.audio` (assetId, offset, gain).
- Ops: `register_audio_asset`, `add_audio_clip`, `set_audio_clip` (mover, recortar, ganancia).
- El LLM ve los assets en la línea `AUDIO` del digest y puede colocarlos o moverlos.
- En el navegador, el mapa de assets vive en `web/src/audio-store.ts` (decode + peaks) y los bytes
  se guardan en IndexedDB (`web/src/audio-db.ts`, base `miuzika`, store `audio-assets`). Al arrancar
  y antes de un undo/redo, `hydrateProjectAudio` decodifica los WAV que referencia el proyecto;
  si falta alguno se avisa y se puede reimportar.
- Preview y mixdown comparten instrumentos y FX: `web/src/synth.ts` (capas, envolventes,
  brillo dependiente de velocidad, drums sintetizados) y `web/src/fx.ts` (reverb por convolución,
  delay con damping, chorus, drive, filtro, EQ de 3 bandas, compresor; master con compresión y
  saturación suave). Se aproxima el proyecto, no es el motor de openDAW.
- Mixdown: `OfflineAudioContext` → PCM 16-bit (`web/src/render.ts`). Es offline, puede tardar.
  Una canción de 2:06 ronda los 20 MB y decenas de segundos de render.
- Sample Lab con dos formatos de usuario: **one-shot** y **loop**. El one-shot usa el motor
  general de capas o, internamente, la macro industrial; la UI no separa estilos ni motores.
- Motor general: one-shots de 1-4 capas con osciladores,
  unísono/detune, FM, pitch envelope (`glide`), filter envelope, ruido, pan, drive, bitcrush,
  EQ, delay y reverb (`web/src/sample-render.ts`). El LLM compone los primitivos según el sonido.
- Macro **industrial** (`web/src/industrial.ts`): one-shot procedural puro (Float32Array,
  testeable en Node) con stack de sierras detuneadas y pitch-drop, sub, FM inarmónica, transitorio
  de ruido, saturación tanh asimétrica, bitcrush, SVF TPT con barrido de cutoff, taps de delay y
  ensanchado Haas. Es una macro de ejemplo, no el único motor; `IndustrialSpec` expone sus
  parámetros y `sample-render.ts` lo convierte en `AudioBuffer`/WAV.
- «Congelar» (`web/src/bounce.ts`, `bounce-dialog.ts`): MIDI→audio con el motor WebAudio. El
  usuario elige pistas MIDI una a una; cada una se renderiza sola con sus FX, sin buses ni máster
  (`buses: false`), y se sustituye por una pista de audio. Los WAV se guardan en IndexedDB.
- **Rendered** (`src/agent/rendered-track.ts`, `sandbox/sound/render_track.py`): renderiza las
  pistas MIDI seleccionadas con las voces Python de `rendered/`; añade una pista `[Rendered]` y
  silencia la MIDI original para comparar. Es el A/B contra Congelar/WebAudio.
- **Modo híbrido** (`src/config.ts`): `MIDI_ENABLED=true` mantiene MIDI como capa de
  composición/edición y audio como capa de sonido. Con `false` se ocultan MIDI, Congelar y
  openDAW, se filtran pistas MIDI de la timeline/player y se bloquean `/api/generate` y
  `/api/chat`. El código y los tests MIDI se conservan.
- **Edición de secciones de audio** (`web/src/main.ts`): `parseAudioEdit` detecta pista + rango
  de compases y `replaceAudioRange` genera una variación con el sandbox, elimina/parte los clips
  que solapan el rango y coloca el nuevo clip. Requiere clips alineados al compás; no hay
  crossfade automático todavía.
- **Sandbox Python** (`sandbox/sound`, `src/agent/sound-sandbox.ts`): el LLM escribe
  `render(sr, duration, params, seed)`; un contenedor Docker (o Docker dentro de WSL2) lo ejecuta
  con `--network none`, root read-only, tmpfs, sin capabilities, límites de CPU/memoria/pids y
  timeout. El runner valida imports y AST, prohíbe I/O/red/exec, comprueba NaN/forma y normaliza
  a −1 dBFS. El WAV vuelve al navegador y se monta como pistas de audio.

Siguiente fase de audio:

1. **Receta reproducible**: guardar código + params + seed junto al WAV y permitir re-render.
2. **Loops sample-perfect**: crossfades/validación de continuidad y time-stretch.
3. **Export autocontenido** (ZIP con WAV) y export a openDAW audio (`AudioFileBox`).
4. **Asistente de mezcla**: análisis de loudness/espectro → automatización.
5. **Generación neural**: ACE-Step (Apache-2.0/MIT) o Stable Audio con licencia revisada.
6. **Coherencia multitrack**: mezcla completa + Demucs (MIT) para stems editables.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Musicalidad del LLM | plan + patrones deterministas, presets por género, A/B humano |
| Alucinación de estado | digest obligatorio, ids resueltos, errores accionables |
| Coste/latencia | plan corto, edición por tools, cache de planes, modelo flash para ops |
| Licencias | openDAW AGPL o comercial; modelos con allowlist; samples CC0 |
| Sin VST3 en web | catálogo propio de instrumentos; escritorio (Tracktion/JUCE) si se targetea pro |
| Código Python malicioso | contenedor sin red/read-only/caps/límites + allowlist AST; nunca en el host |
| Deriva de esquema | zod como fuente única + tests de contrato |
