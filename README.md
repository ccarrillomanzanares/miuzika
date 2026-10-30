# miuzika

A browser DAW with an agent that composes, arranges and produces. You can talk to it
in any language; the agent writes directly into the project (notes, chords, effects,
mix) and, when synthesized audio is needed, runs Python on your machine or on a
Lambda Cloud GPU.

```text
GUI + openDAW (WASM)    timeline, piano roll, playback, drums, SoundFonts
agent (LLM)             reads and edits the project with ops; composes with music theory
numpy / torch engine    synthesis, render, analysis (workspace/codigo, workspace/gpu)
Strudel -> WAV          generative patterns rendered to an audio track
disk                    every project is a folder: proyecto.json + its WAVs
```

Architecture, boundaries and dangerous couplings are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The daily status report is in
[`ESTADO.md`](ESTADO.md); pending phases are in [`PLAN.md`](PLAN.md); the 27-Oct
review is in [`docs/REVISION-2026-10-27.md`](docs/REVISION-2026-10-27.md).

## Getting started

Requirements: **Node 24** and **Python 3 with numpy** (`MIUZIKA_PYTHON` in `.env` if
the executable is not called `python`).

```bash
npm install
npm run dev          # http://localhost:5173  (not 127.0.0.1: the origin matters)
```

`.env` (only the server reads it; the browser never sees the keys):

```text
OLLAMA_API_KEY=...            # Ollama Cloud (and web search); other providers and keys, in the "Models" menu
OLLAMA_BASE_URL=https://ollama.com
# Optional, GPU on Lambda Cloud:
LAMBDA_API_KEY=...  LAMBDA_SSH_KEY=...  LAMBDA_SSH_KEY_NAME=...  LAMBDA_SSH_USER=ubuntu
LAMBDA_REGION=us-east-1  LAMBDA_INSTANCE_TYPE=gpu_1x_a10  LAMBDA_NOMBRE=miuzika-gpu
```

## Checks

| command | what it does |
|---|---|
| `npm run typecheck` | TypeScript without emitting (0 errors) |
| `npm run test:unit` | domain, agent and file tests (`node --test`) |
| `npm test` | the above + openDAW contract (export/import an `.odw`) |
| `npm run build:web` | production bundle |

And manually, because no test covers it: open a project, press play and **listen to it**.

## How it works

- **Projects**: `workspace/proyectos/<folder>/proyecto.json` is the single source of
  truth. The folder is fixed when the project is created and does not change when the
  project is renamed; it accepts names in any alphabet. Autosave 1.5 s after every
  change (and `Save` / Ctrl+S).
- **Open**: project (`.json`, `.miuzika.zip`), audio or MIDI, from the button or by
  dragging it onto the window.
- **Agent**: right-hand panel. It reads the project, writes progressions and notes,
  adjusts mix and effects, searches the CC0 library (4,231 VCSL samples), converts SFZ
  instruments to SoundFont, creates sounds from words and runs Python. Its memory is
  per project (`agente.json`). The system prompt is a fingerprinted literal: it does
  not change by accident.
- **Strudel**: `Strudel` button, a pattern and `Render WAV`; it becomes an audio track
  (1 cycle = 1 bar).
- **GPU**: CPU / GPU selector in the chat. The instance **does not shut down by
  itself**: the header counter shows the real hourly rate and spend; turn it off from
  there.

## Structure

```text
src/core/          pure domain: types, transactional ops, theory, composition,
                   summary for the agent, sounds and words, search, names
src/host/opendaw/  miuzika project -> openDAW (adapter, mapping, contract)
web/src/           the app: main.ts (state and UI), timeline, piano roll, openDAW,
                   stems, Strudel, chat, i18n
web/src/agent/     agent loop, tools (LLM contract), actions on the project,
                   context and activity
server/            dev server API: context + one module per area
                   (files, projects, audio, catalog, voices, gpu, python) and Lambda
workspace/         numpy engine (codigo/), torch engine (gpu/), tools/,
                   templates/, works/, CC0 catalog and projects (outside git)
docs/              architecture, openDAW, legal, test plan, reviews
```

## Limitations

- It only exists with `npm run dev`: the API (`/api/*`) is Vite middleware. There is
  no deployment, no users, no isolation: the agent runs Python with your permissions.
  See "Product" in `docs/REVISION-2026-10-27.md`.
- WAVs longer than 30 s are streamed (`<audio>`), outside the openDAW mixer: track FX
  and the master do not affect them.
- Effects use normalized parameters 0..1 (except EQ, in dB); no buses or automation.
- The pattern engine assumes 4/4. Strudel depends on remote sample maps.
- The interface is in English and Spanish; the agent answers in the language of the user.

## License

**AGPL-3.0-or-later**. openDAW is dual-licensed (AGPL/commercial); Strudel,
superdough and the sample packs are third-party. See [LICENSE](LICENSE),
[NOTICE.md](NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).
