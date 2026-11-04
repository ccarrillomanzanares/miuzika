# miuzika

miuzika is a DAW that runs in the browser, with an AI agent that composes, arranges and
produces inside the project. You can talk to it in any language. It writes notes, chords,
drums, effects and the mix straight into the song, through transactional operations (a bad
edit is rejected as a whole, never half-applied). When a synthesized sound is needed, it
writes and runs Python on your machine or on a GPU rented on Lambda Cloud. Playback runs on
openDAW (WASM); generative patterns run on Strudel.

## Features

- Timeline, piano roll, drum grid and playback on openDAW, with General MIDI and SoundFonts.
- CC0 sample library (VCSL) and conversion of SFZ instruments to SoundFont.
- Agent that reads and edits the project: progressions, notes, drums, mix, effects, buses
  and sends, earlier versions, listening to the mix through the engine, MIDI and WAV export.
- Agent memory per project, and a fingerprinted system prompt that does not change by accident.
- Models dialog: LLM provider and model (Ollama Cloud, Anthropic, OpenAI, Gemini, OpenRouter,
  DeepSeek, Mistral, Groq, local Ollama, LM Studio, any OpenAI-compatible endpoint), with the
  cost of each call shown.
- Brief: a form that writes the request for a new song or an arrangement.
- GPU music models: ACE-Step 1.5 generates audio, MIDI-LLM proposes MIDI, basic-pitch
  transcribes audio to MIDI.
- Strudel patterns rendered to an audio track (1 cycle = 1 bar).
- Pad: the laptop touchpad as an instrument.
- Export to WAV, MIDI and 320 kbps MP3.
- Open project files (`.json`, `.miuzika.zip`), audio or MIDI, by button or drag and drop.
- Every project is a folder whose `proyecto.json` is the single source of truth. Autosave
  runs 1.5 s after each change; Ctrl+S saves at once.

## Getting started

Requirements: **Node 24** or later, and **Python 3 with numpy**. If the Python executable is
not called `python`, set `MIUZIKA_PYTHON` in `.env`.

```bash
npm install
npm run dev          # http://localhost:5173 (use localhost, not 127.0.0.1)
```

**API keys** never go in this repository or in the browser's code. Open **Models** in the
app, pick a provider and paste its key: it is stored in `.miuzika/proveedores.json`, which is
outside git. Web search uses the Ollama Cloud key.

**GPU (optional)**: Lambda Cloud settings go in `.env`. Variable names and defaults (no
secrets here): `LAMBDA_API_KEY`, `LAMBDA_SSH_KEY` (path), `LAMBDA_SSH_KEY_NAME`,
`LAMBDA_SSH_USER=ubuntu`, `LAMBDA_REGION=us-east-1`, `LAMBDA_INSTANCE_TYPE=gpu_1x_a10`,
`LAMBDA_NOMBRE=miuzika-gpu`. `OLLAMA_BASE_URL` defaults to `https://ollama.com`.
A started GPU instance keeps billing until you turn it off. The header counter shows the
hourly rate and the spend; the Off button shuts down the instance.

## Checks

| command | what it does |
|---|---|
| `npm run typecheck` | TypeScript, no emit |
| `npm run test:unit` | unit tests (`node --test`) for `src/`, `web/` and `server/` |
| `npm test` | the unit tests plus the openDAW contract (export and import an `.odw`) |
| `npm run build:web` | production bundle |
| `python workspace/herramientas/smoke.py` | the Python engine |

No test covers how the music sounds. Open a project, press Play and listen to it.

## Documentation

- [`ESTADO.md`](ESTADO.md): current status, what works and what is pending. Single source of truth for status.
- [`PLAN.md`](PLAN.md): roadmap.
- [`docs/DECISIONES.md`](docs/DECISIONES.md): decision log.
- [`docs/DIARIO.md`](docs/DIARIO.md): dated work log.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): layers, boundaries, data model, endpoints, dangerous couplings.
- [`docs/LEGAL.md`](docs/LEGAL.md): licensing and third-party material.

## Known caveat

- Strudel depends on remote sample maps.

## License

**AGPL-3.0-or-later**. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) and
[docs/LEGAL.md](docs/LEGAL.md). openDAW is dual-licensed (AGPL or commercial); Strudel,
superdough and the sample packs are third-party.
