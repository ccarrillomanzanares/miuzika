# STATUS — 5-Nov-2026

The ONE place for current status: what exists, how well it is verified, what is missing.
History (what was done, session narratives, the numbered browser checks 1-18) is in
`docs/DIARIO.md`; this file only holds the present. Working rules are in `CLAUDE.md`;
architecture in `docs/ARCHITECTURE.md`; the 3-Nov architecture review with its execution
order in `docs/REVISION-2026-11-03.md`.

Repository: `github.com/ccarrillomanzanares/miuzika`, branch `master` (the previous
history, humseed, is on the `humseed` branch). On the laptop, the folder follows
`origin/master`; `master-antiguo` and `revision-arquitectura` are old branches.

## 1. State table

States: **HEARD** (Carlos listened and said so) · **MEASURED** (run or measured, numbers or
files exist, nobody listened) · **BUILT** (code and tests, not exercised end to end) ·
**PLANNED** · **BROKEN** · **PARKED**. A state is only raised with evidence (house rule 4);
HEARD needs a sentence from Carlos. Where sources disagreed, the newest dated evidence
wins and the cell says so. Rule: change the row in the same commit that changes the thing.

| capability | state | last evidence | date |
|---|---|---|---|
| openDAW playback, timeline, piano roll | HEARD (core path) | in-app sessions with Carlos | 28-Oct, 2-Nov |
| GM SoundFonts, drum kits | HEARD, but GM drums were transposed | Carlos heard the "bomb, metallic" snare; `afinarZonas` fix measured with the real engine (kit 0/16 snare 0.71 s, 207 Hz; was 2.35 s, 60 Hz), not yet heard. fineTune and preset-level tuning still ignored | 4-Nov |
| Drumkit tracks without a program play GM kit 0 | HEARD | Carlos, browser test (`51897d0`) | 4-Nov |
| GM loop fix (SF2 global zones) | MEASURED | 113 of 128 presets had lost the loop; not heard | 28-Oct |
| VCSL instruments (142) via `sfz2sf2.py` | HEARD (sound) / level MEASURED | Steinway (84 zones) and harp sound for Carlos. Level was 14-15 dB under GM (cause found: recording level, openDAW ignores `initialAttenuation`); after the converter fix harp -18.0 LUFS, organ -10.8, GM piano -13.4; Carlos hears the piano above both. Only new conversions get the fix. Supersedes "cause unknown" in the review | 4-Nov |
| Effects in real units, old-project migration | MEASURED | tests pin the migration; not heard | 28-Oct |
| Buses and sends | HEARD (tail) | send tail audible (bar 5 at -66 dBFS with a -3 dB send, silent at -60). `.odw` loads. The UI does not draw buses | 4-Nov |
| Mute / solo, live notes by track id | mute HEARD; solo and pad MEASURED only | mute silences everything (Carlos); units found by track id, contract-checked; solo, pad and two same-name tracks not exercised with sound | 4-Nov |
| Agent composing in the project (notes, drums, progressions, ops, versions) | MEASURED | "herminia" run: 84 MIDI bars, 128 calls, 0.14 $. No sentence records the music judged by ear. Prompt v5 in force (`622c6698`) | 4-Nov |
| New-song Brief on GPU forces ACE-Step (header box) | MEASURED, insufficient | 4-Nov night: the box did force `generar_audio` and the take came, but once the tool returned the list widened to 31 tools and the model deleted take 2 from the project, muted take 1 and composed the song in MIDI for 25 min (mix loop, cancelled by Carlos). The turn has to end, or stay read-only, once the forced tool has delivered | 4-Nov |
| `generar_audio` (ACE-Step 1.5 XL turbo on Lambda) | HEARD | 5-Nov: `still-here-1` heard by Carlos (the material of tests 1-10). Earlier:  "very industrial, very good" (2-Nov). 3-Nov: cold boot 264 s, warm run 119 s for 2 takes. 4-Nov night, "still-here" (Carlos's brief "parecida a Ghosts Again", English lyrics): boot 231 s, install 19 s, DiT 39 s + LM 33 s, two 210 s takes in 73 s, VRAM peak 16.1 GB; the LM kept 118 BPM / A minor / 210 s. Not heard: Carlos stopped for the night. The caption does not steer the Spanish accent | 4-Nov |
| `transcribir_audio` (basic-pitch, local) | HEARD (first version); tempo fix MEASURED | 125 BPM, last onset at beat 303.5 | 2-Nov |
| `proponer_midi` (MIDI-LLM 1B on Lambda) | MEASURED | 92-100 % of notes in key; both proposals at 125 BPM with the kit on channel 10; tracks named by GM program. Not heard as intended | 2-Nov |
| GPU providers list in Models, GPU tools only offered on GPU | BUILT | `PLAN.md`, 4-Nov, steps 1-3; Carlos has not tried it | 4-Nov |
| Lambda "⏻ Off" button | MEASURED | 5-Nov: pressed 22:14, Lambda confirmed in 81 s (`apagada: true`); 3-Nov: 87 s | 5-Nov |
| Cancel stops a Lambda run | MEASURED, one phase missing | 5-Nov, three tries: one press cancels during the source render and during the upload (request "closed" at 68 s, `cancelado: true`, no track). Cancel while `generar_audio.py` itself runs on the GPU was never reached: the progress line names the script 70-90 s before it runs, and the tab is frozen during the offline render (5-6 presses needed once) | 5-Nov |
| `exportar` MIDI | MEASURED | works | 2-Nov |
| `exportar` WAV | MEASURED (works; not heard) | Carlos 3-Nov: "la exportación wav funcionó ayer". Supersedes landing "working" (31-Oct, while it failed), ESTADO "fails every time" (2-Nov, before the fix) and OPENDAW "not implemented" | 3-Nov |
| `exportar` MP3 (320 kbps CBR, ID3 title) | HEARD | Carlos 4-Nov, tail intact; headless end to end 3-Nov | 4-Nov |
| `escuchar_mezcla` | MEASURED, not heard | silent MIX row now a problem (3-Nov); a bus has no row (explained). Table never compared with the ear | 3-Nov |
| Silent MIX after compressor + EQ on an audio track; unstable `escuchar_mezcla` levels | BROKEN (seen twice) | 3-Nov in the app; 13 headless renders always sound. 4-Nov night, "still-here": the agent wrote that the Arp row moved 10 dB between passes with the same gains, and then blamed mute/solo states; the trajectory of that turn holds the numbers, not yet read | 4-Nov |
| `verificar_audio` | MEASURED | DC < 50 mL treated as a note, 16-bit clipping seen; run headless | 4-Nov |
| One WAV intake (`cargarWavDeDisco`) | MEASURED | a 30 s take enters decoded (-11 dBFS muted-alone); the Audio button and `anadir_pistas` paths not run in a browser | 3-Nov |
| Play waits for sample load | BUILT | not confirmed in a browser | 28-Oct |
| 400 MB decode budget, long stems | BUILT | not confirmed with a real long-stem project | 28-Oct |
| "Models" Test button | BUILT | proxy tested against a simulated server only | 28-Oct |
| Cost counter, rate line, cost cap per turn | MEASURED (log) / BUILT (UI) | `llm.log` carries `coste_usd`; turn cost 0.022 $ read from logs; header, rate line and cap not seen in a browser | 3-Nov |
| Trajectories (`trayectorias/`) | MEASURED | one file per turn, read back (old check 11 closed) | 3-Nov |
| Agent without a project, F5 | BUILT | not confirmed | 28-Oct |
| Pad (touchpad instrument) | BUILT | never exercised in this repo (brought from humseed) | 27-Oct |
| Strudel pattern to WAV | BUILT | TEST_PLAN boxes unticked since 21-Oct; no run recorded | 21-Oct |
| Python synthesis engine (`dsp/instruments/render/midi`) | MEASURED, fallback | smoke OK; still injected into every prompt; fallback since 27-Oct | 3-Nov |
| Python box (`caja.py`) for agent and server scripts | MEASURED | `ejecutar_python`, `/api/picos`, `/api/verificar`, `/api/manifiesto` boxed; guardrail, not a cage | 3-Nov |
| torch engine `motor_gpu.py` | MEASURED | re-implements the numpy timbres; off unless `MIUZIKA_LAMBDA=on` | 2-Nov |
| Authorship layer (Spike B: C2PA + OTS + lineage) | MEASURED, integration PLANNED | `autoria/spike-b`; home to be decided | 2-Nov |
| audiowmark baseline | MEASURED, not heard | SNR 31.1 dB | 2-Nov |
| Build gates: `tsc`, unit tests, openDAW contract, smoke | MEASURED | typecheck and 332 unit tests green on 5-Nov; contract and smoke last run 3-Nov | 5-Nov |
| Agent on Claude Sonnet 5.5 through the Anthropic provider | MEASURED | 5-Nov: `adaptarCuerpo` drops `temperature`/`top_p` for anthropic (400 on Claude 4.7+) and keeps `stream_options` so usage is logged; 16 calls, 1.05 $, 0.05-0.09 $ per call (25-31K input tokens, no caching on the OpenAI-compatible endpoint). DeepSeek path unchanged (test). Prompt unchanged during the trial | 5-Nov |
| CLAP scoring pilot | PARKED | `tools/piloto-gpu`, nothing links to it | 23-Oct |
| LoRA on own stems, Magenta RT2, Stable Audio 3, 2-take default, Lambda persistent FS | PARKED | `PLAN.md`, 2-Nov, Parked; persistent FS: Carlos accepts the ~2.5 min reinstall | 4-Nov |
| ACE-Step source tasks: `cover`, `repaint`, `extract`, `lego`, `complete` (review step 7) | HEARD per task, see `docs/PRUEBAS-ACESTEP-2026-11-04.md` | 5-Nov, A10, 14 h, ~18 $: **PASS by ear** complete (voz -> band), extract vocals, cover turbo 0.6 with lyrics, cover sft 0.6 ("muy industrial, me encanta, mejor que cover-piano2"); **FAIL/partial** extract drums, lego (one run over a silent source does not count); repaint range control measured. xl-base 11-13 GB VRAM, 50 steps 20-72 s for 32 bars vs 4.7 s turbo; covers aligned (lag 0 ms). Defects found: "mix" source honours mute and leaves out streaming WAVs (silent source sent, 190 s wasted); lego/repaint clip not trimmed to its range; ssh control command hung 3 of 16 runs (cause unknown, 75 stdin tests clean) | 5-Nov |
| Mixer UI (buses, sends, meters), automation, `.odw` import | PLANNED | `docs/ARCHITECTURE.md` section 11 | 28-Oct |

## 2. Pending browser checks (Carlos)

Closed so far: Steinway/VCSL sound, bus tail, mute, MP3, drumkit default (4-Nov), WAV export
(3-Nov), generated takes and the three tools (2-Nov), trajectory files (3-Nov). Detail and
the numbering of the old list: `docs/DIARIO.md`, "Browser checks 1-18". Still to do:
- **Drums and levels, by ear**: the `afinarZonas` snare/toms (4-Nov) and the new VCSL levels.
- **`escuchar_mezcla`** on a real project: the table matches what is heard.
- **The bar-1 material** sounds with the Play load wait; **a project with long stems**
  opens and memory holds.
- **Models**: Test with real Ollama Cloud; the rate line under the model field; a cap of
  e.g. 0.01 $ stops a composing turn and the header counter agrees with the notice.
- **Cost counter** in the chat header after the first call (tooltip, price date, turn cost).
- **The pad** on the laptop; mute/solo and pad on two tracks with the same name.
- **No project + F5**: the agent conversation is still there.
- **GPU providers and prompt v5**: a new-song Brief on GPU ticks "ACE-Step" and gives a take.
- **Imports**: Audio button and `anadir_pistas` with WAVs; a GPU tool with the selector on CPU
  answers "The GPU is not allowed"; Cancel during `generar_audio` logs `cancelado: true`.
- The 3-Nov bug: audio track + compressor + eq, full render vs solo render.
- **ACE-Step tasks: done 5-Nov** (tests 1-10 in `docs/PRUEBAS-ACESTEP-2026-11-04.md`, verdicts in the table above). Still to exercise: Cancel while the DiT runs on the GPU; lego over a sounding mix; a cover of "Vidrio" (not done, still-here was the material).
- **`inicio_compas` from 1** (4-Nov): a take brought in with `anadir_pistas` or `generar_audio`
  "from bar 1" lands at the start, not one bar late.

## 3. Pending work

Order of work: `docs/REVISION-2026-11-03.md` §10. Steps 1-6 are done (bugs 1-10, server
plumbing, core ownership, docs checked against the code); step 7 built 4-Nov night, not run.
1. **Step 7, after the 5-Nov run** (order agreed with Carlos, all touch `web/` or `server/`): (a) the "mix"
   source for the model ignores mute/solo (`sin_pista` excludes); (b) server-side mixdown of the streaming
   WAVs (position, gain, trim) into the model source, the WAV export and `escuchar_mezcla`; (c) status says
   "syncing" until the "running" aviso, Cancel responsive during the offline render; (d) control ssh capped
   at 20 s with one retry (sync mkdir, upload mkdir, fetch find); (e) lego/repaint clip trimmed to its range;
   (f) drop the "Not in the source" list for a single-track source; (g) refuse a silent source (peak under
   -60 dBFS) with the reason; (h) prompt lesson written up for Carlos (ask for missing GPU-costing arguments
   instead of guessing). Cover alignment measured (lag 0 ms); `cover-nofsq` still undocumented upstream.
2. Docs consolidated 4-Nov evening (§9.5): this table, one `PLAN.md` with dated sections (the
   three `docs/PLAN-*.md` are now stubs because code comments cite them), `docs/DECISIONES.md`
   (9 conflicts listed there, unresolved, for Carlos), `docs/DIARIO.md` for the dated log.
3. Done 4-Nov evening (`04aedde`): `inicio_compas` counts from 1 like `desde_compas` and the
   prompt. Not yet seen with a real model: see the check in section 2.
4. Draw buses and sends in the interface (mixer).
5. Steinway with 3 velocity layers (now 2 because of the 40 MB cap; samples cut to ~4 s would
   make room). Carlos, 4-Nov: not now.
6. Review bugs 11 and 12 (direct mutations outside ops; hand-built empty `Project`).
7. If the Python box falls short: another Windows user or a container. GPU (Lambda)
   scripts do not go through the box.
8. **End the turn when the forced tool has delivered** (4-Nov night): with the "ACE-Step" box, after `generar_audio` succeeds the turn should stop (or keep only read tools). Code in `herramientasForzadas` / the loop, not the prompt. Carlos to confirm.
9. **For Carlos to decide**: the agent says "lo que oigo" when it only reads the engine's
   numbers (seen 4-Nov); that wording is in the prompt, which only changes with his yes.

## 4. How to start

1. `npm run typecheck` and `npm run test:unit` (`npm test` adds the openDAW contract).
2. `python workspace/herramientas/smoke.py`.
3. `npm run dev` from Carlos's own terminal (from the Claude Code shell it could not spawn
   Python on 2-Nov) and go through the list in section 2 with Carlos.
4. Anything that changes a row of the table updates the table in the same commit.
