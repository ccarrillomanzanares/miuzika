# Plan

One roadmap, in dated sections (newest first after "Now / next"). Merged on 4-Nov-2026 from
the old `PLAN.md` (phases 0-5, frozen 27-Oct), `docs/PLAN-MODELO-PROPIO.md`,
`docs/PLAN-MODELOS-MUSICA.md` and `docs/PLAN-PROVEEDORES-GPU.md`; the old files are one-line
stubs because code comments still cite them. Decisions are logged in `docs/DECISIONES.md`;
what is done and heard is in `ESTADO.md`. Architecture and live debt: `docs/ARCHITECTURE.md`.

Labels: "Phase N" no longer exists as a bare name. The 27-Oct plan uses **Stage 0-5**, the
authorship handoff's two phases are **Authorship phase A / B** (`fable.md`), the own-model
note uses **P1-P8**, and the music-models list keeps its numbered approvals (**M1-M6**).

## Now / next (4-Nov-2026)

1. **Review step 6, the rest** (`docs/REVISION-2026-11-03.md` §10): one state table in
   `ESTADO.md`; README reduced to pitch + install + links. (PLAN and DECISIONES: this file.)
   Still Carlos's call: §9 items 1-4, 6 (Strudel, Pad, Python synthesis engine, `autoria/`
   location, what to delete).
2. **Review step 7**: ACE-Step `extract` / `lego` (then the other tasks) as a source behind
   `importarPistas`, with `--tarea` and `--modelo acestep-v15-xl-base` in `generar_audio.py`.
   Design: section "2-Nov: music models", last subsection. Prerequisites: one WAV intake
   (done 3-Nov), the render-to-file module for inputs, explicit Lambda inputs (built, not
   run on a real instance).
3. **GPU providers** (section "4-Nov"): prompt text for `generar_audio` on GPU (done, prompt
   v5); still to do: rename `/api/run/lambda` to `/api/run/gpu` with the old path as an
   alias; Carlos to try a GPU turn and the Models GPU section in his browser.
4. **Own model and paid tier** (section "1-Nov"): P3 (the evaluator) is next; P4-P8 wait for
   trajectories to accumulate. Carlos, 2-Nov: try existing models before training our own.
5. **Left from the 27-Oct plan** (section "27-Oct", Stage table): 3.6 and 3.7, the rest of
   Stage 1 (`congelar`, prompt rules on mixing), Stage 2 (mixer UI: buses/sends are not
   drawn), Stage 4 (`analizar_mezcla`), Stage 5 (one engine job).
6. **Parked** (do not start without Carlos): ACE-Step on the Contabo VPS, LoRA on own
   stems, Magenta RealTime 2, Stable Audio 3, a Lambda persistent filesystem, the 2-take
   default of `generar_audio`.
7. Authorship layer (`autoria/`, `fable.md` §6 steps): Spike B done 2-Nov; integration
   into the export path and the watermark baseline are open; its folder and name are
   Carlos's call.

---

## 4-Nov-2026 — GPU providers and song generation (decided with Carlos)

Decided with Carlos on 4-Nov (written before building; steps 1-3 of "Order" were built the same day). Step 4 of the 3-Nov review is done; this sits
next to step 5 (core ownership) and before step 7 (ACE-Step tasks).

### Decisions

1. **GPU providers are a list of their own in "Models"**, separate from the LLM providers: they
   do something else (rent a machine by the hour, upload, run, bring files back, shut down), and
   there are more than Lambda. Lambda is the first and, for now, the only one used: Carlos has
   Lambda credits. The others are there so the interface is not cut to Lambda's shape.
2. **The person chooses, the code enforces.** With the chat selector on **GPU**, "hazme una
   canción" goes to ACE-Step (`generar_audio`). With it on **CPU**, the GPU tools are not in the
   tool list of the turn at all (today they are listed and answer "The GPU is not allowed"), so
   the model cannot pick them. Carlos, 4-Nov: "sí con el selector en gpu hazme una canción... sí ok".
3. **The Brief form is not part of this** (Carlos dropped that idea the same day).
4. **ACE-Step is one sound model among others to come.** It has several tasks (text2music, cover,
   repaint, lego, extract, complete; see section "2-Nov: music models", last subsection) and we are at the
   start of learning them. Other sound models will come later; not designed now, but nothing here
   should assume ACE-Step is the only one.

### What changes

- **Server**: `lambda.ts` becomes the first implementation of a `ProveedorGpu` interface
  (`server/gpu/`): `estado`, `encender`, `apagar`, `subir`, `ejecutar`, `traer`, plus price per hour
  and the provider's own words for its states. `/api/gpu/*` and `/api/run/lambda` (renamed
  `/api/run/gpu`, the old path kept as an alias) go through the provider chosen in "Models".
- **Config**: from `.env` (`MIUZIKA_LAMBDA=on`, `LAMBDA_*`) to `.miuzika/proveedores.json` under a
  `gpu` key (key, instance type, region, name, SSH key path), like the LLM keys. `.env` keeps
  working as a fallback so nothing breaks the day it lands.
- **Models panel**: a "GPU" section: provider, key, machine type, region, price per hour (from the
  provider when it gives it), and a "Test" that only lists instances (no start, no cost).
- **Tools per turn**: the tool list is built per turn from the selector (and later from which sound
  models are configured). GPU tools: `generar_audio`, `proponer_midi`, `crear_voz destino=gpu`,
  `ejecutar_python destino=lambda`, `crear_sonido` with a GPU voice.
- **Prompt**: one section, exact text shown to Carlos before touching `agente-prompt.ts` (house
  rule 1): with GPU tools present a song is made with `generar_audio`; proposals and transcriptions
  are heard with `anadir_pistas`; material to compare goes from bar 1 muted or solo.

### Other providers, for the interface only (looked up 4-Nov, not used)

| provider | 24 GB class, per hour | how a machine is driven | what it teaches the interface |
|---|---|---|---|
| **Vast.ai** | RTX 4090 from ~$0.13, median ~$0.53 (73 offers, aggregators, Jul–Oct 2026) | REST `console.vast.ai/api/v0`: rent an **offer id** (marketplace) → instance id; status gives `ssh_host`/`ssh_port`; stop (disk still billed) vs destroy (DELETE). SSH key must be on the account before creating. | a machine is **chosen from offers**, not by a fixed type; SSH port is not 22; stop ≠ destroy |
| **RunPod** | RTX 4090 ~$0.34 community / ~$0.74 secure | `runpodctl` / API: create a pod from a template + GPU id; SSH on by default; stop keeps storage (billed); a pod with a network volume can only be terminated | **templates/images** instead of installing on boot; stopped storage costs money |

Prices are from aggregator pages and disagree; they are only to size the interface, not to choose.
Sources: computeprices.com/gpu, amcompute.com/gpu-cloud-prices/rtx-4090, gpus.io/en/gpus/rtx4090,
docs.vast.ai/api-reference/hello-world, docs.runpod.io/pods/manage-pods,
docs.runpod.io/runpodctl/reference/runpodctl-pod.

So `ProveedorGpu` needs: a way to pick the machine (fixed type for Lambda, offer search for Vast),
SSH host **and port**, an explicit **stop vs destroy** with what each still bills, and an optional
image/template so cold starts do not reinstall (Lambda persistent filesystem: later, as an option for
users who pay for storage; Carlos accepts the reinstall, 4-Nov).

### Order

1. Done 4-Nov (`e1a6869`): `ProveedorGpu` interface with Lambda behind it, no behaviour change.
2. Done 4-Nov (`dc57e63`, `6f42e6b`): settings in `.miuzika/proveedores.json` under `gpu`, read on
   every request, `.env` as the fallback field by field; the Models "GPU" section (headless run).
3. Done 4-Nov: tools per call from the selector; on CPU the GPU tools are not offered.
4. The prompt section, after Carlos says yes to the exact text (proposed 4-Nov, see ESTADO).

Still to do: rename `/api/run/lambda` to `/api/run/gpu` (keeping the alias); the log tool names
(`lambda_encender`, `ejecutar_python_lambda`…) say Lambda and stay until a second provider exists.
Not checked yet with Carlos: a GPU turn with a model after these changes, the Models GPU section
in his browser.

---

## 2-Nov-2026 — Music models (updated 3-Nov and 4-Nov)


Follows `fable.md` (brainstorm handoff, 2-Nov) §3.1 and §4.5, and `autoria/CONCEPT.md`
(authorship layer, Spike B done). This note records what Carlos approved on 2-Nov, in
which order, and what was parked, so later sessions do not re-argue it.

### What changed when the handoff was checked against the laptop (2-Nov)

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
  230M, MIDI input per frame, ~200 ms. real-time-phase candidate; nothing promised for CPU or
  browser.
- **Transcription** closes a gap `medir_referencia` admits ("does NOT extract the melody
  or the chords"). MuScriptor (Kyutai, 2026) is CC-BY-NC: not for the product. basic-pitch
  (Spotify) is Apache-2.0 from memory, to verify before use.

### Approved (2-Nov), in this order

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
   PLAN.md section "1-Nov": a Qwen3 8B LoRA does not fit in 7.7 GB of RAM; a 1B that
   already speaks MIDI is a more honest start for the local tier.

### Parked (noted, not started)

- **ACE-Step on the Contabo VPS, CPU only** (Carlos, 4-Nov: "me interesa pero no ahora"). The VPS is
  a Contabo VM, 16 shared vCPU, 64 GB RAM, Ubuntu, no GPU; it also serves ccmai.org. 64 GB holds the
  model (16 GB of VRAM on the A10); the guess, not measured, is 30-60x slower than the A10 (the
  2 x 120 s takes that took 44 s could take 20-45 min) and the LM's vllm backend needs a GPU, so it
  would need ACE-Step's other LM backend or no LM. Shared vCPUs at 100 % for that long may be
  throttled by Contabo and slow the site. Use: free, unhurried generation (overnight queue). Test
  when picked up, with Carlos's explicit yes (it installs ~10-15 GB on his server and loads its
  CPU): one 30 s take, measuring time, RAM and CPU. Lambda stays the place for ACE-Step meanwhile;
  the VPS suits CPU work (Stable Audio Small, basic-pitch, measuring, Python renders).

4. **LoRA on Carlos's own stems** on Lambda, with ACE-Step and Stable Audio 3 (both ship
   training code). Measure VRAM, time, cost; the lineage record must name the LoRA.
5. **Real-time phase (`fable.md` "Phase 2"), Magenta RealTime 2 Small** only after measuring whether 230M runs in real
   time on this CPU. WebGPU on Intel UHD is not a plan; without hardware it waits.
6. **Housekeeping**: add to `docs/LEGAL.md` §6 Magenta RT2 (CC-BY-4.0), MIDI-LLM (Llama
   3.2 Community), MuScriptor (NC, rejected), basic-pitch; read the Stability AI Community
   License text (the repo README says Community, the GitHub sidebar says MIT). Any new
   tool the agent must know about touches the prompt: house rule 1, ask Carlos.

### Measurements (2-Nov-2026, afternoon)

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

rebuild on the next cold start). A Lambda persistent filesystem: Carlos accepts the reinstall (no
storage credits, 4-Nov); later, an option for users who want to pay for storage.
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

### What was built (2-Nov-2026)

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

### Exercised in the browser (2-Nov-2026, evening, Carlos driving, DeepSeek v4.1 flash)

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

### ACE-Step tasks in the architecture (3-Nov-2026, design, nothing built)

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

---

## 1-Nov-2026 — A model of our own, and two tiers


Carlos wants both: a **local** model that does everything the agent does, with lower
quality but at almost no cost, and an **advanced** paid tier that resells capacity of
an external provider with higher quality. This note records what was decided and why,
so the next sessions do not re-argue it.

### What the numbers say (tmp/llm.log, 28-Oct "Hard" session, DeepSeek V4.1 Flash)

| | |
|---|---|
| Calls per composing turn | 23 to 46 |
| Input tokens per turn | 1.0 to 1.7 M (99% cache reads; ~48 k context per call) |
| Output tokens per turn | 12 k to 97 k |
| Cost per turn at 1-Nov prices | ~0.04 $ (DeepSeek V4.1 Flash) · ~1.2 $ (Claude Sonnet 4.5) |

The cached-input price decides the advanced tier's economics, not the list price. A
turn is **more than a million input tokens**: without a per-turn cap and per-user
metering, reselling is not viable.

### Where the data is (and is not)

- `tmp/llm.log` keeps only the first 200 characters of each message and the sizes
  (unless `MIUZIKA_LOG_COMPLETO=1`). It is **not** a training corpus.
- `proyectos/*/agente.json` keeps 32 turns in total, user/assistant text only, no tool
  calls or results.
- So, as of 1-Nov, **there is no training data**. Capturing it comes first.

### Order of work

Shared by both tiers (first):

1. **Cost per call and per turn, with prices that update themselves.** Done on 1-Nov:
   `src/core/precios.ts`, `server/precios.ts`, `/api/precios`, the chat-header counter,
   `coste_usd` in every `llm.log` line. Source: OpenRouter's public model list.
2. **Full trajectory capture** in a file apart from `llm.log`: messages, tool calls,
   tool results, and the verdict of `escuchar_mezcla` (valid project, muted tracks).
   This is the dataset for the local tier and the audit trail for the paid one.
   Done on 1-Nov: `proyectos/<slug>/trayectorias/`, one file per turn
   (`src/core/trayectoria.ts`, `/api/trayectorias`). From now on every session with
   the agent adds to the dataset; the 28-Oct sessions are lost (only summaries).
3. **The evaluator**: share of briefs that end in a valid project with no muted tracks,
   run with the same verifiers for the local model, DeepSeek and Claude. It puts a
   quality number next to each price.

Local tier (free):

4. **Synthetic, verified dataset.** Hundreds of varied briefs (style, tempo, key,
   instruments) solved by a strong model inside the agent itself, kept only if the
   parser, the transactional ops and `escuchar_mezcla` accept the result (rejection
   sampling: miuzika has verifiers, so no hand labelling). Target: 1,000 to 3,000
   trajectories.
5. **LoRA on Qwen3 8B or 14B**, a few hours on a fine-tuning service or on Lambda,
   exported to GGUF and served with local Ollama (the "Ollama local" provider already
   exists; nothing changes in the interface). Goal: learn the tool protocol and the
   compact notation well enough to **drop most of the 21 k-character prompt and the
   tool schemas**, so the context per call falls to a fraction and an 8B runs at a
   usable speed on a laptop. Not expected: composing better than a frontier model.

Advanced tier (paid):

6. **Infrastructure, not model**: accounts, token metering per user, the provider key
   on the server (today keys live in the user's `.miuzika/proveedores.json`), a cost cap
   per turn, and a margin on top.
7. **Route the paid tier through OpenRouter** with one key of ours: price, real cost per
   request and the invoice come from the same place, no reconciliation. Contract
   providers directly later if volume justifies it; the interface does not change.
8. **Terms of service**: the big providers allow building a product on top and charging
   for it, not reselling raw API access. Read each provider's terms before choosing; do
   not take this from memory.

---

## 27-Oct-2026 — Original phased plan (historical, frozen)

Written 27-Oct and never updated afterwards; the status column below was filled in on
4-Nov from `ESTADO.md` and `docs/REVISION-2026-11-03.md` §10. Its "Phase N" are renamed
**Stage N** so they do not clash with the authorship phases A/B. The order is not the list
order: sound creation came first because it depends on nothing and unblocks the rest.

On 27-Oct the decision that blocked the rest ("score as data, yes or no") was made: **yes,
and it already existed**: `proyecto.json` with its ops, used by the agent through
`editar_proyecto` and `escribir_progresion` (`docs/REVISION-2026-10-27.md`).

### What was actually done (as of 4-Nov)

| stage | original idea | state on 4-Nov |
|---|---|---|
| 0 Foundation | per-project agent context, outputs by reference, bounded logs, clips in bars | DONE |
| 3 Sound creation | recipe + WAV, 16-word vocabulary, gate, `crear_sonido` / `crear_voz` | steps 3.1-3.5 DONE; 3.6 and 3.7 have no record of being done |
| 1 Teach the agent to mix | real units, sends, `medir_mezcla`, `congelar`, prompt rules | DONE 28-Oct: effects in real units (with migration of old projects), buses and sends (`add_bus`, `set_bus`, `set_send`; AudioBusBox + AuxSendBox), `escuchar_mezcla` in place of `medir_mezcla` (renders the mix and each track, RMS by section). NOT done: openDAW `AudioUnitFreeze` (the `congelar` in the architecture notes is a Python GPU function), the unit-catalog and mixing-rules prompt section. Not heard (REVISION §6). |
| 2 Minimal mix UI | inserts list, meters, bounce/freeze, sends panel | NOT started; the interface does not draw buses or sends |
| 4 Analysis and suggestions | `analizar_mezcla`, `AutoEq` | PARTLY: `verificar_audio` (peak, RMS, LUFS, crest, DC, clipping) and `escuchar_mezcla` exist; no `analizar_mezcla` table or suggested curve |
| 5 A single engine job | generic `trabajo`, replaces `/api/run/python` and `/api/run/lambda` | NOT done as designed; instead `server/proceso.ts` (one spawn helper, 3-Nov) and the `ProveedorGpu` interface (4-Nov) |

### Original text

#### Stage 0 — Foundation — DONE (27-Oct)

Agent context per project (`proyectos/<slug>/agente.json`: 8 turns + summary), long
outputs by reference in `_salidas/`, bounded logs with rotation, clips measured in bars
(`anadir_pistas(compases=N)`, `igualar_clips`), and the agent asks before delivering
(MIDI vs WAV, stems 12 dB down).

#### Stage 3 — Sound creation — ALMOST

**Idea**: a sound is a **JSON recipe + WAV**, not a new synthesizer. The Python engine
already has the timbres; openDAW already has a sampler. And there is no knob panel: you
ask with words and with the play button.

| step | status |
|---|---|
| 3.1 catalog **read from the engine** (`codigo/voces.py` + `/api/voces`), with family, range, unit and measured profile | DONE |
| 3.2 parameter panel discarded: the language is chat + words | DECIDED |
| 3.3 gate for new voices (`codigo/gate_voz.py` + `/api/voces/nueva`): they are baked in `instruments.py` | DONE |
| 3.4 16-word vocabulary with axes and universal post-processing (`src/core/palabras.ts`) | DONE |
| 3.5 agent tools: `listar_voces`, `crear_sonido`, `crear_voz` | DONE |
| 3.6 listening in context: the agent places the sound on the track and it is heard inside the song | PENDING |
| 3.7 project sound list with play button (minimum interface) | PENDING |

**Acceptance criteria (met except 3.6-3.7)**
- Same recipe and same seed give the same WAV (same hash). OK
- The gate rejects what is not a sound and says why. OK (square wave:
  "crest 0.0 dB outside 2.0-30.0"; duplicate: 409; no seed: "not reproducible").
- The file is saved in `proyectos/<slug>/sonidos/<name>.wav` + `.json`. OK
- Words change the sound measurably (tail -30 dB, centroid +1.393 Hz, crest from 11.1
  to 18.1). OK
- `tsc` 0, `test:unit` 103/103, `npm test` with OPENDAW OK, browser test. OK

**Out of scope**: own synthesizer, graphical waveform editing, DDSP.

#### Stage 1 — Teach the agent to mix (after Stage 3)

- `set_device` with **real units** (Hz, dB, ratio, ms, %) instead of 0..1.
- `sends` in the model -> openDAW `AuxSendBox`.
- Tools `medir_mezcla` (bounce with `OfflineEngineRenderer` -> `verificar_audio`) and
  `congelar` (`AudioUnitFreeze`).
- Prompt: unit catalog, sensible ranges, insert order and rules (do not compress
  already compressed stems, -6 dB headroom in the sum, do not limit stems).
- **Verify**: bounce with crest 12-14 dB and peaks <= -1 dBFS, and the values reported
  in chat match `proyecto.json`.

Reuse: `EffectFactories`, `EffectParameterDefaults`, `Mixer`, `OfflineEngineRenderer`,
`AudioUnitFreeze`, `/api/verificar`.

#### Stage 2 — Minimal mix UI

- **Insert list per track** (add/remove/enable, sliders with real units).
- **Meter** (`MeterWorklet`) on track and master.
- "Bounce" (to `salida/mezcla.wav`) and "Freeze" buttons.
- **Sends** panel (A/B to a reverb/delay bus).
- **Verify**: UI fader and chat produce the same `proyecto.json`; meter and bounce
  match within ±0.3 dB; 21 tracks without underruns.

**Out of scope**: automation, curves, snapshots.

#### Stage 4 — Analysis and suggestions

- `analizar_mezcla`: peak, RMS, LUFS, crest, DC and correlation per stem and in the sum
  (already in `dsp.py`), plus `AutoEq` for the suggested curve.
- Table in chat + suggestions applicable only if the user says yes.
- Permanent warning about duplicated material (MIDI + WAV of the same instrument).
- **Verify**: on "Stahl" it flags the `sint` at -31.7 dBFS and proposes the correction
  without touching anything.

**Out of scope**: automatic mastering.

#### Stage 5 — A single engine job

- Generic `trabajo`: `{id, tipo: render|bounce|analisis|sonido, destino: cpu|gpu,
  script, estado, progreso, salida, coste, cancelar}`.
- Replaces `/api/run/python` and `/api/run/lambda`; the numpy 409 and the cost counter
  become job properties.
- GPU only if the job asks for it (`motor_gpu`), with real cost warning and shutdown at
  the end.
- **Verify**: two jobs at once do not step on each other; cancel leaves the instance
  shutting down; displayed cost matches the invoice.

#### Usual gates

In every phase: `npx tsc --noEmit` = 0, `npm run test:unit` green, `npm test`
(openDAW), `npm run build:web`, and a real browser test on `localhost:5173`.
