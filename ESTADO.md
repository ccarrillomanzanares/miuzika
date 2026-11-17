# STATUS — 15-Nov-2026

## START HERE

Requested 7-Nov: **do not go again through where we have already been.** Before proposing a test or a feature, read
"What ACE-Step can and cannot do" below: it holds every verdict by ear so far. When a new verdict or conclusion arrives, write it there
in the same session, not at the end.

Verdicts are written as reported, in English: "heard: PASS/FAIL" and what was heard. They are the user's ear, not literal quotes.

**Nothing is pending (12-Nov).** The lists of proposals, ideas, undecided points and tests left were removed from this file and
from BUGS.md on request, and everything marked "not heard" or "not tried" below is taken as good. Do not rebuild those lists from
the older text below or from git history, and do not raise their items again unless asked. What stays below is what was built,
measured and heard: the verdicts.

## Known limitations (facts of the code, not tasks)

- **A long WAV that does not fit the decode budget plays outside openDAW** (400 MB of decoded audio): it sounds and exports with
  its gain, pan and the master, but without its track's effects and sends. The Log says so for each such track. WAVs on tracks
  with effects or sends take the budget first.
- **A project cannot be longer than 512 bars**: a file longer than that at the project's tempo (17 minutes at 120 BPM) is refused
  on import with "lengthBars: Integer between 1 and 512".

**15-Nov: the Note box (requested: a way to leave an impression at the moment, for any feature, that reaches the next
session and never reaches git).** "Note" in the status bar or F2 from anywhere: a line of text and, optionally, PASS / So-so /
FAIL; Enter saves, Esc closes and keeps the text. Saved with what the app was showing when the box opened: project, bar,
playing or not, the selected tracks, every open window with its heading and named fields, and the whole chain with its values
when the effects panel is open. One JSON line per note in `.miuzika/notas.log` (ignored by git; a unit test fails if it stops
being ignored), a Log line in the app, and `npm run notas` for a session to read the new ones (CLAUDE.md orders it at the start).
- Over a modal window the box opens as a modal too (everything outside a modal is inert); otherwise it is not modal and does
  not stop or cover the transport.
- Measured headless with the notes pointed at a temp file: saved with no project; saved with the effects panel open (context
  held the reverb's four values); Esc closed only the box and kept the text; over Settings it was typed in and saved, Settings
  stayed open and a value typed in a key field did not reach the file; an empty note was not sent; no page errors. 246 unit
  tests green. **Not tried by the user yet.**
- Limits: the file lives on this machine only and has no copy; a slider still held when the box opens is recorded at its
  last released value.

**15-Nov: lego and complete read again (requested: look once more at the function that generates a track from the others,
in case something was missed). Nothing run.** Read: upstream's README, INFERENCE.md, API.md, GRADIO_GUIDE.md, Tutorial.md
(its last 8k characters only as a summary), `constants.py` on `main`, and issues/PRs #1375, #1286, #1287, #1255; against
our script and the verdicts below.
- **What we do as upstream says:** base models only, the instruction with the track name, the 12 track names, no LM for
  lego and complete (upstream made that its own default in PR #1287; its docs still say otherwise), duration locked to the
  source.
- **Three settings never tried in lego/complete.** `shift`: we send 1.0 on base models; upstream's Gradio and API default
  to 3.0 and its Best Practices recommend 3.0. `use_adg` (base only, "enable for quality"): never sent. Steps: we used 50;
  it recommends 32-64. Issue #1255 says lego gave noise from Python and worked in Gradio, for a "missing parameter" it does
  not name; our Python path matches that description.
- **Against expecting much from those:** issue #1375 (open, no maintainer answer), at our same commit `ca1e85f`, on base and
  xl-base, reports lego usable in about 1 of 10 takes over a dense mix and 1 of 4 over a sparse one, not locked to the
  source's rhythm, the seed deciding most of it, and CFG 7 / shift 3 / 32 steps among what was tried without success. It
  also points at a lego-trained checkpoint in the code (`is_lego_sft`) that has not been released.
- **What our own verdicts already said and the 14-Nov summary lost:** lego was dropped for not following the CAPTION, not
  for not fitting. Fit was heard as good at times: bass over drums "only bass, usable" (7-Nov), and on `acestep-v15-base`
  guitars that "fit the other instruments very well" (`guitarra-i`). The best case was few tracks as context on the small
  base model.
- **Complete:** upstream describes its source as ONE track ("e.g., a cappella vocals"), and measured it following harmony
  (bass root match 56.9 % against a 32.5 % floor, PR #1287). Ours passed from a voice and failed from extracted drums:
  drums carry no harmony to follow. Never tried: complete from one clean harmonic track (a riff, a bass line, or MIDI
  played through the SoundFont).
- Ideas only, nothing decided: lego back as an option with shift 3 and ADG; complete from a harmonic track.
- **Run the same day on request** (project `psycho-desde-cero`, 122 BPM, all 31.5 s = 16 bars, seed 4242, sent straight
  to `/api/gpu/ejecutar`; lego is still out of the window). Source: `riff-1`, a guitar alone from Stable Audio (stem,
  cfg 1), chosen by measure among three (strongest pulse at 122; E and B on top, more G# than G, so the key sent was
  E major). `generar_audio.py` gained `--adg` (`use_adg`, a field of GenerationParams at `ca1e85f`), only passed when asked.
  - complete, xl-base, DRUMS | BASS, shift 1 (`comp-s1`, 2 takes) and shift 3 + ADG (`comp-s3`, 2 takes), 19 s each.
    Measured: three of the four are the riff back, nearly unchanged (correlation with the source 0.74-0.83, same pitch
    classes and centroid, 3-7 % of the energy under 150 Hz against the riff's 3 %): little or no bass and drums added.
    `comp-s3-2` is something else: 81 % under 150 Hz, uncorrelated, D#/E/D on top.
  - lego, `acestep-v15-base`, shift 3 + ADG, 3 takes each. Bass: `lego-bass-2` 98 % under 150 Hz, E and B on top (the
    riff's two notes), no copy of the source (0.00); `lego-bass-1` a bass with the riff partly in it (0.35);
    `lego-bass-3` quiet and mid-heavy, not a bass by measure. Drums: all uncorrelated with the source, pulse at 122 BPM
    strong in takes 1 and 3 (0.42, 0.45; the riff itself 0.11), weaker in 2.
  - These numbers cannot tell whether the takes sit on the riff's beat or sound like one band.
  - **Heard 15-Nov: PASS for fit.** The takes 1 together (riff-1 + lego-bass-1 + lego-drums-1) fit quite well; the takes
    2 with riff-1 fit too. The takes 3 are not good tracks, they are not heard well (as measured: `lego-bass-3` at
    -21.5 dB RMS with no lows, `lego-drums-3` at -23.8 dB). **So lego over one harmonic track gave a bass and a drum kit
    that go with it in 2 of 3 takes each**, on `acestep-v15-base` with shift 3 and ADG. Whether they follow the caption's
    style was not said at first; then: **heard: the style is more rockabilly than psychobilly** (the texts sent asked for
    it: "rockabilly boogie riff", "walking rockabilly boogie line", "primitive rockabilly drum kit", at 122 BPM, slow
    for psychobilly). The complete takes were not commented on. Not separated: how much is due to shift 3 and ADG, since
    no take with the old settings was made over this riff.

**15-Nov: lego back in the window (asked: how to use lego from the app).** Modules -> ACE-Step -> Track now starts with
"What": One instrument (lego) or Accompaniment (complete). Lego: one instrument per run, `acestep-v15-base` unless
another base model is chosen, shift 3 and ADG by default (both on Review, editable; ADG is a new row there for lego and
complete), 2 bars of margin as complete, takes offered for Repeat again. Its text in the window says what was heard:
fits over one clean simple track in about 2 takes of 3, clumps over a distorted or dense source, the caption barely
steers it. Checked headless on the simulated GPU: form, Review (model, shift 3, ADG on, the DRUMS instruction), Run,
the take delivered as a track, the recipe file carrying `adg: true`; complete keeps shift 1 and no ADG. 260 unit tests
green. **Not tried by the user on a real GPU through the window.** The two test projects of the day were deleted by
the user from Projects.

**15-Nov: the first two notes left from the app, and bugs 47, 50, 51, 52 fixed (requested: go on fixing the bugs).**
- Notes read with `npm run notas` (2 new of 2), both on Stable Audio's form. Heard/seen: SO-SO, digits typed in
  Duration came out reversed (bug 51, fixed). FAIL, with the Note box open the form could not be scrolled (bug 52,
  fixed: the box is no longer modal and sits inside the window it is opened over). Also said: the Example field
  of that form will probably not be used. Example removed from the form the same day, on request, with the table of
  the guide's example prompts behind it.
- Bug 50 (a project playing another project's audio) and bug 47 (the engine copying every WAV at every mount):
  fixed, detail and measurements in BUGS.md. All measured headless, 259 unit tests green. **Not tried by the user.**
- The Note box works end to end: both notes arrived with the form's values at that moment.

**15-Nov: second lego batch, towards psychobilly and with a voice (requested: a new project, and see whether it can
make a voice).** Project `psychobilly-180`, 180 BPM, E minor, 64 s = 48 bars, seed 4242, lego on shift 3 + ADG, 3 takes
each. Riff from Stable Audio without the word rockabilly ("Psychobilly, Punk Rock, Horror Punk", a distorted guitar
alone); `riff-3` chosen by measure (E, B, G on top). Lego bass and drums over the riff on `acestep-v15-base`. Then lego
VOCALS with English lyrics (two verses and two choruses) over a mix of riff-3 + lego-bass-3 + lego-drums-1, on
`acestep-v15-base` (`voz-base`) and `acestep-v15-xl-base` (`voz-xl`).
- Measured, vocals: `voz-base-2` and `voz-xl-2` are uncorrelated with the context (0.00), with almost no lows (2 % and
  16 % under 150 Hz) and a centroid near 1.1-1.2 kHz: the shape of a voice alone. `voz-base-1` and `-3` are mostly the
  context back (correlation 0.78 and 0.83, 84-87 % under 150 Hz); `voz-xl-1` and `-3` carry part of it (0.35, 0.46).
  So with a dense context lego returned the context in 4 of 6 takes, as upstream's issue #1375 describes.
- Measured, bass: all three 75-94 % under 150 Hz and uncorrelated with the riff. Drums: `lego-drums-1` 90 % under
  150 Hz (kick-heavy, or not a full kit), `-3` all highs with the strongest pulse, `-2` quiet.
- Whether any take sings the words, and whether the style moved to psychobilly, is for the ear. **Not heard.**
- **Heard 15-Nov, with the right audio: FAIL.** Only the riffs and the voice can be listened to; the basses and drums
  are clumps. The voice has little consistency. The riffs are fine as riffs, nothing more. So lego passed over the
  clean 122 BPM guitar (first batch, 2 of 3 takes) and failed over the distorted 180 BPM one (0 of 6), with the same
  model and settings. What changed between the two: a distorted, dense source instead of a clean one, 180 BPM instead
  of 122, 64 s instead of 31.5 s; which of the three did it is not known. It agrees with upstream's issue #1375
  (a dense source: about 1 usable take in 10).
- A first listen (some tracks clumps, others the same as the previous project) does not count: bug 50, the bass, drums
  and `riff-1` tracks were playing the previous project's audio. The first project's verdict stands (it was opened first).

**15-Nov: deleting tracks asks about their audio files (bug 45, requested 14-Nov; said again after Delete did not ask).**
The browser's own "Delete?" became a window with one box, unticked: "Also delete its audio from disk", with the files
and sizes. Detail and measurements in BUGS.md, 45. Measured headless, 255 unit tests green. **Not tried by the user yet.**

**15-Nov: Projects can be ticked, duplicated and deleted (requested, with the delete asking apart whether the folder and
its contents go too).** Each row has a tick box; a click on the row still opens it. **Duplicate** copies the whole folder
(audio included) to a free `<folder>-copy` and gives the copy its own name ("… (copy)"), id and folder; the open project is
saved first so the copy has its last change. **Delete…** always asks, listing each project with its files and size, and has
one box, unticked by default: "Also delete its folder and everything inside". Unticked, only `proyecto.json` goes (the
project leaves the list, its audio stays; a folder left empty goes too). The open project is closed without saving before
it is deleted, so its autosave cannot write it back. Disk part in `server/proyectos-disco.ts` (6 unit tests); the routes
take folder names only and check all of them before touching the first.
- Measured headless on test projects made for it: duplicate carried the WAV and the new name; Cancel deleted nothing;
  delete without the folder left the WAV and removed the project from the list; delete with folders of two projects, one of
  them open with a tempo change still waiting for the autosave, left neither on disk 4 s later and no project open; `..` and
  paths as names answered 400; the other 15 project folders (223 files) had the same files and sizes before and after; no
  page errors. 252 unit tests green. **Not tried by the user yet.**
- Not built: a way back. A deleted folder is deleted, not moved to a bin.

**14-Nov: effects in the interface (requested).** The ten effects, their ops and their openDAW translation existed since
the agent version; no screen reached them. Now each track head has an **FX** button (next to S and M, with the count) that opens
the track's chain in a panel that is not modal, so Play, mute and solo stay in reach: add (the ten), remove, on/off, move up
and down, and one slider per parameter drawn from `DEVICE_PARAMS` (`src/core/efectos.ts`: labels, units, logarithmic sliders
for Hz and ms; `web/src/panel-efectos.ts`). Two ops were missing and were added with tests: `set_device` takes `enabled`,
and `move_device` reorders a chain.
- **The live path, tried first because the design hung on it:** `syncMix` now also writes the parameters and the on/off of the
  effects on the running engine's project, so a slider is heard while it moves with no remount, and releasing it records one
  `set_device` (one undo step). Measured headless on a side stick every beat with a reverb (median level between hits):
  wet 0 → 0.00001, dragged to 0.82 and still held → 0.0097, released → 0.0097, switched off → 0, same engine object
  throughout, transport never stopped; 40 writes in 1.2 s, no page errors.
- Adding, removing or moving an effect is a change of structure: a playing engine is mounted again and keeps playing (the
  gap of bug 8). Ctrl+Z walked back six changes one at a time. The ten effects in one chain mounted and played (31 controls,
  every slider moved once while playing, no page errors).
- A track whose WAV plays outside the engine says so in its panel (the first known limitation above).
- **Heard 15-Nov: PASS, the effects work fairly well; some of them do not seem to do much.** Which ones, and at which
  settings, was not said. Zipper noise on a moving slider was not mentioned.
- Facts of the model, not built: the master has no chain (`master` is only `gainDb`), and buses and sends have ops and an
  openDAW translation but no screen (the adapter now records each bus's unit, so the live path reaches them).
- Also 14-Nov: the user's literal quotes, pronouns and machine details were taken out of this file (the repository is public);
  CI added (`.github/workflows/ci.yml`: typecheck and unit tests).

**10/11-Nov, hands-on test of the Pad and the piano roll.** Decided by the user: drums play **only the GM
SoundFont's kit** (GeneralUser GS); Freepats was looked at and rejected (no clap/cowbell/rim, non-GM notes, 209 MB); the 13 WAVs of
unknown source were removed (they remain in git history). Fixed: bugs 36-39 (see BUGS.md); the Pad is
centred horizontally at the bottom (requested). Built on request: the piano roll with its own undo/redo, length from the note end, audition, piano keys (GM piece names on a drum track),
playback of the pending notes, box/shift/Ctrl+A selection, arrows, grid 1/4-1/32 with triplets and Quantize, velocity lane, zoom,
key shading (notes outside it red), Transpose/Invert/Reverse/x2/÷2/Duplicate, Ctrl-drag copy. All measured headless, **none heard**.

**12-Nov: the open bugs fixed.** 21 (a source over full scale is turned down, said on Review), the rest of
29 (Pause and Stop keep the engine loaded; Play is immediate), long WAVs under the Pad's loop, doubled notes in a Pad take, and
WAVs with effects first in the memory budget (10, still in part). Detail and measurements in BUGS.md (21, 10, 42-44). All measured
headless, none heard. Also that day: everything listed as "not heard" or "not tried" up to here is taken as good, on the user's
word; do not ask for those listens again.

**8-Nov: ACE-Step test phase CLOSED.** Requested: no more of those tests; real users' attempts will be the test.
Do not propose more ACE-Step tests (shared chords for stems, more structure seeds, more solo instruments, repaint of
glitches, MIDI dressed by cover): they stay as ideas below, for users to find. Recipe that came out best: text2music on xl-sft + LM 4B
with the `vein` caption at a given BPM; stems by describing one instrument alone; bass/drums by extract. GPU shut down after it (89 s).

**8-Nov, decided by the user: non-commercial models are allowed, with disclaimers.** Reason given: the project is experimental, and
as such, with the disclaimers in place, it can use models like MuLaCover. Conditions agreed: each such module states its licence before Run;
each take's lineage records the licence; the notice also reminds that a third-party source (a known song) has its own rights; if
miuzika ever becomes a paid service, these modules are reviewed. YuE2 and MusicGen become candidates on these terms.
**8-Nov: building the MuLaCover and Demucs modules** (requested, both).
Built: windows in Modules (`web/src/modulos/{mulacover,demucs}/ventana.ts`, shared `comun.ts`), pure recipes with tests
(`src/modulos/{mulacover,demucs}/receta.ts`), GPU scripts `generar_mulacover.py` (pinned e27fa7f) and `separar_demucs.py` (demucs 4.0.1,
torch 2.5.1), `entregarMidi` in the host. Windows checked headless to Review (licence and warranty shown). Real runs on the A10:
Demucs htdemucs 2 min with install, htdemucs_ft 86 s, htdemucs_6s 81 s (6 stems), Ghosts Again original 68 s; MuLaCover from MIDI with
drums 437 s. **Heard: Demucs on Ghosts Again original (`ghosts-orig-stems`), PASS: separated very well.** mc-ghosts-ft (htdemucs_ft on
the MuLaCover cover): heard: PASS, each stem carries its own part, and **cleaner than the htdemucs stems**: ft is the better default; it took 86 s
here, about the same as htdemucs, not the 4x its README warns of (one 3-min song). Proposed: make htdemucs_ft the window's default. **htdemucs_6s: heard: FAIL, guitar and bass unusable** (on the cover, which has no real
guitar): it invents them from the synths. Note agreed for the window: "Six stems: only for songs with real guitar or piano;
on synth music it invents them." **Applied 8-Nov on request**: htdemucs_ft first and default, notes updated. GPU shut down after the
tests (77 s). The temporary `probar_heartmula.py` and `probar_mulacover.py` were deleted on request (unused);
HeartMuLa's two install fixes are written above, if it is ever tried again.
MuLaCover from MIDI (Ghosts Again's transcribed melody+chords+drums, the user's lyrics, industrial style, seed 42), `mc-midi-drums`: heard:
complete, many instruments, much more pop and commercial, with voice. From MIDI it still goes pop, like from audio. `mc-midi-sin-drums` (no drum MIDI): heard: complete too, with drums: without a drum
MIDI it writes its own drums; the drum MIDI is optional for real. `mc-desde-heartmula` (source: HeartMuLa's pop take hm-darkwave-1,
same lyrics and industrial style): heard: not dark, not industrial, not dark synth pop. **MuLaCover keeps the
melody and sings the lyrics, but its style ignores the style text: 4 of 4 takes came out pop.** Outputs are always audio (the
mc-midi-* takes are not MIDI: they are WAVs made *from* MIDI).

**8-Nov: Stable Audio researched (requested, with a trial run).** Read: HF cards of stable-audio-3-medium and -small-music,
their LICENSE.md, github.com/Stability-AI/stable-audio-3 (README, inference and prompting docs). Not run yet.
- Family (May 2026): `small-music` 433M (CPU-capable, 120 s), `small-sfx`, `medium` 1.4B (GPU + Flash Attention 2, up to 380 s,
  ~6.5 GB VRAM), Large API-only. Stereo 44.1 kHz. Instrumental: "don't output intelligible vocals". Stems/solo instruments supported
  (`TrackType: Instrument`). BPM only as text ("120 BPM"); no key, no melody conditioning. Audio-to-audio (`init_audio`,
  `init_noise_level`), inpainting and continuation. Defaults: steps 8, cfg 1.0 (7.0 "for stronger prompt adherence"), duration 120.
- Licence: code MIT; weights **Stability AI Community License**: free for research, personal and commercial use under US$1M annual
  revenue (commercial use asks for registration at stability.ai/community-license); **outputs are the user's**; no use to train
  another foundation model; also the Gemma Terms (text encoder T5Gemma), not read.
- **Blocker: the weights are gated.** Downloading needs a Hugging Face account that accepted the terms, and its token.
  **Solved 8-Nov:** the medium terms were accepted and a token with gated read access was provided; it is saved in Settings,
  never in the repository. For the first trial it was copied to the instance by hand; the app did not carry it yet.
- **First trial, 8-Nov 13:15**, project `stableaudio-prueba`, temporary `workspace/gpu/probar_stableaudio.py` (790793b, flash-attn
  2.6.3 wheel cu126/torch2.7): drums, synth bass (30 s) and an instrumental song (120 s), 92 BPM, seed 7111, each at cfg 1 and 7.
  Install + download only ~13 s of script time beyond boot; each take ~24 s with the model reloaded every time. Output 44.1 kHz.
  Measured: cfg 7 takes are much louder (RMS -6.7 to -9.8 dB against -16 to -18 at cfg 1, peaks at 0 dBFS): likely distorted.
  **Heard: `sa-song-cfg1` strong PASS, very industrial — the first model that lands the wanted style.** bass cfg1 heard as a bass
  (PASS), bass cfg7 a mix of things, not only bass, also synth; drums cfg1 percussion, passable; drums cfg7 also
  industrial percussion. cfg 1 (the default) is the better setting; song cfg7 heard as heavily saturated (as measured: RMS -7.3 dB). **Use cfg 1.**
  Second listen, same day: drums cfg1 is a drum kit, drums cfg7 too but oversaturated; bass cfg1 is a bass, bass cfg7
  more like an oversaturated didgeridoo. So cfg 7 saturates on every kind (drums, bass, song), as the RMS said; cfg 1 gives the asked instrument.
  `sa-song-cfg1` on second listen: very industrial, liked a lot, though it lacks melody.
- **8-Nov: Stable Audio module built** (requested: GPU off, but the module built with every function): window in Modules
  (from text: song / one instrument / sound effect / free; transform audio; repaint bars; continue), Review with the composed prompt
  editable, licence and cost; `generar_stableaudio.py` (790793b, Python API, model loaded once, takes as one batch); the Hugging
  Face token saved in **Settings** (`.miuzika/proveedores.json`, never returned) and copied by the server to the instance only for
  this script (`secretos` in `ejecutarEnLambda`, scp of a temp file, mode 600). Windows checked headless for all four tasks.
- **Real runs through the app's path, 8-Nov 14:17-14:36** (`stableaudio-prueba`, all cfg 1): two drum takes in one batch (1.6 s
  of generation; model load 46 s the first time, 18 s after); transform `sa-song-cfg1` at change 0.7 (65 s; correlation with the
  source 0.05: a new piece); repaint bars 13-16 (106 s; correlation with the source 0.995 before, 0.87 inside, 0.97 after: outside
  is kept, only through the codec); continue the 30 s bass to 60 s (81 s; first 30 s at 0.998); small-music song (76 s).
  Heard: `sa2-repintar` very close to its source `sa-song-cfg1` (the take liked most), as
  expected: only bars 13-16 are new. Whether the change at those bars is audible was not said.
  `sa2-continuar`, `sa2-drums-x2-1`, `sa2-drums-x2-2` and `sa2-small`: heard: they fit together and are what they say; the overall
  style is not the favourite. PASS on doing what was asked and fitting together; style below `sa-song-cfg1`. `sa2-transformar`
  (change 0.7 over `sa-song-cfg1`): heard: also very good. Every task of the module passed by ear. Committed dd3deff.
- **Form with every detail** (requested: Stable Audio is a good candidate, so build the form with every detail
  possible; melody test not wanted). Read at 790793b (model.py, dit.py, prompting.md, inference.md, Gradio): several repaint
  regions in one pass ("5-8, 13-16"), one prompt per take (variation lines), empty prompt allowed (the guide's unconditional and
  no-prompt continuation), Genre/Instruments tags, Duo kind, the guide's example prompts, change-amount presets (0.1/0.4/0.6/0.7/0.9
  from the guide and our run), duration in bars, Advanced (steps, cfg, APG, sampler), and the -base checkpoints (50 steps, cfg 7,
  euler/rk4/dpmpp; not gated on HF; not run). **Found in dit.py: guidance only runs when cfg != 1, so at the default cfg 1 the
  negative prompt does nothing**: the form and Review say so. small-sfx is gated too and was missing from the Settings check.
  Checked headless on the simulated GPU (every task to Review, no page errors). Committed 58cb11d.

**8-Nov: Basic Pitch (audio → MIDI) tried, locally, no GPU** (requested: try it on a generated song that had been
liked). spotify/basic-pitch 0.4.0 (PyPI, Aug-2024; repo at fa5997a, Nov-2025), **Apache 2.0**. On Windows with
Python 3.12 its pip metadata asks for tensorflow<2.15.1 (no 3.12 wheels): installed `--no-deps` plus onnxruntime 1.31.1, librosa,
pretty-midi, resampy, `setuptools<81` (resampy needs pkg_resources); it then runs the bundled `nmp.onnx` on CPU. Knobs (inference.py):
onset threshold (0.5), frame threshold (0.3), minimum note length (127.7 ms), min/max frequency, multiple pitch bends, melodia trick, MIDI tempo.
- `sa-bass-cfg1` (30 s): 1.8 s on CPU; default 13 notes, all D1, long. **pyin agrees: 99% of frames are D1**: the bass is a drone, so
  this is right. Lower thresholds 0.3/0.2: 39 notes, still D1; 0.2/0.1: 902 notes of junk (E6, E7...).
- `sa-song-cfg1` (full distorted mix, 115 s): 3.4 s; default only 47 notes, 90% silent. 0.3/0.2: 513 notes, mostly C#2, B2, G#2, D#2
  (a consistent set); 0.2/0.1: 9693 notes of junk. On a full mix it needs a separation first (Demucs), as expected.
- Files in `stableaudio-prueba/generado/`: `bp-sa-bass-cfg1.mid`, `bp-sa-song-cfg1.mid` (default), `bp-*-sensible.mid` (0.3/0.2).
  **Heard: FAIL, the four MIDI are worth nothing.** Basic Pitch on Stable Audio's distorted material: FAIL. No module built.

**8-Nov: Strudel module brought from old miuzika** (requested).
In Modules: a pattern rendered to WAV in the browser with the real engine (`web/src/modulos/strudel/`, the old strudel-audio.ts and
strudel-source.ts), heard in the window, then added as an audio track at a chosen bar, clip = the bars asked. No GPU. Packages as old:
@strudel/* 1.2.6 / webaudio, soundfonts, superdough 1.3.0 (latest). Patterns kept per project folder in localStorage. Five examples.
Two bugs of the old code found in the headless run (it had never been run, per the old ESTADO): (1) the effects controller came from a
second copy of superdough (`superdoughoutput.mjs` vs the bundled dist) with no context set: room/delay/distort failed with "different
audio context" and the delay arpeggio was silent; (2) superdough's private node pools reuse filters etc. from the previous render's
dead OfflineAudioContext. Fixed: the library builds its own controller, and stale pooled nodes read as collected during a render.
Measured after: the 5 examples, then three again, all sound with no warnings. Renders peaked up to +6.6 dBFS (909 kit): turned down to
-1 dBFS before the WAV. Added one as a track headless: 4 bars on the grid, waveform drawn. Committed 6ee39da.

**8-Nov: MIDI-LLM module** (requested after a review of what old miuzika had: `proponer_midi` first, named "MIDI-LLM", import
path approved). Old `proponer_midi.py` ported to `generar_midillm.py`: repo pinned 93c660c, weights revision 8b82ab9 (not gated),
packages pinned to its requirements.txt without vllm, torch 2.8.0 cu128; the generation driven through the repo's own
`generate_from_prompts_hf` so the seed is set and recorded (its script has none); tempo stamped on each .mid (ticks unchanged).
Window: description, instruments, key, time signature, tempo in words and chords composed into its training captions' shape
("Set in the key of D minor with a 4/4 time signature… a chord progression of Dm, Bb, F, and C."), its README's examples, 1-8
proposals, start bar, Advanced (length in tokens, temperature, top-p, seed). Delivery: `entregarMidi` now takes a start bar, names
each proposal's tracks "<file> · <instrument>", mutes proposals after the first, and makes the project if none is open.
Licence: Llama 3.2 Community ("Built with Llama"). Checked headless to Review. Committed c8383df.
- **Real run, 8-Nov 18:50-18:59** (`midillm-prueba`, through the app's server; instance booted from off): industrial synth-pop
  caption with synth bass, drums, synth strings, lead synth, D minor, 4/4, fast-paced, Dm-Bb-F-C, 4 proposals, seed 7111, 92 BPM.
  Install 40 s, model load 116 s (first download), generation 32 s, VRAM 3.8 GB, none dropped. By measure it followed the text:
  the four asked instruments in every proposal (GM 38/39, kit ch10, 50, 81, plus 30/84/53/54 of its own), 99-100 % in D minor
  in two, 79 % and 61 % in the others, 92 BPM stamped. All four hit the 682-note cap (2046 tokens) and the drums take most notes:
  only 4.7, 12.7, 8.4 and 11.7 bars of music. Imported by hand with Open.
  **Heard: FAIL, of no use at all.** Like Basic Pitch: the numbers said it followed the text; the ear says no.
  **Module removed on request**; it stays in c8383df. `entregarMidi`'s start bar and per-proposal naming stay.

**8-Nov: instrument picker for MIDI tracks** (requested). Nothing in the GUI changed a
track's instrument: an imported .mid without program played GM 0 (piano) for good. Now the instrument line of a MIDI track head
("Synth bass 1 ▾", "Drums · Room ▾") opens a picker: search, the 128 GM programs by family, the 12 kits of GeneralUser GS's bank 128
(read from its preset headers: Standard 1-3, Room, Power, Electronic, 808/909, Dance, Jazz, Brush, Orchestral, SFX), openDAW's 5
synths. A click applies `set_instrument` live (undoable; a playing engine is mounted again); kits listed first on a drum track; a
note warns that drum hits play as pitches on a melodic instrument. `src/core/instrumentos.ts` with tests. Checked headless: melody
→ Synth bass 1, drums → Room, Ctrl+Z back to Standard 1, Play without errors. One bug found there and fixed: a search kept from
another track hid the kits. GS variation banks (1-26, e.g. "Acid Bass", "808 Tom") are not offered:
the engine only picks bank 0 and 128.

**8-Nov: Export menu: MP3, WAV, MIDI** (requested: the MIDI and WAV exports were missing). The exporter already wrote all three (old agent's
tools); only MP3 had a button. The header's MP3 button became an **Export** menu. Checked headless on MuLaCover's melody + drums
(melody set to Synth bass 1, drums to 808/909): MIDI 2 tracks at 114.796 BPM, read back with midi_lector: melody program 38, drums
channel 10 kit 25; WAV 3:55, peak +1.7 dBFS (the Log says CLIPPING: lower the master); MP3 320 kbps, 9.0 MB. No page errors.
Then asked: what happens with a WAV selected and MIDI pressed. Read in the code: Export ignores the selection; a project of audio alone
wrote an EMPTY .mid and the Log said "0 track(s)"; audio tracks were left out silently. Fixed: no MIDI tracks with notes → nothing
written and it says why; mixed → the .mid plus a Log line naming the audio tracks left out. Both also open a notice window with
"Don't show this again" (requested: it has to inform, with a do-not-show-again check; `aviso-unico.ts`, localStorage); the Log
line stays always. Checked headless: window, ticked, no window the second time, Log line still there.

**8-Nov: Basic Pitch on CLEAN stems** (before building "To MIDI", asked about that day).
Demucs stems of Ghosts Again (original), CPU, 6-9 s each: **bass** (30-400 Hz) 1,423 notes, pitch classes E, D, C#, F# as pyin
(pyin: E1, D1, C#1, F#1), but often doubled an octave up (polyphony median 2 on a one-note line): a "bass" mode that keeps the
lowest note gives 590 notes (`bp-ghosts-bass-mono.mid`); **vocals** (80-1200 Hz) 341 notes, 68% silent (the gaps between lines),
G#, A, C#, F#, B, E; **other** 1,994 notes, polyphony median 3. Files in `heartmula-prueba/generado/bp-ghosts-*.mid`.
**Heard: far from perfect, but it can help composing.** PASS as a composing aid, on clean stems. Building
"To MIDI" on it: kinds Bass (lowest note kept), Melody, Chords/pad, Other (raw); Drums refused (Basic Pitch is pitch only).
- **Built, 8-Nov:** select ONE audio track → "To MIDI" in the selection bar → kind, sensitivity (thresholds 0.6/0.4, 0.5/0.3,
  0.4/0.25), shortest note, snap (off, 1/8, 1/16). Each clip is transcribed for the part of its WAV it plays
  (`workspace/herramientas/transcribir.py`) and its notes land where the clip is, in a new MIDI track "<name> (MIDI)" with an
  instrument for the kind (bass → GM 38, melody → 81, chords → 89, other → 0); the .mid stays in generado/. Basic Pitch in its own
  venv `.miuzika/basic-pitch/` (made on first use by `server/api/transcribir.ts`, --no-deps + the versions of the trial; 464 MB).
  Headless on the Ghosts bass stem: first run 132 s (install included), transcription 7 s, 590 notes of 1,423 heard, C#1-E3 (the
  same as the hand-made mono file heard before). Drums: button off with the reason.
  Committed 7902f74.

**8-Nov: Pad (the touchpad as an instrument) brought from old miuzika** (requested,
before renaming this folder to miuzika and deleting the old one). There it came from humseed and was never exercised. Brought as
it was: `workspace/herramientas/touchpad/` (Raw Input capture, Windows Precision Touchpad), `server/api/pad.ts` (now also refuses
other origins, bug 16), `src/core/pad.ts` with its tests (drum pad names now in English), `web/src/pad.ts`, a Pad button in the
header. The transport gained `prepararMotor` (the engine loaded, stopped) for the live notes; a structural change unloads that
engine so the next note picks up the new instruments. Checked headless with the real touchpad: the panel opens, the capture starts
and says ready, tracks and modes listed (drums → Pads), closing stops the capture, a foreign Origin gets 403. **Not armed and not
played** (arming freezes the cursor): to be tried by the user.

**8-Nov evening: Pad redesigned with loop recording** (requested: play with the pad and the numeric keypad, with the
interface rethought; the numpad for any instrument, not only drums, the touchpad too; keys changeable if there is
no numpad; on stop, ONE clip per track with every layer, the option chosen). Two sources, each with its own track and instrument (and
"+ New track / + New drum track" in the panel): touchpad, and nine keys (numpad 1-9; on a drum track nine GM pieces, on any
other nine steps of the project scale). Loop of 1/2/4/8/16 bars or one free take, via the engine's loop area so the project
plays along; count-in of one bar when recording; each pass a layer heard from the next pass on; quantize Off (default) / 1/8 /
1/16; numpad keys: Enter record/punch, 0 loop on/off (stop saves), . undo pass, −/+ octave of the keys, * metronome, hold / note
repeat, hold Del + note = erase as it goes by. Presets Numpad and Letters (ZXC/ASD/QWE), every key remappable, kept in
localStorage. Pure part `src/core/bucle.ts` with 9 tests. Headless run (drum MIDI at 100 BPM, 1-bar loop, keys sent by
Playwright): two kicks in pass 1, two snares in pass 2, hats by repeat in pass 3 every 0.15 s (= 1/16 at 100), "." removed the
6 hats, Del+1 removed the kick on the downbeat only, stop saved 3 notes in one 1-bar clip, Ctrl+Z removed it. Layer replay
measured against the live hit + one loop: 0 to +19 ms. Letters preset, remap, new drum track, Esc, 600 px width: right.

**9-Nov: Pad warnings and taken names on Review** (the recommended order, approved). The Pad opens with no project and
offers New… and Projects… (before, it only wrote a Log line and seemed to do nothing). A source whose track cannot be heard
says so, with "Unmute" or "Solo this track too" (BUGS 29). The four GPU windows ask the server (`/api/gpu/nombre`, the
same test as Run) whether the take name is taken: said on Review with Run disabled, and asked again on Run so the window
does not close and the form is kept. Headless on the simulated GPU: all three paths as described.
Also 9-Nov: repository public with full AGPL text, About, README GIF; landing rewritten and uploaded; CLAUDE.md updated
for this being the only miuzika; no personal names in the repo.

**8-Nov night: New asks for the name** (requested: New has to ask for the project's name and open it, and from there
the Pad can run; the Pad does not open with no project, which is why "Pad" seemed to do nothing). New opens a
window with the name; the folder comes from it, and a taken one is said before creating ("goes to proyectos/x-2/"); Create opens
the project and writes it at once. In the Pad, an empty project shows "Choose a track…" (before, "+ New track" looked chosen and
picking it did nothing), creating a track waits for the engine to load (headless, it was refused while loading), and the
engine is loaded again after every change so the next key sounds at once. Headless: New → name → open and on disk, same name
→ "-2" said, Cancel keeps the open one, Pad → new drum track + new synth track → Numpad1 peaks 0.60.

**8-Nov: HeartMuLa researched for a module of its own (requested: read up on it for a form of its own).**
Read from heartlib at `5858ca8` (8-Oct-2026, shallow clone, nothing run) and the HF cards. Nothing designed or built yet.
- Licence: code and all weights Apache 2.0 (since 20-Jan-2026).
- Models: HeartMuLa-oss-3B (14-Jan), HeartMuLa-RL-oss-3B-20260123 ("more precise control over styles and tags"),
  **HeartMuLa-oss-3B-happy-new-year** (13-Feb, the one they recommend); HF metadata says "4B params" for the 3B cards. 7B: internal only,
  "not released yet". HeartCodec-oss-20260123 (2B, decoder, 48 kHz stereo) + HeartCodec-oss-encoder. HeartTranscriptor-oss (0.8B, lyrics
  ASR). HeartCLAP (text-audio embedding). **MuLaCover** (16-Sep, separate repo): cover/remix from reference audio *or melody/chord MIDI*,
  genre and instruments by text: close to the "MIDI dressed by cover" idea, not read yet.
- Inputs: `lyrics` (sections `[Intro] [Verse] [Prechorus] [Chorus] [Bridge] [Outro]`), `tags` (comma-separated, no spaces, e.g.
  `piano,happy,wedding`); both **lower-cased by their own code** and tags wrapped in `<tag>…</tag>`. `max_audio_length_ms` (script default
  240000, pipeline 120000), `topk` 50, `temperature` 1.0, `cfg_scale` (README and pipeline say 1.5, the example script 3.0: conflict).
  No seed parameter, no BPM or key fields, no reference audio yet (TODO, a `muq_embed` slot exists). Output 48 kHz.
- Speed "RTF ≈ 1.0" (a 3-min song ≈ 3 min). VRAM not stated; `--lazy_load` for one GPU. Python 3.10 recommended, torch <2.11,
  transformers 4.57.0, torchtune 0.4.0.

**8-Nov: first HeartMuLa trial on the A10** (prompt approved), project `heartmula-prueba`, temporary script
`workspace/gpu/probar_heartmula.py` (untracked, to delete). Tags `darkwave,deep,male,dark,synthesizer,night`, the user's lyrics with
[Intro]…[Outro], happy-new-year 3B, 180 s asked, topk 50, temperature 1.0, seed 7111, cfg 1.5 and 3.0. Two install fixes needed on the
instance: `pyarrow<18` (torchtune 0.4.0 -> old datasets uses pa.PyExtensionType), and torchaudio.save wants torchcodec, so our script
writes the WAV with soundfile (16-bit, 48 kHz). Measured: HeartMuLa 12.7 GB and codec 6.2 GB of VRAM (loaded in turn, peak 13.7 GB);
take 1 (cfg 1.5) 153 s of audio in 136 s, peak 0.0 dBFS; take 2 (cfg 3.0) 102 s in 81 s: **both stopped before the 180 s asked**
(the model ends on its own). Boot 260 s; install + 22 GB download ~5 min. **Heard (quickly): FAIL: almost nothing of
the tags, romantic pop songs.** Same failure as ACE-Step's voice (pop by default), and worse on style. One prompt, two takes.
**8-Nov: MuLaCover trial** (go given, as a private experiment: its weights and outputs are **CC BY-NC 4.0**, commercial use
forbidden by its LICENSING.md, so it cannot enter the app as is). Temporary script `workspace/gpu/probar_mulacover.py` (untracked, to
delete), MuLaCover `e27fa7f`. Source: Ghosts Again MP3 (a file supplied by the user), the user's lyrics, style
`topic:[Isolation]; genre:[industrial]; instrument:[synthesizer,drum machine]; mood:[dark]`, seed 42. Worked with the default PyPI torch
(no CUDA 13 needed) + `pyarrow<18`; install + 16 GB of models in <30 s on an instance already on. It transcribed the source to
melody/chord/drum MIDI (bpm.txt 114.8) and generated 195.6 s in 397 s, peak 14.7 GB VRAM. First try cut at 320 s by our launcher
(Node fetch aborts after 300 s without data; the server took it as Cancel): any client of /api/gpu/ejecutar must tolerate long silences.
MIDI kept in `heartmula-prueba/generado/mc-ghosts-midi/`. **Heard: PASS-ish: the cover is fine, lyrics and all; it is
more pop and the voice more conventional, less evocative than the original's; worth knowing this can be done, as long as
it is stated that it cannot be used commercially.** First model that sang the given lyrics over a known song's melody and chords.
If it ever enters the app: say plainly, before Run, that MuLaCover's outputs are non-commercial (CC BY-NC 4.0). Nothing decided.

**7-Nov evening, in short (committed on request):**
- **Removed from the window:** lego (on request: not steerable) and the Reference field (it failed in lego and in cover).
- **Works:** text2music with a detailed English caption (project `vein`: heard: very good).
- **Half:** extract (it pulls what stands out in the mix); cover (keeps the song and sounds good, but ignored "dirtier").
- **Fixed:** bugs 25 (the file picker looked empty) and 26 (a reload now reopens the last project).
- **Texts:** the help texts no longer carry our test dates or anecdotes.
- **Projects:** the older ones were deleted by the user; `vein` is the current one. `vein-cover-1` is a stray project from bug 26, the user's to delete.
- **Tests left (proposed 7-Nov night, the user's choice; recommended first: 1):**
  1. DONE 7-Nov 21:20, `vein-voz`: good music, but other songs than vein-1 and a mainstream pop voice (see the verdict table).
     Then `vein-voz-b`, the voice described in the caption: heard: not close. The caption does not steer the voice.
     **Voice closed on request, 7-Nov night: nothing more on voice; it is known that a voice can be asked for in full songs,
     and that is all.** Do not propose more voice tests (cover with lyrics, complete from a recorded voice): voice = text2music full songs, as is.
  **Requested 7-Nov night: a new project created for the tests, the tests run without changing the code, and the WAVs
  loaded by the user afterwards.** Project `pruebas` (no tracks; the WAVs are imported by the user). Run through `/api/gpu/ejecutar`, one after
  another, same recipe shape as the window (script outside the repo). p01-p02 cover with a dirty caption at
  0.6/0.3, p03 cover-nofsq, p04 repaint bars 9-12, p05-p06 extract keyboard/percussion, p07 complete over vein-drums, p08 text2music no
  LM, p09 no BPM/key, p10-p14 the other five text2music models (seed 782922162, as vein-1), p99 Cancel during the DiT. Test 9 (MIDI
  dressed by cover) left out: it needs the user's notes. Results below as they come.
  Run 22:00-22:19: p01-p11 done, a WAV each in `pruebas/generado/`, none heard yet. Times: covers 69-90 s, repaint 56 s, extracts 62-74 s,
  complete 70 s, t2m no LM 56 s, t2m no BPM/key 150 s, xl-sft 166 s, xl-base 213 s. At 22:19 the launcher process was killed (low
  memory), which the server took as Cancel of p12 about 32 s into the script: no file left. p12-p14 and p99 still to run.
  **Heard the same night, in short:** good songs from text2music on every model tried (xl-turbo with and without LM,
  xl-sft, xl-base), none really industrial; no BPM -> the LM picks 125 (dance). Caption does not steer style in cover either (p01/p02).
  cover-nofsq stays close to the song and passed. Repaint obeys the range exactly. Extract keyboard passed, percussion confused with
  it. Complete over extracted drums: jumble. Pattern across tasks: **ACE-Step keeps structure well; style words barely move it.**
  Heard, on the whole: **it leans towards dance music**: with this dark synth-pop/industrial caption it leans to dance (p09 at 125,
  p10 "rave", even at 92 BPM). Words that pull away from dance are the next thing to try, if any.
  **Second batch, 22:47-23:05 (new A10, boot+install+p12 in 7 min 47 s):** p12 turbo 467 s with the boot, p13 sft 131 s, p14
  base 149 s, p15 nofsq 0.3 66 s, p16 nofsq 0.8 60 s, p17 repaint bars 9-16 73 s, then p18 (caption without dance words: "slow, heavy,
  dragging, lumbering", sparse heavy drums; arpeggio, plucks, hi-hats, claps, tight, gated taken out; 496 chars, seed 782922162, 92 BPM).
  **Cancel during generation, p99 (600 s on xl-base, no LM), cut 75 s into the script, PASS:** right after, no `generar_audio` process
  on the instance, 0 MiB GPU memory, only the uploaded recipe left there; no WAV brought back, no track. Heard: none of these yet.
  p18 done 23:06, 112 s. Measured: p17 obeys its range (bars 1-8 and 17-23 at correlation 1.00, 9-16 new). nofsq correlation with its
  source: 0.66 at 0.3, 0.71 at 0.6, 0.72 at 0.8: strength barely moves it, as in cover (p01/p02). GPU shut down on request
  after all 18 were heard (Lambda confirmed in 88 s).
  **8-Nov: LM 0.6B discarded on request**, without testing it. Searched the web first: no user reports or A/B of
  the LM sizes; upstream says same data, 0.6B = low-VRAM option, 4B "strong" for composition and understanding; their numbers are all
  with 1.7B. Running the 4B in project `pruebas-4b` (q01-q04: the `vein` recipe and seed on xl-sft, base, xl-turbo, sft, so each pairs
  with p10, p14, vein-1, p13). Risk noted: xl + 1.7B already used ~14 GB of the A10's 22.
  Run 8-Nov 07:46-07:58: all four done. The 4B fits: q01 xl-sft peak 11.3 GB (lineage). Times: q01 392 s with boot and 4B download,
  q02 base 90 s, q04 sft 92 s, q03 xl-turbo 83 s (its first try failed on "ssh cut off after 20 s" at sync, as guitarra-f on 7-Nov;
  retried alone, fine). With the 4B the runs were faster than with 1.7B (base 90 s vs 149 s; why not known). GPU on.
  q05 (go given): q01's recipe, 3 takes, random seed -> seeds 589740696/7/8 (lineage), 241 s, 8-Nov 08:15.
  Decided 8-Nov: the 4B works better than the 1.7B and is the default model, choosable, 0.6B out. Planned in receta.ts
  (LMS without 0.6B, text2music default 4B, `none` kept). **DONE 8-Nov ~08:43 on the go**: LMS = 4B, 1.7B, none (4B first in the
  Review selector); typecheck and 178 unit tests green. **Seen in Review by the user: the 4B shows.**
  Two "ssh cut off after 20 s" on 8-Nov's instance (q03 at sync, r03 at upload), both retried; watch whether the 20 s cap is too tight.
  **r* batch, 8-Nov, requested: as many tests as possible, for a comparison**, all paired with an earlier take:
  r01 xl-base+4B (vs p11), r02 xl-sft+4B without BPM/key (vs p09), r03 xl-sft+4B without dance words (vs p18), r04 xl-sft+4B with fewer
  layers (no arpeggio/plucks, "an occasional" choir, 4 drum parts) on q05's seeds 589740696/7/8, r05 xl-sft+4B with section tags and no
  words (`[Instrumental]` then [Intro]…[Outro]) on q01's seed; extract bass/keyboard/synth(/drums) from q01 and q05-1 (base); nofsq 0.6 of
  q01 and q05-1 (xl-sft, seed 7111).
  **s* batch, queued after r*: the original idea, whether the 4B can create tracks of one instrument each.**
  text2music xl-sft + LM 4B, 60 s, 92 BPM, D minor, seed 4242, 2 takes each, one positive caption per instrument ("Isolated … track:
  a single … playing alone … Solo … recording … stem for mixing", no negations): s01 drums, s02 bass, s03 pad, s04 lead. Before (1.7B,
  2-5 Nov): text2music completed a song when asked for drums alone, and negations primed what they denied.
  **The user's conclusion, 8-Nov: the 4B works better than the 1.7B, but the app must keep saying that this is experimental
  and can cause GPU rental spending that is not productive.** The window's texts (EXPECTATIVAS, SIN_GARANTIA in ventana.ts) were
  stale against 7/8-Nov verdicts. **Updated 8-Nov on approval**: "Experimental: results vary…, many takes
  may be needed" opens the No-warranty notice; text2music (one instrument possible, style words weak, give BPM, several takes), cover
  (caption barely changes style), cover-nofsq (close to source, strength ~nothing, change seed), repaint (exact range), extract (+keyboard
  good, percussion confused), complete (+jumble from extracted drums). typecheck and 178 tests green. **Texts seen by the user: approved.**
  **Heard 8-Nov, the news: text2music with xl-sft + LM 4B gives one instrument per track, 6 of 8 takes (s01-s04).** Next to try:
  put one good take of each in a project and hear whether they fit together. **Done by the user, heard: they fit somewhat, not much; s04-2 (lead)
  does not fit at all, it has its own rhythm.** Measured (crude numpy, no librosa installed): all stems sit in D minor by pitch classes
  (bass A D E Bb, pad A D G F, lead-2 D F A C); lead-2 has the strongest 92 BPM periodicity of all (0.69). So key and tempo match by
  measure; the likely misfit is that each stem was generated apart with its own chord changes, phrasing and downbeat.
  Heard again in `escuchar-4b` (8-Nov ~10:00): p18 (1.7B, no dance words): also an ambient or atmospheric soundtrack, somewhat
  industrial and mysterious (first named as q01 by mistake, then corrected to p18).
  **Heard: q01 (xl-sft + 4B) is the best take so far** (very good; the choirs make it); see the verdict table.
  **Estimate against real (test 7, 7-Nov night, GPU already on; `estimar` in receta.ts, computed by hand, code not touched):**
  covers/extract/complete with a 12 MB source: estimated ~219 s, real 62-90 s; repaint turbo ~203 s, real 56 s. text2music 180 s with
  LM: turbo ~171 s, real 150 s; xl-sft ~220 s, real 166 s; xl-base ~220 s, real 213 s; no LM ~101 s, real 56 s. Cause of the big miss:
  upload is taken at 110 kB/s (109 s for 12 MB) but measured 12 MB in 20-38 s (`gpu_aviso` stamps), ~0.3-0.6 MB/s. Estimates run high,
  never low.
  GPU shut down on request, 7-Nov ~22:33, confirmed by Lambda in 95 s. The rest needs a new boot (~4-5 min).

Where we were before (7-Nov morning and afternoon, partly superseded above):
- Song project **`bateria-1`**, now deleted: drums kept; basses `bajo-1` (heard: a synthesized xylophone) and `bajo-1-2` (heard: better, but not
  hardcore punk). Project `ace-step` ("toma"), the morning song.
- Built and checked on 7-Nov: bar margin (heard: it reaches bar 8 inclusive), instruction as upstream, context starts on Tracks,
  bugs 15, 16, 22, 23, 24 fixed (detail in the dated section below and in `BUGS.md`). typecheck and 177 unit tests green. Committed in
  `8996a73` (7-Nov afternoon, on request; local only).
- GPU: off at ~11:25 on 7-Nov; on again from 19:29 for the evening runs.
- In the window since 7-Nov afternoon (requested: no user should have cause to complain that it is useless): each tab and task says what it is good for
  and what fails (`EXPECTATIVAS` in `ventana.ts`, one sentence per verdict of the table below: change them together), and Review shows a
  framed **No warranty** notice before Run: free software as is (AGPL-3.0, as in LICENSE, like all free software), no result
  guaranteed, the rented GPU bills every run, failed and cancelled ones included, until Off. Seen headless; not a lawyer's text.
- (Superseded: lego was removed from the window that evening.) Lego had proposed `acestep-v15-base` by default.

Reference audio, tried on 7-Nov and removed from the window:
- **Reference audio** field: the candidate to steer style without words, since the caption does not steer it in lego. Read in upstream
  `ca1e85f` on 7-Nov (code, not run): `GenerationParams.reference_audio` (a file path), processed for **every** task with no task gate, so
  it can go together with lego's context (`src_audio`). `io_audio.py process_reference_audio`: to 48 kHz stereo, a silent file fails the
  whole call, then exactly 30 s are taken: shorter files are looped, and three 10 s pieces are picked with `random.randint` from the
  front, middle and back thirds (so a file of exactly 30 s is used whole and deterministically: cut it to 30 s on our side). Encoded by
  the VAE (no separate timbre encoder seen). Docs: "global reference for timbre or style", "mainly controls the acoustic features"
  (timbre, mixing, performance style), not melody or rhythm (a docs claim). Not read: the DiT forward, so whether lego really uses it is
  unknown until heard. **REMOVED from the window the same evening, on request**, after it failed in lego and in cover (see
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
    - Heard: a jumble of drums, pad and some bass, not a clean bass.
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
      - `synth-pop-dark-wave` heard: a xylophone. bajo-1 was the same. Lego bass over bateria-1 without a reference gave
        a xylophone twice, with two different captions.
      - Next: a bass-only reference. Proposed: extract bass from the 30 s Ghosts Again cut (extract on bass never tried), then
        use it as the reference. The other way: a CC bass-only loop.
      - **Extract on bass works**, `ghosts-bass`, 7-Nov 19:50: base, 50 steps, `[Instrumental]`, 41 s on a GPU already on.
        - Heard: PASS, it sounds like the bass of the source song, very good, though the extraction carries some of the rest.
        - Measured: centroid 164 -> 90 Hz, above 2 kHz 1.0 -> 0.0 %, correlation 0.70 with its source (not a copy).
      - **`bass-ghostref`, 7-Nov 19:52:** lego with the extracted bass as the reference; source, seed and caption as above.
        - Measured: centroid 46 Hz, 97 % of the energy under 120 Hz, about -9 dB RMS, sounding without pause through the margin.
        - Heard: FAIL, it sounds awful, another jumble.
        - **Verdict: the reference changes lego's output a lot, but does not make a usable bass.** With a full mix it gave a mix;
          with a bass alone, a block of sub-bass. It seems to copy the sound's colour, not the playing.
        - Also, these three runs had no key or BPM, over a context of drums only: the bass had no harmony to follow.
        - Do not retry lego plus reference for bass.

Standing facts: requested: no repeated warnings about GPU cost, but say when a machine is left on. The SSH key for the GPU provider
is registered there and saved in Settings. Commits and pushes only when asked. Logs are UTC: give local times.

## 7-Nov afternoon: margin, instruction, context (built, checked on the simulated path, margin HEARD)

What was built and measured (headless Chrome on :5181, `MIUZIKA_GPU=simulado`: proves the path, not the music):
- **Margin (1)**: lego and complete send 2 bars of margin by default (silence longer, or tracks rendered further and padded with silence;
  a File source is sent as it is, no margin). Review shows "margin (bars)", editable 0-16: a change re-prepares the source. The clip is cut
  to the asked bars, the WAV keeps everything (`largoDeClip` in `src/core/tiempo.ts`). Recipe `entrega` carries `compases` and `margen`, so
  Repeat keeps the cut; older takes without them are placed whole, as before. Measured: 8 bars of silence at 120 -> 20 s source, clip 32
  beats, WAV 40; tracks bars 1-4 with the margin edited to 1 -> 10 s source, clip 16 beats, WAV 20; Repeat of it -> clip 16. Side effect:
  a tracks source asked past the project's end is now padded to the asked length (it used to be cut short). Each margin edit leaves the
  previous render in `entrada/` (`-fuente.wav`, `-fuente_2.wav`). **First A10 take with the margin, 7-Nov ~11:00**, project `bateria-1`
  (lego drums over 8+2 bars of silence, `acestep-v15-base`, 170 BPM, instruction edited by the user to "Generate the DRUMS track"): bars 1-8 at
  rms ~-19 dB (bar 8 -17.8), bar 9 only a tail (rms -39), bar 10 silent (-62); sound ends 0.1 s into bar 9. Clip 32 beats, WAV 10 bars. One
  take only. **HEARD: it reaches bar 8 inclusive.**
  Then `bajo-1` (lego bass over `bateria-1`, base, D minor, caption "bajo eléctrico, estillo punk hardcore"): sounds to bar 8.04, but
  heard: it resembles a synthesized xylophone. Measured over bars 1-8: 15 % of energy above 2 kHz, almost none at 500-2000 Hz, centroid 800 Hz
  (yesterday's `toma` basses: ~0 % above 2 kHz, centroid 66-137 Hz). `bajo-1-2` = Repeat with the same seed 4024297871 and source, only the
  caption changed to "electric bass guitar, distorted, fast punk hardcore, eighth notes locked to the kick": above 2 kHz 7.6 %, 120-500 Hz
  52 %, centroid 447 Hz, 6 dB louder. Heard: better, but not hardcore punk. So here the caption did move the timbre (one seed, one
  pair). Both clips are 9 bars: bug 24. The session stopped at ~11:25 and the GPU was shut down by the user. The drums, heard: a classic rock kit, not hardcore punk (caption "batería real, estillo punk hardcore"). Peak
  -0.0 dBFS in bar 1, normalize off: possible clipping, not heard as such.
- **Instruction (2)**: `instruccionDe` and `generar_audio.py` now build it as upstream's `generate_instruction` (read at `ca1e85f` on 7-Nov:
  `track_name.upper()`, complete joins with " | "). The simulated script received "Generate the GUITAR track based on the audio context:".
- **Context (3)**: with tracks, the form starts on Tracks with none ticked (measured: 0 of 1), so Review stops at "Choose the tracks to send";
  empty project starts on Silence.
typecheck and 175 unit tests green. Committed in 8996a73.

## Why this project exists

On 6-Nov the indeterminism of the agent version of miuzika was judged unacceptable: asking for one drum take took two attempts and gave nothing
valid. The agent refused an exact order because a tool description forbade what the code allowed, and the audio sent to
the model depended on the mute state, which nobody saw before spending GPU. Decided: copy the pieces worth keeping into a new
project: first the GUI, then the code that runs ACE-Step on a GPU provider with no intermediary. The goal was to replace the agent version.

## What exists

The GUI, separated from the agent: timeline, piano roll, openDAW playback, projects on disk, import (audio, MIDI, project
files), MP3 export, undo, mute/solo, Space = play/pause and twice = stop. Strudel and the Pad were brought over on 8-Nov; the agent, chat, Models and Sounds went with the old version. Public repository since 8-Nov.

All 14 bugs from the copy are in `BUGS.md`: 11 fixed and verified, 1 in part (long WAVs play without their effects, and the
Log says so), 2 never reproduced.

## What the user tested by ear (6-Nov, a quick pass)

| check | result |
|---|---|
| Import an audio file, it sounds | good |
| Play from the cursor | good |
| Moving a clip while playing | good |
| Mute and solo | good |
| Undo, save, reopen | good |
| MP3 export | good |
| Pause | not found at first: it is the ▶ button, which turns into ❚❚. Space was added for that |
| Space, once and twice | checked headless; the window is 0.35 s |
| MIDI | imports and sounds, but could be better (not a bug) |

Gates at that point: typecheck, 132 unit tests, openDAW contract and build green.

## The ACE-Step module (built 6-Nov; run on a real A10 and heard since 7-Nov: see "First real run" and the verdict table)

Decided with the user on 6-Nov: the app is modular and the GUI is where each module leaves its result. ACE-Step only for now, but
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
Changes against the agent version's copy: parameters travel in a JSON file (`entrada/<name>.receta.json`), not the command line; the script no
longer changes the lyrics; silence is created on the instance; control ssh capped at 20 s with one retry; `pkill` pattern fixed.

**Checked**, 6-Nov: 158 unit tests, typecheck, openDAW contract, build, and a headless run through the whole GUI against
`MIUZIKA_GPU=simulado` (the real script, with torch and ACE-Step replaced): caption and lyrics with accents, quotes and line breaks reach
the model's parameters identical; a muted track sounds in the source; tempo, undo, Repeat, Cancel, refusals. That proves the path, not the music.

ACE-Step is **pinned to `ca1e85f`** (decided 6-Nov): `REPO_COMMIT` in `generar_audio.py` and `ACESTEP_CONOCIDA` in `src/modulos/ace-step/version.ts`, tied by a
test. To move: change both once a new version has been tried by ear. The tell-tale compares upstream's `main` with it when the window opens, and each
finished take's lineage with it too. The weights are not pinned (they download apart, last changed Feb and Apr at the two repositories checked).

Known gaps: form fields are shared between tabs on purpose, so lyrics written in
Song show up in Track: visible, but check them.

## Settings (built 6-Nov, requested: no editing of `.env` by hand)

The **Settings** button holds the accounts the app rents from; which model to use stays in each module. It paints what each provider declares in
`src/core/proveedores-gpu.ts`, only Lambda so far. Keys go to `.miuzika/proveedores.json` (outside git and workspace) and only their last digits come
back; `.env` is a fallback for empty fields. Test connection only reads: API key, key file, key name in Lambda, ssh program.

## First real run (7-Nov, A10, HEARD by the user)

`lego` drums over 8 bars of silence at 116 BPM, `acestep-v15-xl-base`, no LM, seed 1097560858, ACE-Step `ca1e85f`, project folder `ace-step`, take `toma`.
Heard: electronic drums, only drums, no distortion heard unless it is the kit's own effects. So lego over silence gave the asked instrument this
once (the earlier run gave an accidental violin): one take is not a rate. Whether it sits in time at 116 was not said.
Measured: 5 min 37 s in all against ~7 min 24 s estimated (boot 241 s, install 15 s, model 17 s, generation 7 s, VRAM 11.27 GB); peak -0.0 dBFS, RMS -16.2 dBFS; 16.520 s against
16.552 s asked (ACE-Step truncates).
Worked for the first time on a real GPU: new SSH key, pinned commit, recipe file, silence on the instance, `lm none` in lego. Cancel on a real GPU, 7-Nov, about 12 s after the script started (probably still loading the model): no process left on the instance, 0 MiB of GPU memory in use, no output there, no track in the project. Same fixed seed, same machine: identical audio byte for byte (`toma-2`, `toma-2-2`, lego with xl-base), but a random seed recorded a false number (BUGS 20, fixed). Other models and another instance not measured.

**Lego over a sounding track, 7-Nov, HEARD:** bass over the drums `toma` (E minor, 116, 2 takes, 50 s). Heard: both are only bass; on the kick, probably yes; both usable. Correlation with the drums -0.002 and -0.027: no copy, unlike the strings of 5-Nov over a full mix. Neither follows the caption's "driving eighth notes" by measure (`bajo-1` spaced hits, `bajo-2` a low drone); the ear passed them anyway.

**Guitar over drums, `bajo-1` and `synth-b-3`, 7-Nov, HEARD:** take 1 does not sound like a guitar, between a synth and an electronic harp; take 2 can pass for a guitar but is nearly a bass; take 3 a guitar with effects. None respects the caption. Pattern so far in lego: the instrument mostly holds, the caption does not.

**`guitarra-i`, same as `guitarra-h` on `acestep-v15-base` instead of xl-base, 7-Nov, HEARD:** takes 1 and 3 are guitars and fit the other instruments very well, but sound nothing like the caption; take 2 does not sound good. First guitars that fit the song. Correlation with `guitarra-h` 0.11-0.23: another result, not a variation. Model load 5.6 s, generation 8.1 s, VRAM 7.07 GB. The caption still does not steer the sound on either model.

**`guitarra-h`, same recipe and seeds as `guitarra-g` with GUITAR in capitals, 7-Nov, HEARD:** take 1 a guitar, but not near the caption; take 2 a synth, and it ignores the caption too; take 3 a jumble of odd, badly assembled things. Capitals do change the audio (correlation 0.79-0.89 against 0.97-0.99 for a plain repeat) but they do not bring the caption or the instrument closer. Sent directly through the API, with the user's go.

**`guitarra-g`, Repeat of `guitarra-c` (3 takes, same seeds, source, guidance 11), 7-Nov:** not byte-identical, correlation 0.991, 0.996 and 0.973 with `guitarra-c`. So same seed repeats exactly in the one-take case measured (`toma-2`), and only nearly in this three-take batch; the cause is not known. Meant to carry GUITAR in the instruction; the recipe says lowercase, also in `guitarra-f`. Not reproduced on the simulated path, where a typed edit reaches the model.

**`guitarra-d`, instruction with GUITAR in capitals as upstream writes it, over silence, D minor, guidance 7, 1 take, 7-Nov, HEARD:** a slightly distorted guitar, reggae style, not what was sought. Sent from a form reset by a reload, so it does not compare with `guitarra-c`. Our `instruccionDe` and the script write lowercase names while upstream writes them in capitals (`task_utils.py`), and `complete` joins them with " | " (corrected that afternoon).

**`guitarra-c`, guidance 11 confirmed in the lineage, 7-Nov, HEARD:** take 1 does not respect the caption at all but sounds like a guitar; take 2 the same but it is a synth; take 3 unidentifiable. Guidance is not the way. No empty takes this time, three is too few to credit it.

**`guitarra-b`, same recipe at guidance 7 (the 11 asked for did not reach the recipe; why not checked), 7-Nov, HEARD:** take 2 ignores the caption completely, an eccentric rock guitar. Takes 1 and 3 almost empty (-57 dBFS), like `synth-b-1`: lego sometimes returns near silence and the app presents it as a good take.

**Simpler pad over drums and `bajo-1`, 7-Nov, HEARD:** `synth-b-1` rubbish (-57 dBFS); `synth-b-2` fine, but it adds rhythm, better without it; `synth-b-3` fine, nothing special. So a simple caption over fewer tracks did better than the first attempt, on one run.

**Synth over drums and two basses, 7-Nov, HEARD, did not pass:** `synth-1` an odd jumble, as if lifted from another song; `synth-2` very low, could serve, but off style and with a touch of drums. By measure `synth-1` looked promising (E minor 0.83, no copy of the source, level fine): the numbers said nothing about whether it belongs.

## Needed from the user before the first run (all done 7-Nov)

Done 7-Nov: Settings filled and Test connection passes. The API key carried over from the agent version was dead (401), and its SSH key no longer existed in Lambda: a new key was created and registered, with no passphrase because the server runs ssh with nobody to type it. The default key name in `proveedores-gpu.ts` and `lambda.ts` is stale but overridden.

## Direction for the song (the user, 7-Nov)

Rejected: a whole song from text2music, then separated: control from scratch is wanted. After 13 lego takes with context, lego does not follow the caption at guidance 7 (11 run later, `guitarra-c`: no better) and fits unevenly.

## What ACE-Step can and cannot do: the verdict so far (written 7-Nov afternoon, on request)

Only the user's ear counts as a verdict here; sources: the agent version's ACE-Step test log of 5-Nov (not in this repository) and the sections of this
file from "First real run" (7-Nov). Update this table when a new verdict arrives, instead of letting it scatter again.

| task | verdict by ear | model | source |
|---|---|---|---|
| complete (voice -> band) | PASS, very good | xl-base | 5-Nov test 7 |
| cover 0.6 with lyrics | PASS: turbo has a voice, piano with fewer notes; sft very industrial, liked a lot (preferred). Without lyrics: no voice | xl-turbo, xl-sft | 5-Nov tests 4, 4b, 8 |
| extract vocals | PASS on the 2nd try, only the voice is heard | xl-base | 5-Nov test 2b |
| extract bass from `vein-1`, bars 1-24 | NOT GOOD, but the source is to blame: by ear, vein-1 does not make clear whether there is a bass. Measured like the good `ghosts-bass` (highs gone, centroid 286 -> 80 Hz, correlation 0.57). Extract needs a distinct line in the mix. xl-base (the window's default), 95 s | xl-base | 7-Nov 20:22 |
| cover of `vein-1`, bars 1-24, strength 0.6, caption pushed to "harsher and dirtier" industrial | HALF. Heard: synth-pop, nice, but NOT more industrial or dirtier. It keeps the song and sounds good, but the caption's push did not reach the sound, like the style in lego. Seed 7111, 70 s run. **Correction, 7-Nov night:** its recipe and lineage carry the plain `vein` caption, with no "harsher/dirtier" words: the push was never sent, so this says nothing about the caption steering a cover. Retested as `p01`/`p02` in project `pruebas` | xl-sft | 7-Nov 20:41 |
| cover with reference: `vein-cover-ref`, the `vein-cover-1` recipe plus Ghosts Again 1:24-1:54 | FAIL. Heard: a rather shrill jumble of instruments. Same source (sha 09df95507fff) and seed. Measured: 5.5 dB louder, stereo narrowed to the reference's (-5.0 -> -9.1 dB side), correlation 0.61 with the cover without reference. A full-mix reference pulls the mix and makes a jumble, as it did in lego. A first try went to a stray project at 120 BPM without the reference (bug 26) | xl-sft | 7-Nov 20:58 |
| cover with a really dirty caption (`pruebas` p01 at 0.6, p02 at 0.3; "Harsh, dirty industrial dark wave… overdriven… bitcrushed… saturated… noise"), seed 7111, `vein-1` bars 1-24 | FAIL for the style. Heard: it is a cover, but not dirty the way an industrial song is dirty; the keyboards are shrill, and that is not dirt; p02 the same. Measured: strength 0.6/0.3 both in the lineage, yet p01-p02 correlation 0.89 (strength barely moved the result; neither closer to the source: 0.36/0.38). Against `vein-cover-1` (same seed, plain caption) 0.78: the dirty words changed it a little, towards harsh keys, not dirt. The caption does not steer a cover's style either | xl-sft | 7-Nov 22:01 |
| cover-nofsq 0.6 (`pruebas` p03), plain `vein` caption, seed 7111 | PASS-ish. Heard: fine, a little pop, but from bar 14 it improves towards classic dark synth pop. Measured: correlation with its source 0.71, against 0.32 for `vein-cover-1` (cover, same inputs): nofsq stays much closer to the song | xl-sft | 7-Nov 22:03 |
| repaint bars 9-12 of `vein-1` bars 1-24 (`pruebas` p04, plain caption, seed 7111, range 20.87-31.30 s) | Heard: fine; the melody from about bar 14 is good, similar but with a nice touch, like a synthesized saxophone. Measured per bar against the source: bars 1-8 and 13-24 identical (correlation 1.00, 0.0 dB), bars 9-12 new (0.00-0.33, +1 to +2 dB). The range is obeyed exactly. So what was heard from bar ~14 is vein-1's own material. Asked, the repainted part was then heard: a very short orchestral turn at bar 10 or 11 that makes it very different. Verdict: PASS for range control (exact, seamless enough to be noticed only as a short orchestral turn); what it paints is the model's choice | xl-turbo | 7-Nov 22:04 |
| extract keyboard from `vein-1` bars 1-24 (`pruebas` p05) | PASS, it seems to have worked | base | 7-Nov 22:05 |
| extract percussion, same source (p06) | FAIL: confused with what p05 extracted, because that keyboard is very rhythmic. A rhythmic keyboard reads as percussion | base | 7-Nov 22:06 |
| complete over `vein-drums` (an extract) with BASS, SYNTH, KEYBOARD (p07) | FAIL, awful, a huge jumble. Complete passed only from a voice (5-Nov); from an extracted drum track it made a jumble. One take | xl-base | 7-Nov 22:08 |
| cover-nofsq 0.3 (`pruebas` p15), plain `vein` caption, seed 7111 | PASS: dark synth pop, fine, liked. Correlation with the source 0.66 | xl-sft | 7-Nov 23:00 |
| cover-nofsq 0.8 (p16), same inputs | Heard: the same as p15. Measured between the three nofsq takes (0.3, 0.6, 0.8, same seed): 0.97-0.99. **In nofsq the strength does almost nothing** (in cover 0.6 vs 0.3 gave 0.89). To change a nofsq take, change the seed, not the strength | xl-sft | 7-Nov 23:01 |
| repaint bars 9-16 (p17), plain caption, seed 7111 | PASS, the change is heard, though by ear it seemed to last until about bar 18. Measured: bars 17-23 identical to the source (correlation 1.00), so samples change only in 9-16; hearing it to 18 may be the source's own phrase sounding different after the new part, or the count. Range obeyed on 4 and 8 bars | xl-turbo | 7-Nov 23:03 |
| extract synth / drums from `vein-1`, bars 1-24 | HALF: extract is usable, but only halfway. Synth: vein-1 has several synths and it pulled the least present one. Drums: the opening came out as something that is not drums, then a kit quite like vein-1's. No vocals heard in vein-1 to extract | base | 7-Nov evening |
| extract drums | FAIL / partial (a jumble with leftovers). A real separator (Demucs or similar) is the honest tool | xl-base | 5-Nov tests 3, 3b |
| lego over silence or a few tracks | NOT STEERABLE. Heard, 7-Nov evening: everything that came out well had barely followed the caption. The takes kept were what the model chose, not what was asked. The instrument holds sometimes; bass over bateria-1 failed 5 of 5 (xylophone x2, pad mix, sub block, "not punk"). The reference changes it a lot without making it usable. Best case: drums over silence | base, xl-base | 7-Nov |
| lego over a full mix | FAIL: strings came back as a track with voice and everything | xl-base | 5-Nov |
| lego / repaint with a range | the rest came back as a copy of the source | — | 5-Nov |
| text2music | good full songs (very industrial, very good), but not for one instrument: the LM completes a song, negations prime what they deny. **7-Nov 20:07, project `vein`:** a detailed English caption (483 chars: instruments, drums, production, no negations), 92 BPM, D minor, 4/4, 180 s, 2 takes. Heard: very good, good examples of the prompt given. The LM kept the caption, BPM, key and duration. Seeds 782922162/3, 220 s run | xl-turbo + LM 1.7B | 2-Nov, 5-Nov evening, 7-Nov |
| text2music with sung English lyrics: `vein-voz`, the `vein` recipe changing only lyrics (the user's imagery, `[Verse]`/`[Chorus]`/`[Bridge]`) and language `en`, seed 782922162 (vein-1's) | HALF. Heard: both are whole songs different from vein-1; the voices do not follow the caption's style, they are mainstream pop voices with that genre's effects; the music of both is very good, but it is not what was sought. Same seed with new lyrics gives another song, not vein-1 with a voice: the LM re-plans from the lyrics. The voice was not drowned by the caption's "wordless choir"; the caption never describes a lead voice, so the model sang its default pop. Recipe checked in the lineage: every value as asked. 152 s run | xl-turbo + LM 1.7B | 7-Nov 21:20 |
| text2music, `vein-voz-b`: `vein-voz` by Repeat changing only the caption: choir phrase out, "Low baritone male lead vocal, detached and half-spoken, cold monotone delivery, dry and close with light distortion" in, near the front (493 chars, checked in the lineage) | FAIL for the voice. Heard: both are whole songs with instruments; take 1 moves a little away from pop, but it is not the voice in mind and not close; take 2 the same. Two runs, four takes: describing the voice in the caption does not bring the wanted voice. Do not retry caption wording for the voice without a new idea | xl-turbo + LM 1.7B | 7-Nov evening |
| text2music without the LM (`pruebas` p08): the `vein` recipe and seed 782922162 with `lm none` | PASS as a song. Heard: it came out well; it does not sound industrial but the song is fine, though it borders on MIDI-like. 56 s run against ~150 s with the LM | xl-turbo | 7-Nov 22:09 |
| text2music with BPM and key empty (p09), LM 1.7B, `vein` caption and seed | Heard: almost dance music, with a dark touch, but dance. The LM chose **125 BPM, E minor** (lineage): the tempo it picks for this caption is a dance tempo. Give the BPM when the feel matters | xl-turbo + LM 1.7B | 7-Nov 22:11 |
| text2music on xl-sft (p10): `vein` recipe and seed, LM 1.7B, 50 steps, guidance 7 | Heard: more industrial, but also dance, rave, and very like vein. At 92 BPM (lineage), so the dance feel is not the tempo here. Sample correlation with vein-1 is 0.05: that measure cannot see musical likeness between two generations; the shared LM plan (same seed, caption, LM) is the likely reason it sounds alike, a hypothesis | xl-sft + LM 1.7B | 7-Nov 22:14 |
| text2music on xl-base (p11): `vein` recipe and seed, LM 1.7B, 50 steps, guidance 7 | PASS as a song, not the style: fine too, not industrial. 213 s run, the slowest | xl-base + LM 1.7B | 7-Nov 22:18 |
| text2music on turbo (non-xl, p12): `vein` recipe and seed, LM 1.7B | PASS as a song, not the wanted style: listenable | turbo + LM 1.7B | 7-Nov 22:55 |
| text2music on sft (non-xl, p13): `vein` recipe and seed, LM 1.7B | HALF: more industrial, but badly produced for seconds at a time, with occasional glitches. sft leans industrial on both sizes (p10 xl-sft too); the small one has glitches | sft + LM 1.7B | 7-Nov 22:57 |
| text2music on base (non-xl, p14): `vein` recipe and seed, LM 1.7B | HALF, the closest to the wanted style so far: at times excellent, industrial and hard-hitting, at other times with glitches. Small models (sft, base) reach the industrial sound but glitch; xl models are clean but softer | base + LM 1.7B | 7-Nov 22:59 |
| text2music, caption without dance words (p18): `vein` caption with arpeggio, plucks, hi-hats, claps, tight, gated out and "slow, heavy, dragging, lumbering", sparse heavy drums in; 92 BPM, seed 782922162 | It left dance, but went to film score. Heard: like an instrumental film soundtrack, repetitive, accompaniment for a scene. The words do move the genre (first caption change that did), just not to the wanted song | xl-turbo + LM 1.7B | 7-Nov 23:06 |
| text2music with **LM 4B** (`pruebas-4b`, 8-Nov), `vein` recipe and seed 782922162 | **q01 xl-sft: PASS, the best so far: very good, and the choirs make it.** q02 base and q04 sft: FAIL, as if the notes were cut off shortly after starting, the melody above all (the small models glitch with 1.7B too, p13/p14). q03 xl-turbo: fine, but it leans more to synth pop. **Recipe to start from: xl-sft + LM 4B.** One seed per model. **q05, same recipe, 3 new seeds (589740696/7/8):** take 1 PASS, liked, reminiscent of other industrial bands (also the loudest, RMS -12.5 dB); takes 2 and 3 film soundtracks, somewhat overloaded: 3 has the caption's wordless choir almost all the time, tiring and excessive; 2 tries to be industrial but at times many sounds pile up. **Rate with this recipe: 2 of 4 takes good (q01 and one q05).** Caution, found 8-Nov: in `pruebas-4b` the q05 tracks sit in the order x3-3, x3-2, x3-1, and re-heard alone the file `x3-1` is the one with the choirs all the time; so the q05 verdicts probably map to files in reverse (the good one = `x3-3`), and the r04 pairing may flip too. Left unsettled on the user's word (it does not matter). Hypothesis, not tried: the caption lists many layers (choir, pad, arpeggio, plucks, lead, 7 drum parts), and some seeds use them all at once | xl-sft / base / xl-turbo / sft + LM 4B | 8-Nov 07:52-07:58 |
| r01 xl-base + 4B (`pruebas-4b`, vs p11 xl-base + 1.7B, fine but not industrial) | Heard: fine, not exciting, passable: about the same as with 1.7B | xl-base + LM 4B | 8-Nov 08:39 |
| r02 xl-sft + 4B, BPM and key empty (vs p09, dance at 125) | Heard: more like an industrial rap backing, but rap. The lineage records no BPM chosen by the LM this time (p09's did: 125), so the tempo is unknown. Empty tempo still drifts away from the wanted style | xl-sft + LM 4B | 8-Nov 08:41 |
| r04 xl-sft + 4B, fewer layers, q05's seeds (take n pairs with q05-n) | take 2: a soundtrack, somewhat industrial, with some glitches (q05-2 was the one where sounds pile up). Take 1: glitches at times, while q05-1 on the same seed passed: **fewer layers made the good seed worse.** Take 3: industrial, very like one heard before, fine (q05-3 was the overloaded choir one: fewer layers helped this seed). Net: 1 of 3 good, as with the full caption; it moves which seed works, not the rate | xl-sft + LM 4B | 8-Nov 08:45 |
| r05 xl-sft + 4B, q01's recipe and seed with section tags and no words in the lyrics (`[Instrumental]`, [Intro]…[Outro]) | Heard: an industrial soundtrack, fine too. Against q01 (very good, the choirs), the tags changed the song towards film score. **The sections follow the tags (one take):** heard: pads and bass first, drums at ~10, everything at 21, a drop and a return, a partial stop, everything back with force, and a closing descent. Measured per bar at 92 BPM (69 bars): intro 1-8 quieter, bridge dip 53-56, strongest 58-64, outro 65-68 at -27 dB then silence. The bar numbers given by ear run ×1.3 of these (84 by ear = bar 65): the listening grid was likely at 120 BPM | xl-sft + LM 4B | 8-Nov 08:47 |
| **text2music, one instrument per track, LM 4B** (`pruebas-4b` s01-s04, the original idea): xl-sft, 60 s, 92 BPM, D minor, seed 4242, 2 takes, positive captions "Isolated … track: a single … playing alone … stem for mixing" | **s01 drums: PASS, only drums, with something very subtle at the end of some hits, acceptable; take 2 tries to add some pads as rhythm, but acceptable as drums (2 of 2).** First time text2music gave one instrument alone (with 1.7B on 2-5 Nov it completed a song). s02 bass take 1: PASS, a bass, somewhat electric, with touches of choir; take 2: FAIL, a synth bass, but it adds drums and pads, no use as a single track. Bass 1 of 2. s03 pad: PASS 2 of 2, only pad. s04 lead: take 1 FAIL, several instruments (percussion, lead and synth); take 2 PASS, only lead synth. **Total 6 of 8 takes were one instrument alone (drums 2/2, bass 1/2, pad 2/2, lead 1/2): with 2 takes per instrument, the one-track-per-instrument idea is reachable with xl-sft + 4B.** Not checked: whether the stems fit together (same tempo and key asked, each generated apart) | xl-sft + LM 4B | 8-Nov 09:03 |
| r03 xl-sft + 4B, caption without dance words (vs p18, same caption on xl-turbo + 1.7B: a repetitive soundtrack) | Heard: certainly not dance; a film soundtrack, almost horror, very dark; fine, but not as a song. Taking the dance words out pushes to film score on both LMs; the 4B makes it darker | xl-sft + LM 4B | 8-Nov 09:08 |
| extract from q01 / q05-1 (`pruebas-4b` r-ext-*, base, whole 180 s songs; heard in `escuchar-4b`) | q01 bass: PASS, it is the song's bass, synthesized as it is. q01 keyboard: HALF, it is the keyboard, but the choirs came along and some bass too: hard to separate. q01 synth: the same as keyboard, which makes sense; measured keyboard-synth correlation 0.95 (the model treats both words as the same part in a synth song). q01 drums: PASS-ish, a little synth came along at the start (better than drums from vein-1 or the 5-Nov mixes). q01 nofsq: brighter than the original, but very similar. q05-1 (file `x3-1`): bass PASS, a synth bass, the original song's; synth and keyboard very alike again; nofsq very like the original with another brightness. **Pattern on two songs: bass and drums come out clean, keyboard = synth (one synth block with what else is around), nofsq = same song, other colour** | base | 8-Nov |
| repaint | range control works; heard: the same, a little more; level then falsified by our -6 dB master (fixed) | xl-turbo | 5-Nov test 5 |

**The weak point: style in lego.** The instrument mostly comes out, the caption's style almost never: 16 guitars on 7-Nov, none followed
it; on 7-Nov afternoon neither drums nor bass sounded "punk hardcore". Sometimes another instrument (bass like a xylophone, guitars like synth
or harp) and sometimes a near-silent take (-57 dBFS). One counter-sign: same seed, an English caption moved the bass timbre a lot (better, not
punk), one pair only. Rough share of lego takes kept: between one in three and two in three (a count over the verdicts, not a measure).

**Tested 7-Nov evening:** the reference audio in lego. It steers the sound hard but not usefully (see "Reference audio" above).
**Extract bass: PASS** (it sounds like the song's bass, a little bleed), base, 7-Nov.

**Lego dropped from the app on request, 7-Nov evening. Done, committed the same evening:**
- Track is complete only. Silence went with lego.
- Repeat lists no lego takes, though every take still counts for the names in use.
- The script still runs lego, so old lineages stay readable.
- The extract text now says that voice and bass are good.
- Extract's default instrument was drums when untouched, while the form showed vocals; now it is vocals.
- Checked headless. Was proposed: lego on `acestep-v15-base`, first track over silence, each next
one over a few finished tracks, English caption with positive words only, 2-3 takes per track to keep one.

## Then: validate ACE-Step

Requested: validate whether ACE-Step creates songs correctly with all its functions and models. Tasks by models, same
material, the user's ear as the verdict. Earlier results and measurements: the agent version's test log of 5-Nov (not in this repository).

- Passed by ear on 5-Nov: `complete` (voice -> band), `extract` vocals, `cover` (turbo 0.6 with lyrics; sft 0.6).
- Failed or partial: `extract` drums; `lego` strings over a sounding mix.
- text2music completes a song even when asked for drums alone: negations in the caption prime the words they deny.

**The musical goal:** a dark wave / synth pop song, sinister, dirty, at moments industrial, mid-tempo, nihilistic English
lyrics, **one track per instrument and one for the voice, mixed by the user**. Not a finished mix from the model.

**Answered 7-Nov:** `lego` over real silence gives one instrument: drums twice, heard (only drums for `toma`; `bateria-1` a classic
rock kit). See the verdict table above.

## Outside this folder

- Lambda: the last A10 was shut down on 6-Nov 18:54 (confirmed). One old instance has been listed as "terminating"
  for a year: a provider fault, it does not bill.
