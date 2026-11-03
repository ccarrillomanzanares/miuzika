# STATUS — 28-Oct-2026

Handover document: what exists, what works, what is missing and where to go next.
Working rules are in `CLAUDE.md`; architecture in `docs/ARCHITECTURE.md`; the 27-Oct
review with its bugs in `docs/REVISION-2026-10-27.md`.

Repository: `github.com/ccarrillomanzanares/miuzika`, branch `master` (the previous
history, humseed, is on the `humseed` branch). On the laptop, the folder follows
`origin/master`; `master-antiguo` and `revision-arquitectura` are old branches.

## 1. What was done on 27 and 28 October

**The agent**
- Composes in the project, not in scripts: `escribir_notas` (compact notation:
  `"D2:1.5 D2:.5 F2 | r:2 [D3 F3 A3]:4"`, with repetitions `( ... )x4`),
  `escribir_bateria` (`x...x...` grid), `escribir_progresion`, `editar_proyecto`
  (transactional ops, undone with Ctrl+Z). Rewriting a section preserves what is
  outside it; bars that do not fit are rejected.
- Instruments: General MIDI (GeneralUser GS in `workspace/catalogo/gm/`) and the VCSL
  library (142 recorded instruments: Steinway, organs, harps...) with
  `usar_instrumento("Grand Piano, Steinway B", pista=...)`.
- Searches the internet (`buscar_web`, `leer_web`, Ollama services).
- `versiones`: project snapshot at the start of every turn (`proyectos/<c>/versiones/`,
  last 40); restores a track or the whole project.
- `exportar(midi, wav)`: type-1 MIDI from the project; WAV of the mix with openDAW's
  `OfflineEngineRenderer` (same sound as Play).
- Prompt v4 (fingerprint `0eaa1767`): finishes the whole song in the turn and does not
  ask about MIDI/WAV unless asked. Limit: 80 steps per turn; loop brake by failed
  cycles (4), not by writes.

**The app**
- Interface in English (base) with optional Spanish (`?lang=es`); `i18n.ts`.
- "Brief" (formerly "Template"): form that writes the request into the chat. Modes:
  new / version (where it goes, what is kept, relative tempo and key) / arrangement;
  delivers MIDI and/or WAV.
- "Models": provider, key and model for the agent (Ollama Cloud by default, Anthropic,
  OpenAI, Gemini, OpenRouter, DeepSeek, Mistral, Groq, local Ollama, LM Studio, any
  OpenAI-compatible provider). Keys in `.miuzika/proveedores.json`. Web search always
  uses the Ollama Cloud key.
- "Pad": the laptop touchpad as an instrument (Windows Raw Input,
  `workspace/herramientas/touchpad/`): keys in the project scale, drum pads, sliding;
  records into a clip with count-in and metronome.
- Play waits for the engine to load samples and SoundFonts (previously the first part
  played silently).

**The Python engine** (`workspace/codigo`)
- `pan`, `reverb`, `delay` and `place` accept mono and stereo; `render.stem(path, fn,
  data...)` only recomputes what changes; `write_wav` lowers to -1 dBFS what used to
  clip.
- `sfz2sf2.py` writes valid SF2 files (previously ALL VCSL instruments played silently:
  EOP/EOI and ranges written incorrectly) and they fit in the browser (<= 40 MB).

**Done on 28-Oct afternoon** (one commit per point, with its reason):
- The agent conversation without a project is saved in
  `proyectos/sin-proyecto/agente.json`.
- "Hard": the Steinway was already there; removed the 2 bars of silence (everything
  starts at bar 1, 46 bars). Copy of the previous version in
  `hard/versiones/..._antes-de-quitar-...`.
- `escuchar_mezcla`: renders the mix and each track alone with openDAW and gives RMS
  by sections crossed with the notes (MUTED = notes with no signal).
  `src/core/escucha.ts`.
- Effects in real units (`cutoffHz`, `timeMs`, `thresholdDb`...; EQ with frequencies).
  Old projects are migrated when opened and sound the same (tests pin this).
- Buses and sends: `add_bus`, `set_bus`, `remove_bus`, `set_send`; effects on a bus with
  `add_device` by its name. In openDAW: AudioBusBox + "aux" unit + AuxSendBox.
  The interface does not draw buses yet (only the agent sees them in `leer_proyecto`).
- Long WAVs: they enter openDAW as long as they fit in 400 MB decoded
  (`PRESUPUESTO_DECODIFICADO_MB`); only the rest goes through `<audio>`.
- The agent's Python runs in `server/python/caja.py`: it writes only in its project,
  does not read keys, no processes, network or ctypes; minimal environment. Guardrail,
  not a cage.
- GPU counter in English (Spanish with `?lang=es`).

**28-Oct, night: session with the agent on "Hard"** (watching `tmp/llm.log`):
- Fixed: loose effect parameters (`{type:"compressor", thresholdDb:-20}`) were lost
  without warning (`6da2f44`); openDAW render stopped after 10 s of silence and gave
  false MUTED results in `escuchar_mezcla` (`2fc97ab`); openDAW drops the global zone of
  SF2 files and 113 of 128 GM presets lost the loop (`f3a734d`,
  `web/src/soundfont-zonas.ts`). None of this has been heard.
- "Hard": 112 bars (4:04), new ending. Grand Piano muted (and at -60 dB). The
  "Piano oscuro" track (GM 5) has the piano notes copied AGAIN: the agent restored the
  previous version and deleted the new melody. It is saved in
  `proyectos/hard/melodia-nueva-lead-oscuro.json` (10 calls to `escribir_notas`); it
  still needs to be written again. Drum, bass and bus effects still have default
  values.

**1-Nov: model-cost counter** (towards a paid "advanced" mode and a local model, see
`docs/PLAN-MODELO-PROPIO.md`). Carlos asked that any cost shown update by itself.
- `src/core/precios.ts`: pure pricing. Rates come from OpenRouter's public model list
  (452 models on 1-Nov, cached-input price and DeepSeek's UTC time windows included);
  `tarifaPara(proveedor, modelo)` maps our provider/model names to an OpenRouter id
  (`claude-sonnet-5-5` = `anthropic/claude-sonnet-5.5`, `deepseek-v4.1-flash:1017` =
  `deepseek/deepseek-v4.1-flash-1017`), local providers are free, unknown models give
  null and the interface says "price unknown" (never a made-up number). Cache writes
  are not reported by the OpenAI-compatible `usage` and are not counted (lower bound).
- `server/precios.ts` + `/api/precios`: list downloaded at start-up if the copy is older
  than a day, then daily, kept in `.miuzika/precios.json`; a failed download keeps the
  copy. Every `tmp/llm.log` line now carries `proveedor`, `coste_usd` and `tarifa`
  (verified live: a 48 k call with 47.9 k cached = 0.000218 $).
- Chat header: "LLM $0.04 · $0.31 session" next to the GPU counter, tooltip with tokens,
  cache share, the rate per million and the date of the price list (warns at 72 h); the
  end-of-turn line adds the turn's cost. Session total survives F5 (localStorage).
- Measured on the 28-Oct log before this: a composing turn is 23 to 46 calls, 1.0 to
  1.7 M input tokens (99% cache reads), 12 to 97 k output. At 1-Nov prices that is
  ~0.04 $ with DeepSeek V4.1 Flash and ~1.2 $ with Claude Sonnet 4.5 per turn.
- Ollama Cloud bills a subscription, not tokens: with it the counter shows "~$0.04" and the
  tooltip says it is the model's OpenRouter price, to compare models (OpenRouter is the
  reference, agreed 1-Nov).
- NOT seen in a browser yet (no browser from this session): the counter itself.

**1-Nov: trajectories** (step 2 of the plan: the dataset for a model of our own).
- Every agent turn, finished, cancelled or failed, is saved whole in
  `proyectos/<slug>/trayectorias/<date>_<request>.json` (same naming as `versiones/`,
  so the snapshot taken before the turn sorts next to it and is named inside as
  `versionAntes`). It holds: the conversation as the model saw it (system prompt with
  manifest and context block included), every tool call with the arguments the model
  REALLY wrote (the loop replaces long ones with `_omitido` after applying them; the
  file restores them from the step records), the full tool results (not the 12,000-
  character cut), the project after the turn, the turn's cost, and a verdict read from
  the last `escuchar_mezcla` report (silent tracks, clipping, "No problems").
- `src/core/trayectoria.ts` (pure, tests), `server/api/trayectorias.ts` (48 MB body
  limit, name validated, logged in `herramientas.log`), `main.ts` `guardarTrayectoria`.
  `trayectorias` is a hidden folder for `listar_ficheros`, like `versiones`.
- Verified live: the route writes the file and rejects a bad name. A real turn end to
  end has NOT been run yet (needs the browser): check that a file appears after a turn.

**1-Nov: prices in "Models" and a cost cap per turn.**
- Under the model field, the rate of what is typed: $/M in, cache and out, and what a
  typical turn costs (`TURNO_TIPICO` in `src/core/precios.ts`: 27 calls of 48 k with 99%
  cached and 1.9 k out, the middle of the 28-Oct measurements). "~" with Ollama Cloud
  (subscription), "≈" otherwise; "price unknown" when not in the list.
- "Cost cap per turn" ($, this browser, `tope-coste.ts`): the loop asks `debeParar`
  before every model call and ends the turn with a notice naming both numbers when the
  turn's cost reaches the cap. Empty = no cap. With an unknown rate nothing can be
  measured, so nothing stops (said in the Models help). Not seen in a browser yet.

**2-Nov: music models** (`docs/PLAN-MODELOS-MUSICA.md`, `fable.md` for the handoff).
Carlos decided: generation on Lambda first (the laptop has no CUDA and 7.7 GB RAM), ACE-Step
1.5 as the first model, basic-pitch and MIDI-LLM approved, LoRA / Magenta RT2 / the rest
parked. Built and measured, nothing heard:
- `generar_audio` (ACE-Step 1.5 XL turbo on the A10): cold 7.3 min end to end, warm 1.8 min;
  13 s per 30 s of audio, 16 GB VRAM. Four takes in `proyectos/spike-generacion/generado/`;
  Carlos heard them the same evening: one of the 60 s takes is "very industrial, very good",
  the others fine, the sung one sings its Spanish lyrics with a Latin American accent.
- `transcribir_audio` (basic-pitch, `.miuzika/bp` venv): F1 0.85 bass / 0.89 riff / 0.66 synth
  against the "Stahl" source MIDI; 8 s per stem.
- `proponer_midi` (MIDI-LLM 1B on the A10): 4 multitrack proposals in 38 s, 92-100 % of notes
  in the asked key, nominal 120 BPM. In `proyectos/spike-generacion/propuestas/`.
- `.env`: `MIUZIKA_LAMBDA=on` again (31-Oct it was turned off). The instance was shut down
  at the end of the session; the next cold start reinstalls (~2.5 min).
- Authorship layer (`autoria/`, Spike B) from the morning: see `autoria/CONCEPT.md`.

## 2. Pending browser checks (Carlos)

None of this has been heard in previous sessions:
1. **The Steinway and the VCSL library sound** (regenerated in "Hard" and "Stairway").
2. **The bar-1 material sounds** with the Play load wait.
3. **`exportar` WAV** (OfflineEngineRenderer) and MIDI.
4. **"Models" -> Test** with real Ollama Cloud (the proxy was only tested against a
   simulated server).
5. **The pad** on the laptop: capture starts, sounds and records.
6. **`escuchar_mezcla`** on "Hard": the table appears and matches what is heard.
7. **A bus** with reverb and sends: the tail is audible (the `.odw` loads, but it has
   not been heard).
8. **A project with long stems** (e.g. "hurt-instrumental"): it opens and memory holds
   with the 400 MB budget.
9. **Talking to the agent without a project**, F5, and the conversation is still there.
10. **The LLM cost counter** (1-Nov) appears in the chat header after the first call,
    the tooltip shows tokens and the price date, and the end-of-turn line has the cost.
11. **A trajectory file** (1-Nov) appears in `proyectos/<slug>/trayectorias/` after a
    turn, with the tool calls, their results and `proyectoDespues`; also after Cancel.
12. **"Models"** (1-Nov): the rate line appears under the model field and changes while
    typing; a cap of e.g. 0.01 $ with DeepSeek stops a composing turn after a few calls
    with the notice, and the counter in the header agrees with the number in the notice.
13. ~~Listen to the generated takes~~ Done 2-Nov evening: `60s-1` very industrial, Rammstein-
    like, very good; the other two instrumental takes fine; the sung one has an audible
    voice singing the lyrics, Latin American accent (`docs/PLAN-MODELOS-MUSICA.md`).
14. ~~The three tools from the agent~~ Done 2-Nov evening in "Stahl" with DeepSeek v4.1 flash
    (`docs/PLAN-MODELOS-MUSICA.md`, "Exercised in the browser"). All three ran; Carlos:
    `transcribir_audio` fine, `generar_audio` "the quality of the last track is very good".
    Five defects found, none in the GPU path itself; fixes pending below.
15. **Fixes from check 14**, agreed with Carlos on 2-Nov night, in this order. Items 1-4
    were done on 2-Nov night (four commits, unit tests, `npm test` green) and still need a
    browser run: a `generar_audio` take audible in `escuchar_mezcla`, a `transcribir_audio`
    on the beat, and a `proponer_midi` on Lambda (the `--bpm` stamping was only run locally
    on the 2-Nov file). Item 5 touches the prompt (house rule 1: Carlos must say yes to the
    exact wording first).
    1. Done 2-Nov night. **A 30 s WAV must enter the mixer.** Two copies of the streaming rule disagree:
       `audio-store.ts` (`reservarDecodificado`: decode when ≤ 30 s, or when it fits the
       400 MB budget) is what the Audio button and project load use; `acciones.ts`
       `importarPistas` has its own `>= SEGUNDOS_STREAMING` and never looks at the budget.
       So a 30.000 s take (the `generar_audio` default) is heard through the streaming
       `<audio>` element but is SILENT for `escuchar_mezcla` and missing from the export;
       a 35 s WAV streams even with memory to spare. Fix: `importarPistas` calls
       `reservarDecodificado` like `main.ts` does and drops its own rule; unit test that a
       30.0 s WAV ends up decoded through the action. Seen 2-Nov: the drone at bar 121 was
       SILENT in 121-136 and the agent started splitting it in two.
    2. Done 2-Nov night. **`/api/transcribir` passes `--midi-tempo <project bpm>`** (the action sends the bpm).
       basic-pitch writes 120 BPM; the import places notes by beats; in Stahl (125) every
       onset landed 4 % early (agent measured last onset 291.3 vs 303.5 beats) and it
       re-scaled by hand.
    3. Done 2-Nov night. **`proponer_midi`**: `proponer_midi.py` gets `--bpm` and rewrites the .mid tempo to
       the project's (ticks unchanged) so the 120-vs-125 warning disappears; the summary in
       `acciones.ts` names tracks by GM program ("distortion guitar 151n, electric bass
       77n, drums (GM kit) 208n") instead of "Track 1". On 2-Nov the agent re-read the files
       with its own scripts, called the channel-10 drum track "a piano on channel 16" and
       rendered it as piano.
    4. Done 2-Nov night. **`escribir_fichero` accepts `content` as an alias of `contenido`** in the tools.ts
       dispatch (server keeps `contenido`). DeepSeek v4.1 flash sent `content` six times on
       2-Nov; three in a row aborted the `generar_audio` turn.
    5. **Prompt line (needs consent)** about the three tools: hear `proponer_midi` and
       `transcribir_audio` results with `anadir_pistas(midis=...)`, not with home-made
       renderers; the tool summary is already trustworthy; material to compare goes in
       solo/mute at the song's start, not stacked after the last bar (2-Nov: bars 81, 90,
       112, 121, song grew 80 → 136 bars).
    Browser run of items 1-3, 2-Nov night ("Stahl", DeepSeek v4.1 flash): `proponer_midi` on
    Lambda wrote both proposals at 125 BPM with the kit on channel 10; `transcribir_audio` wrote
    125 BPM, last onset at beat 303.5; `generar_audio` gave a 30.000 s WAV. The imports and the
    mix could not be checked: the dev server had been started from the Claude Code shell and
    could not spawn Python (Windows exit 0xC0000142 for every child, empty stderr). Start
    `npm run dev` from Carlos's own terminal. Seen in the app later that night ("vidrio-4"):
    the 30 s take entered as "audio" and measured −11 dBFS muted-alone; the proposal's tracks
    came in as "Distortion guitar", "Electric bass (pick)", "Drums", "Fx 5 (brightness)".
16. **"Vidrio" run, 2-Nov night** (new project, no GPU, 0.027 $, 89 model calls):
    - VCSL converts and plays per the table: Steinway B (84 zones) and Concert Harp (45 zones).
      Nobody has listened yet.
    - VCSL vs GM, same 48 notes, both at 0 dB: Steinway −32 dBFS, GM piano −17 dBFS. The gap
      is 15 dB (pending item 3.2 said ~12).
    - Muted rows are labelled "(muted)", rendered alone and left out of MIX, as fixed on 1-Nov.
      Clip names come out as "Progresión VCSL 1", without the doubled bar.
    - `exportar` MIDI works. **WAV fails every time**: "Failed to execute 'copyToChannel' on
      'AudioBuffer': The provided Float32Array value must not be shared". The offline render
      returns channels backed by SharedArrayBuffer; `main.ts` casts them and passes them as they
      are. Fixed 2-Nov night (each channel copied to a plain Float32Array). Re-run on "vidrio-3":
      55.3 s WAV, peak −7.7 dBFS, RMS −28 dBFS; the last 2.3 s after the song's 53 s carry the
      release and reverb tail (−46 dBFS). Nobody has listened to it yet.
    - Minor, seen on "vidrio-4": exporting an empty project writes 10 s of silence and reports
      "peak -Infinity dBFS" instead of saying there is nothing to export; and anadir_pistas warns
      "MIDI and WAV of the same song" whenever both come in one call, even unrelated material.
    - The agent retried `exportar` about 20 times, toggling mutes and sends in between, so the
      three-identical-errors stop never fired. `escuchar_mezcla` cannot measure a bus ("No tracks
      named sala"), so the reverb tail was not checked.
    - `usar_instrumento` answered "Could not convert: " with nothing after it when Python died
      silently. Fixed 2-Nov night: the server's runner now gives the exit code.
17. **"Vacío", 2-Nov night**: a 120 s sung song in Spanish, 2 takes (cold A10: boot 270 s,
    model load 52 s, generation 43 s for both). Both entered as "audio"; the WAV export works.
    Carlos: the accent is still Latin American even with "Castilian Spanish accent" in the
    caption, so the caption does not steer it. Transcribing a full mix was dropped: basic-pitch
    puts voice, guitars and drums in one track. Stem separation comes first.
    Parked: `generar_audio` default of 2 takes;
    Lambda persistent filesystem so cold starts do not reinstall the weights.

## 3. Pending work

**3-Nov: architecture review before reordering.** `docs/REVISION-2026-11-03.md` is the
inventory of the whole tree (four clean-context reviewers, key claims re-verified by hand):
measured shape, 12 bugs that fell out of it (a bad `gpu/*.py` edit deletes the file; the Python
box has a side door; a cancelled turn keeps Lambda billing), the duplication map, the 31 tools
grouped, the capability state table (HEARD / MEASURED / BUILT / PARKED / PLANNED), the proposed
spines and the execution order. **Start there**: section 10 gives the order (bugs 1-5 first, one
commit each with a test); section 9 lists the decisions only Carlos can take. Baseline 3-Nov:
`tsc` 0 errors, 245 unit tests green.

**3-Nov, bugs 1-5 of the review fixed** (one commit each, with tests; 262 unit tests green,
openDAW contract OK, smoke OK). Step 2 of section 10 (one WAV intake) was done the same day;
step 3 too (handler table; export and listening out of main.ts; zod left for later).
Step 4 (server plumbing: spawn helper, route wrapper, path resolver) is next.
- `2d4f787` a gpu/ write or edit that does not parse keeps the old file (`escribirComprobando`).
- `ea6df8f` the server's own Python scripts run in `caja.py` too; the agent can no longer write
  `herramientas/` or the non-engine `codigo/` files. All ten server scripts were run boxed by hand.
- `a2ee158` Cancel stops a Lambda run (boot wait, sync, ssh). A started instance stays on.
- Decision 7, taken 3-Nov ("añade el botón"): a "⏻ Off" button next to the GPU counter, shown
  only while an instance named LAMBDA_NOMBRE is on or starting; it asks for confirmation and
  shuts down only our instances (the Lambda account is shared; the server refuses others).
  Not clicked yet: needs a running instance.
- `672f405` **behaviour change**: `generar_audio`, `proponer_midi`, `crear_voz` on GPU and
  `crear_sonido` with a GPU voice now need the chat selector on GPU, like `ejecutar_python`.
- `9ea410a` Cancel reaches the file tools and five actions, and is reported as a cancel.
- One WAV intake (`cargarWavDeDisco`, `opsDeAudio`): behaviour change, the agent re-importing
  a decoded WAV with the same name now replaces that track's clips (before, only streamed
  ones did; decoded ones made a duplicate track).
- `/api/run/lambda` takes `entradas`: input files uploaded whatever their folder or size.
Run against a real dev server on 3-Nov (started from the Claude Code shell; Python spawned
fine this time): /api/picos, /api/manifiesto and /api/verificar work with the scripts boxed;
the agent file routes refuse herramientas/ and codigo/voces.py (logged "server script"), refuse
a "../" escape, and a broken write or edit of gpu/proponer_midi.py leaves its md5 unchanged.
NOT run: anything that calls the Lambda API (status, the off button, a GPU run, inputs upload).
Not run in a browser (the dev server was off): importing WAVs with the Audio button and with anadir_pistas, and opening a project with audio; a GPU tool with the selector on CPU answers
"The GPU is not allowed"; Cancel during `generar_audio` logs `cancelado: true` in
`tmp/herramientas.log` and the instance stops at the step it was in; `usar_instrumento`,
`usar_sample` and `medir_referencia` still work (they now run boxed).

ACE-Step tasks (cover, repaint, lego, complete, extract) planned into the architecture on 3-Nov,
nothing built: `docs/PLAN-MODELOS-MUSICA.md`, last section. Mastering is a separate stage.

Carlos, 3-Nov: "la exportación wav funcionó ayer" (the 2-Nov fix of check 16 works in the app).

**Lambda, 3-Nov night:** `/api/gpu/estado` says our instance is off (`fase: apagada`); the
other one listed (`295bdec6…`, "terminating") has been stuck like that for about a year, a
provider-side fault; Carlos, 3-Nov: it is not billing. Ignore it. `3d46b7f046ca` is no longer
billing. The "⏻ Off" button is still unclicked.

**3-Nov night, step 4 started**: `server/proceso.ts` `correrProceso` (time limit, cancel by
signal, tree kill, `explicarFalloMudo`) replaces the four spawn wrappers (`contexto.correr`,
`/api/run/python`, basic-pitch, lambda ssh/scp; the pad keeps its own long-lived process).
Run against a test server on :5199: `ejecutar_python` ok / cut at 2 s / cancelled (no python
left), `/api/manifiesto`, `/api/picos`, `/api/verificar`, and `ssh -V` via `/api/gpu/estado`.
Then, same night: `registroApi` logs every /api request to `tmp/api.log` (not `/api/build` and
`/api/gpu/estado`, which the tab polls); `rutaJson` (`server/ruta.ts`) took over 16 JSON routes
(fs/*, manifiesto, run/python, picos, midi, verificar, transcribir, referencia/medir,
instrumentos/crear, catalogo/buscar, catalogo/importar, trayectorias, proveedores/probar).
Behaviour: bad JSON is 400 everywhere (some were 500); picos/midi/probar now refuse the wrong
method; the 413 text names the route's limit. Left on purpose: the GPU routes and voces/nueva
(Lambda chain, not testable without a paid start), streaming/binary/raw-text routes and the
proxies. Each migrated route was hit on a :5199 server, Cancel logs "closed".
Left in step 4: path resolver, `contexto.ts` slimmed.


1. Draw buses and sends in the interface (mixer).
2. Seen on 28-Oct with the agent. Fixed on 1-Nov (not yet exercised in a browser):
   - `escribir_notas`/`escribir_bateria`/`escribir_progresion` without `pista` now fail
     with "Missing `pista`" instead of creating a track "Pista".
   - Clip names no longer repeat the bar ("Pre - batería 33 33").
   - The `escuchar_mezcla` report says that "(muted)" rows are rendered alone with mute
     off, and that the MIX row already excludes them.
   - Cancel is checked before every render in `escuchar_mezcla` and `exportar` (a render
     in flight still finishes: the offline renderer has no abort).
   - Tool results are now whole in the trajectory files (`trayectorias/`).
   Still open:
   - VCSL instruments play ~12 dB below GM (measured by the agent). Checked on 1-Nov:
     the Steinway samples themselves peak at a median −6 dBFS (24 of 351 measured), so
     the samples are not quiet; look at velocity layers → attenuation in `sfz2sf2.py`
     and at how openDAW applies `initialAttenuation`. Needs listening to confirm.
3. If the Python box falls short: another Windows user or a container. GPU (Lambda)
   scripts do not go through the box.

## 4. How to start

1. `npm run typecheck` and `npm run test:unit` (189 tests green on 28-Oct at night;
   `npm test` adds the openDAW contract).
2. `python workspace/herramientas/smoke.py`.
3. `npm run dev` and go through the list in section 2 with Carlos.
