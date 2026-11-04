# miuzika architecture

**Status: 4-Nov-2026**, checked against the code that day (reviews: `docs/REVISION-2026-10-27.md`,
`docs/REVISION-2026-11-03.md`). If something does not match, the code wins and this file is
corrected. Counts that change every week (lines per file, tests) are left out on purpose: they
are what made the 27-Oct version wrong within days.

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
|       agent.ts     loop: think -> tool -> observe (80 steps max.)                 |
|       tools.ts     tools: the contract with the LLM                               |
|       acciones.ts  read/change the project ("Studio" contract)                   |
|       contexto.ts  trimming, agente.json, safe conversation trimming             |
|                                                                                  |
| llm.ts       SSE against /api/llm (the key NEVER arrives here)                     |
|                                                                                  |
| src/core/ (pure domain, shared with the server and the tests)                     |
|   types / ops (transactional) / project / proyecto-archivo / theory / notacion /  |
|   pistas / tiempo / resumen / escucha / versiones / sonidos / bateria / ...       |
+----------------------------------------------------------------------------------+
                                  | fetch /api/* (section 6)
+----------------------------------------------------------------------------------+
| DEV SERVER  (server/)                                                            |
|                                                                                  |
| api.ts       mounts the routes in Vite (order matters: prefix match)              |
| contexto.ts  what every route shares: workspace paths, Python, GPU, logs          |
| ruta.ts      rutaJson (method, body limit, JSON, errors) + tmp/api.log            |
| proceso.ts   one way to spawn a process (timeout, cancel, tree kill)              |
| dentro.ts    "is this path inside that folder", once                              |
| api/         ficheros / proyectos / audio / catalogo / voces / gpu / python /     |
|              proveedores (LLM proxy, GPU settings) / precios / pad / trayectorias |
| gpu/         ProveedorGpu interface; lambda.ts is the first provider              |
| (vite.config.ts mounts the plugin)                                                |
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
- **The agent writes with tools, not with `fs`.** Its tools (section 7) are the
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
4. agent.ts         while (pasos < 80):
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
| steps per turn | 80 | `agent.ts` | a loop cannot be infinite (12 cut real songs short) |
| output per request | 32,768 tokens | `agent.ts` | the model **reasons** and that spends from the same budget |
| a file written | 8,000 characters | `tools.ts` | an `escribir_fichero` of 9,700 tokens causes `load` on the next call |
| wait per request | 180 s | `llm.ts` | without a timeout, a hung request never answers |
| tool output | 4,000 characters | `contexto.ts` | a render prints hundreds of lines |

And automatic cutoffs, each one because it already happened: **3 identical failures** of a tool in
a row cut the turn; **4 cycles** of "write the script, run it, it fails" cut the turn (4 writes
in a row only earn a warning, 8 cut); an empty response is retried up to **5** times
(1-2-4-8-16 s) and then **one** automatic resumption. A turn forced to call a tool (the ACE-Step
box) is offered only that tool and the few it needs, and stops with the real error if it fails.

---

## 5. The data model

`src/core/types.ts`. It is independent of the engine: openDAW is a view.

```text
Project { schemaVersion: 1, id, name, bpm, key{tonic,mode}, timeSignature,
          lengthBars, seed, tracks[], buses[], audioAssets[], codeSources[],
          master{gainDb}, meta{createdAt,prompt?,generator?,carpeta?} }

Track   { id, name, kind: midi|audio, instrument{type,preset?,program?,archivo?},
          gainDb, pan, muted, solo, devices[], clips[], sends[] }

Bus     { id, name, gainDb, devices[] }   <- tracks feed it with sends (dB, post-fader)

Clip    { id, name, start (beats), length (beats), notes[], audio?{assetId,offset,gainDb} }

Note    { pitch 0..127, start, duration, velocity 1..127 }
Device  { id, type, enabled, params }   ← 10 types, real units (Hz, dB, ms) in DEVICE_PARAMS
```

Details that matter:

- **Time is counted in beats** (quarter notes), not in seconds or pixels. It is converted to
  pulses (960 per beat) only when talking to openDAW, and to PPQN only when exporting MIDI.
  Seconds and beats convert through `src/core/tiempo.ts`; bars through `beatsPerBar(project)`.
- **A clip with audio longer than two bars lasts a whole number of bars**
  (`src/core/tiempo.ts`): the MIDI ends on its last note and the WAV carries a reverb tail;
  if they are not matched, the timeline shows two grids.
- **A clip's duration never exceeds the file**: if the agent asks for 90 bars
  of a WAV that lasts 84.17, the clip stays at 84.17 and the result says so.

### The operations (`src/core/ops.ts`, 22 on 4-Nov)

`set_song · add_track · set_track · set_instrument · remove_track · add_notes ·
replace_clip_notes · remove_clip · add_device · set_device · remove_device · add_bus ·
set_bus · remove_bus · set_send · register_audio_asset · add_audio_clip · set_audio_clip ·
set_clip_length · move_clip · duplicate_clip · set_master`

Tracks are found by `buscarPista` (`src/core/pistas.ts`): id, name without accents or case,
id prefix, "pista 2". The same finder serves ops, versions, the agent's actions and listening.

Each one validates with zod, is applied on a `structuredClone` and **either goes in whole or
does not go in at all**: if the project would become invalid (`validateProject`), the whole
batch is discarded and the original stays intact. That is what allows the agent to
change the project without being able to break it: `editar_proyecto` gives it these ops as is, and
the cheat sheet that the model sees comes from the schema itself (`firmasDeOps`).

### On disk

```text
workspace/
├── proyectos/<slug>/
│   ├── proyecto.json      ← the master (format in `src/core/proyecto-archivo.ts`)
│   ├── agente.json        ← the agent's memory for THAT project
│   ├── entrada/           ← WAVs imported by the user
│   ├── salida/            ← WAV, MIDI and MP3 exports, and what the engine generates
│   ├── versiones/         ← snapshots before each agent turn (`versiones` tool)
│   ├── trayectorias/      ← one whole agent turn per file
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

## 6. The endpoints

All of them are dev-server middlewares, one or more per module in
`server/api/`; none exist in production because there is no production.

| route | method | what it does | who calls it |
|---|---|---|---|
| `/api/llm/*` | proxy | `v1/…` to the active provider with its key; `api/…` (web search) to Ollama Cloud | `llm.ts` |
| `/api/proveedores` | GET, POST | providers, key (never returned), model; `/modelos`, `/probar` | `ajustes-modelos.ts` |
| `/api/agent-log` | POST | one line per request in `tmp/llm.log`, priced (`coste_usd`, `tarifa`) | `llm.ts` |
| `/api/precios` | GET, POST | OpenRouter price list cached in `.miuzika/precios.json` (daily); `?proveedor=&modelo=` gives the rate; `/refrescar` | `coste-llm.ts` |
| `/api/trayectorias` | POST | one whole turn (conversation, real tool arguments, full results, project after, cost, listening verdict) → `proyectos/<slug>/trayectorias/` | `main.ts` |
| `/api/build` | GET | id of the served code (stale bundle warning) | `build.ts` |
| `/api/fs/write` | POST | writes to workspace; 409 if it duplicates the engine or is `patch*.py` | `escribir_fichero` |
| `/api/fs/read` | POST | reads up to 20,000 characters | `leer_fichero` |
| `/api/fs/edit` | POST | exact search/replace; smoke if it is the engine | `editar_fichero` |
| `/api/fs/list` | GET | inventory; `?carpeta=` (by default, the project) | `listar_ficheros` |
| `/api/proyectos` | GET/POST | lists masters / reads whole / writes validating the format | `proyecto-disco.ts` |
| `/api/manifiesto` | GET | regenerates `MANIFEST.md` with `ast` and returns it | `main.ts` |
| `/api/audio` | GET | WAV or MP3 with Range (streaming) | `<audio>`, `audio-store.ts` |
| `/api/audio/mp3` | POST | WAV in `salida/` → 320 kbps MP3 with ffmpeg | MP3 button |
| `/api/audio/subir` | POST | browser WAV → `entrada/` (512 MB limit) | `proyecto-disco.ts` |
| `/api/picos` | GET | peaks for drawing the waveform, **with cache by mtime** | `audio-store.ts` |
| `/api/midi` | GET | notes from a `.mid` normalized to beats | `anadir_pistas` |
| `/api/verificar` | POST | measurements of a WAV (`verificar_audio.py`) | `verificar_audio` |
| `/api/referencia/medir` | POST | tempo, key and form of an audio file or YouTube | `medir_referencia` |
| `/api/instrumentos/crear` | POST | `.sfz` → `.sf2` inside the project (level matched to GM) | `usar_instrumento` |
| `/api/gm` | GET | where the General MIDI SoundFont is | `main.ts` (GM tracks) |
| `/api/catalogo/buscar` | POST | natural-language search over 4,231 samples | `buscar_sonido`, dialog |
| `/api/catalogo/audio` | GET | listen to a sample without bringing it in | "Sounds" dialog |
| `/api/catalogo/importar` | POST | bring a converted sample into the project | `usar_sample` |
| `/api/voces` | GET | voice catalog read from the engine (`?medir=1` renders) | `listar_voces` |
| `/api/voces/nueva` | POST | gate: renders, measures and bakes the voice into `instruments.py` | `crear_voz` |
| `/api/run/python` | POST | runs a script on the laptop | `ejecutar_python` |
| `/api/run/lambda` | POST | the same contract on the GPU (409 if the script is pure numpy) | `ejecutar_python`, `generar_audio`, `proponer_midi` |
| `/api/transcribir` | POST | WAV → MIDI with basic-pitch (`.miuzika/bp`), into `transcripciones/` | `transcribir_audio` |
| `/api/gpu/estado` | GET | phase, real rate and spend | `gpu-coste.ts` |
| `/api/gpu/encender` · `/apagar` | POST | instance lifecycle | header buttons (⏻ Off) |
| `/api/proveedores/gpu` | GET, POST | GPU providers and their settings (Lambda first) | Models → GPU |
| `/api/pad/estado` · `/eventos` · `/orden` | GET, POST | the touchpad as an instrument | `pad.ts`, `herramientas/` |

---

## 7. The agent's tools

`web/src/agent/tools.ts` is the contract with the model (schemas and dispatch);
`web/src/agent/acciones.ts`, the implementation of those that touch the project.

31 on 4-Nov. The list the model gets is narrowed per turn (`herramientasDelTurno`): with the
selector on CPU, `generar_audio` and `proponer_midi` are not offered.

**Composing and producing in the project (they run in the tab):**
`leer_proyecto` · `editar_proyecto` · `escribir_notas` · `escribir_bateria` ·
`escribir_progresion` · `crear_proyecto` · `anadir_pistas` · `ajustar_pistas` ·
`igualar_clips` · `usar_sample` · `usar_instrumento` · `listar_instrumentos` ·
`crear_sonido` · `generar_audio` · `transcribir_audio` · `proponer_midi` · `versiones`

**Listening and exporting (they render with the same engine as Play):**
`escuchar_mezcla` · `exportar` (MIDI and WAV; MP3 is a button, not a tool, by Carlos's decision)

**Those that talk to the server or the web:**
`escribir_fichero` · `leer_fichero` · `listar_ficheros` · `editar_fichero` ·
`ejecutar_python` · `verificar_audio` · `buscar_sonido` · `listar_voces` ·
`crear_voz` · `medir_referencia` · `buscar_web` · `leer_web`

**Music models (2-Nov-2026, `docs/PLAN-MODELOS-MUSICA.md`):** `generar_audio` and
`proponer_midi` run `workspace/gpu/generar_audio.py` (ACE-Step 1.5) and
`workspace/gpu/proponer_midi.py` (MIDI-LLM) on Lambda through `/api/run/lambda`; both
scripts bootstrap their own environment on the instance and print a `RESULT {...}` line
that `src/core/generacion.ts` reads. `transcribir_audio` runs basic-pitch on the laptop.

Why that division: the project **can only be changed by the tab** (it owns
the master file). The tab registers its actions once with
`registrarAcciones()` and `acciones.ts` only depends on a small contract
(`Estudio`: proyecto, fijar, enVivo, avisar, and optionally exportar, escuchar).

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
npm run test:unit       # src/, web/ and server/ (all green before every commit)
npm test                # + contract with openDAW (export/import an .odw)
npm run build:web       # production bundle
python workspace/herramientas/smoke.py   # the Python engine
```

And by hand, because no test covers it: open `localhost:5173`, open a project with
tracks, press play and **hear** that it sounds; save and check that `proyecto.json`
has the current `guardadoEn`. Levels, files and the DOM can be measured without Carlos's
browser: a headless Chrome on a second dev server (`--port 5199`) renders with the real engine.

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

1. **Mixing**: buses, sends and real units exist since 28-Oct, but the interface does not draw
   buses (only the agent sees them) and there is no automation and no live meters.
2. **Two transports**: WAVs that do not fit openDAW's 400 MB decoded budget play through
   `<audio>`, outside openDAW's mixer (without track or master effects).
3. **Isolation**: the agent's Python runs in `server/python/caja.py` (only its project, no
   keys, processes, network or ctypes). A guardrail, not a cage.
4. **openDAW ignores some SF2 generators**: global zones, scaleTuning and coarseTune are fixed
   before handing the SoundFont over (`web/src/soundfont-zonas.ts`); fineTune,
   initialAttenuation and preset-level tuning still are not.
5. **`openDawToProject`** is only used by the contract test, not by the UI: there is no
   `.odw` import from the app.

---

## 12. File map, to orient yourself

**Browser (`web/src/`)**

| file | what it owns |
|---|---|
| `main.ts` | app state, history, autosave, startup, dialogs, the MP3 button |
| `agent/agent.ts` | the turn loop, its cutoffs and forced turns |
| `agent/tools.ts` | the tools: schemas, the `MANEJADORES` table, the per-turn list |
| `agent/acciones.ts` | the actions on the project (`Estudio` contract) |
| `agent/contexto.ts` | trimming, turns, `agente.json`, conversation trimming |
| `agente-prompt.ts` | the system prompt, with fingerprint (Carlos's consent to change) |
| `render-escucha.ts` | `exportar` and `escuchar_mezcla`: offline render and measurement |
| `opendaw-engine.ts` | WASM engine startup, SoundFont loading, live mix and WAV render |
| `soundfont-zonas.ts` | SF2 fixes openDAW needs (global zones, tuning) |
| `timeline.ts` / `editor.ts` | canvas timeline and piano roll |
| `audio-store.ts` | AudioBuffers, the one WAV intake (`cargarWavDeDisco`, `opsDeAudio`) |
| `stem-player.ts` | long stems via `<audio>` synchronized by clock |
| `chat.ts` | chat panel (persists nothing), destination selector, ACE-Step box |
| `formulario-encargo.ts` | the Brief form |
| `ajustes-modelos.ts` | Models: LLM providers and GPU providers |
| `pad.ts` | the touchpad as an instrument |
| `llm.ts` | SSE, timeouts, retries on `load` |
| `code-lab.ts`, `strudel-*.ts` | Strudel (decision 1 of the 3-Nov review still open) |

**Domain (`src/`)**

| file | what it owns |
|---|---|
| `core/types.ts` | the data model |
| `core/ops.ts` | the operations, transactional, and their cheat sheet |
| `core/project.ts` | create, validate, migrate, statistics, project folder |
| `core/proyecto-archivo.ts` | the master-file format (browser writes, server checks) |
| `core/pistas.ts` | the one track finder |
| `core/theory.ts` | scales, chords, note names (one reader, one spelling) |
| `core/notacion.ts` | the compact note notation the agent reads and writes |
| `core/tiempo.ts` | seconds and beats, clip lengths in bars |
| `core/resumen.ts` | what the agent sees with `leer_proyecto` |
| `core/escucha.ts` | levels per span and the listening report |
| `core/versiones.ts` | snapshots and restoring tracks |
| `core/bateria.ts` | grid drums and the default kit |
| `core/proveedores-gpu.ts` | GPU providers and effective settings |
| `core/precios.ts` | model prices |
| `core/sonidos.ts`, `palabras.ts`, `taxonomia.ts`, `buscar.ts` | sound recipes, sound words, labels, search |
| `core/nombres.ts`, `rutas.ts` | slugs and normalization; shared folders |
| `host/opendaw/adapter.ts`, `mapping.ts` | miuzika project to openDAW project, devices and instruments |

**Server (`server/`)**

| file | what it owns |
|---|---|
| `api.ts` | mounts the routes |
| `contexto.ts` | what every route shares |
| `ruta.ts`, `proceso.ts`, `dentro.ts` | route wrapper and log, process spawning, path containment |
| `registro.ts`, `trabajo.ts` | logs; what is on disk in workspace/ |
| `config-proveedores.ts` | `.miuzika/proveedores.json` (LLM and GPU parts) |
| `mp3.ts`, `gm.ts`, `precios.ts` | MP3 encoding, the GM SoundFont, price store |
| `gpu/proveedor.ts`, `gpu/lambda.ts`, `lambda.ts` | GPU provider interface and Lambda |
| `python/caja.py` | the sandbox the agent's Python runs in |
| `api/*.ts` | one module per group of routes (section 6) |
