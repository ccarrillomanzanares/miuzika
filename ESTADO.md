# STATUS — 7-Nov-2026 (morning, handoff before a /clear)

## START HERE: what to build next, approved by Carlos on 7-Nov ("claro sí")

Context: on 7-Nov Carlos built a song track by track on a real A10 (project `workspace/proyectos/ace-step`, kept as it is). The sections below
from "First real run" on hold every take, measure and verdict. Conclusion so far: `acestep-v15-base` fits the song better than `xl-base` (one
guitar batch: "pegan muy bien con el resto"), and **the caption does not steer the sound in `lego` on either model** (16 guitar takes, guidance
7 and 11, with and without context, with and without capitals). His plan: start a **new project on `acestep-v15-base`**, drums first, once these
three are built. Touching `web/` reloads his tab and the reload closes the project: say so before starting.

1. **Bars that sound to the end.** "From 1 to 8" gives 8-bar files whose sound stops near bar 7 (measured: `toma` 6.94, `toma-2` 7.08,
   `bajo-1` 6.23, `synth-b-2` 7.08). Bar arithmetic is right; the silence is in the generated audio. Build: generate about 2 bars more than asked
   (silence longer, or the tracks' source rendered 2 bars further, padded with silence if the tracks end), then cut the delivered clip to the
   bars asked. Show the margin in Review, editable. Untested whether it fills bar 8: measure where the sound ends after building. Pieces:
   `web/src/modulos/ace-step/ventana.ts` (`prepararFuente`, `lanzar`, `entregar`), `web/src/modulos/anfitrion.ts` (`entregarAudio` length),
   recipe `entrega`, and Repeat must keep working.
2. **Instruction as upstream writes it.** ACE-Step `ca1e85f`, `acestep/core/generation/handler/task_utils.py`: lego and extract put the track
   in capitals (`track_name.upper()`: "Generate the GUITAR track based on the audio context:"), complete joins upper-case names with " | ".
   Ours uses lowercase and ", ", in `src/modulos/ace-step/receta.ts` (`instruccionDe`, tests in `receta.test.ts`) and in
   `workspace/gpu/generar_audio.py` (`INSTRUCCIONES`, whose comment wrongly says verbatim). Measured: capitals change the audio (correlation
   0.79-0.89 against 0.97-0.99 for a plain repeat) but did not improve the guitar by ear. Fix both, same seed keeps working.
3. **Context starts on Tracks** when the project has tracks, none ticked; on Silence when it is empty. After a reload the form fell back to
   Silence and `guitarra-d` was made with no context unnoticed.

Also from this session, listed below under "Improvements" and in `BUGS.md` (19-22): his own requests (ask whether to delete the file when a
track is deleted; Open and Audio starting in the project folder, "ya lo veremos"), and proposals not yet approved (taken name refused on Review,
form values kept across reloads, reopen the last project on load, flag a near-silent take, lower a multi-track source instead of clipping, Repeat
proposing a taken name). Unresolved: twice the Review instruction edit did not reach the recipe (`guitarra-f`, `guitarra-g`), never reproduced on
the simulated path where a typed edit arrives; ask him whether the box showed the change.

After building: the next idea inside ACE-Step is a **reference audio** field (upstream accepts a style reference for these tasks; not exposed;
not known to work in lego), to steer the sound without words. Lyrics for a vocal track still to come: he writes them or asks for a draft he edits.

State at handoff: GPU instance `bec6a1d0be85` (A10, us-east-1) **left on** by his choice: he wants the credits spent ("en un año me los
quitarán"), do not keep warning about cost (memory `creditos-lambda`). SSH key `~/.ssh/miuzika-lambda`, registered in Lambda and saved in
Settings; Test connection passes. Nothing is committed: no commit unless he asks. Clock: logs are UTC, Carlos reads local time (UTC+1); give
local times.


## Why this project exists

On 6-Nov Carlos got tired of the indeterminism in miuzika: asking for one drum take took two attempts and gave nothing
valid. The agent refused an exact order because a tool description forbade what the code allowed, and the audio sent to
the model depended on the mute state, which nobody saw before spending GPU. He decided to copy what he likes into a new
project: first the GUI, then the code that runs ACE-Step on a GPU provider with no intermediary. The goal is to replace miuzika.

## What exists

The GUI, separated from the agent: timeline, piano roll, openDAW playback, projects on disk, import (audio, MIDI, project
files), MP3 export, undo, mute/solo, Space = play/pause and twice = stop. Agent, chat, Models, Sounds, Strudel and Pad
stayed in miuzika. Local git repository with **no commits and no remote**.

All 14 bugs from the copy are in `BUGS.md`: 11 fixed and verified, 1 in part (long WAVs play without their effects, and the
Log says so), 2 never reproduced.

## What Carlos tested by ear (6-Nov, "así por encima")

| check | result |
|---|---|
| Import an audio file, it sounds | good |
| Play from the cursor | good |
| Moving a clip while playing | good |
| Mute and solo | good |
| Undo, save, reopen | good |
| MP3 export | good |
| Pause | he could not find it: it is the ▶ button, which turns into ❚❚. Space was added for that |
| Space, once and twice | **not heard yet**, only checked headless. The window is 0.35 s; ask if it is comfortable |
| MIDI | imports and sounds, but "creo que se puede mejorar". **Not a bug: he will come back to it** |

Gates at that point: typecheck, 132 unit tests, openDAW contract and build green.

## The ACE-Step module (built 6-Nov, MEASURED with a simulated GPU, never run on a real one, nobody has heard it)

Decided with Carlos on 6-Nov: the app is modular and the GUI is where each module leaves its result. ACE-Step only for now, but
open to other models and GPU providers. No LLM touches what is sent; ACE-Step's own LM is accepted, as a visible option.
**Text reaches the model byte for byte** and nothing empty is filled in hidden. The CPU/GPU selector and the ACE-Step box do not
exist here; the GPU's cost and Off stay in the main bar with every module closed. Modules menu -> one window, three tabs:

- **Song**: text2music, all 6 models. Sets name, tempo and key of a new project.
- **Track**: lego (one instrument) or complete (accompaniment), the 2 base models. Context: silence, chosen tracks or a file.
- **Transform**: cover, cover-nofsq, repaint, extract.
- **Review**, common to the three: every value sent, editable; length, level and size of the source; estimated time and cost.
  Invalid values are refused with the reason, never corrected. A take keeps its recipe, with Repeat and New seed.

The rule on tempo: **the first generation in a project without tracks sets its tempo and key**, from Song or Track. And the BPM
is an editable field in the header at any time: MIDI follows it, a WAV keeps its speed and its place in time (`set_tempo`).

Pieces: `src/modulos/ace-step/receta.ts` (pure, tested), `web/src/modulos/ace-step/ventana.ts`, `web/src/modulos/anfitrion.ts` (all a
module may do to the project), `web/src/gpu-barra.ts`, `server/api/gpu.ts`, `server/lambda.ts` + `server/gpu/`, `workspace/gpu/generar_audio.py`.
Changes against miuzika's copy: parameters travel in a JSON file (`entrada/<name>.receta.json`), not the command line; the script no
longer changes the lyrics; silence is created on the instance; control ssh capped at 20 s with one retry; `pkill` pattern fixed.

**Checked**, 6-Nov: 158 unit tests, typecheck, openDAW contract, build, and a headless run through the whole GUI against
`MIUZIKA_GPU=simulado` (the real script, with torch and ACE-Step replaced): caption and lyrics with accents, quotes and line breaks reach
the model's parameters identical; a muted track sounds in the source; tempo, undo, Repeat, Cancel, refusals. That proves the path, not the music.

**Never run, to watch in the first real run:**
- The script's new paths on Lambda: `--parametros`, silence, empty BPM or key, `lm none` in text2music.
- Cancel while the DiT runs (the old `pkill` could not have matched; the new one is only unit-tested).
- The cost estimate is built from the 4-5 Nov numbers: compare it with the first real runs.

ACE-Step is **pinned to `ca1e85f`** (Carlos, 6-Nov): `REPO_COMMIT` in `generar_audio.py` and `ACESTEP_CONOCIDA` in `src/modulos/ace-step/version.ts`, tied by a
test. To move: change both once a new version has been tried by ear. The tell-tale compares upstream's `main` with it when the window opens, and each
finished take's lineage with it too. The weights are not pinned (they download apart, last changed Feb and Apr at the two repositories checked).

Known gaps: form fields are shared between tabs on purpose, so lyrics written in
Song show up in Track: visible, but check them. Nobody has compared the upstream docs since 5-Nov, and there are parameters not exposed.

## Settings (built 6-Nov, Carlos: "no queremos editar el .env")

The **Settings** button holds the accounts the app rents from; which model to use stays in each module. It paints what each provider declares in
`src/core/proveedores-gpu.ts`, only Lambda so far. Keys go to `.miuzika/proveedores.json` (outside git and workspace) and only their last digits come
back; `.env` is a fallback for empty fields. Test connection only reads: API key, key file, key name in Lambda, ssh program.

## First real run (7-Nov, A10, HEARD by Carlos)

`lego` drums over 8 bars of silence at 116 BPM, `acestep-v15-xl-base`, no LM, seed 1097560858, ACE-Step `ca1e85f`, project folder `ace-step`, take `toma`.
His ear: "suena a batería electrónica, sólo batería", no distortion heard unless it is the kit's own effects. So lego over silence gave the asked instrument this
once (the earlier run gave an accidental violin): one take is not a rate. Whether it sits in time at 116 was not said.
Measured: 5 min 37 s in all against ~7 min 24 s estimated (boot 241 s, install 15 s, model 17 s, generation 7 s, VRAM 11.27 GB); peak -0.0 dBFS, RMS -16.2 dBFS; 16.520 s against
16.552 s asked (ACE-Step truncates). The install's 15 s looks too short next to earlier runs: measure again before changing the estimate.
Worked for the first time on a real GPU: new SSH key, pinned commit, recipe file, silence on the instance, `lm none` in lego. Cancel on a real GPU, 7-Nov, about 12 s after the script started (probably still loading the model): no process left on the instance, 0 MiB of GPU memory in use, no output there, no track in the project. Same fixed seed, same machine: identical audio byte for byte (`toma-2`, `toma-2-2`, lego with xl-base), but a random seed recorded a false number (BUGS 20, fixed). Other models and another instance not measured. Still not run: Cancel during the generation itself (7 s here, little margin),
`lm none` in text2music, empty BPM or key.

**Lego over a sounding track, 7-Nov, HEARD:** bass over the drums `toma` (E minor, 116, 2 takes, 50 s). Carlos: "ambas son sólo bajo", on the kick "creo que sí", "me sirven las dos". Correlation with the drums -0.002 and -0.027: no copy, unlike the strings of 5-Nov over a full mix. Neither follows the caption's "driving eighth notes" by measure (`bajo-1` spaced hits, `bajo-2` a low drone); the ear passed them anyway.

**Guitar over drums, `bajo-1` and `synth-b-3`, 7-Nov, HEARD:** take 1 "no suena a guitarra, entre sinte y arpa electrónica"; take 2 "puede pasar por guitarra pero casi bajo"; take 3 "guitarra con efectos". None respects the caption. Pattern so far in lego: the instrument mostly holds, the caption does not.

**`guitarra-i`, same as `guitarra-h` on `acestep-v15-base` instead of xl-base, 7-Nov, HEARD:** takes 1 and 3 "son guitarras, pegan muy bien con el resto de instrumentos pero no suenan para nada parecidas al caption"; take 2 "no suena bien". First guitars that fit the song. Correlation with `guitarra-h` 0.11-0.23: another result, not a variation. Model load 5.6 s, generation 8.1 s, VRAM 7.07 GB. The caption still does not steer the sound on either model.

**`guitarra-h`, same recipe and seeds as `guitarra-g` with GUITAR in capitals, 7-Nov, HEARD:** take 1 "una guitarra pero no está cerca del caption", take 2 "un synth y tampoco respeta caption", take 3 "un pego de cosas raras y mal montadas". Capitals do change the audio (correlation 0.79-0.89 against 0.97-0.99 for a plain repeat) but they do not bring the caption or the instrument closer. Still to correct to upstream's form, as it is our error. Sent directly by Claude with his go.

**`guitarra-g`, Repeat of `guitarra-c` (3 takes, same seeds, source, guidance 11), 7-Nov:** not byte-identical, correlation 0.991, 0.996 and 0.973 with `guitarra-c`. So same seed repeats exactly in the one-take case measured (`toma-2`), and only nearly in this three-take batch; the cause is not known. Meant to carry GUITAR in the instruction; the recipe says lowercase, also in `guitarra-f`. Not reproduced on the simulated path, where a typed edit reaches the model.

**`guitarra-d`, instruction with GUITAR in capitals as upstream writes it, over silence, D minor, guidance 7, 1 take, 7-Nov, HEARD:** "una guitarra algo distorsionada, estilo reggae, no es lo que buscábamos". Sent from a form reset by a reload, so it does not compare with `guitarra-c`. The same-seed test of the capitals is still to run. Our `instruccionDe` and the script write lowercase names while upstream writes them in capitals (`task_utils.py`), and `complete` joins them with " | ": not corrected until measured.

**`guitarra-c`, guidance 11 confirmed in the lineage, 7-Nov, HEARD:** take 1 "no respeta para nada el caption pero suena a guitarra", take 2 "también pero es synth", take 3 "no se sabe qué es". Guidance is not the way. No empty takes this time, three is too few to credit it.

**`guitarra-b`, same recipe at guidance 7 (the 11 asked for did not reach the recipe; why not checked), 7-Nov, HEARD:** take 2 "pasa completamente del caption, parece una guitarra de frank zappa". Takes 1 and 3 almost empty (-57 dBFS), like `synth-b-1`: lego sometimes returns near silence and the app presents it as a good take. Improvement to make: warn about it.

**Simpler pad over drums and `bajo-1`, 7-Nov, HEARD:** `synth-b-1` "basura" (-57 dBFS); `synth-b-2` "está bien" but adds rhythm, better without it; `synth-b-3` "está bien, no es para tirar cohetes". So a simple caption over fewer tracks did better than the first attempt, on one run.

**Synth over drums and two basses, 7-Nov, HEARD, did not pass:** `synth-1` "un pegote extraño como si se hubiese extraído de otra canción"; `synth-2` very low, "podría servir" but off style and with a touch of drums. By measure `synth-1` looked promising (E minor 0.83, no copy of the source, level fine): the numbers said nothing about whether it belongs. To try: a simpler caption over fewer tracks.

## Needed from Carlos before the first run

Done 7-Nov: Settings filled and Test connection passes. The API key in `../miuzika/.env` is dead (401), and the SSH key `aios-agent-rag` no longer exists in Lambda: a new one, `~/.ssh/miuzika-lambda`, was created and registered, no passphrase because the server runs ssh with nobody to type it. The default name `aios-agent-rag` in `proveedores-gpu.ts` and `lambda.ts` is stale but overridden. Next: the first real run, whose go is Carlos's.

## Undecided: do not assume any of this

1. **Where the project lives on GitHub**: a new repository, or replacing miuzika's content with its history behind it. No commits yet.
2. **What cannot be missing before he stops using miuzika.** Asked, not answered. Candidates: faders, effects and buses;
   WAV and MIDI export; Sounds; Strudel; Pad; the agent as an optional piece.

Missing from the GUI because only the agent did it. He said "no añadas nada" for now, so **do not build these unasked**:
change the key by hand, rename, gain and pan, effects, WAV and MIDI export.

## Direction for the song (Carlos, 7-Nov)

Rejected: a whole song from text2music, then separated: "quiero tener el control desde 0". After 13 lego takes with context, lego does not follow the caption at guidance 7 (11 not run) and fits unevenly. Proposed, not decided or tried: he writes the notes (MIDI), the app renders them and `cover` dresses each track. Evidence for: `cover` passed his ear on 5-Nov, aligned at lag 0 ms. Against: only on full material, never one instrument at a time. Gap: the GUI edits a clip's notes and imports .mid, but cannot create an empty MIDI track.

## Improvements Carlos is noting while making a song (7-Nov), not built yet

- Deleting a track from the GUI should also ask whether to delete its file from disk.
- Open and Audio should start in the project's folder if there is one, else the app's (Carlos, 7-Nov). A browser's file dialog cannot be given a folder by path, so proposed: a list inside the app of the project's files (generado/, entrada/), served by the server, with the system dialog as a second option.
- Approved by Carlos 7-Nov: in a project with tracks, Context starts on Tracks, none ticked; in an empty one, on Silence.
- Proposed: the form keeps its last values per project across reloads; a taken name refused on Review; a near-silent take flagged; a multi-track source lowered instead of clipped (BUGS 21).
- A tab reload closes the project. It happened 7-Nov also with no change of ours (no file touched, last request 29 min before, cause unknown; a browser discarding an idle tab is a guess). Proposed: reopen the last project on load.
- A taken name should be refused on Review, with Run disabled and the reason there. Today Run closes the window, the server answers 409, the reason only reaches the Log, and the form's edits are gone (Carlos, 7-Nov: "creo que no está haciendo nada").
- "From bar 1 to 8" should fill bar 8. Measured 7-Nov: files and sources do last 8 bars (16.52 s of 16.552 s), but the model ends before: `toma` at bar 6.94, `toma-2` at 7.08, `bajo-1` at 6.23, `synth-b-2` at 7.08. Bar arithmetic is right; the silence is in the generated audio. Why is not known (a written ending is a guess). Proposed, not built: generate about 2 bars more and cut the clip to the bars asked, shown in Review. Untested whether the margin fills it.

## Idea to keep: continuing ACE-Step ourselves (noted at Carlos's request, 6-Nov; nothing decided or started)

Upstream has slowed down (last commit on `main` 29-Aug, last push anywhere 11-Oct), so he wants this written down. From its docs, nothing tried:
keep our own copy of the code (MIT, 14 MB) and of the weights (Hugging Face, MIT); train a LoRA or LoKr on his own songs (16 GB VRAM minimum,
20 recommended, "8 songs, 1 hour on a 3090"); retrain all parameters from the current weights (minimum 8x40 GB GPUs, about 2 TB, 116K songs,
code changes: `docs/en/Large_Scale_SFT_Training_Guide.md`, whose Muse dataset has folders named `suno_*`, to clear up before using it). No guide
seen for training from zero. A LoRA can lean the sound towards his; it adds no function and fixes no task.

## Then: validate ACE-Step

Carlos: validate "si ace-step crea correctamente canciones con todas sus funcionalidades y modelos". Tasks by models, same
material, his ear as the verdict. Earlier results and measurements: `../miuzika/docs/PRUEBAS-ACESTEP-2026-11-04.md`.

- Passed by his ear on 5-Nov: `complete` (voice -> band), `extract` vocals, `cover` (turbo 0.6 with lyrics; sft 0.6).
- Failed or partial: `extract` drums; `lego` strings over a sounding mix.
- text2music completes a song even when asked for drums alone: negations in the caption prime the words they deny.

**His musical goal:** a dark wave / synth pop song, sinister, dirty, at moments industrial, mid-tempo, nihilistic English
lyrics, **one track per instrument and one for the voice, mixed by him**. Not a finished mix from the model.

**First test, still pending:** does `lego` over real silence give one clean instrument? The only evidence is one accidental
violin. The 6-Nov attempt in miuzika does not count: the source was `bateria-1`, not silence. If it fails, the fallback is built
from what passed (generate a voice or a base, and complete from there).

## Outside this folder

- `../miuzika` is untouched and still works; its `ESTADO.md` knows nothing of this project.
- `../miuzika/workspace/proyectos/capas/` was created by me on 6-Nov for that test (empty project and a silent WAV). Unused.
- Lambda: the last A10 was shut down on 6-Nov 18:54 (confirmed). Instance `295bdec6…` has been listed as "terminating"
  for a year: a provider fault, it does not bill.
