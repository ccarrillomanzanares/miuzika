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

## 3. Pending work

1. Draw buses and sends in the interface (mixer).
2. Seen on 28-Oct with the agent:
   - `escribir_notas`/`escribir_bateria` without `pista` create a new track
     (`trk_pista_...`); they should error (required in the schema and the code does not
     check it).
   - Clip names repeat the bar ("Pre - batería 33 33").
   - `escuchar_mezcla`: the "(muted)" row is measured alone and without mute on purpose,
     but it does not say so; the agent twice concluded that mute did not work. State it
     in the report.
   - Cancel does not stop `escuchar_mezcla`/`exportar` midway: it waits for the renders
     to finish. Check the signal between render and render.
   - VCSL instruments play ~12 dB below GM (measured by the agent): check the level in
     `sfz2sf2.py`.
   - `llm.log` truncates tool results and `agente.json` does not save them: reviewing a
     listening pass needs the whole table.
3. If the Python box falls short: another Windows user or a container. GPU (Lambda)
   scripts do not go through the box.

## 4. How to start

1. `npm run typecheck` and `npm run test:unit` (189 tests green on 28-Oct at night;
   `npm test` adds the openDAW contract).
2. `python workspace/herramientas/smoke.py`.
3. `npm run dev` and go through the list in section 2 with Carlos.
