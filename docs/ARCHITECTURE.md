# miuzika architecture

**Status: 27-Oct-2026** (architecture review: see `docs/REVISION-2026-10-27.md`).
Everything that follows is checked against this commit's code: if something does not match,
the code wins and this file is corrected.

---

## 1. What it is, in one sentence

A DAW in the browser (openDAW WASM for playback, Strudel for patterns) with an
agent that **composes, arranges and mixes by writing directly into the project**
(transactional ops: notes, chords, effects, faders) and that, for synthesized audio,
**writes and runs Python** on your disk or on a GPU. You speak to it in
any language. The browser renders and drives.

There is no database, no production server, no cloud of our own. What there is:

| piece | where it runs | who starts it |
|---|---|---|
| GUI + agent | browser (Chrome, `localhost:5173`) | `npm run dev` |
| API + Python execution | **Vite dev server** (plugin `server/api.ts`) | the same process |
| numpy engine | your laptop, one process per script | the server |
| torch engine (GPU) | Lambda Cloud instance (SSH/SCP) | the server, with your key |
| LLM | the provider chosen in "Models" (Ollama Cloud by default), via the server proxy | the browser |

A consequence to keep in mind: **nothing is deployed**. All of this lives
inside `npm run dev`. If Vite is not running, there is no app.

---

## 2. The layers and their boundaries

```text
+----------------------------------------------------------------------------------+
| BROWSER  (web/src/)                                                               |
|                                                                                  |
| main.ts      app state, history, autosave, dialogs, startup                       |
|   |- timeline.ts / editor.ts (piano roll) / code-lab.ts (Strudel)                 |
|   |- opendaw-engine.ts (WASM) + stem-player.ts (<audio>)  same transport         |
|   |- chat.ts (panel, stores nothing) / i18n.ts (fixed es/en texts)                |
|   \- agent/                                                                       |
|       agent.ts     loop: think -> tool -> observe (12 steps max.)                 |
|       tools.ts     tools: the contract with the LLM                               |
|       acciones.ts  read/change the project ("Studio" contract)                   |
|       contexto.ts  trimming, agente.json, safe conversation trimming             |
|                                                                                  |
| llm.ts       SSE against /api/llm (the key NEVER arrives here)                     |
|                                                                                  |
| src/core/ (pure domain, shared with the server and the tests)                     |
|   types / ops (transactional) / project / theory / composicion /                 |
|   resumen / sonidos / palabras / taxonomia / buscar / nombres / rutas             |
+----------------------------------------------------------------------------------+
                                  | fetch /api/* (25 endpoints)
+----------------------------------------------------------------------------------+
| DEV SERVER  (server/)                                                            |
|                                                                                  |
| api.ts       mounts the routes in Vite (order matters: prefix match)              |
| contexto.ts  confines everything to workspace/, resolves paths, runs Python,     |
|              reads bodies with a limit, writes logs                               |
| api/         files / projects / audio / catalogo / voces / gpu / python           |
| lambda.ts    start, sync over scp, run, fetch, shut down                          |
| (vite.config.ts mounts the plugin; /api/llm uses api/proveedores.ts)              |
+----------------------------------------------------------------------------------+
             | spawn python -u                         | ssh / scp
+-----------------------------+          +-----------------------------+
| numpy ENGINE                |          | torch ENGINE                |
| workspace/codigo/           |          | workspace/gpu/              |
| dsp / instruments / midi /  |          | motor_gpu / voces_gpu       |
| render / voces / gate_voz / |          | (only on Lambda)            |
| sfz2sf2 / ...               |          |                             |
|                             |          |                             |
| WORKS workspace/obras/      |          |                             |
+-----------------------------+          +-----------------------------+
```

### Boundaries that must be respected

- **The browser does not touch the disk.** There is no IndexedDB (it was removed on purpose). Everything goes
  through `/api/*`. In `localStorage` only this remains: which project is open, whether the chat
  is collapsed, the LLM model, the cpu/GPU destination and the session's GPU spend.
- **The Ollama key and the Lambda key live in `.env`.** Only the server uses them.
  The client bundle does not contain them: `/api/llm` is a proxy.
- **The agent writes with tools, not with `fs`.** Its 20 tools are the
  only door; everything goes through `ejecutarHerramienta()` in `tools.ts`.
- **The tools speak a canonical vocabulary; the model translates.** Sound words,
  effect and instrument types, modes and patterns are `enum`s in the schema;
  chords, chord symbols; sound search, Spanish or English. The
  person writes in their language and the LLM acts as the translation layer.

---

## 3. Who is the source of truth

Three different truths, and they do not replace each other:

| question | owner | where |
|---|---|---|
| what is in the song? | **`proyectos/<slug>/proyecto.json`** | disk; the browser writes it with autosave (1.5 s after a change) |
| how does a sound sound? | **the render** (duration, peak, crest, centroid) | it is measured, not declared |
| what does the agent remember about this project? | **`proyectos/<slug>/agente.json`** | disk; 8 turns + rolling summary |

Rules derived from this:

1. **The browser is the only one that writes `proyecto.json`.** If you edit it from
   outside, the tab that has it open overwrites it on the next change. For a
   fix to survive, it has to be an **op** executed in the tab.
2. **The agent has no memory of its own.** If it is not in `agente.json` (or in its
   summary), it does not exist for it. When a project is opened, that block is injected into the
   system prompt, next to the engine manifest.
3. **The folder belongs to the project, not to its name.** `meta.carpeta` is set when it is created
   (or when opened from disk) and does not change when it is renamed. Names allow any
   alphabet (`slugDe` in `src/core/nombres.ts`, the only slug function).
4. **No WAV is stored inside the JSON.** Each asset carries its `ruta` relative to the
   project folder; the bytes live on disk. That is why the project is portable and
   why the 6-stem master is not 760 MB of base64.

---

> The same two flows, drawn: `docs/esquema-arquitectura.html` (layers) and
> `docs/flujo-aplicacion.html` (open/play and one agent turn).

## 4. The lifecycle of a turn, step by step

This is what happens when you write in the chat:

```text
1. chat.ts          submit → onSend(texto) → main.responderAlUsuario(texto)
2. main.ts          refrescarManifiesto(): requests /api/manifiesto (regenerates with ast)
                    and rebuilds the system prompt:
                       AGENTE_SISTEMA (literal, with fingerprint)
                     + project folder
                     + engine manifest (signatures)
                     + bloqueContexto(agente.json)   ← project memory
3. main.ts          starts the heartbeat (1 s) and the "thinking · N s · N tokens" bubble
4. agent.ts         while (pasos < 12):
                     chat() → llm.ts → POST /api/llm/v1/chat/completions (SSE)
                     if finish_reason == "load"      → wait with a 1-token request
                     if finish_reason == "sin_salida" → retry with reasoning_effort:none
                     if there are tool_calls → ejecutarHerramienta() one by one
5. tools.ts         each tool: fetch to the server (or to the browser, if it touches the
                    project) and returns text for the model
6. server           confines the path to workspace/, writes/runs and returns
                    {ok, codigo, salida, errores, escritos}
7. tools.ts         if the output is over 4,000 characters: head + tail to the model and
                    the whole text to _salidas/<herramienta>_<id>.txt
8. main.ts          at the end: final bubble, line "✓ N steps · N tools" and
                    agregarTurno() → POST agente.json
```

### The limits that keep a turn from eating the session

| limit | value | where | why |
|---|---|---|---|
| steps per turn | 12 | `agent.ts` | a loop cannot be infinite |
| output per request | 32,768 tokens | `agent.ts` | the model **reasons** and that spends from the same budget |
| a file written | 8,000 characters | `tools.ts` | an `escribir_fichero` of 9,700 tokens causes `load` on the next call |
| wait per request | 180 s | `llm.ts` | without a timeout, a hung request never answers |
| tool output | 4,000 characters | `contexto.ts` | a render prints hundreds of lines |

And three automatic cutoffs, each one because it already happened: **3 identical failures** in a row
cut the turn; **3 writes** without running anything cut the turn; an empty response is
retried up to **5** times (1-2-4-8-16 s) and then **one** automatic resumption.

---

## 5. The data model

`src/core/types.ts` (198 lines). It is independent of the engine: openDAW is a view.

```text
Project { schemaVersion: 1, id, name, bpm, key{tonic,mode}, timeSignature,
          lengthBars, seed, tracks[], audioAssets[], codeSources[],
          master{gainDb}, meta{createdAt,prompt?,generator?} }

Track   { id, name, kind: midi|audio, instrument{type,preset?,program?,archivo?},
          gainDb, pan, muted, solo, devices[], clips[] }

Clip    { id, name, start (beats), length (beats), notes[], audio?{assetId,offset,gainDb} }

Note    { pitch 0..127, start, duration, velocity 1..127 }
Device  { id, type, enabled, params }   ← 10 types, ranges in DEVICE_PARAMS
```

Details that matter:

- **Time is counted in beats**, not in seconds or pixels. It is converted to
  pulses (960 per beat) only when talking to openDAW, and to PPQN only when exporting MIDI.
- **A clip with audio longer than two bars lasts a whole number of bars**
  (`src/core/tiempo.ts`): the MIDI ends on its last note and the WAV carries a reverb tail;
  if they are not matched, the timeline shows two grids.
- **A clip's duration never exceeds the file**: if the agent asks for 90 bars
  of a WAV that lasts 84.17, the clip stays at 84.17 and the result says so.

### The 17 operations (`src/core/ops.ts`)

`set_song · add_track · set_track · remove_track · add_notes · replace_clip_notes ·
remove_clip · add_device · set_device · remove_device · register_audio_asset ·
add_audio_clip · set_audio_clip · set_clip_length · move_clip · duplicate_clip ·
set_master`

Each one validates with zod, is applied on a `structuredClone` and **either goes in whole or
does not go in at all**: if the project would become invalid (`validateProject`), the whole
batch is discarded and the original stays intact. That is what allows the agent to
change the project without being able to break it: `editar_proyecto` gives it these ops as is, and
the cheat sheet that the model sees comes from the schema itself (`firmasDeOps`).

### On disk

```text
workspace/
├── proyectos/<slug>/
│   ├── proyecto.json      ← the master (format miuzika-proyecto, version 1)
│   ├── agente.json        ← the agent's memory for THAT project
│   ├── entrada/           ← WAVs imported by the user
│   ├── salida/            ← WAV and MIDI generated by the agent and the engine
│   ├── sonidos/           ← .json recipe + its .wav
│   ├── samples/           ← samples brought in from the catalog (already converted)
│   └── instrumentos/      ← the project's .sf2 (gitignored)
├── codigo/                ← numpy ENGINE (shared by all projects)
├── gpu/                   ← torch ENGINE (only runs on Lambda)
├── herramientas/          ← manifest, peaks, verificar_audio, midi_lector, smoke
├── plantillas/            ← one_shot.py and others
├── catalogo/              ← 4,231 CC0 samples from VCSL (9.6 GB, gitignored)
├── obras/<slug>/          ← cancion.py (data) + tema.py (arrangement): ONE song, not an API
├── _salidas/              ← long tool outputs (outside the project on purpose)
├── _referencias/, _archivo/
```

**`_salidas/` is outside the project and is shared** for a specific reason: the
agent can call `crear_proyecto` in the middle of a turn, and a relative path that we
gave it earlier would stop pointing to the same place. Shared folders are declared
in **a single place**: `src/core/rutas.ts` (read by the server and the browser).

---

## 6. The 25 endpoints

All of them are dev-server middlewares, one or more per module in
`server/api/`; none exist in production because there is no production.

| route | method | what it does | who calls it |
|---|---|---|---|
| `/api/llm/*` | proxy | `v1/…` to the active provider with its key; `api/…` (web search) to Ollama Cloud | `llm.ts` |
| `/api/proveedores` | GET, POST | providers, key (never returned), model; `/modelos`, `/probar` | `ajustes-modelos.ts` |
| `/api/agent-log` | POST | one line per request in `tmp/llm.log` | `llm.ts` |
| `/api/build` | GET | id of the served code (stale bundle warning) | `build.ts` |
| `/api/fs/write` | POST | writes to workspace; 409 if it duplicates the engine or is `patch*.py` | `escribir_fichero` |
| `/api/fs/read` | POST | reads up to 20,000 characters | `leer_fichero` |
| `/api/fs/edit` | POST | exact search/replace; smoke if it is the engine | `editar_fichero` |
| `/api/fs/list` | GET | inventory; `?carpeta=` (by default, the project) | `listar_ficheros` |
| `/api/proyectos` | GET/POST | lists masters / reads whole / writes validating the format | `proyecto-disco.ts` |
| `/api/manifiesto` | GET | regenerates `MANIFEST.md` with `ast` and returns it | `main.ts` |
| `/api/audio` | GET | WAV with Range (streaming) | `<audio>`, `audio-store.ts` |
| `/api/audio/subir` | POST | browser WAV → `entrada/` (512 MB limit) | `proyecto-disco.ts` |
| `/api/picos` | GET | peaks for drawing the waveform, **with cache by mtime** | `audio-store.ts` |
| `/api/midi` | GET | notes from a `.mid` normalized to beats | `anadir_pistas` |
| `/api/verificar` | POST | measurements of a WAV (`verificar_audio.py`) | `verificar_audio` |
| `/api/referencia/medir` | POST | tempo, key and form of an audio file or YouTube | `medir_referencia` |
| `/api/instrumentos/crear` | POST | `.sfz` → `.sf2` inside the project | `usar_instrumento` |
| `/api/catalogo/buscar` | POST | natural-language search over 4,231 samples | `buscar_sonido`, dialog |
| `/api/catalogo/audio` | GET | listen to a sample without bringing it in | "Sounds" dialog |
| `/api/catalogo/importar` | POST | bring a converted sample into the project | `usar_sample` |
| `/api/voces` | GET | voice catalog read from the engine (`?medir=1` renders) | `listar_voces` |
| `/api/voces/nueva` | POST | gate: renders, measures and bakes the voice into `instruments.py` | `crear_voz` |
| `/api/run/python` | POST | runs a script on the laptop | `ejecutar_python` |
| `/api/run/lambda` | POST | the same contract on the GPU (409 if the script is pure numpy) | `ejecutar_python` |
| `/api/gpu/estado` | GET | phase, real rate and spend | `gpu-coste.ts` |
| `/api/gpu/encender` · `/apagar` | POST | instance lifecycle | header button |

---

## 7. The agent's 20 tools

`web/src/agent/tools.ts` is the contract with the model (schemas and dispatch);
`web/src/agent/acciones.ts`, the implementation of those that touch the project.

**Composing and producing in the project (they run in the tab):**
`leer_proyecto` · `editar_proyecto` · `escribir_progresion` · `crear_proyecto` ·
`anadir_pistas` · `ajustar_pistas` · `igualar_clips` · `usar_sample` ·
`usar_instrumento` · `crear_sonido`

**Those that talk to the server:**
`escribir_fichero` · `leer_fichero` · `listar_ficheros` · `editar_fichero` ·
`ejecutar_python` · `verificar_audio` · `buscar_sonido` · `listar_voces` ·
`crear_voz` · `medir_referencia`

Why that division: the project **can only be changed by the tab** (it owns
the master file). The tab registers its actions once with
`registrarAcciones()` and `acciones.ts` only depends on a four-method contract
(`Estudio`: proyecto, fijar, enVivo, avisar).

All of them share the same wrapper: their own timeout, cancellation with `AbortSignal`
(which in `/api/run/python` also kills the process), and if the response is over 4,000
characters it is trimmed and the whole thing is saved to `_salidas/`.

---

## 8. The two Python engines, and the underlying problem

| | `workspace/codigo/` | `workspace/gpu/` |
|---|---|---|
| technology | pure numpy (no scipy) | torch + CUDA |
| where | your laptop | Lambda (`gpu_1x_a10`, $1.29/h) |
| cost | 0 | ~3 min startup + per hour |
| what it does | timbres, MIDI, mixing, analysis, catalog | ×4 saturation, stereo IR, FFT reverb, shimmer, granular, multiband compressor, heavy voices |
| what it does **not** do | anything GPU | **does not write `.mid`** |

### Library and work: separated on 26-Oct

`codigo/` mixed two things with the same status in the manifest, and the agent
imported the second believing it was the first:

- **the library** — `dsp.py` (filters, STFT, reverb, LUFS, crest), `instruments.py`
  (24 timbres), `midi.py` (MIDI writer), `render.py` (mixing utilities:
  `place`, `reverb_st`, `StemWriter`, `write_wav`), `voces.py`, `gate_voz.py`,
  `sfz2sf2.py`, `catalogo.py`, `importar_sample.py`;
- **a work** — `cancion.py` (140 bars at 90 BPM, sections, harmony, lyrics) and the
  earlier `render.py`, which was the arrangement of **that** song.

What was wrong, specifically:

1. `cancion.py` was named as if it were infrastructure: the agent imported it and
   inherited another song's tempo and form.
2. **`dsp.py` carried the tempo inside** (`BPM = 90.0`, `SPB`, `BAR`) and the smoke test
   *forced* it to keep matching `cancion.BPM`: a lock that prevented fixing it without touching two files.
3. `render.py` was half library (what `proyectos/stahl` and
   `proyectos/ghosts-again` use) and half work.

Now:

```text
workspace/codigo/render.py            150 lines · library (place, reverb_st, StemWriter…)
workspace/codigo/dsp.py               302 lines · no BPM, no SPB, no BAR
workspace/herramientas/smoke.py                  · no cancion, no tempo
workspace/obras/quereme-despacio/
    cancion.py                        250 lines · the work's data
    tema.py                           476 lines · its gen_* and its master
workspace/_archivo/experimental-26oct/           · 21 agent scripts, archived
```

The manifest no longer lists `cancion` (7 modules, 8.9 KB of signatures). `render` still
appears: it is a real library and two projects use it.

`obras/` is not in the shared folders on purpose: it is reached with an explicit
path (`obras/<slug>/...`) from the project, not through the `COMPARTIDO` shortcut.

### The split, in practice

- Track audio → GPU (`saturar(veces=4)`, `ir_estereo(dur>=3)`, `reverb`, `shimmer`,
  `congelar`, `granular`, `compresor_multibanda`, 24 bits).
- MIDI and quick samples → local numpy, free.
- **A numpy script on Lambda is CPU at GPU prices**, and the server rejects it
  (409) *before* starting the machine: it reads the source and, if it imports
  `dsp`/`instruments`/`render`/`midi`/`cancion`/`tema` without `motor_gpu`, it stops.

---

## 9. Dangerous couplings (read before touching)

1. **Editing `vite.config.ts` or `server/` restarts the server** and kills the turn in
   flight; the open tab is left with the old JavaScript (HMR disconnects
   silently). The app detects it (`/api/build`) and offers "↻ new version".
2. **Adding a dependency requires restarting the server by hand**: Vite reoptimizes and
   the browser fails with "Failed to fetch dynamically imported module".
3. **The system prompt is a literal with a fingerprint** (`agente-prompt.ts` +
   `HUELLA_PROMPT` + a test that fails if it changes). Changing it is a deliberate act.
4. **`.sf2` files do not load with openDAW's manager**: it stays in `progress` forever
   because it reads from its OPFS. There is a custom manager in `opendaw-engine.ts`.
5. **`middlewares.use("/api/x", …)` matches by prefix**: a handler for `/api/voces`
   swallows `/api/voces/nueva` if it does not call `next()`.
6. **Play with `element.click()` does not start openDAW**: it is not a user gesture and the
   `AudioContext` stays suspended. In tests, click for real by coordinates.
7. **`confirm()` blocks the renderer in headless tests**: it must be accepted via CDP
   (`Page.handleJavaScriptDialog`) in a separate call.

---

## 10. How it is verified (the gates)

```bash
cd /c/Users/carlos/proyectos/miuzika
npx tsc --noEmit        # 0 errors
npm run test:unit       # 121 tests (pure domain: ops, project, sounds, words…)
npm test                # + contract with openDAW (export/import an .odw)
npm run build:web       # production bundle
```

And by hand, because no test covers it: open `localhost:5173`, open a project with
tracks, press play and **hear** that it sounds; save and check that `proyecto.json`
has the current `guardadoEn`.

To test tools without going through the model, the app exposes in development:

```js
await __miuzika.herramienta('anadir_pistas', JSON.stringify({ wavs:['salida/x.wav'], compases:16 }))
```

---

## 11. Known debt (honest)

**Fixed on 26-Oct** (measured before/after):

| what | before | after |
|---|---|---|
| `listar_ficheros` put the whole workspace into the context | 586,682 B (trimmed: the agent did not see its files) | 11,097 B the root · 5,022 B the project · catalog excluded |
| `ejecutar_python` returned the tree on every call | 4,231 files traversed per execution | only `escritos` (what changed in the project) |
| opening a 21-track / 11-WAV project | 38 s (one Python process per asset, serially) | 16.8 s cold · **0.5 s** with the peak cache |
| the text of the retry without reasoning was discarded | a good response was thrown away as an empty turn | it is recomputed after the retry |
| `resolveClip` with a single clip | deleted the only clip even if the name did not match | error with the list of clips |
| `fallosIguales` lived in the module | a failure from yesterday cut today's turn | per turn |
| two lists of shared folders | the browser was missing `catalogo/` | a single one in `src/core/rutas.ts` |
| `oboe` alias with a Cyrillic "е" | the oboe was not recognized | fixed |
| `boot()` with 50 dead lines | promised to open the last project (it no longer does) | real clean start |
| `leerCuerpo` without a limit | a 9 MB POST ate the memory | 413 above 8 MB |
| the engine mixed library and work | `cancion.py` and a work's `render.py` in the manifest; `dsp.BPM = 90` with a smoke test that shielded it | library in `codigo/`, work in `obras/quereme-despacio/`, `dsp` without tempo |
| `codigo/experimental/` | 21 agent scripts, two reimplementing the engine | archived in `_archivo/experimental-26oct/` |
| prompt at rest | without manifest (early exit in `cargarAgenteDelProyecto`) | 2,890 → 11,939 characters with manifest and context |

**Pending, in order of importance:**

**Resolved on 27-Oct**: "score as data" is `proyecto.json` itself with
its ops, now within the agent's reach (`leer_proyecto`, `editar_proyecto`,
`escribir_progresion`); `theory.ts` is connected; `parecidosA` was removed. The complete
list, in `docs/REVISION-2026-10-27.md`.

1. **Mixing**: there are no buses, no automation, no live meters. `set_device`
   exists but with normalized 0..1 units, not in Hz/dB/ms.
2. **Two transports**: WAVs longer than 30 s play through `<audio>`, outside
   openDAW's mixer (without track or master effects).
3. **Isolation**: the agent runs Python with the user's permissions.
4. **`openDawToProject`** is only used by the contract test, not by the UI: there is no
   `.odw` import from the app.
5. Three CSS classes used without styles (`.cancel`, `.code-example`, `.texto`).

---

## 12. File map, to orient yourself

**Browser (`web/src/`)**

| file | lines | what it owns |
|---|---|---|
| `main.ts` | 1,839 | app state, history, autosave, startup, dialogs |
| `agent/tools.ts` | 1,256 | the 20 tools: schemas, dispatch and wrapper |
| `agent/acciones.ts` | 931 | the actions on the project (`Estudio` contract) |
| `timeline.ts` | 737 | canvas: tracks, clips, waveform, drag, zoom |
| `opendaw-engine.ts` | 411 | WASM engine startup and mix synchronization |
| `llm.ts` | 374 | SSE, timeouts, retries on `load` |
| `agent/agent.ts` | 280 | the turn loop and its cutoffs |
| `chat.ts` | 258 | chat panel (persists nothing) |
| `audio-store.ts` | 239 | AudioBuffers cache + parallel hydration |
| `proyecto-archivo.ts` | 199 | serialize/validate the master |
| `stem-player.ts` | 180 | long stems via `<audio>` synchronized by clock |
| `agent/contexto.ts` | 196 | trimming, turns, `agente.json`, conversation trimming |
| `i18n.ts` | 120 | fixed page texts (es/en) |
| `editor.ts` | 175 | piano roll |
| `code-lab.ts` | 143 | Strudel editor |
| `agente-prompt.ts` | 65 | prompt with fingerprint |

**Domain (`src/`)**

| file | lines | what it owns |
|---|---|---|
| `core/ops.ts` | 688 | the 17 operations, transactional, and their cheat sheet |
| `core/sonidos.ts` | 338 | sound recipe → Python script |
| `core/palabras.ts` | 272 | 16 sound words → parameters |
| `core/taxonomia.ts` | 226 | 55 labels (GM + BST + AudioSet) and aliases |
| `core/theory.ts` | 195 | scales, chords, diatonic triads |
| `core/composicion.ts` | 166 | progression → notes, with voice leading |
| `core/resumen.ts` | 109 | what the agent sees with `leer_proyecto` |
| `core/project.ts` | 231 | create, validate, statistics, project folder |
| `core/types.ts` | 204 | the data model |
| `core/buscar.ts` | 178 | natural-language search |
| `core/nombres.ts` | 50 | slugs and normalization in any alphabet |
| `core/rutas.ts` | 46 | shared folders |
| `host/opendaw/adapter.ts` | 479 | IR ↔ openDAW project |
| `host/opendaw/mapping.ts` | 214 | 10 devices and 4 instruments to the SDK |

**Server (`server/`)**

| file | lines | what it owns |
|---|---|---|
| `api.ts` | 36 | mounts the routes |
| `contexto.ts` | 458 | shared paths, Python, bodies and logs |
| `api/ficheros.ts` | 287 | fs/*, manifest, build, agent-log |
| `api/proyectos.ts` | 88 | proyecto.json |
| `api/audio.ts` | 215 | upload, serve, peaks, MIDI, verify, reference |
| `api/catalogo.ts` | 244 | CC0 library and SFZ instruments |
| `api/voces.ts` | 188 | voice catalog and its gate |
| `api/gpu.ts` | 260 | Lambda: status, start, stop, run |
| `api/python.ts` | 162 | run a script with limit and cancellation |
| `lambda.ts` | 587 | Lambda Cloud client (API + ssh/scp) |
