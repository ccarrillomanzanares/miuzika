# miuzika — instructions for Claude Code

Browser music workstation (openDAW in WASM) with generative modules and no LLM between the interface and the models. The
user writes in Spanish; the interface, code, comments and commits are in English. Since 6-Nov-2026 this is the only
miuzika: the old agent version was retired and its folder deleted after the pieces the user wanted were brought over.

Read `ESTADO.md` first: where we are, what has been tested by ear and **what is still undecided**.

## How to work with the user

- They think one thing at a time and say when they want to think: **do not assume a decision**. "No lo sé" means
  undecided. When they ask for an opinion ("no hagas nada, dime"), give it and touch nothing.
- Only what they ask for: propose extra features, do not build them.
- No intermediary between the interface and the music model: the same order does the same thing, every time. No LLM in
  that path. That is why this project exists.
- Bugs are listed before they are fixed (`BUGS.md`).

## House rules

1. **Their ear decides.** Never claim something sounds good without them hearing it. Numbers and hypotheses, yes;
   arguing against their ear, no. "Measured" and "heard" are different states: say which.
2. **Do not reload the app without warning.** Touching `web/` reloads their tab and cuts what they are listening to.
3. **Secrets**: keys never reach the browser, the logs or the repo. They live in `.miuzika/proveedores.json` (git-ignored: the
   GPU account and the Hugging Face token) and `~/.ssh/`; do not print or copy them.
4. **Commit or push only when asked.** Commits in English, with the measured reason. Code comments too: why, with the
   data that justified it.
5. **The repository is public** (github.com/ccarrillomanzanares/miuzika, pushed as `master` → `main`): no personal names,
   quotes or details of the user's machine in commits, code or docs. Write "requested", "heard: pass", and the reason.
6. **Spending GPU money needs their go**, and a machine left on keeps billing: check and say so.

## Commands

```
npm run dev            # localhost:5180. The user runs it from their own terminal
npm run typecheck      # tsc --noEmit
npm run test:unit      # node --test for src/, web/, server/
npm test               # + openDAW contract (check.ts)
npm run build:web
git push origin master:main
```

Needs Python with numpy (`workspace/herramientas/`: waveform peaks, MIDI reading), ffmpeg on the PATH (MP3 export,
importing anything that is not a PCM WAV) and the GeneralUser GS `.sf2` in `workspace/catalogo/gm/` (git-ignored).

## Map

- `web/src/main.ts` — only the wiring. Its header lists the pieces: `sesion` (project, undo, autosave), `transporte`
  (play/stop, openDAW + long stems), `seleccion`, `importar`, `dialogo-proyectos`, `dialogo-nuevo`, `exportar`, `avisos`
  (the Log).
- `src/core/` — pure domain with tests: types, transactional ops, project, theory, MIDI export, instruments, the Pad's
  mapping (`pad.ts`) and loop (`bucle.ts`).
- `src/host/opendaw/` — miuzika project -> openDAW project.
- `src/modulos/`, `web/src/modulos/` — what generates material: ACE-Step, Stable Audio, MuLaCover, Demucs (GPU), Strudel
  (browser). A module reads the project and hands in audio or MIDI through `anfitrion.ts`; shared window pieces in
  `comun.ts`; nothing specific to a model lives outside its folder. Text is sent byte for byte.
- `web/src/pad.ts`, `server/api/pad.ts`, `workspace/herramientas/touchpad/` — the Pad: touchpad (Windows Precision
  Touchpad capture) and keyboard as instruments, with loop recording.
- `web/src/a-midi.ts`, `server/api/transcribir.ts`, `workspace/herramientas/transcribir.py` — To MIDI (Basic Pitch, local).
- `web/src/gpu-barra.ts`, `server/api/gpu.ts`, `server/lambda.ts`, `server/gpu/`, `workspace/gpu/` — the rented GPU, for any module.
- `web/src/ajustes.ts`, `server/api/ajustes.ts`, `server/config-proveedores.ts`, `src/core/proveedores-gpu.ts` — Settings: provider accounts, keys never
  back to the browser. `MIUZIKA_PROVEEDORES=<file>` points a test server elsewhere, so a test never touches the real keys.
- `server/` — the API as a Vite plugin: projects, audio, peaks, MIDI, GM SoundFont, GPU, Pad. It carries requests and decides nothing.
- `site/` — the landing at ccmai.org/miuzika (static; uploaded to the VPS by hand, see memory).
- `workspace/proyectos/` — projects, outside git. **Those are the user's.**
- Logs: `tmp/api.log`, one line per /api request; `tmp/gpu.log`, one per GPU step.

## Testing without their browser

Python Playwright + the installed Chrome, headless, with a temp profile: it does not touch their Chrome.
`p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chrome", headless=True)`. Run a second server with
`npx vite --port 5181 --strictPort`, with `MIUZIKA_GPU=simulado` to run a module's path for free (real script, stand-ins for torch and
the model: it proves the path, not the music), never on 5180 while they use it, and close it afterwards: stopping the task leaves the
`node` child alive, so check the port. Test projects land in `workspace/proyectos/` and have to be removed by exact name,
never with a wildcard. To measure sound, tap what connects to the AudioContext destination with an AnalyserNode
(`add_init_script` patching `AudioNode.prototype.connect`). This measures; it does not listen.

## Traps

- `npm install` needs the lockfile: without it, duplicate `@opendaw` packages break the types.
- Do not link `node_modules` with a junction into a git worktree: `git worktree remove` deletes through it.
- `<button>.click()` from a script does not start openDAW (not a user gesture): use real clicks.
- Windows: a long inline shell command can fail with ENAMETOOLONG; write files with the Write tool.
- `node --test` runs TypeScript in strip-only mode: no parameter properties (`constructor(private x)`) in code a test imports.
