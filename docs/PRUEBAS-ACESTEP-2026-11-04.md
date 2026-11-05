# ACE-Step tasks — test session, 4-Nov-2026 (night)

What to run on a real Lambda instance now that every checkpoint and task is wired (see
`PLAN.md`, "Built 4-Nov-2026, night"). Carlos chose (4-Nov, 21:57 UTC) to test on a song the
agent generated from his own brief: "crea una canción parecida a ghosts again de depeche mode
en inglés". The agent (DeepSeek v4.1 flash, ACE-Step box ticked) created the project
**still-here** (118 BPM, A minor, 8 bars) and called `generar_audio` with `duracion 210`,
`variantes 2`, `idioma en`, a synth-pop caption and full English lyrics (intro, two verses,
pre-choruses, choruses, bridge). Instance launched 20:57:25 UTC. Everything below is run on
the take Carlos prefers, called **T** (`still-here-1` or `still-here-2`).

Numbers that matter: at 118 BPM in 4/4 a bar lasts 2.034 s; 210 s are 103.3 bars; bar k
starts at (k-1) × 2.034 s. Bars 1-32 are 65.1 s.

## Status at the end of 4-Nov

Test 0 ran: both takes came back (numbers in `ESTADO.md`, `generar_audio` row). After that the agent,
with the full tool list again, deleted take 2 from the project, muted take 1 and composed in MIDI; Carlos
cancelled, pressed Off and stopped. **Tomorrow**: open `still-here`, listen to `still-here-1` first (unmute it,
mute the MIDI tracks or delete them), bring take 2 back if wanted ("Añade con anadir_pistas el wav
generado/still-here-2.wav desde el compás 1"), then tests 1-10 with `fuente 'still-here-1'`. First run of the
day pays boot and install again.

## Rules of the session

- The "ACE-Step" box **unticked** from now on (it narrows the turn to four tools; the follow-up
  prompts name the tool and its arguments explicitly).
- Keep the instance on; "⏻ Off" at the end. xl-base downloads its weights on its first run.
- Each tool result ends "NOT heard by anyone yet": the ear decides. Note `model load`,
  `generation`, `VRAM peak` from each result and one sentence by ear.
- Base runs 50 steps: the stem tests cut the source to bars 1-32 so a run stays in minutes.

## Tests, in order

| # | test | model | source | expected | result |
|---|---|---|---|---|---|
| 0 | the two takes (running) | xl-turbo | — | two audio tracks at bar 1, ~3:30 each; the project grows past 8 bars; English vocal | 5-Nov, HEARD: see "Results, 5-Nov" |
| 1 | refusals, no GPU time | default | — | three refusals in ms, no second boot | |
| 2 | extract vocals, bars 1-32 | xl-base | T | unmuted voice-only track at bar 1, ~65 s; weights download; VRAM | |
| 3 | extract drums, bars 1-32 | xl-base | T | drums-only track at bar 1 | |
| 4 | cover 0.6, bars 1-32, stripped version | xl-turbo | T | MUTED track at bar 1, 65 s, bars aligned with T | |
| 5 | repaint 4 bars Carlos picks | xl-turbo | T | MUTED whole-length track; only those bars differ | |
| 6 | lego: strings over the song, bars 1-32 | xl-base | mix (= T alone) | unmuted strings stem at bar 1 | |
| 7 | complete from the extracted vocals | xl-base | voz | accompaniment track at bar 1, 65 s | 5-Nov, HEARD: PASS ("está muy bien") |
| 8 | sft cover (optional) | xl-sft | T | 50 steps; time and ear vs 4 | 5-Nov: ran on the 2nd attempt (ssh hang on the 1st). **HEARD PASS**, preferred over 4b; see results |
| 9 | cancel during a base run | xl-base | mix | `cancelado: true` in `tmp/herramientas.log`, no track | 5-Nov: PASS twice (during the source render; during the upload, `cancelado: true` at 68 s, request "closed"). The GPU phase itself was never cancelled: 3 tries, 3 earlier phases |
| 10 | ⏻ Off | — | — | off within ~90 s | 5-Nov 22:14-22:16: **PASS**, Lambda confirmed in 81 s (`apagada: true`), the instance is gone from the state; only the year-old ghost "terminating" A100 remains |

### Prompts (Spanish, as Carlos writes)

0. Already sent. Check: both takes present, play whole (3:30), project length grew, vocal in
   English and baritone as the caption asked. Mute the take not chosen.
1. "Con generar_audio, tarea extract, fuente 'T', pista 'drums', nombre 'x'. No cambies el modelo." →
   xl-turbo cannot do extract, use xl-base. · "Con generar_audio, tarea cover, nombre 'x', prompt 'piano'." →
   give `fuente`. · "Con generar_audio, tarea lego, fuente 'mix', pista 'batería', modelo acestep-v15-xl-base,
   nombre 'x', prompt 'strings'." → no track "batería", list of twelve.
2. "Con generar_audio, tarea extract, fuente 'T', desde_compas 1, hasta_compas 32, pista 'vocals', modelo acestep-v15-xl-base, nombre 'voz'."
3. "Con generar_audio, tarea extract, fuente 'T', desde_compas 1, hasta_compas 32, pista 'drums', modelo acestep-v15-xl-base, nombre 'bateria'."
4. "Con generar_audio, tarea cover, fuente 'T', desde_compas 1, hasta_compas 32, fuerza 0.6, prompt 'stripped-down version: solo grand piano and intimate baritone vocal, slow, cathedral reverb, 118 bpm', nombre 'cover-piano'."
5. "Con generar_audio, tarea repaint, fuente 'T', desde_compas N, hasta_compas N+3, prompt '<the agent's caption, shortened: mid-tempo British synth-pop, warm analog pads, plucked arpeggio, 80s drum machine, baritone vocal, 118 bpm>', nombre 'repaint-N'." (N = the bar where the first chorus starts, found by ear)
6. Mute everything but T, then: "Con generar_audio, tarea lego, fuente 'mix', desde_compas 1, hasta_compas 32, pista 'strings', modelo acestep-v15-xl-base, prompt 'lush cinematic string section, slow sustained chords, melancholic, 118 bpm', nombre 'cuerdas-lego'."
7. "Con generar_audio, tarea complete, fuente 'voz', pista 'drums, bass, synth', modelo acestep-v15-xl-base, prompt 'British synth-pop band backing a baritone vocal, 80s drum machine, sub bass, analog pads, 118 bpm', nombre 'banda'."
8. Same as 4 with `modelo acestep-v15-xl-sft`, nombre 'cover-sft'.
9. Send 6 again with nombre 'cancelar' and press Cancel once "generating" shows.

### How to listen

- Cover and repaint come in **muted**: mute T, unmute the new one, play from bar 1; then both
  from bar 9 and check the first hit lands on the bar.
- Extract: solo the new track. Only voice? Only drums? Fills kept? Compare with T bars 1-32.
- Lego: T + cuerdas-lego. Complete: voz + banda. Does it keep 118 BPM and the sections?

## Results, 5-Nov-2026

**Test 0, `still-here-1`, heard by Carlos (morning).** "Suena más a Modern Talking que a Depeche Mode,
pero tiene toques de Depeche. Es en inglés, no sé si es barítono." Lyrics intelligible: he quoted the
chorus ("we are the ghosts again, walking the rooms we made ... say it slow, say it clear, we were never
really here"). First chorus at **bar 28** (N for test 5). Take 2 not yet heard.

**The take seemed to end at bar 76.** It does not: both WAVs last 210.0 s (48 kHz, 16-bit, stereo) and
carry signal to the last block (RMS per 10 s around -15 dBFS, -32 only in the last 10 s of take 1). The
agent's runaway turn of 4-Nov cut the clip: one `editar_proyecto` call set `lengthBars` 76, removed
`trk_still_here_2`, muted `trk_still_here_1` and set `clp_1` to 304 beats (76 bars) so the audio fitted
its MIDI arrangement. The asset keeps `durationBeats` 413 (103.25 bars). Fix: clip back to 413 beats,
song to 104 bars. Nothing to fix in `generar_audio`.
Restored 5-Nov 07:50 by the agent on an explicit `editar_proyecto` prompt (3 calls, 3.3 s, 0.01 $, nothing
else touched). Carlos then heard the whole take: "llega al 103 o así y lo hace bien", the ending is fine.

**Test 1a (extract on xl-turbo, "no cambies el modelo"), 07:53.** One `generar_audio` call, refused in ms:
"acestep-v15-xl-turbo cannot do extract (only text2music, cover, cover-nofsq, repaint); use acestep-v15-base or
acestep-v15-xl-base." No Lambda call in `tmp/herramientas.log`, no second attempt by the agent: it quoted the
error, said nothing was written and no GPU spent, and offered three options without acting. Turn: 2 LLM calls,
4.0 s, 0.004 $. PASS.

**Test 1b (cover without `fuente`), 08:07.** FAIL, on the model's side, not the tool's: DeepSeek filled the gap
itself and called `generar_audio` with `fuente: "mix"` and an invented caption ("solo grand piano, intimate and
warm, close-miked, sparse dark ballad, no drums, no bass, no synths"), so the tool had nothing to refuse and
launched Lambda (`launching gpu_1x_a10 in us-east-1`, 07:07:59 UTC). The schema says "Every task but text2music
needs `fuente`" and the model read that as "supply one". The code-side refusal (empty `fuente`) stays unexercised
from the chat; the unit tests cover it. Lesson for the prompt (Carlos's call): a tool argument the person did not
give is asked for, not guessed, when it costs GPU time.

**Unplanned cover (from 1b), whole take, xl-turbo, 08:07-08:20.** Came back: `generado/x.wav`, 210.2 s, track
"x" MUTED at bar 1, 413.5 beats (103.37 bars; the source clip is 103.25). Lineage: cover_strength 1.0 (no
`fuerza` given), 8 steps, guidance 1.0, lm none, seed 395089999, source = the mix rendered to
`entrada/x-fuente.wav` (40.4 MB, peak -7.0 dBFS). Timings: boot 284 s; **381 s from "active" to "running"**
(last night 22 s with no WAV: the 40 MB upload is the cost, about 110 kB/s up; a 32-bar source will be ~12 MB);
install 20.6 s, DiT download + load 16.7 s, generation 12.5 s, VRAM peak 13.2 GB; `/api/run/lambda` 748 s in all,
the turn 763 s, 0.011 $ of LLM. Output peak -1.0 dBFS (source -7.0); RMS per 10 s tracks the source almost block
by block (-14/-15, dip to -20 at 140-160 s, -21 at 200 s), which is what strength 1.0 should do. After the tool the
agent read the project once and stopped, saying "escúchalo tú". NOT heard yet.
HEARD (Carlos, 08:30): "no es piano solo, tiene varios instrumentos". Both tracks together: "tienen armonía,
van alineadas ... van juntas a tiempo"; the two mixed are "un poco pegote" and, being fussy, the mix could be
better. So: **the bars line up** (the thing test 4 had to prove), and strength 1.0 copies the source so hard that
the "solo grand piano" caption loses. Test 4 at `fuerza 0.6` is the real check of whether the caption wins.

**Test 1c (lego with pista 'batería'), 08:56-09:05.** FAIL, again on the model's side: DeepSeek translated
'batería' to `drums` and the tool, with a valid stem name, ran. It also read the crossed request ("pista drums,
prompt strings") as "add a drum stem with a strings character" and said so afterwards, offering to redo it with
`pista='strings'`. Run: instance reused (`reusing instance 90de0381943e`); **400 s from reuse to "running"**
(46 files, 40.4 MB source again); xl-base weights downloaded + loaded in 30 s; 50 steps, guidance 7, **generation
70.1 s** for 210 s, VRAM peak 13.2 GB; `ejecutar_python_lambda` 523 s, the turn 559 s, 0.008 $. Source: the mix
as Carlos had it unmuted at the time (peak -2.8 dBFS, so probably take + cover together). Output `x2.wav` 210.5 s,
peak -1.0 dBFS, track "x2" UNMUTED at bar 1 (lego stems come unmuted by design), RMS per 10 s swings -35 to -18
with a silent block at 160-170 s: a part that plays in sections, as a drum stem would.
HEARD (Carlos, 09:25): "es sólo batería". The lego stem is what it says it is; the 'strings' caption did not turn it into something else.
Carlos also noted "esa batería no es la de la canción": correct and expected, lego writes a NEW drum part over the
mix as context, it does not pull the song's own drums out (that is extract, test 3). Whether the lego drums sit on
the tempo and follow the sections is still to be judged with both tracks sounding together.

**Test 1 verdict.** 1 of 3 refusals reached the code (1a). In 1b and 1c the model supplied or translated the
argument that was meant to be missing or wrong, so the tool had nothing to refuse and GPU time was spent twice
(about 13 and 9 minutes of wall clock, most of it upload). The code-side checks for empty `fuente` and unknown
stem names are covered by unit tests only. Prompt lesson (Carlos decides, house rule 1): when a `generar_audio`
argument is missing or not in the allowed list, ask, do not guess or translate; it costs GPU minutes.

**Test 2 (extract vocals, bars 1-32, xl-base), 09:38-09:44.** Ran as asked (the model had nothing to fill in):
source = track still-here-1 alone, bars 1-32, 65.1 s, peak -7.1 dBFS, 12.5 MB; instruction "Extract the vocals
track from the audio:", 50 steps, guidance 7, shift 1.0, caption "", lyrics "[Instrumental]" (the script's default)
so `instrumental=True`. Instance warm: model load 3.9 s, **generation 20.0 s**, VRAM 13.1 GB. Track "voz" unmuted
at bar 1, 32 bars exactly. Upload still 306 s (see below). Turn 364 s, 0.007 $. After the tool the agent read the
project once, warned that x2 and voz were both unmuted, and stopped.
HEARD (Carlos, 09:50): "la pista de voz no tiene sólo voz, tiene instrumentos". FAIL.
Measured: `voz.wav` RMS per 4 s is flat, -19 to -14 dBFS over the whole 65 s, intro included, and 5 dB ABOVE the
source (-23 to -21); peak -1.0 dBFS. A vocal stem would be quieter than the mix and silent where nobody sings. The
profile is the source again, louder: the model reconstructed the input.
Why, two leads from the ACE-Step 1.5 docs and code (read 5-Nov):
  1. inference.py comment: "For extract tasks, LLM-generated captions can conflict with the extract instruction and
     cause the DiT model to reconstruct input audio instead of extracting stems." We pass no caption, but we pass
     lyrics "[Instrumental]" and instrumental=True for a VOCALS extract: the same kind of conflict. Fix to try: for
     extract, lyrics "" (or the song's real lyrics, which are in `generado/still-here.lineage.json`) and
     instrumental=False.
  2. GenerationParams has enable_normalization=True, normalization_db=-1.0 by default: every output we got (x, x2,
     voz) peaks at exactly -1.0 dBFS. For cover/extract/lego the output should keep the source's level; pass
     enable_normalization=False for the source tasks (text2music may keep it).
  Also: the docs recommend shift 3.0 for base too ("Best quality" section, example 9); we pass 1.0 for base.

**Upload cost, cause found.** `sincronizar` in server/lambda.ts uploads EVERY project file under 50 MB on every
run (`ficherosDelProyecto` skips only salida/ and __pycache__). still-here now holds entrada/*.wav (40+40+12 MB)
and generado/*.wav (40×3 + 12 MB) plus proyecto.json and trajectories: about 230 MB re-sent each run, hence
300-400 s whatever the source size (28 files/22 s last night, before any WAV existed). The inputs are already
uploaded explicitly by `planDeEntradas`. Fix: skip entrada/, generado/, versiones/, trayectorias/, .cache/ (or all
*.wav) in `ficherosDelProyecto`. Touches server/: restarts the server, so after today's tests.

**Fix built 10:20 (Carlos: "sí haz esos puntos"), `workspace/gpu/generar_audio.py` only, no reload.** (1) extract
drops the default lyrics "[Instrumental]" (lyrics "" unless the caller passes real ones) and never sets
`instrumental`; (2) `enable_normalization` is now True only for text2music, so cover/repaint/extract/lego/complete
keep the source's level; the lineage records `lyrics`, `instrumental` and `normalized_to_db`. The fields exist at
the pinned commit ca1e85f (checked in its inference.py). The script is re-uploaded on the next run, so test 2 can
be repeated at once as **2b**: same prompt with `nombre 'voz2'`. Expected if lead 1 is right: voz2 quiet in the
intro, level below the source, voice only. Shift stays 1.0 for base so only one thing changes per run.

**Test 2b, first attempt 11:46: did not run.** `ejecutar_python_lambda` came back in 60.7 s with exit 1, "could not
sync: [miuzika] ssh cut off after 60 s": the first ssh of `sincronizar` (mkdir) hung on an instance idle for 2 h.
Nothing ran on the GPU (checked by ssh at 11:55: GPU 0 MiB, no generar_audio process; the instance is active since
09:12, 3.6 h, 4.64 $ at 1.29 $/h). Two agent-side defects seen: (a) the tool text said "The model ran out of time
(25 min)" for a 60 s ssh failure (`acciones.ts` uses `por_timeout` for any timeout); (b) from that text DeepSeek
told Carlos the job "se quedó colgado hasta agotar los 25 minutos" and burnt GPU, which did not happen. The model
also noted correctly that voz2 is the same request as voz; it does not know the script changed underneath.

**Test 2b, second attempt 11:50-11:55: PASS, HEARD.** Carlos: "se escucha sólo la voz". Measured: `voz2.wav`
65.1 s, peak -9.5 dBFS (no normalisation now), RMS per 4 s **-55 dBFS for the first 24 s** (bars 1-12, the
instrumental intro) then -26 to -31, that is 5 dB under the mix (-22). voz (before the fix) was -19..-14 all the
way through. Lineage: lyrics "", instrumental False, normalized_to_db null, 50 steps, guidance 7, shift 1.0.
Timings: model load 4.2 s, generation 20.0 s, VRAM 13.1 GB; upload 228 s (59 files). So lead 1 was the cause:
"[Instrumental]" as lyrics made xl-base rebuild the mix instead of extracting the voice. The fix lives in
`workspace/gpu/generar_audio.py`; the web side still sends `--letra [Instrumental]` for extract, harmless now.

**Test 3, first attempt 11:59: did not run**, same "could not sync: ssh cut off after 60 s" as 2b's first attempt,
5 min after a successful run this time, so it is not idleness. 2 of 5 instance reuses today hung on the first ssh
(the mkdir of `sincronizar`); a probe from this machine right after answered in 1.7 s. No ControlMaster in the ssh
options, ConnectTimeout 15 (so TCP connected and the session hung). Mitigation to build (server/, after the tests):
retry that first ssh once when it is cut off, and label the error "ssh" not "model timeout". The agent repeated the
false "25 min of GPU per failed attempt" line, same cause as before.

**Test 3, second attempt 12:07-12:16: ran.** Instance reused, first ssh fine; **upload 518 s** (68 files, the
project folder is ~290 MB now); model load 4.0 s, generation 20.0 s, VRAM 13.1 GB; `ejecutar_python_lambda` 563 s.
Track "bateria" at bar 1, 32 bars. Measured: `bateria.wav` 65.1 s, RMS per 4 s -24..-20 dBFS (the mix is -22, so
the drums carry most of this mix's energy, plausible for a drum-machine synth-pop take), **peak 0.0 dBFS**: with the
normalisation off the raw output of this stem saturates (count below). Crest factor is the tell: see the numbers
appended after listening. NOT heard yet at the time of writing.
Numbers: 2 saturated samples in 6.2 M (a peak that touches 0 dBFS, not sustained clipping; the source has 0).
Crest factor (peak over RMS, per 8 s): source 11-15 dB, `bateria.wav` 15-20 dB (more transient, as drums are),
`voz2.wav` 15-20 dB in the sung bars, 6 dB in the silent intro. Consistent with a drum stem. The ear decides.
HEARD (Carlos, 12:25): **FAIL.** "No es la batería ... no tiene vacíos ... es una extracción completamente fallida,
no suena bien, es un pego de cosas sin sentido." So with lyrics "" the vocals extract works and the drums extract
does not. Open hypotheses, one run each (each run is ~10 min today, 8-9 of them upload): (a) a non-vocal stem
wants lyrics "[Instrumental]" (the target has no words) while a vocal stem wants "" or the real lyrics; (b) shift
3.0 for base, as the docs' best-quality section says; (c) the non-XL `acestep-v15-base`; (d) ACE-Step's generative
extract is simply weak on drums in a dense synth mix. The ear decides (Carlos); the RMS/crest numbers above did
not catch this failure, so they are not a proxy for "it is a drum stem".

**Pause, 12:35-13:00 (Carlos: "sí, podemos parar"; instance left on).** Built, typecheck clean, 330 tests green:
- `server/lambda.ts`: the sync skips entrada/, generado/, versiones/, trayectorias/, .cache/ and any audio file
  (`seSincroniza`, tested); the inputs still travel via `planDeEntradas`. The first ssh of the sync is retried
  once when cut off. `esTimeoutDelModelo` (tested): exit 124 or a cut-off RUN is a model timeout, a cut-off
  sync/upload is not. `server/api/gpu.ts` uses it.
- `web/src/agent/acciones.ts`: three texts, ssh-unreachable / model timeout / no audio; the ssh one says
  "nothing ran and no GPU time was spent".
- `workspace/gpu/generar_audio.py`: hypothesis (a): only vocals/backing_vocals extracts drop "[Instrumental]";
  other stems keep it. To be tested on test 3 again, as **3b** (`nombre 'bateria2'`).
Simulated on still-here with the real `seSincroniza`: before 44 files / 343 MB per run, now 4 files / 0.02 MB
(agente.json, proyecto.json, two small .py). Whether Vite re-imported the server plugin is checked on the next
run: the "N file(s) uploaded" notice should read about 5 (4 + the input), not 68.

**Test 3b, 15:05-15:11 (after restarting `npm run dev`; Carlos reports the app re-sent the pending prompt on
reload, the log shows exactly one agent turn, the 3b one).** Server fixes confirmed on the wire: "32 file(s)
uploaded" (31 baseline files of codigo/gpu/herramientas + the input; before: 68), sync 76 s instead of 300-520 s,
whole `ejecutar_python_lambda` 165 s; model load 4 s, generation 20 s, VRAM 13.1 GB. Lineage: lyrics
"[Instrumental]", caption "", instruction "Extract the drums track from the audio:", shift 1.0, guidance 7,
normalisation off (`normalized_to_db: null`).
- `bateria2.wav` (first seed): **near silence**. Peak -45 dBFS, RMS -56 dBFS, flat per bar (-59..-55), 98 % of
  the energy under 200 Hz, zero transients: noise floor, not drums. The agent measured the same thing itself,
  called it "vacía", and **launched a second run on its own** (`bateria2b`, seed 2932572162) without asking.
- `bateria2b.wav` (second seed, same conditioning): loud again, RMS -21.6 dBFS, per bar -24..-19 (moves with the
  music), 89 % under 200 Hz, raw peak at 0 dBFS with 1 saturated sample (no normalisation, so this is the model's
  own output level). The agent's envelope check: correlation 0.60 with the mix envelope, 141 onsets vs 132 mix
  kicks, 62 % within 40 ms (typical offset 23 ms). Project: bateria2b at -4 dB, bateria2 and bateria muted.
  NOT heard yet at the time of writing.
Reading: same inputs, two seeds, one silent and one loud means the drums extract is **unstable** with this
conditioning; hypothesis (a) is at best not sufficient. Checked against the pinned ACE-Step source
(`inference.py`, `INFERENCE.md`, `GRADIO_GUIDE.md` at ca1e85f): the official extract example passes only
`src_audio` + `instruction`, so the documented default is lyrics "" and caption "" (exactly test 3, which failed
by ear); `params.instrumental` is never read by `generate_music`, only by `create_sample`, so it is inert here;
`shift` 3.0 is recommended for **turbo**, not for base (Tutorial 827-830 lists 1.0 as the base default), which
weakens hypothesis (b). Remaining: (c) `acestep-v15-base`, (d) weak on drums, and (e) seed variance alone, which
would make "retry with another seed" the practical recipe. The ear decides on bateria2b.
HEARD (Carlos, 15:20): **FAIL.** "No la ha extraído bien, queda hecha un pegote con restos incoherentes del resto
de instrumentos." Same verdict as test 3 with lyrics "". The onset agreement (62 % within 40 ms) and the moving
per-bar RMS did not catch it either: the thing follows the pulse but is not the song's drums. So far the base
model extracts vocals from this mix (2b, heard) and does not extract drums (3, 3b, heard). Next and last drums
attempt: **3c** with `acestep-v15-base`; if it fails too, drums extract goes down as not usable on this material
and the session moves on to test 4.

**Test 3c, 15:20-15:25, `acestep-v15-base` (the small base), one take as asked (the agent obeyed "una sola
toma").** 34 files uploaded (the two check scripts the agent wrote are .py, so they travel; fine), sync 118 s, model
load 62 s (first load of this checkpoint), generation 10.6 s, VRAM 8.2 GB. `bateria3.wav`: peak -1.8 dBFS, RMS
-24.1, crest 22, per bar flat at -24 (one dip to -30 at bar 28, where the mix also dips), 82 % of the energy
under 200 Hz, envelope correlation with the mix 0.76 (2b: 0.60); agent's onset check 72 % within 40 ms (2b: 62 %).
Left at 0 dB, nothing else touched.
HEARD (Carlos, 15:30): **PARTIAL.** "Muchísimo mejor, pero en algunas partes de la batería se notan sonidos de
sinte. Sirve por si quisiéramos sacar un MIDI o usarlo de base para una creación como ejemplo, pero no para una
mezcla profesional." Verdict for drums extract on this material: the small base is clearly better than xl-base
(3, 3b: garbage; 3c: a drum part with synth bleed), usable as a reference or a MIDI source, not as a mix stem. A
dedicated separator (Demucs or similar) is the honest tool for a real stem; that is a product decision for Carlos,
not taken here. Numbers that tracked the ear this time: envelope correlation 0.60 -> 0.76 and onsets 62 -> 72 %;
numbers that did not: RMS/crest (all three loud takes look alike). Drums extract closed; on to test 4.

**Test 4, 15:36-15:41, cover 0.6 bars 1-32, xl-turbo (default; Carlos asked how we know the default is used: it is
`MODELO_POR_DEFECTO` in `src/core/generacion.ts` and the script's own default, the agent did not send `modelo`,
and the lineage confirms `acestep-v15-xl-turbo`).** The model ran fine: load 4.1 s, generation 4.6 s, VRAM 13.1 GB,
8 steps, guidance 1.0, shift 3.0, cover_strength 0.6, lyrics "[Instrumental]". The server then said **"done; 0
file(s) brought back"** and the agent reported "cover-piano no existe", correctly refusing to retry. Cause, read in
`server/lambda.ts` `traerNuevos`: the file list comes from one `ssh find -newer .marca` with a 120 s limit, and
its `codigo`/`errores` are ignored, so a cut-off ssh (the same first-ssh hang seen in the morning) looks like "no
new files". Timeline matches exactly: script done 14:38:49Z, "done" 14:40:50Z = 121 s. Checked on the instance at
15:42: `.marca` 14:38, `find` answers in 1.5 s now and lists `generado/cover-piano.wav` + `.lineage.json`. Both
copied back by hand with scp; the project does not have the track yet (anadir_pistas can add it at bar 1, 32
bars). Fix to build (server/, so it restarts the server: ask Carlos first): retry the `find` once when cut off,
and if it still fails return the ssh error so the agent says "generated, left on the instance" instead of
"nothing produced"; keep that text out of `esTimeoutDelModelo`, which would read "cut off after" as a model
timeout.
Measured `cover-piano.wav` vs `entrada/cover-piano-fuente.wav` (65.08 s both): peak -1.3 dBFS (raw, no
normalisation), RMS -17.5 (source -22.4), energy 200 Hz-2 kHz 66 % (source 30 %): piano/voice range, not the
synth-pop bass; bars 1-4 at -24 then -15..-21 from bar 5 (the source is flat -21..-24, so the cover reshapes the
dynamics); envelope correlation 0.47; best envelope lag 0 ms (aligned). NOT heard yet. Note for the ear: the
prompt asks for a baritone vocal while lyrics are "[Instrumental]"; if the vocal is missing or gibberish, the next
try should pass the song's lyrics (in `generado/still-here.lineage.json`).
Track added at 15:47 via anadir_pistas (agent obeyed "no generes nada": one verificar_audio, the track at bar 1,
32 bars, muted). Agent slip in its report: "entra normalizada al techo": the normalisation is off since the pause,
the 0 dBFS peak is the model's raw output level.
HEARD (Carlos, 15:52): **PARTIAL.** "Es un piano sí, pero tiene más instrumentos y no hay voz." The extra
instruments are consistent with strength 0.6 keeping a good part of the source; the missing voice is the lyrics:
the tool sends "[Instrumental]" when `letra` is omitted, and cover is direct conditioning, so the DiT got "no
words" against a prompt asking for a baritone. Next: **4b**, same prompt and strength, `letra` = the song's own
lyrics up to the first chorus (from `generado/still-here.lineage.json`), to isolate the vocal question; a lower
strength (0.4) only afterwards if the ear still wants fewer instruments.

**Test 4b, 15:52-15:54, cover 0.6 with the song's lyrics.** One take, as asked. The lyrics the agent sent are
byte-identical to `inputs.lyrics` of `still-here.lineage.json` from [Intro] to the end of the first [Chorus]
(checked by diff of the `--letra` argument in herramientas.log); lineage `instrumental: false`. xl-turbo, seed
739214838, load 4.1 s, generation 4.7 s, VRAM 13.1 GB; this time the fetch worked ("3 file(s) brought back", whole
call 66 s). Track 11 "cover-piano2" at bar 1, 32 bars, muted. Measured vs cover-piano (no lyrics) and the source:
RMS -16.0 (cover1 -17.5, source -22.4), raw peak -0.4 dBFS; energy under 200 Hz 61 % (cover1 33 %, source 66 %),
200 Hz-2 kHz 36 % (cover1 66 %); per bar -19..-14 from bar 1, no quiet intro this time (cover1 had bars 1-4 at
-24); envelope correlation with the source 0.53 (cover1 0.47). So the lyrics changed the take a lot: the bass
came back and the piano-range share halved. Whether there is a sung baritone the numbers cannot say. NOT heard yet.
HEARD (Carlos, 16:00): **PASS.** "Hay voz, creo que canta la letra y es un piano con menos notas que cover-piano."
Lesson for cover: a sung cover needs `letra`; without it the tool sends "[Instrumental]" and the voice is gone
whatever the prompt says. The "bass came back" reading above was wrong as a proxy for "more instruments": by ear
the piano got sparser, so the extra low energy is the voice and the room, not the synth bass. Test 4 closed
(4b PASS); 4 itself stands as "PARTIAL: no voice without lyrics". Next: test 5 (repaint).

**Test 5, 16:02-16:06, repaint bars 28-31 (first chorus) with the chorus lyrics, xl-turbo.** One take, as asked.
Lyrics sent = the first [Chorus] of `still-here.lineage.json`, unchanged. Source = the whole take (210.25 s),
`range_s` 54.915-63.051 s = bars 28-31 exactly; load 3.9 s, generation 12.2 s, VRAM 13.2 GB, fetch OK, whole call
197 s (sync 129 s, 35 files). Track 12 "repaint-28" at bar 1, 413.5 beats, muted. Measured sample by sample
against the source: bars 1-27 and 32-104 are **identical** (99.95 % of stereo samples bit-equal, the rest is a
~25 ms crossfade on each side: first differing sample 54.890 s, last 63.076 s); bars 28-31 differ (diff RMS -16
to -19 dBFS) and are **5 dB louder** than the source (-19..-15 vs -24..-21 per bar; peak -2.0 dBFS vs the
source's -7.0) with the piano/voice band up (200 Hz-2 kHz 42 % vs 32 %). The range control works; the level jump
is the thing to listen for. The agent's warning is fair: six chorus lines do not fit 8.1 s, so expect the voice to
rush or sing part of them; a full chorus wants 8 bars. NOT heard yet.
HEARD (Carlos, 16:15): "En la aplicación la altura del wav de still-here-1 es mayor que la de repaint-28, pero yo
los oigo igual de volumen. El primer estribillo se ve superior en repaint y se oye algo más." Checked: the
timeline draws absolute peaks (`timeline.ts`, `peak * half`, no per-clip normalisation), so the drawing is honest,
and the files really differ in level: `still-here-1.wav` RMS -15.8 / peak -1.0 dBFS, `repaint-28.wav` RMS -21.4
/ peak -2.0. **Cause: the source rendered for the model goes through the project master (-6 dB)**:
`entrada/repaint-28-fuente.wav` peaks at -7.0 where the file peaks at -1.0, exactly the master. So every source
task today (voz, voz2, bateria*, cover-piano*, repaint-28) conditioned the model on a mix 6 dB below the take,
and repaint returned that quiet copy with bars 28-31 regenerated at the model's own level (-19..-15 per bar,
about the original take's -17..-15). Re-reading the "+5 dB" above: the repainted bars are at the ORIGINAL level,
the rest of the track is 6 dB down. By ear Carlos hears the two tracks alike and the chorus "algo más": the
A/B is between a -6 dB copy and the original, so the 6 dB is partly masked by the master being -6 dB itself.
Fix (web/, reloads the page, ask first): render the source with the master at 0 dB (track gains and mutes kept),
or document that cover/repaint outputs come back at the render level and must be gain-matched. Recorded in the
fix list with `traerNuevos`.

**Pause 2, 16:25-16:50 (Carlos: "vamos").** Built, typecheck clean, 332 unit tests green (2 new):
- `web/src/render-escucha.ts`: `sinMaster` (tested): the source rendered for the model has the master at 0 dB,
  tracks untouched. Sources will now peak where the take peaks (about -1 dBFS for still-here-1) instead of -7.
- `server/lambda.ts`: `traerNuevos` retries the `find` listing once when cut off or failing (`listadoFallido`,
  tested) and, if it still fails, returns `traidaFallo` instead of an empty list; the notice reads "done; the
  outputs could not be listed on the instance (ssh cut off); whatever the script wrote is still there". The
  run's own `errores` no longer carry the fetch failure, so `esTimeoutDelModelo` cannot mistake it for a timeout.
  `ResultadoGpu` (server/gpu/proveedor.ts) and `/api/run/lambda` (`lambda.traida_fallo`) carry it.
- `web/src/agent/acciones.ts`: when the RESULT names files that did not come back, the agent gets "The model
  finished and wrote X on the GPU instance, but the file could not be brought back (...). Nothing to regenerate",
  instead of falling through to anadir_pistas and "could not read".
Not re-tested live (would need the ssh hang to recur); the level fix is checked on test 6 by the source's peak in
the generar_audio report (expected about -1 dBFS, was -7.1).

**Test 6, 16:43-16:49, lego strings over the mix, bars 1-32, xl-base.** One take. Level fix confirmed: the source
`entrada/cuerdas-lego-fuente.wav` peaks at **-1.1 dBFS** (before the pause every source peaked at -7.1). The mix
(= still-here-1 alone, 210 s, 40 MB) is uploaded whole because lego, like repaint, takes the range as the area to
redo (`--desde 0.000 --hasta 65.085`): upload 184 s, 36 files; load 3.8 s, **generation 69.9 s** (50 steps over
210 s), VRAM 13.2 GB, fetch OK, whole call 311 s. Lineage: instruction "Generate the strings track based on the
audio context:", lyrics "[Instrumental]", shift 1.0, guidance 7, seed 3388590524.
**The agent turn died right after the tool returned**: Ollama Cloud answered HTTP 502 ("temporary error, try
again in 30 seconds") to the next DeepSeek call, so the trajectory ends in `estado: error`, no reply to Carlos.
The action had already run: track 13 "cuerdas-lego", unmuted, 0 dB, at bar 1, 413 beats (the whole file).
Measured against the source: **bars 33-104 are the source, bit-identical** (99.98 % of samples, residual -59
dBFS); **bars 1-32 are new** (sample correlation 0.155), quiet (-35..-21 dBFS per bar vs the mix's -24..-21),
88 % of the energy in 200 Hz-2 kHz; the strings only enter at bar 22 (bars 1-21 sit at -35..-32). So ACE-Step's
lego returns the whole source with the new stem ALONE inside the range, not the stem alone over the file.
Consequence in the DAW as placed: from bar 33 the new track doubles still-here-1 (+6 dB). Fix (web/, reload):
for lego with a range, trim the clip to the range (`compases = hasta - desde + 1` at `inicio_compas = desde`),
as the cut sources already do; until then, listen to bars 1-32 only or shorten the clip. NOT heard yet.
HEARD (Carlos, 17:00): **FAIL.** "No ha creado una pista sola de cuerdas: un track con voz y todos los
instrumentos." Numbers on bars 22-32 (where the new material lives) agree on the voice: the lego's envelope
correlates 0.74 with `voz2` (the vocal stem) and 0.11 with the mix; its band profile (7 % under 200 Hz, 79 % in
200 Hz-1 kHz) is the vocal stem's profile, not the mix's (65 % under 200 Hz) and not a string section's either
(sustained strings would spread above 1 kHz; here 1-2 kHz is 6 %). So in the range the model re-sang the vocal
rather than writing strings around it, and outside the range it copied the mix. Verdict: lego, like extract on
drums, does not deliver a stem on this material; the direct-conditioning path reconstructs the source. Strings
in "[Instrumental]" lyrics did not help. Lego closed, one run; on to test 7 (complete from voz2).

**Provider switch, 19:18-19:21.** Carlos put an Anthropic API key in the Models menu and chose `claude-sonnet-5-5`
(100 $ of API credit; Max does not cover the API). Code: `adaptarCuerpo` drops `temperature`/`top_p` for Anthropic
(the OpenAI-compatible endpoint returns 400 for temperature < 1 on Claude 4.7+, doc read 5-Nov) and keeps
`stream_options` so `usage` reaches the log. No prompt caching on that endpoint, so every call pays the full
~25K-token prefix. First turn ("abre still-here y dime qué pistas hay"): 2 calls, 5.4 s, 0.105 $ (DeepSeek: ~0.002 $),
answer correct, in Spanish, flagged the two -4 dB tracks unasked. The prompt is unchanged (house rule 1): model and
prompt are not changed in the same step so that differences are attributable.

**Test 7, 19:24-19:26, complete from voz2 (drums, bass, synth), xl-base, one take, agent = Claude Sonnet 5.5.**
Agent: 3 calls, 0.175 $, 2 min wall clock (sync 66 s, 36 files). It sent exactly the arguments given, nothing
invented; after the tool it ran `verificar_audio` and `leer_proyecto` in one parallel call, reported "No he oído la
toma", noticed the 0 dBFS peak and offered -4 dB without acting. One thing it relayed is noise from the tool text: the
"Not in the source (long WAVs through streaming): bateria2, ... cuerdas-lego" list is meaningless when `fuente` is a
single track by request (fix for `acciones.ts` / `render-escucha.ts`: omit the list when the source is one track).
Run: load 3.8 s, generation 20.0 s, VRAM 13.1 GB; lineage: instruction "Complete the input track with drums, bass,
synth:", lyrics "[Instrumental]", 50 steps, guidance 7, shift 1.0, normalisation off, seed 2185654988, source
`entrada/banda-fuente.wav` = voz2 alone (65.3 s, peak -9.5). Track 14 "banda", unmuted, 0 dB, bar 1, 32 bars.
Measured `banda.wav` (65.32 s): peak 0.0 dBFS (1 clipped sample, raw model level), RMS -19.7, flat per 4 bars
(-19.4..-20.9) including bars 1-12 where voz2 is silent (the band plays the intro too, as a backing band would);
**93 % of the energy under 200 Hz** (voz2 4 %, the mix 66 %): kick and sub bass, almost no pad/synth range (0.4 % in
1-2 kHz); stereo correlation 0.977 (near mono). **It is new material, not the source**: sample correlation with voz2
-0.001, projection gain 0.0 (unlike lego/extract, complete returns the accompaniment alone). **It sits on the 118 BPM
bar grid from bar 1**: onsets folded on the bar peak at 16ths 0, 6, 8, 12, 14 (1.0, 0.94, 0.98, 0.51, 0.87, the rest
< 0.07), bar-period autocorrelation 0.61; the pattern is syncopated (hits on 1, the and-of-2, 3, 4, and-of-4), not
four-on-the-floor, so a plain beat autocorrelation reads it as 79 BPM (1.5-beat period). Whether drums/bass/pads
"fit the voice" the numbers cannot say; the band profile predicts a bass-heavy, pad-less backing. NOT heard yet.
Listen: mute cuerdas-lego, keep voz2 and banda; check (1) a real drum machine or just kick+sub, (2) key (A minor)
against the voice from bar 13, (3) the downbeats against the bar lines.
HEARD (Carlos, 19:40): **PASS.** "La verdad es que está muy bien." So on this material the base model does
complete (voice -> band) and extract vocals, and does not do extract drums or lego. The 93 % under 200 Hz did not
predict a bad result: it is the profile of what a synth-pop backing band without the voice looks like, not a
defect. Lesson for the numbers: band profile is description, not verdict.

**Test 9, 19:37-19:38, cancel (agent = Claude Sonnet 5.5).** Turn 17.4 s: 1 LLM call (5.6 s, 0.063 $, the exact
arguments, `variantes 1`), then `generar_audio` started rendering the whole mix for lego ("Rendering the mix for the
model…"), Carlos pressed Cancel, and the tool returned "Cancelled by the user before the source was rendered." No
`/api/run/lambda` request, no `lambda_aviso`, nothing uploaded, no track, no file under `generado/`; the trajectory
says `estado: cancelado`. So the cancel path **before** the GPU works and spends nothing, but the planned scenario,
cancelling **while the GPU runs** (server kills the remote process, `cancelado: true` in `tmp/herramientas.log`,
"Cancelled by the user while the GPU was working"), was not reached: the click landed during the ~11 s render.
UI defect seen by Carlos: "he tenido que apretar 5 o 6 veces seguidas rápidas para cancelar". The first registered
click did abort (the signal is checked right after `render.renderizar`), but the tab does not respond while the
offline render runs, so the clicks queue and the status does not change until the render ends. Fix candidates
(web/, after the tests): render in a worker or yield to the UI between blocks, and change the status to "Rendering
the source… Cancel takes effect when the render ends" so one press is known to be enough.
**9b to run**: same prompt, nombre 'cancelar2', press Cancel once when the status reads "N file(s) uploaded; running
gpu/generar_audio.py" (that is the GPU phase; upload is ~1-2 min on the warm instance).

**Test 8, first attempt 19:45-19:47: did not run.** Sync OK, then the `mkdir` ssh of the input upload hung and was cut
off at 60 s: "could not upload the inputs: ssh cut off after 60 s". Third cut-off of the day out of 16 runs (10:47 and
11:00 were the sync's first ssh; this one the upload's). The agent (Claude) said "no se ha generado nada y no se ha
gastado tiempo de GPU", offered a retry, did not retry on its own: correct, and the `acciones.ts` text from pause 1 did
its job (no "25 min" story). Instance checked by ssh right after: load 0, GPU 0 MiB, no process, 1.6 s per probe.
The sshd journal shows the hung session **authenticated and opened** at 19:45:58 (`Accepted publickey`, `session
opened`), so the hang is after auth, between the remote command and the client's exit. Hypothesis tested: Windows
OpenSSH hanging on exit when stdin is a pipe (how Node spawns it). 75 `mkdir` runs from Node against the instance
(25 with stdin pipe, 25 ignore, 25 with `-n`): **0 hangs**, median 1.46 s. Not confirmed; cause still unknown. The
other sshd error lines are internet scanners against the public IP (banner/protocol garbage from foreign addresses).
Mitigation to build (server/, restart): control ssh (sync mkdir, upload mkdir, fetch find) capped at 20 s instead of
60 and retried once, all three, so a hang costs 20 s and not the turn.

**Test 8, second attempt 19:54-19:57 ("sí, reintenta"): ran.** Sync 76 s, 36 files; xl-sft weights downloaded + loaded
in 21.9 s (first use), **generation 20.3 s** (50 steps over 32 bars; turbo did it in 4.7 s), VRAM 13.05 GB; whole call
138 s. Lineage: 50 steps, guidance 7, shift 1.0, cover_strength 0.6, lyrics byte-identical to 4b's (408 chars),
instrumental false, seed 2445119919. Track "cover-sft" MUTED at bar 1, 32 bars. Agent: 3 calls, 0.21 $, read the
lineage itself to confirm the model and steps, reported "No la he oído", left gains alone; it again relayed the
"long streaming tracks not in the source" line (tool-text noise, same fix as test 7).
Measured against `cover-piano2` (turbo 4b, same prompt/strength/lyrics) and the source: peak 0.0 dBFS (1 clipped
sample, raw level), RMS -16.9 (turbo -16.0, source -16.4). **Band profile moves away from the source more than turbo
did**: under 200 Hz 47 % (turbo 63 %, source 66 %), 200 Hz-1 kHz 44 % (turbo 33 %, source 27 %), 1-2 kHz 6 % (turbo
2.3 %): more piano/voice range, less synth bass. **Stereo correlation 0.39** (turbo 0.73, source 0.79): a much wider
image, consistent with a piano and a room rather than a copied synth mix. Dynamics: bars 1-4 at -25.6 (turbo -17.9,
source -17.2), then -17.5..-15.4: sft wrote a quiet intro where turbo kept the source's level. Envelope correlation
with the source 0.31 (turbo 0.52): sft departs further at the same strength. Alignment: best envelope lag 0 ms.
Prediction for the ear: more of a piano cover and less of the original than 4b, with a quiet start; whether the
baritone sings the lyrics and whether 50 steps sound cleaner than 8 the numbers cannot say. NOT heard yet.
Listen: mute everything but cover-sft, then A/B with cover-piano2 from bar 1 and from bar 13 (where the voice enters).
**HEARD (Carlos, 22:00): PASS, preferred over cover-piano2.** His words: "esta versión es muy industrial, a mí me
encanta, es mejor que cover-piano2 pero es más sucia, oscura, intensa". Ear vs numbers: "más sucia, oscura, intensa"
is not what the band profile predicted (less low end, more piano range, quieter intro read as "cleaner piano cover");
the wider stereo (0.39) and the departure from the source (envelope corr 0.31) are what match "industrial" and
"intensa". Lesson for the doc: the band shares say where the energy sits, not how dirty it sounds; the ear decides
(see [[oido-manda]]). Cost of this one verdict: 138 s of A10 (~0.03 $) + 0.21 $ of Sonnet 5.5 for the agent turn.
Open question for another day, not for this session: is the difference sft-vs-turbo, 50-vs-8 steps, or the seed?
The seeds differ (4b 739214838, sft 2445119919); one more sft run with seed 739214838 would separate them.

**Test 9b 22:03-22:06 (cancel while the GPU runs): the run was NOT cancelled; it finished.** `/api/run/lambda` returned
200 after 190 s (sync 91 s, load 3.9 s, generation 72.0 s, VRAM 11.3 GB); `api.log` shows no "closed", so the browser
never aborted the fetch, and the turn ended `estado: ok` with a final answer (3 calls, 0.23 $). The wiring is in
place (fetch with the turn's signal -> `res.on("close")` in `server/api/gpu.ts` aborts -> `correrProceso` kills the
ssh tree), so either Cancel was not pressed during the GPU phase or the click did not register; the logs cannot tell.
Asked Carlos. Still untested: GPU-phase cancel.
**Side finding, worth a fix: the source was silence and the tool sent it anyway.** All non-streaming tracks were muted
(Carlos had muted the project to A/B cover-sft) and every streaming track is excluded from "mix", so
`entrada/cancelar2-fuente.wav` is 220.5 s of digital silence (peak -Infinity dBFS in the tool text, 42 MB uploaded).
The model made 32 bars of free strings from the prompt alone: peak -7.8, RMS -29.2 dBFS, stereo correlation 1.000
(mono), useful tail 65.1 s then silence to 220 s (lego clip not trimmed, same defect as test 5). Cost of the wasted
run: 190 s of A10 + 0.23 $ of agent. Fix (web/, `acciones.ts` after `renderizarEntrada`): refuse a source whose peak is
below about -60 dBFS with "the source rendered silent: N tracks muted / only streaming tracks; unmute or give a track";
`renderizarEntrada` already returns `picoDb`. The agent (Sonnet) did read the -Infinity and explained it correctly
after the fact, and reused the prompt of the cancelled take ("cancelar") instead of asking. NOT heard; not worth
hearing (no context).
HEARD (Carlos, 22:2x): "un violín que está bien pero nada más". Expected for a lego over silence: one instrument alone,
not the "lush string section" of the prompt, mono, 12 dB under the other tracks. Not a verdict on lego; a verdict on
sending a silent source. Carlos's point, accepted: the mix for the model must not depend on the mute state (mute is for
listening) and the streaming WAVs are on disk, so the server can sum them into the source. Both go to the change list:
(1) `renderizarEntrada` renders "mix" with mutes/solos off, `sin_pista` excludes; (2) server-side mixdown of streaming
clips (position, gain, trim) added to the openDAW render, for the model source, the WAV export and escuchar_mezcla.

**Test 9b, third try 22:12-22:14 ("cancelar3"): Cancel worked, one press, but again before the GPU.** The agent noticed
by itself that "mix" would be silent again and unmuted "still-here-1" before launching (2 calls, 0.145 $; good call,
it read the previous turn). Source uploaded 22:13:01, instance reused, sync running. Carlos pressed Cancel once when
the progress line showed `generar_audio.py` (the tool-call text that appears as soon as the call starts), not the
"36 file(s) uploaded; running gpu/generar_audio.py" status, which never came: the request was closed at 68.5 s, in the
middle of the sync. `api.log`: `/api/run/lambda` "closed" 68515 ms; `herramientas.log`: `cancelado: true`, 68915 ms,
no track added, turn ended as cancelled. So the server-side chain (close -> abort -> kill the scp tree) works and one
press is enough once the render is over. What this session never exercised: killing `generar_audio.py` itself while
the DiT runs. A remote check after the cancel returned nothing (the ⏻ Off was pressed seconds later), so whether an
orphan stays on the GPU side is not measured; during a sync there is nothing remote to orphan. UI note for the fix
list: the progress line names the script 70-90 s before it actually runs; the status should say "syncing" until
the "running" aviso.

**Test 10, ⏻ Off 22:14:39-22:16:01: PASS.** One press seconds after the cancel; `/api/gpu/apagar` answered 200 after
81.7 s with `lambda_apagar ... apagada: true, segundos: 81`. `/api/gpu/estado` afterwards lists only the ghost A100
(295bdec6…, "terminating" since May, provider fault, not billed). The A10 ran from 07:12 to 21:16 UTC: 14.1 h at
1.29 $/h, about 18.2 $ for the whole session of tests 1-10. Agent cost of the Claude part of the day (tests 7-10 and
the switch): 16 calls, 1.05 $ of the 100 $ of credit.

**Session closed 22:16.** Open for the next session, in the order proposed to Carlos: (1) "mix" for the model ignores
mute/solo; (2) server-side mixdown of streaming clips into the source, the WAV export and escuchar_mezcla; (3) status
says "syncing" until the "running" aviso, and Cancel during the offline render; (4) control ssh capped at 20 s with one
retry; (5) lego/repaint clip trimmed to its range; (6) drop the "Not in the source" list for a single-track source;
(7) the prompt lesson (ask for missing GPU-costing arguments) written up for Carlos to decide; (8) refuse a silent
source (peak under -60 dBFS) with the reason. Still unexercised: cancel while the DiT runs.
