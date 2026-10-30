# miuzika — instructions for Claude Code

Browser DAW (openDAW in WASM) with an LLM agent that composes, arranges and produces.
The user is Carlos: he writes in Spanish; the app interface is in English; the agent
answers in the language of whoever writes to it.

Read `ESTADO.md` first (where we are and what is missing) and, if you are going to
touch structure, `docs/ARCHITECTURE.md`.

## House rules (non-negotiable)

1. **The agent prompt** (`web/src/agente-prompt.ts`) must not be touched without
   Carlos's explicit consent. If he authorizes it: change the text, update
   `HUELLA_PROMPT` (FNV-1a, computed by `huellaDe`) and its test, and note in
   `docs/PROMPT-CAMBIO-2026-10-27.md` what changed and why.
2. **Do not reload the app without warning.** Touching `web/`, `server/` or
   `vite.config.ts` reloads the page or restarts the server and cuts whatever Carlos
   is listening to or the agent turn. Ask first, or wait until he says he is not using
   it. The tail of `tmp/llm.log` tells you whether the agent is working.
3. **Secrets**: `.env` and `.miuzika/proveedores.json` contain keys. Do not print or
   copy them. `.miuzika/` is outside git and outside `workspace/` on purpose.
4. **Never claim something sounds good without checking it.** The VCSL converter once
   reported "84 zones" for a day while everything played silently. If you cannot
   listen, say so and ask Carlos to test it.
5. Commits in English, with the measured reason ("measured on 28-Oct: ..."). Code
   comments too: explain why, with the data that justified it.

## Commands

```
npm run dev            # localhost:5173 (Vite server + API in server/)
npm run typecheck      # tsc --noEmit
npm run test:unit      # node --test for src/, web/, server/
npm test               # + openDAW contract (check.ts)
npm run build:web
python workspace/herramientas/smoke.py   # Python engine (workspace/codigo)
```

## Quick map

- `src/core/` — pure domain with tests: types, transactional ops (`ops.ts`), theory,
  compact notation, grid drums, VCSL library, model providers, MIDI export, versions,
  pad.
- `src/host/opendaw/` — miuzika project -> openDAW project.
- `server/` — the API (Vite plugin): files, projects, audio, catalog, Python, GPU, pad,
  providers/LLM proxy.
- `web/src/` — interface. `main.ts` (orchestration), `agent/` (agent loop, tools,
  actions), `opendaw-engine.ts` (playback and WAV export), `formulario-encargo.ts`,
  `ajustes-modelos.ts`, `pad.ts`.
- `workspace/` — what the agent reads and writes: `codigo/` (numpy engine),
  `catalogo/` (VCSL, GM; outside git), `herramientas/` (smoke, manifest, touchpad),
  `proyectos/<folder>/` (outside git).
- Logs: `tmp/llm.log` (every model call) and `tmp/herramientas.log`.
