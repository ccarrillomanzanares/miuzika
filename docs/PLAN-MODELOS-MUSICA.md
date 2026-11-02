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
`stahl-voz-es.wav`, RMS −17 dBFS. Whether it sings the words, and in tune, is unknown
until Carlos listens.

Output: 48 kHz stereo 16-bit WAV, peak −1.0 dBFS, RMS −14 to −19 dBFS, signal in every
10-second block (no silent takes). The LM echoed the metadata (bpm 125, E minor). Files in
`workspace/proyectos/spike-generacion/generado/` with their `.lineage.json`. **Not heard by
anyone**: Carlos has to listen before any of this is called good. Cost of the whole
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

## What was built (2-Nov-2026, not yet exercised in a browser)

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
