# miuzika-new — instructions for Claude Code

Browser DAW (openDAW in WASM). The user is Carlos: he writes in Spanish; the interface is in English.
**Goal, in his words (6-Nov-2026): this project is to replace miuzika.** What he likes is copied over from
`../miuzika`, piece by piece and only when he says so.

Read `ESTADO.md` first: where we are, what he has tested and **what is still undecided**.

## How to work with Carlos

- He thinks one thing at a time and says when he wants to think: **do not assume a decision**. "No lo sé" means
  undecided. When he asks for an opinion ("no hagas nada, dime"), give it and touch nothing.
- Only what he asks for. On 6-Nov he said "no añadas nada" about extra features: propose them, do not build them.
- He wants no intermediary between the interface and the music model: the same order does the same thing, every time.
  No LLM in that path. That is why this project exists.
- Bugs are listed before they are fixed (`BUGS.md`).

## House rules

1. **His ear decides.** Never claim something sounds good without him hearing it. Numbers and hypotheses, yes;
   arguing against his ear, no. "Measured" and "heard" are different states: say which.
2. **Do not reload the app without warning.** Touching `web/` reloads his tab and cuts what he is listening to.
3. **Secrets**: keys never reach the browser, the logs or the repo. There are none here yet; `../miuzika/.env` and
   `../miuzika/.miuzika/` hold his, so do not print or copy them.
4. **Commit or push only when he asks.** Commits in English, with the measured reason. Code comments too: why, with
   the data that justified it.
5. **Spending GPU money needs his go**, and a machine left on keeps billing: check and say so.

## Commands

```
npm run dev            # localhost:5180. Carlos runs it from his own terminal
npm run typecheck      # tsc --noEmit
npm run test:unit      # node --test for src/, web/, server/
npm test               # + openDAW contract (check.ts)
npm run build:web
```

Needs Python with numpy (`workspace/herramientas/`: waveform peaks, MIDI reading) and ffmpeg on the PATH (MP3 export,
importing anything that is not a PCM WAV).

## Map

- `web/src/main.ts` — only the wiring. Its header lists the pieces: `sesion` (project, undo, autosave), `transporte`
  (play/stop, openDAW + long stems), `seleccion`, `importar`, `dialogo-proyectos`, `exportar`, `avisos` (the Log).
- `src/core/` — pure domain with tests: types, transactional ops, project, theory, MIDI export.
- `src/host/opendaw/` — miuzika project -> openDAW project.
- `src/modulos/`, `web/src/modulos/` — what generates material (ACE-Step). A module reads the project and hands in audio through
  `anfitrion.ts`; nothing specific to a model lives outside its folder. No LLM between a form and a model, and text is sent byte for byte.
- `web/src/gpu-barra.ts`, `server/api/gpu.ts`, `server/lambda.ts`, `server/gpu/`, `workspace/gpu/` — the rented GPU, for any module.
- `web/src/ajustes.ts`, `server/api/ajustes.ts`, `server/config-proveedores.ts`, `src/core/proveedores-gpu.ts` — Settings: provider accounts, keys never
  back to the browser. `MIUZIKA_PROVEEDORES=<file>` points a test server elsewhere, so a test never touches the real keys.
- `server/` — the API as a Vite plugin: projects, audio, peaks, MIDI, GM SoundFont, GPU. It carries requests and decides nothing.
- `workspace/proyectos/` — projects, outside git. **Those are his**: `static-hymn` there came from his own testing.
- Logs: `tmp/api.log`, one line per /api request; `tmp/gpu.log`, one per GPU step.

## Testing without his browser

Python Playwright + the installed Chrome, headless, with a temp profile: it does not touch his Chrome.
`p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chrome", headless=True)`. Run a second server with
`npx vite --port 5181 --strictPort`, with `MIUZIKA_GPU=simulado` to run a module's path for free (real script, stand-ins for torch and
ACE-Step: it proves the path, not the music), never on 5180 while he uses it, and close it afterwards: stopping the task leaves the
`node` child alive, so check the port. Test projects land in `workspace/proyectos/` and have to be removed by exact name,
never with a wildcard. This measures; it does not listen.

## Traps

- `npm install` needs the lockfile: without it, duplicate `@opendaw` packages break the types.
- Do not link `node_modules` with a junction into a git worktree: `git worktree remove` deletes through it.
- `<button>.click()` from a script does not start openDAW (not a user gesture): use real clicks.
- Windows: a long inline shell command can fail with ENAMETOOLONG; write files with the Write tool.
