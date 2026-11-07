# STATUS — 7-Nov-2026 (evening)

## START HERE

Carlos, 7-Nov: **"hay que evitar tener que pasar de nuevo por dónde ya hemos pasado"**. Before proposing a test or a feature, read
"What ACE-Step can and cannot do" below: it holds every verdict by ear so far. When a new verdict or conclusion arrives, write it there
in the same session, not at the end.

**7-Nov evening, in short (committed at his request):**
- **Removed from the window:** lego ("lo quitamos de la app": not steerable) and the Reference field (it failed in lego and in cover).
- **Works:** text2music with a detailed English caption (project `vein`: "están muy bien").
- **Half:** extract (it pulls what stands out in the mix); cover (keeps the song and sounds good, but ignored "dirtier").
- **Fixed:** bugs 25 (the file picker looked empty) and 26 (a reload now reopens the last project).
- **Texts:** the help texts no longer carry our test dates or anecdotes. That rule is kept in memory.
- **Projects:** he deleted the older ones; `vein` is the current one. `vein-cover-1` is a stray project from bug 26, his to delete.
- **Still to do:**
  - Feature noted but not designed: build a caption from web descriptions of a known song.
  - Proposed, not approved: a dedicated stem separator such as Demucs.
- **GPU:** on since 19:29, unless he has pressed Off since.

Where we were before (7-Nov morning and afternoon, partly superseded above):
- Song project **`bateria-1`**, now deleted: drums kept; basses `bajo-1` ("xilófono sintetizado") and `bajo-1-2` ("mejor pero no es
  hardcore punk"). Project `ace-step` ("toma"), the morning song.
- Built and checked on 7-Nov: bar margin (heard: "llega hasta el 8 inclusive"), instruction as upstream, context starts on Tracks,
  bugs 15, 16, 22, 23, 24 fixed (detail in the dated section below and in `BUGS.md`). typecheck and 177 unit tests green. Committed in
  `8996a73` (7-Nov afternoon, at his request; local only).
- GPU: off at ~11:25 on 7-Nov; on again from 19:29 for the evening runs.
- In the window since 7-Nov afternoon (Carlos: "no quiero quejas de usuarios de no sirve"): each tab and task says what it is good for
  and what fails (`EXPECTATIVAS` in `ventana.ts`, one sentence per verdict of the table below: change them together), and Review shows a
  framed **No warranty** notice before Run: free software as is (AGPL-3.0, as in LICENSE, "como todo el software libre"), no result
  guaranteed, the rented GPU bills every run, failed and cancelled ones included, until Off. Seen headless; not a lawyer's text.
- (Superseded: lego was removed from the window that evening.) Lego had proposed `acestep-v15-base` by default.

Next, his choice (nothing decided):
- **Reference audio** field: the candidate to steer style without words, since the caption does not steer it in lego. Read in upstream
  `ca1e85f` on 7-Nov (code, not run): `GenerationParams.reference_audio` (a file path), processed for **every** task with no task gate, so
  it can go together with lego's context (`src_audio`). `io_audio.py process_reference_audio`: to 48 kHz stereo, a silent file fails the
  whole call, then exactly 30 s are taken: shorter files are looped, and three 10 s pieces are picked with `random.randint` from the
  front, middle and back thirds (so a file of exactly 30 s is used whole and deterministically: cut it to 30 s on our side). Encoded by
  the VAE (no separate timbre encoder seen). Docs: "global reference for timbre or style", "mainly controls the acoustic features"
  (timbre, mixing, performance style), not melody or rhythm (a docs claim). Not read: the DiT forward, so whether lego really uses it is
  unknown until heard. **REMOVED from the window the same evening.** Carlos: "sí la quitamos", after it failed in lego and in cover (see
  the verdict table). Takes made with a reference are not offered for Repeat; `generar_audio.py` keeps `--referencia`, and
  `Parametros.referencia` remains. What had been built:
  - "Reference" in Track and Transform, but not for extract: any file the browser decodes, MP3 included, plus "from N s".
  - On Review the browser cuts that 30 s window to a 48 kHz stereo WAV in `entrada/ref-<file>-<N>s.wav` (5.5 MB, ~52 s to upload).
  - Start editable on Review: it re-cuts, and a cut already made is not uploaded again. A start past the end refuses and Run goes off;
    under 30 s left, it says ACE-Step loops it; a silent cut is refused.
  - Saved as `parametros.referencia` and `fuente.referencia` in the recipe, so Repeat keeps it. The script passes `reference_audio`,
    and the lineage keeps its sha256.
  - Checked headless on 5181 with the simulated GPU (mono 100 s MP3): every point above held.
  - **First real run, 7-Nov 19:30, `bajo-ref-1`:**
    - Recipe: lego bass on base over bateria-1 bars 1-9 + 2 bars of margin, seed 4024297871. Caption "synth pop dark wave",
      without BPM or key.
    - Reference: Ghosts Again, a full mix, 0:00-0:30.
    - Carlos by ear: "una mezcolanza de batería, pad y algo de bajo", not a clean bass.
    - Measured: 91 % of the energy under 120 Hz, centroid 91 Hz, peak 0.0 dBFS. These numbers could not tell a mix from a bass.
    - Not separable: the caption also changed, to a genre with no instrument word. Hypothesis: a full-mix reference pulls lego
      towards a full mix (the docs say it steers "mixing").
    - **Separated 19:41, measured:** `bass-dark` (with the reference) and `synth-pop-dark-wave` (without it) share the source
      (sha256 59695bbcaf7c), the seed, the caption and the model.
      - With the reference: centroid 90 Hz, 91 % of the energy under 120 Hz.
      - Without it: centroid 4229 Hz, 61 % above 2 kHz.
      - Correlation between the two: 0.10.
      - **The reference steers lego hard**: the drum-pad-bass mix came from the full-mix reference, not from the caption.
      - `bass-dark` against `bajo-ref-1`, same inputs: correlation 0.9955, not byte-identical. With a reference, repeats are near
        but not exact.
      - Carlos on `synth-pop-dark-wave`: "es un xilófono". bajo-1 was the same. Lego bass over bateria-1 without a reference gave
        a xylophone twice, with two different captions.
      - Next: a bass-only reference. Proposed: extract bass from the 30 s Ghosts Again cut (extract on bass never tried), then
        use it as the reference. The other way: a CC bass-only loop.
      - **Extract on bass works**, `ghosts-bass`, 7-Nov 19:50: base, 50 steps, `[Instrumental]`, 41 s on a GPU already on.
        - Carlos: "suena al bajo de la canción de ejemplo, está muy bien, aunque la extracción lleva algo de sonido del resto".
        - Measured: centroid 164 -> 90 Hz, above 2 kHz 1.0 -> 0.0 %, correlation 0.70 with its source (not a copy).
        - The extract text in the window (EXPECTATIVAS) does not say this yet: change it when he is not using the app.
      - **`bass-ghostref`, 7-Nov 19:52:** lego with the extracted bass as the reference; source, seed and caption as above.
        - Measured: centroid 46 Hz, 97 % of the energy under 120 Hz, about -9 dB RMS, sounding without pause through the margin.
        - Carlos: "se oye fatal, es otro de esos pegotes".
        - **Verdict: the reference changes lego's output a lot, but does not make a usable bass.** With a full mix it gave a mix;
          with a bass alone, a block of sub-bass. It seems to copy the sound's colour, not the playing.
        - Also, these three runs had no key or BPM, over a context of drums only: the bass had no harmony to follow.
        - Do not retry lego plus reference for bass.
        - Proposed instead, not tried: text2music for the whole punk song (170 BPM, D minor), then extract its bass and
          drums. Both tasks were judged good.
  - Repeat cannot add a reference to a take that had none. So the first real test is `bajo-1-2` rebuilt from the form, adding only
    the reference. Its values: Track tab, One new instrument, bass, base, the same caption, D minor, 170 BPM, Tracks with
    bateria-1 only, bars 1 to 9 (its recipe asked 9 bars), margin 2, seed 4024297871. Then compare it by ear with `bajo-1-2`.
- Keep building `bateria-1` with lego on `acestep-v15-base`, English caption with positive words, 2-3 takes per track.
- Proposed earlier, not tried: he writes the notes (MIDI), the app renders them and `cover` dresses each track ("Direction for the song").
  Gap: the GUI cannot create an empty MIDI track.
- Proposals waiting for his yes (do not build without it): lower a multi-track source instead of clipping (bug 21), flag a near-silent
  take, refuse a taken name on Review, keep form values across reloads, reopen the last project on load. His own requests, "ya lo
  veremos": ask whether to delete the file when a track is deleted; Open and Audio starting in the project folder.
- **Feature he asked to note, 7-Nov evening (not designed, not built): "buscar por internet descripciones de canciones que los
  usuarios puedan escoger ya conocidas para usar de referencia".**
  - Why: the `vein` caption came from an AI that searched the web for descriptions of the style, and it worked ("muy bien").
  - Idea: the person picks a known song, the app gathers what is published about it (reviews, interviews, production notes,
    BPM/key databases such as Tunebat), and turns it into a caption under 512 chars. English, positive words only, tempo and key
    in their own fields.
  - Open points to settle with him before designing:
    - It needs a search API and probably an LLM, keys kept server-side. Carlos, 7-Nov: the "no LLM" of 6-Nov meant the ACE-Step
      path needs none, not that the app never has one.
    - What is gathered must be shown and editable before anything is sent, as Review does now.
    - Gathered descriptions can be wrong or invented: show the sources.
    - Only text descriptions travel. Song audio is not downloaded: the YouTube decision of 7-Nov.
- Unresolved: twice the Review instruction edit did not reach the recipe (`guitarra-f`, `guitarra-g`); on 7-Nov afternoon his edit
  ("Generate the DRUMS track") did reach it. Ask him whether the box showed the change those two times.
- Lyrics for a vocal track: he writes them or asks for a draft he edits.

Standing facts: he wants the Lambda credits spent ("en un año me los quitarán"), do not keep warning about cost (memory
`creditos-lambda`), but say when a machine is left on. SSH key `~/.ssh/miuzika-lambda`, registered in Lambda and saved in Settings.
Commits only when he asks (local only, no remote). Logs are UTC, Carlos reads local time (UTC+1): give local times.

## 7-Nov afternoon: margin, instruction, context (built, checked on the simulated path, margin HEARD)

What was built and measured (headless Chrome on :5181, `MIUZIKA_GPU=simulado`: proves the path, not the music):
- **Margin (1)**: lego and complete send 2 bars of margin by default (silence longer, or tracks rendered further and padded with silence;
  a File source is sent as it is, no margin). Review shows "margin (bars)", editable 0-16: a change re-prepares the source. The clip is cut
  to the asked bars, the WAV keeps everything (`largoDeClip` in `src/core/tiempo.ts`). Recipe `entrega` carries `compases` and `margen`, so
  Repeat keeps the cut; older takes without them are placed whole, as before. Measured: 8 bars of silence at 120 -> 20 s source, clip 32
  beats, WAV 40; tracks bars 1-4 with the margin edited to 1 -> 10 s source, clip 16 beats, WAV 20; Repeat of it -> clip 16. Side effect:
  a tracks source asked past the project's end is now padded to the asked length (it used to be cut short). Each margin edit leaves the
  previous render in `entrada/` (`-fuente.wav`, `-fuente_2.wav`). **First A10 take with the margin, 7-Nov ~11:00**, project `bateria-1`
  (lego drums over 8+2 bars of silence, `acestep-v15-base`, 170 BPM, instruction edited by Carlos to "Generate the DRUMS track"): bars 1-8 at
  rms ~-19 dB (bar 8 -17.8), bar 9 only a tail (rms -39), bar 10 silent (-62); sound ends 0.1 s into bar 9. Clip 32 beats, WAV 10 bars. One
  take only. **HEARD**, Carlos: "llega hasta el 8 inclusive".
  Then `bajo-1` (lego bass over `bateria-1`, base, D minor, caption "bajo eléctrico, estillo punk hardcore"): sounds to bar 8.04, but Carlos:
  "se parece a un xilófono sintetizado". Measured over bars 1-8: 15 % of energy above 2 kHz, almost none at 500-2000 Hz, centroid 800 Hz
  (yesterday's `toma` basses: ~0 % above 2 kHz, centroid 66-137 Hz). `bajo-1-2` = Repeat with the same seed 4024297871 and source, only the
  caption changed to "electric bass guitar, distorted, fast punk hardcore, eighth notes locked to the kick": above 2 kHz 7.6 %, 120-500 Hz
  52 %, centroid 447 Hz, 6 dB louder. Carlos: "está mejor pero no es hardcore punk". So here the caption did move the timbre (one seed, one
  pair). Both clips are 9 bars: bug 24. Carlos stopped at ~11:25 and shut the GPU down himself. Carlos: "suena a batería clásica y rockera aunque no punk hardcore" (caption "batería real, estillo punk hardcore"). Peak
  -0.0 dBFS in bar 1, normalize off: possible clipping, not heard as such.
- **Instruction (2)**: `instruccionDe` and `generar_audio.py` now build it as upstream's `generate_instruction` (read at `ca1e85f` on 7-Nov:
  `track_name.upper()`, complete joins with " | "). The simulated script received "Generate the GUITAR track based on the audio context:".
- **Context (3)**: with tracks, the form starts on Tracks with none ticked (measured: 0 of 1), so Review stops at "Choose the tracks to send";
  empty project starts on Silence.
typecheck and 175 unit tests green. Committed in 8996a73.

## Why this project exists

On 6-Nov Carlos got tired of the indeterminism in miuzika: asking for one drum take took two attempts and gave nothing
valid. The agent refused an exact order because a tool description forbade what the code allowed, and the audio sent to
the model depended on the mute state, which nobody saw before spending GPU. He decided to copy what he likes into a new
project: first the GUI, then the code that runs ACE-Step on a GPU provider with no intermediary. The goal is to replace miuzika.

## What exists

The GUI, separated from the agent: timeline, piano roll, openDAW playback, projects on disk, import (audio, MIDI, project
files), MP3 export, undo, mute/solo, Space = play/pause and twice = stop. Agent, chat, Models, Sounds, Strudel and Pad
stayed in miuzika. Local git repository, **no remote**; first commit 7-Nov.

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

## The ACE-Step module (built 6-Nov; run on a real A10 and heard since 7-Nov: see "First real run" and the verdict table)

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

## Needed from Carlos before the first run (all done 7-Nov)

Done 7-Nov: Settings filled and Test connection passes. The API key in `../miuzika/.env` is dead (401), and the SSH key `aios-agent-rag` no longer exists in Lambda: a new one, `~/.ssh/miuzika-lambda`, was created and registered, no passphrase because the server runs ssh with nobody to type it. The default name `aios-agent-rag` in `proveedores-gpu.ts` and `lambda.ts` is stale but overridden. Next: the first real run, whose go is Carlos's.

## Undecided: do not assume any of this

1. **Where the project lives on GitHub**: a new repository, or replacing miuzika's content with its history behind it. Local commits only, no remote.
2. **What cannot be missing before he stops using miuzika.** Asked, not answered. Candidates: faders, effects and buses;
   WAV and MIDI export; Sounds; Strudel; Pad; the agent as an optional piece.

Missing from the GUI because only the agent did it. He said "no añadas nada" for now, so **do not build these unasked**:
change the key by hand, rename, gain and pan, effects, WAV and MIDI export.

## Direction for the song (Carlos, 7-Nov)

Rejected: a whole song from text2music, then separated: "quiero tener el control desde 0". After 13 lego takes with context, lego does not follow the caption at guidance 7 (11 run later, `guitarra-c`: no better) and fits unevenly. Proposed, not decided or tried: he writes the notes (MIDI), the app renders them and `cover` dresses each track. Evidence for: `cover` passed his ear on 5-Nov, aligned at lag 0 ms. Against: only on full material, never one instrument at a time. Gap: the GUI edits a clip's notes and imports .mid, but cannot create an empty MIDI track.

## Improvements Carlos is noting while making a song (7-Nov), not built yet

- Deleting a track from the GUI should also ask whether to delete its file from disk.
- Open and Audio should start in the project's folder if there is one, else the app's (Carlos, 7-Nov). A browser's file dialog cannot be given a folder by path, so proposed: a list inside the app of the project's files (generado/, entrada/), served by the server, with the system dialog as a second option.
- BUILT 7-Nov: in a project with tracks, Context starts on Tracks, none ticked; in an empty one, on Silence.
- Proposed: the form keeps its last values per project across reloads; a taken name refused on Review; a near-silent take flagged; a multi-track source lowered instead of clipped (BUGS 21).
- A tab reload closes the project. It happened 7-Nov also with no change of ours (no file touched, last request 29 min before, cause unknown; a browser discarding an idle tab is a guess). Proposed: reopen the last project on load.
- A taken name should be refused on Review, with Run disabled and the reason there. Today Run closes the window, the server answers 409, the reason only reaches the Log, and the form's edits are gone (Carlos, 7-Nov: "creo que no está haciendo nada").
- "From bar 1 to 8" should fill bar 8. Measured 7-Nov: files and sources do last 8 bars (16.52 s of 16.552 s), but the model ends before: `toma` at bar 6.94, `toma-2` at 7.08, `bajo-1` at 6.23, `synth-b-2` at 7.08. Bar arithmetic is right; the silence is in the generated audio. Why is not known (a written ending is a guess). BUILT and HEARD 7-Nov: 2 bars of margin, clip cut to the bars asked ("llega hasta el 8 inclusive", one take).

## Idea to keep: continuing ACE-Step ourselves (noted at Carlos's request, 6-Nov; nothing decided or started)

Upstream has slowed down (last commit on `main` 29-Aug, last push anywhere 11-Oct), so he wants this written down. From its docs, nothing tried:
keep our own copy of the code (MIT, 14 MB) and of the weights (Hugging Face, MIT); train a LoRA or LoKr on his own songs (16 GB VRAM minimum,
20 recommended, "8 songs, 1 hour on a 3090"); retrain all parameters from the current weights (minimum 8x40 GB GPUs, about 2 TB, 116K songs,
code changes: `docs/en/Large_Scale_SFT_Training_Guide.md`, whose Muse dataset has folders named `suno_*`, to clear up before using it). No guide
seen for training from zero. A LoRA can lean the sound towards his; it adds no function and fixes no task.

## What ACE-Step can and cannot do: the verdict so far (written 7-Nov afternoon, at Carlos's request)

Only his ear counts as a verdict here; sources: `../miuzika/docs/PRUEBAS-ACESTEP-2026-11-04.md` (5-Nov) and the sections of this
file from "First real run" (7-Nov). Update this table when a new verdict arrives, instead of letting it scatter again.

| task | verdict by ear | model | source |
|---|---|---|---|
| complete (voice -> band) | PASS, "está muy bien" | xl-base | 5-Nov test 7 |
| cover 0.6 with lyrics | PASS: turbo "hay voz… piano con menos notas"; sft "muy industrial, me encanta" (preferred). Without lyrics: no voice | xl-turbo, xl-sft | 5-Nov tests 4, 4b, 8 |
| extract vocals | PASS on the 2nd try, "se escucha sólo la voz" | xl-base | 5-Nov test 2b |
| extract bass from `vein-1`, bars 1-24 | NOT GOOD, but the source is to blame: Carlos, "vein-1 no deja muy claro si hay un bajo". Measured like the good `ghosts-bass` (highs gone, centroid 286 -> 80 Hz, correlation 0.57). Extract needs a distinct line in the mix. xl-base (the window's default), 95 s | xl-base | 7-Nov 20:22 |
| cover of `vein-1`, bars 1-24, strength 0.6, caption pushed to "harsher and dirtier" industrial | HALF. Carlos: "suena synth-pop, es chula, pero NO es más industrial y sucia". It keeps the song and sounds good, but the caption's push did not reach the sound, like the style in lego. Seed 7111, 70 s run | xl-sft | 7-Nov 20:41 |
| cover with reference: `vein-cover-ref`, the `vein-cover-1` recipe plus Ghosts Again 1:24-1:54 | FAIL. Carlos: "un pegote de instrumentos bastante estridente". Same source (sha 09df95507fff) and seed. Measured: 5.5 dB louder, stereo narrowed to the reference's (-5.0 -> -9.1 dB side), correlation 0.61 with the cover without reference. A full-mix reference pulls the mix and makes a jumble, as it did in lego. A first try went to a stray project at 120 BPM without the reference (bug 26) | xl-sft | 7-Nov 20:58 |
| extract synth / drums from `vein-1`, bars 1-24 | HALF. Carlos: "extract se puede usar pero a medias". Synth: vein-1 has several synths and it pulled the least present one. Drums: the opening came out as something that is not drums, then a kit quite like vein-1's. No vocals heard in vein-1 to extract | base | 7-Nov evening |
| extract drums | FAIL / partial ("pegote con restos"). A real separator (Demucs or similar) is the honest tool | xl-base | 5-Nov tests 3, 3b |
| lego over silence or a few tracks | NOT STEERABLE. Carlos, 7-Nov evening: "todo lo que ha salido bien, no siguió casi el caption". The takes he kept were what the model chose, not what was asked. The instrument holds sometimes; bass over bateria-1 failed 5 of 5 (xylophone x2, pad mix, sub block, "not punk"). The reference changes it a lot without making it usable. Best case: drums over silence | base, xl-base | 7-Nov |
| lego over a full mix | FAIL: strings came back as a track with voice and everything | xl-base | 5-Nov |
| lego / repaint with a range | the rest came back as a copy of the source | — | 5-Nov |
| text2music | good full songs ("muy industrial, muy bueno"), but not for one instrument: the LM completes a song, negations prime what they deny. **7-Nov 20:07, project `vein`:** a detailed English caption (483 chars: instruments, drums, production, no negations), 92 BPM, D minor, 4/4, 180 s, 2 takes. Carlos: "están muy bien, son buenos ejemplos para el prompt que le dimos". The LM kept the caption, BPM, key and duration. Seeds 782922162/3, 220 s run | xl-turbo + LM 1.7B | 2-Nov, 5-Nov evening, 7-Nov |
| repaint | range control works; heard "igual, algo más", level then falsified by our -6 dB master (fixed) | xl-turbo | 5-Nov test 5 |

**The weak point: style in lego.** The instrument mostly comes out, the caption's style almost never: 16 guitars on 7-Nov, none followed
it; on 7-Nov afternoon neither drums nor bass sounded "punk hardcore". Sometimes another instrument (bass like a xylophone, guitars like synth
or harp) and sometimes a near-silent take (-57 dBFS). One counter-sign: same seed, an English caption moved the bass timbre a lot (better, not
punk), one pair only. Rough share of lego takes he kept: between one in three and two in three (a count over his verdicts, not a measure).

**Not tested:** repaint judged properly by ear, `cover-nofsq`, text2music without the LM.
**Tested 7-Nov evening:** the reference audio in lego. It steers the sound hard but not usefully (see "Built 7-Nov evening" above).
**Extract bass: PASS** ("suena al bajo de la canción", a little bleed), base, 7-Nov.

**Dropped 7-Nov evening. Carlos: "lo quitamos de la app". Done, committed the same evening:**
- Track is complete only. Silence went with lego.
- Repeat lists no lego takes, though every take still counts for the names in use.
- The script still runs lego, so old lineages stay readable.
- The extract text now says that voice and bass are good.
- Extract's default instrument was drums when untouched, while the form showed vocals; now it is vocals.
- Checked headless. Was proposed: lego on `acestep-v15-base`, first track over silence, each next
one over a few finished tracks, English caption with positive words only, 2-3 takes per track to keep one.

## Then: validate ACE-Step

Carlos: validate "si ace-step crea correctamente canciones con todas sus funcionalidades y modelos". Tasks by models, same
material, his ear as the verdict. Earlier results and measurements: `../miuzika/docs/PRUEBAS-ACESTEP-2026-11-04.md`.

- Passed by his ear on 5-Nov: `complete` (voice -> band), `extract` vocals, `cover` (turbo 0.6 with lyrics; sft 0.6).
- Failed or partial: `extract` drums; `lego` strings over a sounding mix.
- text2music completes a song even when asked for drums alone: negations in the caption prime the words they deny.

**His musical goal:** a dark wave / synth pop song, sinister, dirty, at moments industrial, mid-tempo, nihilistic English
lyrics, **one track per instrument and one for the voice, mixed by him**. Not a finished mix from the model.

**Answered 7-Nov:** `lego` over real silence gives one instrument: drums twice, heard ("sólo batería" for `toma`, `bateria-1` "clásica y
rockera"). See the verdict table above.

## Outside this folder

- `../miuzika` is untouched and still works; its `ESTADO.md` knows nothing of this project.
- `../miuzika/workspace/proyectos/capas/` was created by me on 6-Nov for that test (empty project and a silent WAV). Unused.
- Lambda: the last A10 was shut down on 6-Nov 18:54 (confirmed). Instance `295bdec6…` has been listed as "terminating"
  for a year: a provider fault, it does not bill.
