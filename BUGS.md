# Bugs

The 14 listed on 6-Nov-2026 when the GUI was separated from miuzika, and how each ended up.
"Verified" = run end to end in headless Chrome the same day.

No bug is open as of 12-Nov-2026. Bugs 11 (a silent export) and 12 (mute states swapped) were never reproduced and were dropped
from this list on request; the export still renders a second time when the first comes out silent, and says so.

## Known limitations (facts of the code, not bugs to fix)

- **A long WAV that does not fit the decode budget plays outside openDAW's mixer**: with its gain, pan and the master, without
  its track's effects and sends (it is not decoded, so it cannot enter the mixer). The Log says so for each affected track, in
  Play and in the export. Since 12-Nov the WAVs on tracks with an effect switched on or a send take the budget first (unit test
  only: no project on disk has effects and the GUI cannot add them).
- **A project cannot be longer than 512 bars**: a file longer than that at the project's tempo is refused on import.

## Fixed and verified

| # | Bug | Now |
|---|---|---|
| 1 | A new project took over an existing folder and overwrote its proyecto.json | A free folder (`tema-2`); a project file with another id does not overwrite either |
| 2 | Undo and redo were not saved | Saved like any change |
| 3 | A change followed by closing within 1.5 s was lost | Written before switching; on reload too, and the browser asks before leaving |
| 4 | Play ignored the cursor; pause was stop | Play starts at the cursor, pause resumes, Stop goes back to the start |
| 5 | A .mid could not be opened (Chrome types it audio) | MIDI is asked first; a broken .mid opens nothing |
| 6 | Only WAV imported, although the selector offered more | MP3, FLAC, OGG and float WAV become a 24-bit WAV on arrival (AIFF and M4A take the same path, not run); a broken file gives a clear error and opens nothing |
| 7 | A MIDI in a new project stayed at 120 BPM, with no notice | A new project takes the file's tempo; in an open project the warning reaches the Log |
| 8 | Moving, copying or deleting a clip was not heard until Stop + Play | The engine remounts from where it was (0.43 s in the check, so a short gap is audible) |
| 9 | The export left long WAVs out and the Log did not say so | They are mixed in, one at a time, with gain, pan and master |
| 10 | Long WAVs played without the track's pan and the master gain | Both apply; effects and sends do not: see Known limitations |
| 13 | "Audio" was disabled with no project | Enabled; goes through the same path as "Open" |
| 14 | The empty project was built by hand | `createProject` |

## Found later, all fixed

- **15. The empty timeline still says "Ask the agent for a piece in the chat"** (`web/src/timeline.ts`). There is no agent or chat here. Seen 6-Nov
  in a screenshot. FIXED 7-Nov: "Generate one from Modules, or drop a WAV, a .mid or a project here." (seen headless).
- **16. Other POST routes do not check where a request comes from.** Settings refuses other origins, but `/api/gpu/ejecutar` and `/api/gpu/apagar` do not, so a
  web page open in the same browser could in principle reach them, and the first spends money. Read in the code on 6-Nov, not tried. FIXED 7-Nov:
  `rutaJson` refuses (403) every JSON POST whose Origin is another host; no Origin (scripts) and the app's own page pass. Unit test; on the
  simulated server a POST to `/api/gpu/apagar` with Origin `https://evil.example` got 403 and the whole module path still ran. The two POST
  routes not built on `rutaJson` (`/api/audio/subir`, `/api/proyectos`) check it too: 403 measured the same way, and autosave and the source
  upload still work from the app.
- **17. In a narrow window the header's texts and buttons overlap.** Seen by the user on 7-Nov at about 950 px: the GPU text and "Off" fall under Modules and the buttons, and Off is what stops the billing. FIXED 7-Nov: the header wraps. Measured at 1400, 1100, 950, 700, 480 and 360 px: no overlaps, nothing outside the window, Off clickable.
- **18. Under 980 px the lower half of the window stayed empty.** A grid row left over from the chat panel, which does not exist here. Seen in the same measurement on 7-Nov. FIXED the same day: rule removed.
- **19. A take's track appeared without its waveform.** Seen by the user on 7-Nov with `toma-2`, the second real take in the open tab. On disk all is right (WAV, clip, asset) and the browser fetched audio and peaks with 200. Not reproduced: a second take with the simulated GPU draws, and a copy of the project opened with both real WAVs draws. After reloading the tab and reopening the project, both waveforms showed (the user, 7-Nov): so it was only that tab's drawing, the data was right. FIXED the same day. Cause: the canvas kept the height of the tracks there were when the project opened, and a track added to the open project was drawn below it, until something resized it. The simulated runs hid it: their lineage has no readable commit, so a red message opened the log, which resizes. Reproduced without that message (row empty), and drawn after the fix. Nothing to do with the CSS changes.
- **20. With a random seed, the take recorded a seed that was not the one used.** ACE-Step `ca1e85f` draws one seed to report (`inference.py`, `prepare_seeds`) and, told "random", the handler draws another to generate. So Repeat could not repeat such a take: measured 7-Nov, `toma` (random, reported 1097560858) against `toma-2` (asked for 1097560858), 99.66 % of samples differ, while `toma-2` against `toma-2-2` (same fixed seed, same machine) are identical byte for byte. FIXED the same day in `generar_audio.py`: the script always draws the seed itself and asks for it fixed. Checked with the simulated GPU only; `toma` keeps its false number, the only take affected.
- **21. A source made of several tracks can clip.** Measured 7-Nov: `toma`, `bajo-1` and `bajo-2` sum to +3.5 dBFS and the 16-bit WAV cuts it at full scale (0.052 % of samples), while Review shows the +3.5 without saying so. Should come down in level before sending, without touching the tracks. FIXED 12-Nov (requested: fix the open bugs): a source over full scale is turned down as a whole to -0.1 dBFS before the WAV is written, and Review says so ("peak +5.1 dBFS, turned down 5.2 dB so it does not clip"); a source that fits is sent at its own level. Headless: two tracks summing to +5.1 dBFS gave a file peaking at -0.10 dBFS with 0 samples at full scale; one track alone at -0.9 dBFS was left as it was.
- **22. Repeat proposes a name that is taken.** Seen 7-Nov: Repeat of `guitarra-c` (3 takes) proposes `guitarra-c-2`, and the server refuses it because `guitarra-c-2.wav` exists. `nombreLibre` only looks at the names of the lineages, not at the files of each take. FIXED 7-Nov (afternoon): `/api/gpu/tomas`
  returns each take's WAV names (`outputs[].file` of the lineage) and both Repeat and the proposed name avoid them. Simulated path: Repeat of a
  3-take run `prueba-bugs` (files -1..-3) proposes `prueba-bugs-4`.
- **23. A new project's folder and name differ.** Seen by the user on 7-Nov: the project "toma" lives in `proyectos/ace-step/`. With Name empty,
  Review chose the folder before proposing the name (`revisar`: `prepararFuente` first, the name after), so the folder took the default
  `ace-step` and the project the proposed "toma". The same if the name was changed on Review: the folder kept the form's. FIXED 7-Nov: the
  name is proposed first, and a new project's folder is taken from the name as it leaves Review (unless a File source was already uploaded
  into the earlier folder). typecheck and unit tests green. Checked by the user's run on 7-Nov: `bateria-1` landed in `proyectos/bateria-1/`.
  The existing "toma" keeps its folder.
- **24. "Bars 1 to (end)" with a tracks source gives a clip one bar too long.** Seen 7-Nov with `bajo-1` over `bateria-1` (8 bars): the render
  runs 0.27 s (0.19 bars) past the last clip, `prepararFuente` rounds `segundosPedidos` up, so `entrega.compases` = 9 and the clip lasts 36
  beats; Repeat inherits it (`bajo-1-2`). Fix proposed: with no last bar, take the end of the chosen tracks' clips, not the render's length.
  Workaround: type the last bar. FIXED 7-Nov (afternoon): with no last bar, the source ends at the last bar the chosen tracks' clips reach
  (`ultimoCompasDeClips`), and Review says "bars 1-8 (end)". Simulated path: source 14.118 s = 8+2 bars at 170, clips 32 beats. `bajo-1` and
  `bajo-1-2` in `bateria-1` keep their 9-bar clips: shorten them by hand or leave them.
- **25. A chosen file looks unchosen.** Seen by the user on 7-Nov (screenshot): the Reference row says "Ningún archivo seleccionado" next to
  "Chosen: Depeche Mode - Ghosts Again….mp3". The window repaints its HTML and the browser empties every `<input type="file">`, while the app
  keeps the file (`archivoReferencia`). The same for the File source. What is sent is right, but it made him doubt it. Fix proposed: hide the
  browser's text and show only "Chosen: …" with Change and Remove. FIXED 7-Nov (the user: "arregla los bugs"): the Reference row is gone,
  and the File source is a hidden input inside a button-styled label ("Choose a file…" / "Change…") beside the kept file's name. Seen
  headless: "Choose a file… none chosen", then "Change… corto.wav".
- **26. A reload leaves the app empty and the next drop starts another project.** Seen 7-Nov: my edit to `web/` reloaded the page, and the app
  does not reopen the last project. The user dropped `vein-cover-1.wav`, which made a new project `vein-cover-1` at the default 120 BPM instead
  of vein's 92. The run `vein-cover-ref` then went there: bars 1-24 = 48 s, bpm 120 sent. The fix is the pending proposal "reopen the last
  project on load"; until then a reload must be announced together with "reopen your project". FIXED 7-Nov: the open project's folder
  was already kept in localStorage but never read. `main.ts` reads it before the session exists and reopens it through the Projects
  path, so nothing is rewritten. A folder deleted since is skipped. Seen headless: open `vein`, reload, it comes back with
  "Opened from disk “vein”… 92 BPM".
- **27. A drums .mid with no Program Change imports as a piano.** Seen by the user on 8-Nov importing MuLaCover's `drums.mid`: "los tres suenan
  a piano". `midi_lector.py` took the channel only from a Program Change, so notes on channel 10 read as channel 1 and became `synth`
  program 0. (melody.mid and chord.mid sounding as piano is right: no program in a MIDI means GM 0, the piano.) FIXED 8-Nov: with no
  Program Change the channel is taken from the first note. Measured on the three files: drums ch9 (→ drumkit), melody and chord ch0.
  Already imported tracks stay as they are: import `drums.mid` again.
- **28. Short ssh commands to the GPU hang now and then, and one retry is not enough.** 8-Nov, five times in one day: "ssh cut off
  after 20 s" at sync or upload (q03, r03, r-ext-q01-keyboard, sa2-transformar), and once the outputs listing after a good run
  (`sa2-drums-x2`: two takes generated, "the outputs could not be listed (ssh exit 1)", nothing brought back; the files were there).
  Measured right after: five ssh connections at 1.3-1.4 s, and the same listing by hand answered at once. The cause is still unknown
  (same as 5-Nov: 3 of 16). FIXED 8-Nov: `sshControl` tries three times instead of two, each still capped at 20 s.
- **29. The Pad plays into silence when its track is muted or another track is soloed, and says nothing.** Seen by the user on
  8-Nov in `chord`: "no se oye nada del touchpad ni del numpad". In that project the four MIDI tracks are muted and the audio
  track `ghosts-orig-stems-bass` is on Solo; the engine applies mute/solo to live notes too (`syncMix`), so whatever track the
  Pad picks is silent. Read in the project file and the code. Measured the same evening on a copy of `chord` as he left it
  ("Pad drums" unmuted, no solo), tapping the engine's output headless: numpad peaks 0.49-0.50 stopped, in the loop and
  during Play; the loop's replay 0.18. Also measured: right after Play the engine reloads (~3 s on this project) and keys
  played meanwhile are silent. Not confirmed by ear. FIXED 9-Nov (the user chose the recommendation): each source's
  track that cannot be heard says so in the panel, with "Unmute", or "Solo this track too" when another track is on Solo
  (adding it to Solo keeps what was being listened to). Headless: mute → warning → Unmute clears it; Solo on the other
  track → warning → both on Solo. The ~3 s reload after Play: FIXED 12-Nov, see 42.

## From the code review of 6a165e7 (9-Nov, `/code-review high`, two runs; read in the code, not reproduced)

- **30. The taken-name check of the module windows has several holes.** (a) Its answer is cached by name and never reset
  when the project changes: a name taken in project A keeps Run disabled in project B. (b) Run now awaits the check before
  marking the run as started, so a double click can launch two paid GPU runs with the same name. (c) A name edited while
  the check is in flight, or an older answer arriving late, can leave the wrong verdict. (d) In MuLaCover and Demucs the
  answer repaints the whole Review and takes the focus while typing. (e) The GET endpoint creates the project folder
  (`carpetaProyecto` runs mkdir) and is asked on every keystroke in ACE-Step's name field. (f) The same block is copied
  into four windows. Root cause, per the review: Run closes the window before the server has validated the request;
  `/api/gpu/ejecutar` already answers 409 before the machine boots, so keeping the window open until that answer would
  remove (a)-(f) and the endpoint.
- **31. The server's name test misses real collisions.** (a) It compares file names case-sensitively, but NTFS is not:
  a new take `toma` overwrites `Toma.wav`. (b) It checks only `<name>.wav` and `<name>.lineage.json`, while multi-take
  runs write `<name>-1.wav`, `<name>-2.wav` (ACE-Step, Stable Audio) and Demucs writes `<name>-drums.wav`…: a run named
  `bajo` with 2 takes overwrites an existing take `bajo-1`. Confirmed in the scripts' naming.
- **32. Pad: Esc meant for the New or Projects dialog opened from the Pad closes the Pad** (its page-level Esc listener
  does not look at where the key came from).
- **33. Pad: New… inside the Pad skips the busy guard** of the header's New (it can open while a project is loading).
- **34. Pad: every mute/solo/volume change now runs the whole panel setup** (canvas resize, track selects rebuilt, held
  touchpad notes released, engine check). Only the warnings need repainting.
- **35. Pad: small ones.** With no project the mapped keys are still swallowed (page shortcuts seem dead); "Unmute" /
  "Solo this track too" do nothing, silently, while the session is busy; the no-project branch of `proyectoCambiado`
  never runs (main returns before calling it on a null project).
- **30-35 FIXED 9-Nov** (approved as proposed). 30: the endpoint, the cache and the four copies are gone; each window marks
  the run as started at once (a second click does nothing), sends it and waits for the server's answer, which now arrives
  before the boot (`flushHeaders`); only if it accepts does the window close, else the reason is shown on Review with the
  form kept (any refusal, not only the name). 31: `server/nombres-toma.ts`, without case and with `<name>-…` (tests), and
  ACE-Step's proposed names follow the same rule. 32: Esc is left to any modal open over the Pad. 33: New inside the Pad
  goes through the header's button. 34: a mix change repaints only the warnings; tracks, instruments or key changed →
  the selects are rebuilt. 35: no keys taken with no project; busy → a Log line; the dead branch removed. Headless on the
  simulated GPU: refused "bajo" next to bajo-1.wav (window open, reason shown, 1 request); double click on Run → 1
  request; Esc in New closes New only; mute keeps the selects. Stable Audio, MuLaCover and Demucs share the new code but
  were not run one by one.

## From the hands-on test of 10-Nov (Pad and piano roll)

- **36. A drum track without a program never loads the GM SoundFont.** The adapter plays a `drumkit` without program
  through the GM standard kit (4-Nov), but `cargarGm` only fetches the SoundFont when some track has `instrument.program`
  (`web/src/sonidos-proyecto.ts`). A project whose only drums are the Pad's ("Pad drums", no program) and no GM track
  falls back to the 13-WAV Playfield kit, which has no note 50: heard, the Pad's High tom is silent. Those WAVs
  (`web/public/drums/`) also have no recorded source or license in a public repo.
- **37. Pad: with no track chosen it plays into silence without a visible word.** The keys say "Pick a track for the
  keys." in the status line, easy to miss; the touchpad says nothing.
- **38. Piano roll: the page's shortcuts act behind it.** Ctrl+Z / Ctrl+Y undo and redo the project while the editor's
  own edits are pending; Ctrl+A/C/V/D and Delete also act on the timeline. If the undo removes or changes the clip being
  edited, Apply writes the notes over it.
- **39. Piano roll: it only shows C2–C6 (MIDI 36–84).** A take recorded with the Pad at G1–D2 is mostly invisible there.
- **36-39 FIXED 10-Nov** (requested: fix what was found; only the GM kit for drums). 36: `cargarGm` also loads for any
  drum track; the 13-WAV kit, its table and `web/public/drums/` are gone, and without the GM SoundFont a drum track is
  silent with a warning. 37: each source with no track says so in the panel. 38: with the piano roll open the page's
  keys wait (the Pad keeps its Ctrl+Z); the editor's Esc listener is also removed when it closes by a button. 39: the
  piano roll covers 0-127 and opens scrolled to the clip's notes. Headless on :5181 (measured, not heard): a project
  whose only drums have no program fetches the GM and its high tom (50) peaks 0.50, the clap (39) 0.54, an empty clip 0;
  piano roll opened on G1-D2 notes with them in view, Ctrl+Z inside left the mute in place and undid it once closed;
  Pad with no track shows both warnings.
- **40. Piano roll: closing with ×, Esc or a click outside discards the edits without a word** (11-Nov, reported:
  after closing and opening again the changes were gone). Only Apply kept them; with the new editor's tools,
  losing a session of edits that way is easy.
- **40 FIXED 11-Nov.** ×, Esc, a click outside and Apply all keep the edits, as one change; only Discard (was Cancel)
  throws them away, after asking. Also built with it, requested: M and S in the editor's bar toggle the track's mute and
  solo live, with the warning kept up to date ("muted" / "another track is on Solo"). Headless: Esc, × and a click
  outside each kept the added note; closing without edits left the project untouched; Discard asked and kept nothing;
  M/S set the track and lit up.
  Then (reported: after closing and opening again undo was no longer available): each clip's undo/redo is kept in
  memory for the tab and comes back when the clip is opened again, unless its notes changed elsewhere meanwhile (an undo
  in the main window), in which case it starts fresh. Headless: two notes added, closed, reopened, Ctrl+Z → one, closed,
  reopened, Ctrl+Y → both; after the main window's undo changed the clip, the editor opened with no undo.
- **41. Undo/redo while the app is busy did nothing, silently** (seen headless 11-Nov: a Ctrl+Z pressed while the
  instruments loaded looked like a lost undo). FIXED 11-Nov (requested: say so): still refused, but the status line
  says "Undo waits: the app is busy. Try again in a moment." (also in the Log); the end of the busy state clears it.
  Headless: busy → that line, Log (1), the mute kept; free → the same Ctrl+Z undid it; with nothing to undo, no line.

## Fixed on 12-Nov (requested: fix the open bugs)

- **42. Pause, Stop and the end of the song unloaded the engine** (the rest of 29). The next Play, the Pad's next key and
  the piano roll's next audition waited for the whole project to be mounted again, and Play with the Pad open threw away
  the engine the Pad had just loaded. FIXED: Pause and Stop stop the transport and keep the engine; Play starts the one
  that is loaded. Only a change to the project's structure unloads it, as before. Headless, Pad open: Play sounding in
  0.06-0.08 s on the same engine (was ~3 s), Pause keeps the beat, Play goes on from it, Stop leaves the cursor at 0,
  the end of the project stops there and Play from the end starts at bar 1. Cost: the engine's copy of the decoded WAVs
  stays in memory while paused (it was already there while playing).
- **43. Long WAVs (streamed, outside the engine) were silent under the Pad's loop** (read in the code 8-Nov). The Pad
  starts the engine by itself and nothing started them. FIXED: they start whenever the transport is told to start,
  whoever asks, and jump back with every pass. Headless, 1-bar loop at 120 BPM over a streamed 250 s WAV: its position
  ran 0 → 2 s and back on each of 4 passes, and it paused when the loop stopped.
- **44. A Pad take could hold two notes of the same pitch on the same instant** (seen 10-Nov: two identical G1 on one
  beat). The take is no longer on disk and no clip of any project has such a pair, so its cause was not found. Two
  ways the recorder makes them by itself: the same slot played in two passes with quantize on, and note repeat held for
  more than one pass. FIXED: in the clip they are one note, the longer and the louder (unit test). Hits of the same
  pitch 1/32 of a beat apart or more stay two.
