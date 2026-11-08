# STATUS — 7-Nov-2026 (evening)

## START HERE

Carlos, 7-Nov: **"hay que evitar tener que pasar de nuevo por dónde ya hemos pasado"**. Before proposing a test or a feature, read
"What ACE-Step can and cannot do" below: it holds every verdict by ear so far. When a new verdict or conclusion arrives, write it there
in the same session, not at the end.

**8-Nov: ACE-Step test phase CLOSED.** Carlos: "esas pruebas ya no las haremos, dejaremos que sean los intentos reales de los
usuarios". Do not propose more ACE-Step tests (shared chords for stems, more structure seeds, more solo instruments, repaint of
glitches, MIDI dressed by cover): they stay as ideas below, for users to find. Recipe that came out best: text2music on xl-sft + LM 4B
with the `vein` caption at a given BPM; stems by describing one instrument alone; bass/drums by extract. GPU shut down after it (89 s).

**8-Nov, decided by Carlos: non-commercial models are allowed, with disclaimers.** "Este proyecto es experimental, y como tal y
poniendo los disclaimers podemos usar modelos como MuLaCover". Conditions agreed: each such module states its licence before Run;
each take's lineage records the licence; the notice also reminds that a third-party source (a known song) has its own rights; if
miuzika ever becomes a paid service, these modules are reviewed. YuE2 and MusicGen become candidates on these terms.
**8-Nov: building the MuLaCover and Demucs modules** (his "adelante con mulacover. adelante con demucs").
Built: windows in Modules (`web/src/modulos/{mulacover,demucs}/ventana.ts`, shared `comun.ts`), pure recipes with tests
(`src/modulos/{mulacover,demucs}/receta.ts`), GPU scripts `generar_mulacover.py` (pinned e27fa7f) and `separar_demucs.py` (demucs 4.0.1,
torch 2.5.1), `entregarMidi` in the host. Windows checked headless to Review (licence and warranty shown). Real runs on the A10:
Demucs htdemucs 2 min with install, htdemucs_ft 86 s, htdemucs_6s 81 s (6 stems), Ghosts Again original 68 s; MuLaCover from MIDI with
drums 437 s. **Heard: Demucs on Ghosts Again original, PASS: "lo ha hecho muy bien para ghosts-orig-stems".** mc-ghosts-ft (htdemucs_ft on
the MuLaCover cover): "cada pista hace lo suyo", PASS, and **"mc-ghosts-ft es más limpio que stems"** (htdemucs): ft is the better default; it took 86 s
here, about the same as htdemucs, not the 4x its README warns of (one 3-min song). Proposed: make htdemucs_ft the window's default. **htdemucs_6s: "guitar y bass no sirven"** (on the cover, which has no real
guitar): it invents them from the synths. Note agreed for the window ("ok"): "Six stems: only for songs with real guitar or piano;
on synth music it invents them." **Applied 8-Nov on his word**: htdemucs_ft first and default, notes updated. GPU shut down after the
tests (77 s, instance 11ffcde3…). The temporary `probar_heartmula.py` and `probar_mulacover.py` were deleted on his word ("si no se
usan se pueden borrar"); HeartMuLa's two install fixes are written above, if it is ever tried again.
MuLaCover from MIDI (Ghosts Again's transcribed melody+chords+drums, his lyrics, industrial style, seed 42), `mc-midi-drums`: "es
completa, tiene muchos instrumentos, mucho más pop y comercial, también tiene voz". From MIDI it still goes pop, like from audio. `mc-midi-sin-drums` (no drum MIDI): "completa también, con batería": without a drum
MIDI it writes its own drums; the drum MIDI is optional for real. `mc-desde-heartmula` (source: HeartMuLa's pop take hm-darkwave-1,
same lyrics and industrial style): "no es un estilo que a mí me parezca ni dark, industrial, dark synth pop". **MuLaCover keeps the
melody and sings the lyrics, but its style ignores the style text: 4 of 4 takes came out pop.** Outputs are always audio (Carlos: the
mc-midi-* takes "no son midi": right, they are WAVs made *from* MIDI).

**8-Nov: Stable Audio researched (his "adelante con ese… lanza un test").** Read: HF cards of stable-audio-3-medium and -small-music,
their LICENSE.md, github.com/Stability-AI/stable-audio-3 (README, inference and prompting docs). Not run yet.
- Family (May 2026): `small-music` 433M (CPU-capable, 120 s), `small-sfx`, `medium` 1.4B (GPU + Flash Attention 2, up to 380 s,
  ~6.5 GB VRAM), Large API-only. Stereo 44.1 kHz. Instrumental: "don't output intelligible vocals". Stems/solo instruments supported
  (`TrackType: Instrument`). BPM only as text ("120 BPM"); no key, no melody conditioning. Audio-to-audio (`init_audio`,
  `init_noise_level`), inpainting and continuation. Defaults: steps 8, cfg 1.0 (7.0 "for stronger prompt adherence"), duration 120.
- Licence: code MIT; weights **Stability AI Community License**: free for research, personal and commercial use under US$1M annual
  revenue (commercial use asks for registration at stability.ai/community-license); **outputs are the user's**; no use to train
  another foundation model; also the Gemma Terms (text encoder T5Gemma), not read.
- **Blocker: the weights are gated.** Downloading needs a Hugging Face account that accepted the terms, and its token. None found
  here (no HF key in .env, no local token). Carlos must create/accept and give a token (to keep server-side, like the Lambda key).
  **Solved 8-Nov:** his token from `info.txt` on his VPS, copied (never printed) to `miuzika-new/.miuzika/hf_token.txt` (git-ignored);
  he accepted the medium terms and gave the token gated read access. For the trial Claude copied it by ssh to
  `~/.cache/huggingface/token` on the instance; the app never carried it.
- **First trial, 8-Nov 13:15**, project `stableaudio-prueba`, temporary `workspace/gpu/probar_stableaudio.py` (790793b, flash-attn
  2.6.3 wheel cu126/torch2.7): drums, synth bass (30 s) and an instrumental song (120 s), 92 BPM, seed 7111, each at cfg 1 and 7.
  Install + download only ~13 s of script time beyond boot; each take ~24 s with the model reloaded every time. Output 44.1 kHz.
  Measured: cfg 7 takes are much louder (RMS -6.7 to -9.8 dB against -16 to -18 at cfg 1, peaks at 0 dBFS): likely distorted.
  **Heard by Carlos: `sa-song-cfg1` "es super industrial... wow!!!" — the first model that lands his style.** bass cfg1 "suena a bajo"
  (PASS), bass cfg7 "una mezcla de cosas, no es sólo bajo, es también synth"; drums cfg1 "percusión, puede pasar", drums cfg7 "también
  es percusión industrial". cfg 1 (the default) is the better setting; song cfg7 "está super saturada" (as measured: RMS -7.3 dB). **Use cfg 1.**
  Second listen, same day: drums cfg1 "es batería", drums cfg7 "también, pero sobresaturada"; bass cfg1 "es un bajo", bass cfg7 "parece
  más bien un didgeridoo sobresaturado". So cfg 7 saturates on every kind (drums, bass, song), as the RMS said; cfg 1 gives the asked instrument.
  `sa-song-cfg1` on second listen: "es muy industrial, me gusta muchísimo aunque le falta melodía". Ideas not tried yet: ask for a lead
  in the text ("with a lead synth melody"), or put a melody on top from another module (ACE-Step track, MIDI by hand).
- **8-Nov: Stable Audio module built** (his "párala pero desarrolla el módulo con todas las funcionalidades"): window in Modules
  (from text: song / one instrument / sound effect / free; transform audio; repaint bars; continue), Review with the composed prompt
  editable, licence and cost; `generar_stableaudio.py` (790793b, Python API, model loaded once, takes as one batch); the Hugging
  Face token saved in **Settings** (`.miuzika/proveedores.json`, never returned) and copied by the server to the instance only for
  this script (`secretos` in `ejecutarEnLambda`, scp of a temp file, mode 600). Windows checked headless for all four tasks.
- **Real runs through the app's path, 8-Nov 14:17-14:36** (`stableaudio-prueba`, all cfg 1): two drum takes in one batch (1.6 s
  of generation; model load 46 s the first time, 18 s after); transform `sa-song-cfg1` at change 0.7 (65 s; correlation with the
  source 0.05: a new piece); repaint bars 13-16 (106 s; correlation with the source 0.995 before, 0.87 inside, 0.97 after: outside
  is kept, only through the codec); continue the 30 s bass to 60 s (81 s; first 30 s at 0.998); small-music song (76 s). Not heard yet.
  Heard by Carlos: `sa2-repintar` "es super parecida a la última que escuché que me gustó tanto" (`sa-song-cfg1`, its source), as
  expected: only bars 13-16 are new. Whether the change at those bars is audible was not said.
  `sa2-continuar`, `sa2-drums-x2-1`, `sa2-drums-x2-2` and `sa2-small`: "pegan juntas, y son lo que dicen, el estilo total no es el que
  más me gusta pero bueno pegan". PASS on doing what was asked and fitting together; style below `sa-song-cfg1`. `sa2-transformar`
  (change 0.7 over `sa-song-cfg1`): "también es muy buena". Every task of the module passed by ear. Committed dd3deff.
- **Form with every detail** (Carlos: "stable audio es un buen candidato... ahora a programar el formulario con todos los detalles
  que se puedan"; melody test not wanted). Read at 790793b (model.py, dit.py, prompting.md, inference.md, Gradio): several repaint
  regions in one pass ("5-8, 13-16"), one prompt per take (variation lines), empty prompt allowed (the guide's unconditional and
  no-prompt continuation), Genre/Instruments tags, Duo kind, the guide's example prompts, change-amount presets (0.1/0.4/0.6/0.7/0.9
  from the guide and our run), duration in bars, Advanced (steps, cfg, APG, sampler), and the -base checkpoints (50 steps, cfg 7,
  euler/rk4/dpmpp; not gated on HF; not run). **Found in dit.py: guidance only runs when cfg != 1, so at the default cfg 1 the
  negative prompt does nothing**: the form and Review say so. small-sfx is gated too and was missing from the Settings check.
  Checked headless on the simulated GPU (every task to Review, no page errors). **Not run on the GPU yet**: variations, several
  regions, APG, base models. Committed 58cb11d.

**8-Nov: Basic Pitch (audio → MIDI) tried, locally, no GPU** (Carlos: "probemos basic pitch... prueba con alguna canción que hayamos
creado que me haya gustado"). spotify/basic-pitch 0.4.0 (PyPI, Aug-2024; repo at fa5997a, Nov-2025), **Apache 2.0**. On Windows with
Python 3.12 its pip metadata asks for tensorflow<2.15.1 (no 3.12 wheels): installed `--no-deps` plus onnxruntime 1.31.1, librosa,
pretty-midi, resampy, `setuptools<81` (resampy needs pkg_resources); it then runs the bundled `nmp.onnx` on CPU. Knobs (inference.py):
onset threshold (0.5), frame threshold (0.3), minimum note length (127.7 ms), min/max frequency, multiple pitch bends, melodia trick, MIDI tempo.
- `sa-bass-cfg1` (30 s): 1.8 s on CPU; default 13 notes, all D1, long. **pyin agrees: 99% of frames are D1**: the bass is a drone, so
  this is right. Lower thresholds 0.3/0.2: 39 notes, still D1; 0.2/0.1: 902 notes of junk (E6, E7...).
- `sa-song-cfg1` (full distorted mix, 115 s): 3.4 s; default only 47 notes, 90% silent. 0.3/0.2: 513 notes, mostly C#2, B2, G#2, D#2
  (a consistent set); 0.2/0.1: 9693 notes of junk. On a full mix it needs a separation first (Demucs), as expected.
- Files in `stableaudio-prueba/generado/`: `bp-sa-bass-cfg1.mid`, `bp-sa-song-cfg1.mid` (default), `bp-*-sensible.mid` (0.3/0.2).
  **Heard by Carlos: "no valen nada"** (the four MIDI). Basic Pitch on Stable Audio's distorted material: FAIL. No module built.

**8-Nov: Strudel module brought from old miuzika** (Carlos: "hay que añadir el módulo de strudel que estaba en la versión antigua").
In Modules: a pattern rendered to WAV in the browser with the real engine (`web/src/modulos/strudel/`, the old strudel-audio.ts and
strudel-source.ts), heard in the window, then added as an audio track at a chosen bar, clip = the bars asked. No GPU. Packages as old:
@strudel/* 1.2.6 / webaudio, soundfonts, superdough 1.3.0 (latest). Patterns kept per project folder in localStorage. Five examples.
Two bugs of the old code found in the headless run (it had never been run, per the old ESTADO): (1) the effects controller came from a
second copy of superdough (`superdoughoutput.mjs` vs the bundled dist) with no context set: room/delay/distort failed with "different
audio context" and the delay arpeggio was silent; (2) superdough's private node pools reuse filters etc. from the previous render's
dead OfflineAudioContext. Fixed: the library builds its own controller, and stale pooled nodes read as collected during a render.
Measured after: the 5 examples, then three again, all sound with no warnings. Renders peaked up to +6.6 dBFS (909 kit): turned down to
-1 dBFS before the WAV. Added one as a track headless: 4 bars on the grid, waveform drawn. **Not heard by Carlos yet.** Committed 6ee39da.

**8-Nov: MIDI-LLM module** (Carlos reviewed what old miuzika had: "vamos primero con proponer_midi", named "MIDI-LLM", import
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
  **Heard by Carlos: "no valen para nada".** FAIL. Like Basic Pitch: the numbers said it followed the text; the ear says no.
  **Module removed on his word** ("sí quítalo"); it stays in c8383df. `entregarMidi`'s start bar and per-proposal naming stay.

**8-Nov: instrument picker for MIDI tracks** (Carlos: "¿y el selector de instrumentos para midi?"). Nothing in the GUI changed a
track's instrument: an imported .mid without program played GM 0 (piano) for good. Now the instrument line of a MIDI track head
("Synth bass 1 ▾", "Drums · Room ▾") opens a picker: search, the 128 GM programs by family, the 12 kits of GeneralUser GS's bank 128
(read from its preset headers: Standard 1-3, Room, Power, Electronic, 808/909, Dance, Jazz, Brush, Orchestral, SFX), openDAW's 5
synths. A click applies `set_instrument` live (undoable; a playing engine is mounted again); kits listed first on a drum track; a
note warns that drum hits play as pitches on a melodic instrument. `src/core/instrumentos.ts` with tests. Checked headless: melody
→ Synth bass 1, drums → Room, Ctrl+Z back to Standard 1, Play without errors. One bug found there and fixed: a search kept from
another track hid the kits. **Not heard by Carlos yet.** GS variation banks (1-26, e.g. "Acid Bass", "808 Tom") are not offered:
the engine only picks bank 0 and 128.

**8-Nov: Export menu: MP3, WAV, MIDI** (Carlos: "¿los exports de midi y wav??"). The exporter already wrote all three (old agent's
tools); only MP3 had a button. The header's MP3 button became an **Export** menu. Checked headless on MuLaCover's melody + drums
(melody set to Synth bass 1, drums to 808/909): MIDI 2 tracks at 114.796 BPM, read back with midi_lector: melody program 38, drums
channel 10 kit 25; WAV 3:55, peak +1.7 dBFS (the Log says CLIPPING: lower the master); MP3 320 kbps, 9.0 MB. No page errors.
Then Carlos: "si selecciono un wav y pulso midi… ¿qué hará?". Read in the code: Export ignores the selection; a project of audio alone
wrote an EMPTY .mid and the Log said "0 track(s)"; audio tracks were left out silently. Fixed: no MIDI tracks with notes → nothing
written and it says why; mixed → the .mid plus a Log line naming the audio tracks left out. Both also open a notice window with
"Don't show this again" (his "tiene que informar… y un check de no volver a aparecer"; `aviso-unico.ts`, localStorage); the Log
line stays always. Checked headless: window, ticked, no window the second time, Log line still there.

**8-Nov: Basic Pitch on CLEAN stems** (before building "To MIDI", which Carlos asked about: "transcribe to midi cómo se haría?").
Demucs stems of Ghosts Again (original), CPU, 6-9 s each: **bass** (30-400 Hz) 1,423 notes, pitch classes E, D, C#, F# as pyin
(pyin: E1, D1, C#1, F#1), but often doubled an octave up (polyphony median 2 on a one-note line): a "bass" mode that keeps the
lowest note gives 590 notes (`bp-ghosts-bass-mono.mid`); **vocals** (80-1200 Hz) 341 notes, 68% silent (the gaps between lines),
G#, A, C#, F#, B, E; **other** 1,994 notes, polyphony median 3. Files in `heartmula-prueba/generado/bp-ghosts-*.mid`.
**Heard by Carlos: "está lejos de ser perfecta pero puede ayudar a componer".** PASS as a composing aid, on clean stems. Building
"To MIDI" on it: kinds Bass (lowest note kept), Melody, Chords/pad, Other (raw); Drums refused (Basic Pitch is pitch only).
- **Built, 8-Nov:** select ONE audio track → "To MIDI" in the selection bar → kind, sensitivity (thresholds 0.6/0.4, 0.5/0.3,
  0.4/0.25), shortest note, snap (off, 1/8, 1/16). Each clip is transcribed for the part of its WAV it plays
  (`workspace/herramientas/transcribir.py`) and its notes land where the clip is, in a new MIDI track "<name> (MIDI)" with an
  instrument for the kind (bass → GM 38, melody → 81, chords → 89, other → 0); the .mid stays in generado/. Basic Pitch in its own
  venv `.miuzika/basic-pitch/` (made on first use by `server/api/transcribir.ts`, --no-deps + the versions of the trial; 464 MB).
  Headless on the Ghosts bass stem: first run 132 s (install included), transcription 7 s, 590 notes of 1,423 heard, C#1-E3 (the
  same as the hand-made mono file Carlos heard). Drums: button off with the reason. **Not heard by Carlos in the app yet.**
  Committed 7902f74.

**8-Nov: Pad (the touchpad as an instrument) brought from old miuzika** (Carlos: "antes de eso traéte el código de touchpad",
before renaming this folder to miuzika and deleting the old one). There it came from humseed and was never exercised. Brought as
it was: `workspace/herramientas/touchpad/` (Raw Input capture, Windows Precision Touchpad), `server/api/pad.ts` (now also refuses
other origins, bug 16), `src/core/pad.ts` with its tests (drum pad names now in English), `web/src/pad.ts`, a Pad button in the
header. The transport gained `prepararMotor` (the engine loaded, stopped) for the live notes; a structural change unloads that
engine so the next note picks up the new instruments. Checked headless with the real touchpad: the panel opens, the capture starts
and says ready, tracks and modes listed (drums → Pads), closing stops the capture, a foreign Origin gets 403. **Not armed and not
played** (arming freezes the cursor): to be tried by Carlos.

**8-Nov: HeartMuLa researched for a module of its own (Carlos: "documéntate de heartmula para hacer su propio formulario").**
Read from heartlib at `5858ca8` (8-Oct-2026, shallow clone, nothing run) and the HF cards. Nothing designed or built yet.
- Licence: code and all weights Apache 2.0 (since 20-Jan-2026).
- Models: HeartMuLa-oss-3B (14-Jan), HeartMuLa-RL-oss-3B-20260123 ("more precise control over styles and tags"),
  **HeartMuLa-oss-3B-happy-new-year** (13-Feb, the one they recommend); HF metadata says "4B params" for the 3B cards. 7B: internal only,
  "not released yet". HeartCodec-oss-20260123 (2B, decoder, 48 kHz stereo) + HeartCodec-oss-encoder. HeartTranscriptor-oss (0.8B, lyrics
  ASR). HeartCLAP (text-audio embedding). **MuLaCover** (16-Sep, separate repo): cover/remix from reference audio *or melody/chord MIDI*,
  genre and instruments by text: close to his "MIDI dressed by cover" idea, not read yet.
- Inputs: `lyrics` (sections `[Intro] [Verse] [Prechorus] [Chorus] [Bridge] [Outro]`), `tags` (comma-separated, no spaces, e.g.
  `piano,happy,wedding`); both **lower-cased by their own code** and tags wrapped in `<tag>…</tag>`. `max_audio_length_ms` (script default
  240000, pipeline 120000), `topk` 50, `temperature` 1.0, `cfg_scale` (README and pipeline say 1.5, the example script 3.0: conflict).
  No seed parameter, no BPM or key fields, no reference audio yet (TODO, a `muq_embed` slot exists). Output 48 kHz.
- Speed "RTF ≈ 1.0" (a 3-min song ≈ 3 min). VRAM not stated; `--lazy_load` for one GPU. Python 3.10 recommended, torch <2.11,
  transformers 4.57.0, torchtune 0.4.0.

**8-Nov: first HeartMuLa trial on the A10** (his "ok" to the prompt), project `heartmula-prueba`, temporary script
`workspace/gpu/probar_heartmula.py` (untracked, to delete). Tags `darkwave,deep,male,dark,synthesizer,night`, his lyrics with
[Intro]…[Outro], happy-new-year 3B, 180 s asked, topk 50, temperature 1.0, seed 7111, cfg 1.5 and 3.0. Two install fixes needed on the
instance: `pyarrow<18` (torchtune 0.4.0 -> old datasets uses pa.PyExtensionType), and torchaudio.save wants torchcodec, so our script
writes the WAV with soundfile (16-bit, 48 kHz). Measured: HeartMuLa 12.7 GB and codec 6.2 GB of VRAM (loaded in turn, peak 13.7 GB);
take 1 (cfg 1.5) 153 s of audio in 136 s, peak 0.0 dBFS; take 2 (cfg 3.0) 102 s in 81 s: **both stopped before the 180 s asked**
(the model ends on its own). Boot 260 s; install + 22 GB download ~5 min. **Heard (quickly): FAIL. Carlos: "no tienen casi nada de
los tag, son canciones pop románticas".** Same failure as ACE-Step's voice (pop by default), and worse on style. One prompt, two takes.
**8-Nov: MuLaCover trial** (his "sí pruébalo", as a private experiment: its weights and outputs are **CC BY-NC 4.0**, commercial use
forbidden by its LICENSING.md, so it cannot enter the app as is). Temporary script `workspace/gpu/probar_mulacover.py` (untracked, to
delete), MuLaCover `e27fa7f`. Source: Ghosts Again MP3 (his file, now "DM" in Downloads), his lyrics, style
`topic:[Isolation]; genre:[industrial]; instrument:[synthesizer,drum machine]; mood:[dark]`, seed 42. Worked with the default PyPI torch
(no CUDA 13 needed) + `pyarrow<18`; install + 16 GB of models in <30 s on an instance already on. It transcribed the source to
melody/chord/drum MIDI (bpm.txt 114.8) and generated 195.6 s in 397 s, peak 14.7 GB VRAM. First try cut at 320 s by our launcher
(Node fetch aborts after 300 s without data; the server took it as Cancel): any client of /api/gpu/ejecutar must tolerate long silences.
MIDI kept in `heartmula-prueba/generado/mc-ghosts-midi/`. **Heard: PASS-ish. Carlos: "el cover está bien, con la letra y todo, es
más pop y la voz no es tan sugerente como la de DM, es más convencional, pero saber que se puede hacer esto vale la pena... aunque eso sí
habría que indicar que no se puede usar para comercial".** First model that sang his lyrics over a known song's melody and chords.
If it ever enters the app: say plainly, before Run, that MuLaCover's outputs are non-commercial (CC BY-NC 4.0). Nothing decided.

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
- **Tests left (proposed 7-Nov night, his choice; recommended first: 1):**
  1. DONE 7-Nov 21:20, `vein-voz`: good music, but other songs than vein-1 and a mainstream pop voice (see the verdict table).
     Then `vein-voz-b`, the voice described in the caption: "no se acerca". The caption does not steer the voice.
     **Voice closed, Carlos 7-Nov night: "de voz nada más... sabemos que la voz se puede solicitar para canciones completas y ya
     está".** Do not propose more voice tests (cover with lyrics, complete from his voice): voice = text2music full songs, as is.
  **7-Nov night, Carlos: "crea un proyecto nuevo tú, y haz las pruebas, al terminar cargaré los wavs" ("no has de cambiar el
  código, sólo probar").** Project `pruebas` (no tracks; he imports the WAVs). Run by Claude through `/api/gpu/ejecutar`, one after
  another, same recipe shape as the window (script in the session scratchpad, not in the repo). p01-p02 cover with a dirty caption at
  0.6/0.3, p03 cover-nofsq, p04 repaint bars 9-12, p05-p06 extract keyboard/percussion, p07 complete over vein-drums, p08 text2music no
  LM, p09 no BPM/key, p10-p14 the other five text2music models (seed 782922162, as vein-1), p99 Cancel during the DiT. Test 9 (his MIDI
  dressed by cover) left out: it needs his notes. Results below as they come.
  Run 22:00-22:19: p01-p11 done, a WAV each in `pruebas/generado/`, none heard yet. Times: covers 69-90 s, repaint 56 s, extracts 62-74 s,
  complete 70 s, t2m no LM 56 s, t2m no BPM/key 150 s, xl-sft 166 s, xl-base 213 s. At 22:19 Claude Code killed the launcher (machine
  low on memory), which the server took as Cancel of p12 about 32 s into the script: no file left. p12-p14 and p99 still to run.
  **Heard by Carlos the same night, in short:** good songs from text2music on every model tried (xl-turbo with and without LM,
  xl-sft, xl-base), none really industrial; no BPM -> the LM picks 125 (dance). Caption does not steer style in cover either (p01/p02).
  cover-nofsq stays close to the song and passed. Repaint obeys the range exactly. Extract keyboard passed, percussion confused with
  it. Complete over extracted drums: jumble. Pattern across tasks: **ACE-Step keeps structure well; style words barely move it.**
  Carlos on the whole: **"tira hacia canción de baile"**: with this dark synth-pop/industrial caption it leans to dance (p09 at 125,
  p10 "rave", even at 92 BPM). Words that pull away from dance are the next thing to try, if any.
  **Second batch, 22:47-23:05 (new A10 `bcb2c8c3…`, boot+install+p12 in 7 min 47 s):** p12 turbo 467 s with the boot, p13 sft 131 s, p14
  base 149 s, p15 nofsq 0.3 66 s, p16 nofsq 0.8 60 s, p17 repaint bars 9-16 73 s, then p18 (caption without dance words: "slow, heavy,
  dragging, lumbering", sparse heavy drums; arpeggio, plucks, hi-hats, claps, tight, gated taken out; 496 chars, seed 782922162, 92 BPM).
  **Cancel during generation, p99 (600 s on xl-base, no LM), cut 75 s into the script, PASS:** right after, no `generar_audio` process
  on the instance, 0 MiB GPU memory, only the uploaded recipe left there; no WAV brought back, no track. Heard: none of these yet.
  p18 done 23:06, 112 s. Measured: p17 obeys its range (bars 1-8 and 17-23 at correlation 1.00, 9-16 new). nofsq correlation with its
  source: 0.66 at 0.3, 0.71 at 0.6, 0.72 at 0.8: strength barely moves it, as in cover (p01/p02). GPU shut down at his request
  after he heard all 18 (Lambda confirmed in 88 s, instance bcb2c8c3…). Next session ("mañana probamos más"), proposed: repaint the
  glitches of p14 with base (he gives the bars), and the LM 0.6B and 4B on xl-sft.
  **8-Nov: LM 0.6B discarded** (Carlos: "no hagamos pruebas con 0.6B, descartado"). Searched the web first: no user reports or A/B of
  the LM sizes; upstream says same data, 0.6B = low-VRAM option, 4B "strong" for composition and understanding; their numbers are all
  with 1.7B. Running the 4B in project `pruebas-4b` (q01-q04: the `vein` recipe and seed on xl-sft, base, xl-turbo, sft, so each pairs
  with p10, p14, vein-1, p13). Risk noted: xl + 1.7B already used ~14 GB of the A10's 22.
  Run 8-Nov 07:46-07:58: all four done. The 4B fits: q01 xl-sft peak 11.3 GB (lineage). Times: q01 392 s with boot and 4B download,
  q02 base 90 s, q04 sft 92 s, q03 xl-turbo 83 s (its first try failed on "ssh cut off after 20 s" at sync, as guitarra-f on 7-Nov;
  retried alone, fine). With the 4B the runs were faster than with 1.7B (base 90 s vs 149 s; why not known). GPU on.
  q05 (his "dale"): q01's recipe, 3 takes, random seed -> seeds 589740696/7/8 (lineage), 241 s, 8-Nov 08:15. Not heard yet.
  Carlos 8-Nov: the 4B "funciona mejor que el 1.7B y ha de ser el modelo por defecto", choosable, 0.6B out. Planned in receta.ts
  (LMS without 0.6B, text2music default 4B, `none` kept). **DONE 8-Nov ~08:43 on his "sí"**: LMS = 4B, 1.7B, none (4B first in the
  Review selector); typecheck and 178 unit tests green. **Seen by him in Review: "confirmado que se ve el 4b".**
  Two "ssh cut off after 20 s" on 8-Nov's instance (q03 at sync, r03 at upload), both retried; watch whether the 20 s cap is too tight.
  **r* batch, 8-Nov, his "haz todas las pruebas que puedas… para tener una comparación"**, all paired with an earlier take:
  r01 xl-base+4B (vs p11), r02 xl-sft+4B without BPM/key (vs p09), r03 xl-sft+4B without dance words (vs p18), r04 xl-sft+4B with fewer
  layers (no arpeggio/plucks, "an occasional" choir, 4 drum parts) on q05's seeds 589740696/7/8, r05 xl-sft+4B with section tags and no
  words (`[Instrumental]` then [Intro]…[Outro]) on q01's seed; extract bass/keyboard/synth(/drums) from q01 and q05-1 (base); nofsq 0.6 of
  q01 and q05-1 (xl-sft, seed 7111). Not done: repaint of the crowded bars (needs his bars).
  **s* batch, queued after r*: his original idea, "a ver si el 4B es capaz de crear sólo tracks de instrumentos por separado".**
  text2music xl-sft + LM 4B, 60 s, 92 BPM, D minor, seed 4242, 2 takes each, one positive caption per instrument ("Isolated … track:
  a single … playing alone … Solo … recording … stem for mixing", no negations): s01 drums, s02 bass, s03 pad, s04 lead. Before (1.7B,
  2-5 Nov): text2music completed a song when asked for drums alone, and negations primed what they denied.
  **Carlos's conclusion, 8-Nov: "4B funciona mejor que 1.7B, pero hay que seguir informando de que es algo experimental y podría
  causar gastos en alquiler de GPU que no fueran productivos".** The window's texts (EXPECTATIVAS, SIN_GARANTIA in ventana.ts) are
  stale against 7/8-Nov verdicts. **Updated 8-Nov on his "me parecen bien, haz el cambio"**: "Experimental: results vary…, many takes
  may be needed" opens the No-warranty notice; text2music (one instrument possible, style words weak, give BPM, several takes), cover
  (caption barely changes style), cover-nofsq (close to source, strength ~nothing, change seed), repaint (exact range), extract (+keyboard
  good, percussion confused), complete (+jumble from extracted drums). typecheck and 178 tests green. **Seen by him: "he visto los textos, los veo bien".**
  **Heard 8-Nov, the news: text2music with xl-sft + LM 4B gives one instrument per track, 6 of 8 takes (s01-s04).** Next to try:
  put one good take of each in a project and hear whether they fit together. **Done by him: "encajan algo, no mucho"; s04-2 (lead)
  "no encaja nada, tiene su propio ritmo".** Measured (crude numpy, no librosa installed): all stems sit in D minor by pitch classes
  (bass A D E Bb, pad A D G F, lead-2 D F A C); lead-2 has the strongest 92 BPM periodicity of all (0.69). So key and tempo match by
  measure; the likely misfit is that each stem was generated apart with its own chord changes, phrasing and downbeat. Proposed, not
  tried: write the same chord progression in every stem's caption (e.g. "chord progression Dm - Bb - F - C, one chord per bar"), and
  nudge a stem in the timeline to its downbeat.
  Heard again in `escuchar-4b` (8-Nov ~10:00): p18 (1.7B, no dance words) "también es banda sonora ambiental o atmosférica, algo
  industrial y misteriosa" (he first named it q01 by mistake, then corrected: "no, p18 sin baile 1.7b").
  **Heard: q01 (xl-sft + 4B) is the best take so far** ("muy buena, el punto de los coros es total"); see the verdict table.
  **Estimate against real (test 7, 7-Nov night, GPU already on; `estimar` in receta.ts, computed by hand, code not touched):**
  covers/extract/complete with a 12 MB source: estimated ~219 s, real 62-90 s; repaint turbo ~203 s, real 56 s. text2music 180 s with
  LM: turbo ~171 s, real 150 s; xl-sft ~220 s, real 166 s; xl-base ~220 s, real 213 s; no LM ~101 s, real 56 s. Cause of the big miss:
  upload is taken at 110 kB/s (109 s for 12 MB) but measured 12 MB in 20-38 s (`gpu_aviso` stamps), ~0.3-0.6 MB/s. Estimates run high,
  never low. Proposed, not done (no code tonight): upload at ~400 kB/s.
  GPU shut down at his request, 7-Nov ~22:33, confirmed by Lambda in 95 s (instance 6a4393f4…). The rest needs a new boot (~4-5 min).
  2. Cover at strength 0.3: the `vein-cover-1` recipe changing only that, to see whether the caption's "dirtier" then lands.
  3. Repaint 4-8 bars of `vein-1`, never judged by ear.
  4. text2music on xl-sft / xl-base against xl-turbo: same caption and seed.
  5. text2music with LM none; 6. cover-nofsq. Both never run.

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

1. DECIDED 8-Nov: Carlos deleted and recreated github.com/ccarrillomanzanares/miuzika; this repo was pushed there (`master` →
   `main`, 18 commits, d69bd2e). History checked for keys before pushing: none. The old miuzika folder is gone; this one is `miuzika`.
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
| cover of `vein-1`, bars 1-24, strength 0.6, caption pushed to "harsher and dirtier" industrial | HALF. Carlos: "suena synth-pop, es chula, pero NO es más industrial y sucia". It keeps the song and sounds good, but the caption's push did not reach the sound, like the style in lego. Seed 7111, 70 s run. **Correction, 7-Nov night:** its recipe and lineage carry the plain `vein` caption, with no "harsher/dirtier" words: the push was never sent, so this says nothing about the caption steering a cover. Retested as `p01`/`p02` in project `pruebas` | xl-sft | 7-Nov 20:41 |
| cover with reference: `vein-cover-ref`, the `vein-cover-1` recipe plus Ghosts Again 1:24-1:54 | FAIL. Carlos: "un pegote de instrumentos bastante estridente". Same source (sha 09df95507fff) and seed. Measured: 5.5 dB louder, stereo narrowed to the reference's (-5.0 -> -9.1 dB side), correlation 0.61 with the cover without reference. A full-mix reference pulls the mix and makes a jumble, as it did in lego. A first try went to a stray project at 120 BPM without the reference (bug 26) | xl-sft | 7-Nov 20:58 |
| cover with a really dirty caption (`pruebas` p01 at 0.6, p02 at 0.3; "Harsh, dirty industrial dark wave… overdriven… bitcrushed… saturated… noise"), seed 7111, `vein-1` bars 1-24 | FAIL for the style. Carlos: "es un cover, pero no es sucio en el sentido de cómo puede ser sucia una canción industrial... tiene estridencia de teclados pero eso no es suciedad"; p02 "es igual". Measured: strength 0.6/0.3 both in the lineage, yet p01-p02 correlation 0.89 (strength barely moved the result; neither closer to the source: 0.36/0.38). Against `vein-cover-1` (same seed, plain caption) 0.78: the dirty words changed it a little, towards harsh keys, not dirt. The caption does not steer a cover's style either | xl-sft | 7-Nov 22:01 |
| cover-nofsq 0.6 (`pruebas` p03), plain `vein` caption, seed 7111 | PASS-ish. Carlos: "está bien, un poco pop, pero a partir del compás 14 mejora hacia synth pop estilo depeche mode". Measured: correlation with its source 0.71, against 0.32 for `vein-cover-1` (cover, same inputs): nofsq stays much closer to the song | xl-sft | 7-Nov 22:03 |
| repaint bars 9-12 of `vein-1` bars 1-24 (`pruebas` p04, plain caption, seed 7111, range 20.87-31.30 s) | Carlos: "está bien, la melodía a partir del compás 14 +/- está bien, es similar pero le da un toque chulo, se parece a un saxofón sintetizado". Measured per bar against the source: bars 1-8 and 13-24 identical (correlation 1.00, 0.0 dB), bars 9-12 new (0.00-0.33, +1 to +2 dB). The range is obeyed exactly. So what he heard from bar ~14 is vein-1's own material. Asked, he then heard the repainted part: "tiene un rollo orquestado muy corto en el compás 10 u 11 que lo hace muy diferente". Verdict: PASS for range control (exact, seamless enough to be noticed only as a short orchestral turn); what it paints is the model's choice | xl-turbo | 7-Nov 22:04 |
| extract keyboard from `vein-1` bars 1-24 (`pruebas` p05) | PASS, "parece que ha funcionado" | base | 7-Nov 22:05 |
| extract percussion, same source (p06) | FAIL: "se confunde con lo que se ha extraído en p05, por ese teclado es muy rítmico". A rhythmic keyboard reads as percussion | base | 7-Nov 22:06 |
| complete over `vein-drums` (an extract) with BASS, SYNTH, KEYBOARD (p07) | FAIL, "fatal, pegote descomunal". Complete passed only from a voice (5-Nov); from an extracted drum track it made a jumble. One take | xl-base | 7-Nov 22:08 |
| cover-nofsq 0.3 (`pruebas` p15), plain `vein` caption, seed 7111 | PASS: "dark synth pop, está bien, me gusta". Correlation with the source 0.66 | xl-sft | 7-Nov 23:00 |
| cover-nofsq 0.8 (p16), same inputs | "es igual que p15". Measured between the three nofsq takes (0.3, 0.6, 0.8, same seed): 0.97-0.99. **In nofsq the strength does almost nothing** (in cover 0.6 vs 0.3 gave 0.89). To change a nofsq take, change the seed, not the strength | xl-sft | 7-Nov 23:01 |
| repaint bars 9-16 (p17), plain caption, seed 7111 | PASS, the change is heard. Carlos: "sí ha hecho un cambio pero el cambio dura hasta el compás 18 creo". Measured: bars 17-23 identical to the source (correlation 1.00), so samples change only in 9-16; hearing it to 18 may be the source's own phrase sounding different after the new part, or the count. Range obeyed on 4 and 8 bars | xl-turbo | 7-Nov 23:03 |
| extract synth / drums from `vein-1`, bars 1-24 | HALF. Carlos: "extract se puede usar pero a medias". Synth: vein-1 has several synths and it pulled the least present one. Drums: the opening came out as something that is not drums, then a kit quite like vein-1's. No vocals heard in vein-1 to extract | base | 7-Nov evening |
| extract drums | FAIL / partial ("pegote con restos"). A real separator (Demucs or similar) is the honest tool | xl-base | 5-Nov tests 3, 3b |
| lego over silence or a few tracks | NOT STEERABLE. Carlos, 7-Nov evening: "todo lo que ha salido bien, no siguió casi el caption". The takes he kept were what the model chose, not what was asked. The instrument holds sometimes; bass over bateria-1 failed 5 of 5 (xylophone x2, pad mix, sub block, "not punk"). The reference changes it a lot without making it usable. Best case: drums over silence | base, xl-base | 7-Nov |
| lego over a full mix | FAIL: strings came back as a track with voice and everything | xl-base | 5-Nov |
| lego / repaint with a range | the rest came back as a copy of the source | — | 5-Nov |
| text2music | good full songs ("muy industrial, muy bueno"), but not for one instrument: the LM completes a song, negations prime what they deny. **7-Nov 20:07, project `vein`:** a detailed English caption (483 chars: instruments, drums, production, no negations), 92 BPM, D minor, 4/4, 180 s, 2 takes. Carlos: "están muy bien, son buenos ejemplos para el prompt que le dimos". The LM kept the caption, BPM, key and duration. Seeds 782922162/3, 220 s run | xl-turbo + LM 1.7B | 2-Nov, 5-Nov evening, 7-Nov |
| text2music with sung English lyrics: `vein-voz`, the `vein` recipe changing only lyrics (his imagery, `[Verse]`/`[Chorus]`/`[Bridge]`) and language `en`, seed 782922162 (vein-1's) | HALF. Carlos: "las dos son canciones enteras distintas de vein-1. Las voces no siguen el estilo del caption, son voces mainstream pop, con efectos de esos estilos... la música de esas dos canciones está muy bien, pero no es lo que buscábamos". Same seed with new lyrics gives another song, not vein-1 with a voice: the LM re-plans from the lyrics. The voice was not drowned by the caption's "wordless choir"; the caption never describes a lead voice, so the model sang its default pop. Recipe checked in the lineage: every value as asked. 152 s run | xl-turbo + LM 1.7B | 7-Nov 21:20 |
| text2music, `vein-voz-b`: `vein-voz` by Repeat changing only the caption: choir phrase out, "Low baritone male lead vocal, detached and half-spoken, cold monotone delivery, dry and close with light distortion" in, near the front (493 chars, checked in the lineage) | FAIL for the voice. Carlos: "ambas son canciones enteras con instrumentos, la 1 se sale algo del pop, no es lo que tengo en mente", then "no se acerca"; take 2 the same. Two runs, four takes: describing the voice in the caption does not bring his voice. Do not retry caption wording for the voice without a new idea | xl-turbo + LM 1.7B | 7-Nov evening |
| text2music without the LM (`pruebas` p08): the `vein` recipe and seed 782922162 with `lm none` | PASS as a song. Carlos: "ha salido bien… no suena a industrial pero la canción está bien, aunque roza el midi". 56 s run against ~150 s with the LM | xl-turbo | 7-Nov 22:09 |
| text2music with BPM and key empty (p09), LM 1.7B, `vein` caption and seed | Carlos: "una música de baile casi, con algún toque oscuro pero de baile". The LM chose **125 BPM, E minor** (lineage): the tempo it picks for this caption is a dance tempo. Give the BPM when the feel matters | xl-turbo + LM 1.7B | 7-Nov 22:11 |
| text2music on xl-sft (p10): `vein` recipe and seed, LM 1.7B, 50 steps, guidance 7 | Carlos: "es más industrial pero también es de baile, de rave y es muy parecida a vein". At 92 BPM (lineage), so the dance feel is not the tempo here. Sample correlation with vein-1 is 0.05: that measure cannot see musical likeness between two generations; the shared LM plan (same seed, caption, LM) is the likely reason it sounds alike, a hypothesis | xl-sft + LM 1.7B | 7-Nov 22:14 |
| text2music on xl-base (p11): `vein` recipe and seed, LM 1.7B, 50 steps, guidance 7 | PASS as a song, not the style: "está bien también, no es industrial pero está bien". 213 s run, the slowest | xl-base + LM 1.7B | 7-Nov 22:18 |
| text2music on turbo (non-xl, p12): `vein` recipe and seed, LM 1.7B | PASS as a song, not his style: "bueno, no es de mi estilo, pero se puede escuchar" | turbo + LM 1.7B | 7-Nov 22:55 |
| text2music on sft (non-xl, p13): `vein` recipe and seed, LM 1.7B | HALF: "más industrial, pero no está bien producida por segundos, de vez en cuando tiene pegotes". sft leans industrial on both sizes (p10 xl-sft too); the small one has glitches | sft + LM 1.7B | 7-Nov 22:57 |
| text2music on base (non-xl, p14): `vein` recipe and seed, LM 1.7B | HALF, the closest to his style so far: "a ratos es buenísima, industrial y cañera, pero a otros ratos tiene pegotes". Small models (sft, base) reach the industrial sound but glitch; xl models are clean but softer | base + LM 1.7B | 7-Nov 22:59 |
| text2music, caption without dance words (p18): `vein` caption with arpeggio, plucks, hi-hats, claps, tight, gated out and "slow, heavy, dragging, lumbering", sparse heavy drums in; 92 BPM, seed 782922162 | It left dance, but went to film score: "parece para banda sonora instrumental de película, repetitiva y de acompañamiento para una escena". The words do move the genre (first caption change that did), just not to his song | xl-turbo + LM 1.7B | 7-Nov 23:06 |
| text2music with **LM 4B** (`pruebas-4b`, 8-Nov), `vein` recipe and seed 782922162 | **q01 xl-sft: PASS, the best so far: "muy buena, y el punto de los coros es total".** q02 base and q04 sft: FAIL, "como si las notas se cortaran al poco de lanzarse, sobre todo la melodía" (the small models glitch with 1.7B too, p13/p14). q03 xl-turbo: "está bien pero tira más a synth pop". **Recipe to start from: xl-sft + LM 4B.** One seed per model. **q05, same recipe, 3 new seeds (589740696/7/8):** take 1 PASS, "está bien, me gusta, me recuerda a cosas de otras bandas industriales" (also the loudest, RMS -12.5 dB); takes 2 and 3 "bandas sonoras de película, algo sobrecargadas": 3 has the caption's wordless choir "casi todo el rato… como si fueran espíritus… cargante, excesivo", 2 "intenta ser industrial pero a ratos se agolpan muchos sonidos". **Rate with this recipe: 2 of 4 takes good (q01 and one q05).** Caution, found 8-Nov: in `pruebas-4b` the q05 tracks sit in the order x3-3, x3-2, x3-1, and re-heard alone the file `x3-1` "es aquella que intentaba poner coros todo el rato"; so his q05 verdicts probably map to files in reverse (the good one = `x3-3`), and the r04 pairing may flip too. He said "da igual"; not settled. Hypothesis, not tried: the caption lists many layers (choir, pad, arpeggio, plucks, lead, 7 drum parts), and some seeds use them all at once | xl-sft / base / xl-turbo / sft + LM 4B | 8-Nov 07:52-07:58 |
| r01 xl-base + 4B (`pruebas-4b`, vs p11 xl-base + 1.7B "está bien, no industrial") | "está bien, no mata, pero pasa": about the same as with 1.7B | xl-base + LM 4B | 8-Nov 08:39 |
| r02 xl-sft + 4B, BPM and key empty (vs p09 "de baile" at 125) | "más bien base de rap industrial, pero rap". The lineage records no BPM chosen by the LM this time (p09's did: 125), so the tempo is unknown. Empty tempo still drifts away from his style | xl-sft + LM 4B | 8-Nov 08:41 |
| r04 xl-sft + 4B, fewer layers, q05's seeds (take n pairs with q05-n) | take 2: "banda sonora, algo industrial pero algunos pegotes" (q05-2 was "se agolpan muchos sonidos"). Take 1: "pegotes a ratos", while q05-1 on the same seed passed: **fewer layers made the good seed worse.** Take 3: "industrial, me recuerda a una de las que oí antes, es muy parecida, está bien" (q05-3 was the overloaded choir one: fewer layers helped this seed). Net: 1 of 3 good, as with the full caption; it moves which seed works, not the rate | xl-sft + LM 4B | 8-Nov 08:45 |
| r05 xl-sft + 4B, q01's recipe and seed with section tags and no words in the lyrics (`[Instrumental]`, [Intro]…[Outro]) | "banda sonora industrial, está bien también". Against q01 ("muy buena, los coros"), the tags changed the song towards film score. **The sections follow the tags (one take):** he heard pads and bass first, drums at ~10, "todo" at 21, a drop and a return, "para un poco pero no del todo", back "con fuerza todo", and "baja cerrando". Measured per bar at 92 BPM (69 bars): intro 1-8 quieter, bridge dip 53-56, strongest 58-64, outro 65-68 at -27 dB then silence. His bar numbers run ×1.3 of these (his 84 = bar 65): his grid was likely at 120 BPM | xl-sft + LM 4B | 8-Nov 08:47 |
| **text2music, one instrument per track, LM 4B** (`pruebas-4b` s01-s04, his original idea): xl-sft, 60 s, 92 BPM, D minor, seed 4242, 2 takes, positive captions "Isolated … track: a single … playing alone … stem for mixing" | **s01 drums: PASS, "sólo batería, muy sutilmente se detecta algo al final de algunos sonidos, pero es aceptable"; take 2 "intenta meter algo de pads a modo rítmico, pero es aceptable como batería" (2 of 2).** First time text2music gave one instrument alone (with 1.7B on 2-5 Nov it completed a song). s02 bass take 1: PASS, "es un bajo, algo eléctrico, que tiene toques de coro"; take 2: FAIL, "bajo sintetizado, pero mete batería y pads, no sirve como pista suelta". Bass 1 of 2. s03 pad: PASS 2 of 2, "sólo pad". s04 lead: take 1 FAIL, "hay varios instrumentos, percusión, lead y synth"; take 2 PASS, "sólo lead synth". **Total 6 of 8 takes were one instrument alone (drums 2/2, bass 1/2, pad 2/2, lead 1/2): with 2 takes per instrument, his one-track-per-instrument idea is reachable with xl-sft + 4B.** Not checked: whether the stems fit together (same tempo and key asked, each generated apart) | xl-sft + LM 4B | 8-Nov 09:03 |
| r03 xl-sft + 4B, caption without dance words (vs p18, same caption on xl-turbo + 1.7B: "banda sonora… repetitiva") | "no es de baile sin duda, es banda sonora de película casi de terror, muy oscura, está bien pero no como canción". Taking the dance words out pushes to film score on both LMs; the 4B makes it darker | xl-sft + LM 4B | 8-Nov 09:08 |
| extract from q01 / q05-1 (`pruebas-4b` r-ext-*, base, whole 180 s songs; heard in `escuchar-4b`) | q01 bass: PASS, "yo creo que bien, es el bajo de la canción aunque sea un bajo sintetizado". q01 keyboard: HALF, "también lo es, y también se han venido los coros, también lleva algún bajo... es difícil separar". q01 synth: "igual que keyboard, lo que tiene sentido"; measured keyboard-synth correlation 0.95 (the model treats both words as the same part in a synth song). q01 drums: PASS-ish, "se ha traído algo de synth, pero poco, al principio" (better than drums from vein-1 or the 5-Nov mixes). q01 nofsq: "más brillante que la original, pero es muy parecida". q05-1 (file `x3-1`): bass PASS, "un bajo sintetizado, el de la canción original"; synth and keyboard "muy parecidas" again; nofsq "muy parecida a la original con otro brillo". **Pattern on two songs: bass and drums come out clean, keyboard = synth (one synth block with what else is around), nofsq = same song, other colour** | base | 8-Nov |
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
