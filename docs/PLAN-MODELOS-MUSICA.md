# Music-specific models in miuzika — plan agreed on 2-Nov-2026

Follows `fable.md` (brainstorm handoff, 2-Nov) §3.1 and §4.5, and `autoria/CONCEPT.md`
(authorship layer, Spike B done). This note records what Carlos approved on 2-Nov, in
which order, and what was parked, so later sessions do not re-argue it.

## What changed when the handoff was checked against the laptop (2-Nov)

- **The laptop cannot run the audio models.** Measured: Intel Core i5-1035G1, Intel UHD
  Graphics (1 GB, no CUDA), 7.7 GB RAM with ~2 GB free while working. ACE-Step's "<4 GB
  VRAM" tier assumes a CUDA card; on this machine it would be CPU with full offload and no
  published CPU timing. Stable Audio 3 Small-Music (433M, built for CPU, 1.7 s per 30 s on
  a Mac) is the only local candidate, and even that is unmeasured on this i5.
- **Carlos's decision (2-Nov): generation runs on Lambda first.** The laptop is the
  client. If the models are more comfortable on a Lambda VM, that is where they live; if
  later the service has to be re-rented (a paid tier), so be it. Same path as
  `server/lambda.ts` already uses for the torch engine.
- **Symbolic models were missing from the handoff.** miuzika composes in notes, so a
  text-to-MIDI model fits better than any audio model for *material*. Candidate:
  MIDI-LLM (Llama 3.2 1B + MIDI tokens from the Anticipatory Music Transformer, multitrack
  text-to-MIDI, lead sheet, infilling; weights public, licence Llama 3.2 Community per a
  mirror, to confirm on the official repo).
- **Magenta RealTime 2** (June 2026) exists: code Apache-2.0, weights CC-BY-4.0, Small
  230M, MIDI input per frame, ~200 ms. Phase-2 candidate; nothing promised for CPU or
  browser.
- **Transcription** closes a gap `medir_referencia` admits ("does NOT extract the melody
  or the chords"). MuScriptor (Kyutai, 2026) is CC-BY-NC: not for the product. basic-pitch
  (Spotify) is Apache-2.0 from memory, to verify before use.

## Approved (2-Nov), in this order

1. **`generar_audio` on Lambda.** A tool that runs ACE-Step 1.5 and/or Stable Audio 3
   Medium on the Lambda instance through the existing `/api/run/lambda` path, brings the
   WAV back into the project as an audio track (as `usar_sample` does), feeds tempo, key
   and duration from the project into the prompt, and writes a lineage record (model,
   version, LoRA, prompt, seed) that the authorship layer signs. First step: a measured
   spike on the A10 (install time, weights download, seconds per 30 s, VRAM, cost), with
   the WAV left for Carlos to listen to. Nothing is called "good" until he does.
2. **Audio-to-MIDI transcription** (basic-pitch or equivalent, licence verified first),
   local on CPU, only on the user's own or CC audio (`docs/LEGAL.md` §4).
3. **MIDI-LLM as a material generator**: `proponer_midi(texto)` returns MIDI, converted to
   compact notation and run through the same verifiers as everything else (transactional
   ops, `escuchar_mezcla`). The general agent keeps directing. Side note for
   `docs/PLAN-MODELO-PROPIO.md`: a Qwen3 8B LoRA does not fit in 7.7 GB of RAM; a 1B that
   already speaks MIDI is a more honest start for the local tier.

## Parked (noted, not started)

4. **LoRA on Carlos's own stems** on Lambda, with ACE-Step and Stable Audio 3 (both ship
   training code). Measure VRAM, time, cost; the lineage record must name the LoRA.
5. **Phase 2, Magenta RealTime 2 Small** only after measuring whether 230M runs in real
   time on this CPU. WebGPU on Intel UHD is not a plan; without hardware it waits.
6. **Housekeeping**: add to `docs/LEGAL.md` §6 Magenta RT2 (CC-BY-4.0), MIDI-LLM (Llama
   3.2 Community), MuScriptor (NC, rejected), basic-pitch; read the Stability AI Community
   License text (the repo README says Community, the GitHub sidebar says MIT). Any new
   tool the agent must know about touches the prompt: house rule 1, ask Carlos.

## Measurements (2-Nov-2026, afternoon)

**ACE-Step 1.5 on Lambda `gpu_1x_a10`** (22.1 GB usable), `workspace/gpu/generar_audio.py`,
XL turbo DiT + 1.7B LM (vllm backend), 8 steps, project "Stahl" brief (125 BPM, E minor,
industrial), driven through `server/lambda.ts` exactly as the tool will:

| step | cold instance (run 1) | warm instance (run 2) |
|---|---|---|
| boot to `active` | 207 s | reused |
| upload + sync | 23 s | 26 s |
| install (uv + clone + `uv sync`) | 21 s | 0 |
| DiT load (incl. ~9 GB download) | 108 s | 4.2 s |
| LM load | 34 s | 28 s |
| generation | 13.1 s for 1 × 30 s | 23.2 s for 2 × 60 s |
| VRAM peak | 15.95 GB | 15.96 GB |
| end to end | 7.3 min | 1.8 min |

Run 6, a sung take with Spanish lyrics (`--letra` with [Verse]/[Chorus], `--idioma es`,
40 s): 11.5 s of generation on the warm instance, 8.3 s of it in the LM; file
`stahl-voz-es.wav`, RMS −17 dBFS. Heard: it sings the words (see below).

Output: 48 kHz stereo 16-bit WAV, peak −1.0 dBFS, RMS −14 to −19 dBFS, signal in every
10-second block (no silent takes). The LM echoed the metadata (bpm 125, E minor). Files in
`workspace/proyectos/spike-generacion/generado/` with their `.lineage.json`.

**Heard by Carlos (2-Nov, evening):** `stahl-xl-turbo-60s-1.wav` "sounds very industrial,
Rammstein-like, very good"; the 30 s take and `60s-2` are fine but below it. So one prompt
gives takes of uneven quality: the tool should default to 2 takes, not 1, and let the agent
or the user pick. `stahl-voz-es.wav`: the voice is clearly there and sings the lyrics, with
a **Latin American Spanish accent**. `vocal_language="es"` has no regional control; to try
next: ask for the accent in the caption ("Castilian Spanish accent, Spain") and compare. Cost of the whole
afternoon (6 runs, ~1 h of A10): about 1.3 $.

Lessons: an instance that is terminated loses the install and the weights (~2.5 min to
rebuild on the next cold start; a Lambda persistent filesystem would keep them: not done).
The server's `/api/run/lambda` only powers the GPU on for scripts that import torch, which
is why both scripts import it at the top.

**MIDI-LLM on the same A10**, `workspace/gpu/proponer_midi.py`, transformers backend:
install 31 s (uv venv 3.11 + torch cu128 + transformers + anticipation), 4 proposals in
37.5 s including the model load. Two false starts worth remembering: PyPI's default torch
wheel fails with "NVIDIA driver too old" on Lambda (CUDA 12.8 driver), so torch comes from
the cu128 index; and a half-built venv makes `uv venv` exit 2, so the venv is removed first.
The 4 proposals for the "Stahl" prompt: 11 to 41 s each, 682 note events each (the 2046-token
cap), bass (prog 33), distortion guitar (prog 30), drums and pad (prog 90) tracks, and 92 to
100 % of pitched notes inside E minor. The model writes absolute times at a nominal 120 BPM
(the AMT vocabulary has no tempo), so importing into a 125 BPM project triggers the usual
tempo warning. Nobody has heard them either.

**basic-pitch on the laptop** (`.miuzika/bp` venv, Python 3.12, ONNX runtime; installed
with `--no-deps` because 0.4.0 pins a numpy without a 3.12 wheel): 8 s per 2.5-minute stem
on the i5-1035G1. Scored against the MIDI miuzika rendered the stems from (note-level F1,
50 ms onset tolerance, `scratchpad/comparar_midi.py`):

| stem | ref notes | transcribed | exact | octave errors | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| bass | 493 | 541 | 438 | 1 | 0.81 | 0.89 | 0.85 |
| guitar riff L | 764 | 843 | 715 | 48 | 0.85 | 0.94 | 0.89 |
| synth (polyphonic) | 896 | 919 | 599 | 8 | 0.65 | 0.67 | 0.66 |

Every reference pitch appears in the transcription; the misses are extra notes and some
octave doubling on the guitar. The CLI needs `PYTHONUTF8=1` on Windows (unicode banner).

## What was built (2-Nov-2026)

- `generar_audio` tool: `src/core/generacion.ts` (pure: arguments from the project, RESULT
  parsing, tests), `web/src/agent/acciones.ts` `generarAudio` → `/api/run/lambda` with
  `gpu/generar_audio.py` → the WAVs enter as audio tracks via the same path as
  `anadir_pistas`. `.env` now has `MIUZIKA_LAMBDA=on` (Carlos's 2-Nov decision).
- `transcribir_audio` tool: `/api/transcribir` in `server/api/audio.ts` runs basic-pitch from
  `.miuzika/bp` (or `MIUZIKA_BASIC_PITCH`), writes `transcripciones/<nombre>.mid`, and the
  action imports it as a MIDI track unless `importar=false`.
- `proponer_midi` tool: `gpu/proponer_midi.py` on Lambda; the action does NOT import, it
  summarises each proposal (BPM, bars, tracks, % of pitched notes in the project key) and
  leaves the choice to the agent (`anadir_pistas`).
- None of the three is mentioned in the agent prompt (house rule 1): the model only sees
  the tool schemas. Ask Carlos before adding a line to the prompt.

## Exercised in the browser (2-Nov-2026, evening, Carlos driving, DeepSeek v4.1 flash)

Project "Stahl" (125 BPM, E minor, ten 2.5-minute audio stems). Read back from
`tmp/herramientas.log` and the four trajectories in `proyectos/stahl/trayectorias/`.

| tool | GPU | tool time | turn | cost | outcome |
|---|---|---|---|---|---|
| `transcribir_audio` on `salida/stahl_bajo.wav` | no | 11 s | 2.3 min | 0.016 $ | 541 notes in; the agent re-scaled 120→125 BPM itself and cleaned to 434 |
| `proponer_midi`, 2 proposals | cold A10: boot 267 s, run 100 s | 6.1 min | 7.4 min | 0.012 $ | 2 .mid + lineage; agent summarised and did not import |
| `generar_audio`, 30 s drone | warm: install 19 s, load 61 s, gen 6.6 s | 152 s | 3.5 min | 0.009 $ | WAV in as a track; Carlos: "the quality of the last track is very good" |

**Defects found (none in the GPU path):**

1. **A 30 s WAV enters as streaming through `anadir_pistas`.** `acciones.ts` uses
   `>= SEGUNDOS_STREAMING` while `audio-store.ts` decodes `<= 30`, and the action never
   consults the 400 MB budget. A 30 s take (the tool's default) is heard through the
   streaming `<audio>` element but is outside the mixer: `escuchar_mezcla` reports SILENT
   and the export would not have it. The agent "fixed" it twice by splitting WAVs into
   sub-30 s pieces with its own scripts.
2. **Transcription drift.** basic-pitch writes its MIDI at 120 BPM; the import places notes
   by beats, so in a 125 BPM project every onset lands 4 % early (agent's measurement: last
   onset 291.3 vs 303.5 beats). Fix: `--midi-tempo <project bpm>` (the CLI has it).
3. **The agent misread the proposals.** It did not trust the summary, wrote its own MIDI
   readers, called the channel-10 drum track (program 0 = GM standard kit, verified with
   mido) "a piano on channel 16", judged both proposals bad without hearing them, and when
   asked to make them audible rendered them to WAV with the numpy engine, drums as piano,
   instead of `anadir_pistas(midis=...)`. Carlos's "riff 1 is fine" was heard on that
   render. Summary should name tracks by GM program so there is less to re-derive, and the
   .mid should carry the project tempo so the 120-vs-125 warning disappears.
4. **Placement.** The agent put every new thing after the last material (bars 81, 90, 112,
   121), "so it can be judged alone", and the song grew from 80 to 136 bars. Tool behaviour
   is correct (it obeys `inicio_compas`); the staircase is the agent's judgement, prompt
   territory (house rule 1).
5. **`escribir_fichero` parameter name.** DeepSeek sent `content` instead of `contenido`
   six times; three in a row aborted the `generar_audio` turn after the WAV was already in.
   Accepting the alias costs nothing.

Also seen: the proposals' MIDI duplicates note-ons (380 raw events vs 151 after the
server's dedupe on riff 1), and `gtr_riff_l/r` were already muted before the session began.
The instance stayed on after the tests (no auto-stop; Carlos turns it off from the header).

## ACE-Step tasks in the architecture (3-Nov-2026, design, nothing built)

Carlos asked on 3-Nov whether ACE-Step can take a miuzika song (WAV and MIDI) and make it
sound professional, and then that every ACE-Step task should be planned into the
architecture. Only `text2music` has run here. The task list below comes from the ACE-Step
1.5 README, not from a run: the exact `task_type` strings, parameter names and which
checkpoint supports each task must be read in `~/generadores/ACE-Step-1.5` on the instance
before writing code.

| task | input from miuzika | output back | model | use |
|---|---|---|---|---|
| `text2music` (built) | caption, lyrics, bpm, key | 1-8 full takes | XL turbo | new material |
| `cover` | the mix (or a section) + caption + strength | one full mix | turbo? | hear the song "produced"; may change notes, melody and lyrics |
| `repaint` | the mix + a time range + caption | the mix with that range redone | turbo? | redo a weak bar range |
| `lego` | the mix as context + the instrument wanted | one new stem | base | replace a GM/VCSL track with a real-sounding one, keeping the composition |
| `complete` | one track (e.g. the melody) | accompaniment | base | arrange from a sketch |
| `extract` | a mix | one stem | base | stem separation (blocked "Vacío" transcription) |

What ACE-Step is not: mastering. The finish of a mix that is already right comes from EQ,
compression, a limiter and loudness (about −14 LUFS), done to our own WAV: an openDAW or
Python chain, or Matchering (GPLv3, match a reference track; run as a separate tool). That
is a stage on axis 4 of the review (listening and measuring), not an ACE-Step task.

How the tasks fit the five axes of `docs/REVISION-2026-11-03.md` §8, without a new path:

1. **One request type in `src/core/generacion.ts`.** `PeticionGeneracion` becomes a union
   keyed by `tarea`, and `argumentosGeneracion` validates each one (range inside the song,
   strength 0..1, base model where required) with tests, like today. Bars, not seconds, in
   the request: the core converts with the project's tempo (one `tiempo.ts`, review §4).
2. **Inputs are a new step: render to a file.** Today only the whole mix can be written
   (`exportar`), and `escuchar_mezcla` renders each track alone but only in memory. The
   tasks need "this track alone" and "these bars" as WAV files in
   `proyectos/<slug>/entradas/`, made by the axis-4 render module the review wants out of
   `main.ts`. MIDI tracks enter as audio rendered by openDAW: ACE-Step does not read MIDI.
3. **Lambda must upload the inputs explicitly.** `sincronizar` in `server/lambda.ts` skips
   `salida/` (where `exportar` writes) and any file over 50 MB, and uploads every other
   project file on every run. A 16-bit stereo 48 kHz WAV is 192 KB/s, so a 4:20 song
   already passes 50 MB. The run request gets `entradas: string[]`: those files are uploaded,
   whatever their size. Built 3-Nov (`planDeEntradas` in `server/lambda.ts`, `entradas` in
   `/api/run/lambda`, checked before the machine boots); the rest of the sync is unchanged,
   because GPU sound scripts live in the project folder. Not run on a real instance yet.
4. **One GPU script.** `gpu/generar_audio.py` gets `--tarea`, `--audio`, `--fuerza`,
   `--desde/--hasta` and `--pista`, plus `--modelo acestep-v15-xl-base`. Its bootstrap,
   re-exec, lineage and `RESULT` line are the skeleton the review wants shared with
   `proponer_midi.py`. The lineage records the SHA-256 of every input file: a cover or a lego
   stem is derived from our song, and the authorship layer must be able to say so.
5. **One door back.** Every output enters through `importarPistas`, which step 2 of the
   review makes the only WAV intake: `lego`, `complete` and `extract` as a new audio track at
   the input's first bar; `repaint` as a clip over its range on a new track; `cover` as a
   muted track at bar 1 to compare, never stacked after the last bar (check 15, item 5).
6. **One tool for the agent.** `generar_audio` gets `tarea` and `fuente` ("mix", a track
   name or a WAV path) and `desde_compas/hasta_compas`, instead of six new tools (31
   already). All of it goes through the GPU gate of 3-Nov (selector on GPU). Tool
   descriptions can change; a line in the prompt cannot without Carlos's yes (house rule 1).

To measure before building on it: VRAM with the base XL model plus the LM on the A10
(the turbo took 16 of 24 GB; `--lm none` may be needed for base); whether `cover` and
`lego` keep the project's tempo (the output must line up with the bars, measured like the
basic-pitch onsets on 2-Nov); how long a full-song `cover` takes warm. First listening test
proposed: "Vidrio" mix with two `cover` strengths, one `lego` drum stem, and the same mix
through a mastering chain, the four heard by Carlos.

Order: after steps 1-6 of the review §10, as its step 7 says. Steps 2 (one WAV intake) and
the axis-4 render module are prerequisites; the explicit Lambda inputs (point 3) are new.
