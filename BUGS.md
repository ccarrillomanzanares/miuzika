# Bugs

The 14 listed on 6-Nov-2026 when the GUI was separated from miuzika, and how each ended up.
"Verified" = run end to end in headless Chrome the same day. Nobody has listened to any of this yet.

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
| 13 | "Audio" was disabled with no project | Enabled; goes through the same path as "Open" |
| 14 | The empty project was built by hand | `createProject` |

## Fixed in part

- **10. Long WAVs in Play.** Pan and master gain now apply. **Effects and sends still do not**: a stem is not
  decoded, so it cannot enter openDAW's mixer. The Log says so for each affected track, in Play and in the export.

## Not fixed, because they were never reproduced

- **11. Silent export.** The cause is still unknown. What exists now: a silent render with tracks that should sound is
  rendered once more, and the Log warns if the mix stays silent. The all-muted warning was run; the retry was not,
  since the failure could not be provoked.
- **12. Mute states swapped in static-hymn on 6-Nov** between 18:34 and 18:40. Cause unknown, may have been by hand.

## Open

- **15. The empty timeline still says "Ask the agent for a piece in the chat"** (`web/src/timeline.ts`). There is no agent or chat here. Seen 6-Nov
  in a screenshot. FIXED 7-Nov: "Generate one from Modules, or drop a WAV, a .mid or a project here." (seen headless).
- **16. Other POST routes do not check where a request comes from.** Settings refuses other origins, but `/api/gpu/ejecutar` and `/api/gpu/apagar` do not, so a
  web page open in the same browser could in principle reach them, and the first spends money. Read in the code on 6-Nov, not tried. FIXED 7-Nov:
  `rutaJson` refuses (403) every JSON POST whose Origin is another host; no Origin (scripts) and the app's own page pass. Unit test; on the
  simulated server a POST to `/api/gpu/apagar` with Origin `https://evil.example` got 403 and the whole module path still ran. The two POST
  routes not built on `rutaJson` (`/api/audio/subir`, `/api/proyectos`) check it too: 403 measured the same way, and autosave and the source
  upload still work from the app.
- **17. In a narrow window the header's texts and buttons overlap.** Seen by Carlos on 7-Nov at about 950 px: the GPU text and "Off" fall under Modules and the buttons, and Off is what stops the billing. FIXED 7-Nov: the header wraps. Measured at 1400, 1100, 950, 700, 480 and 360 px: no overlaps, nothing outside the window, Off clickable.
- **18. Under 980 px the lower half of the window stayed empty.** A grid row left over from the chat panel, which does not exist here. Seen in the same measurement on 7-Nov. FIXED the same day: rule removed.
- **19. A take's track appeared without its waveform.** Seen by Carlos on 7-Nov with `toma-2`, the second real take in the open tab. On disk all is right (WAV, clip, asset) and the browser fetched audio and peaks with 200. Not reproduced: a second take with the simulated GPU draws, and a copy of the project opened with both real WAVs draws. After reloading the tab and reopening the project, both waveforms showed (Carlos, 7-Nov): so it was only that tab's drawing, the data was right. FIXED the same day. Cause: the canvas kept the height of the tracks there were when the project opened, and a track added to the open project was drawn below it, until something resized it. The simulated runs hid it: their lineage has no readable commit, so a red message opened the log, which resizes. Reproduced without that message (row empty), and drawn after the fix. Nothing to do with the CSS changes.
- **20. With a random seed, the take recorded a seed that was not the one used.** ACE-Step `ca1e85f` draws one seed to report (`inference.py`, `prepare_seeds`) and, told "random", the handler draws another to generate. So Repeat could not repeat such a take: measured 7-Nov, `toma` (random, reported 1097560858) against `toma-2` (asked for 1097560858), 99.66 % of samples differ, while `toma-2` against `toma-2-2` (same fixed seed, same machine) are identical byte for byte. FIXED the same day in `generar_audio.py`: the script always draws the seed itself and asks for it fixed. Checked with the simulated GPU only; `toma` keeps its false number, the only take affected.
- **21. A source made of several tracks can clip.** Measured 7-Nov: `toma`, `bajo-1` and `bajo-2` sum to +3.5 dBFS and the 16-bit WAV cuts it at full scale (0.052 % of samples), while Review shows the +3.5 without saying so. Should come down in level before sending, without touching the tracks. Listed, not fixed.
- **22. Repeat proposes a name that is taken.** Seen 7-Nov: Repeat of `guitarra-c` (3 takes) proposes `guitarra-c-2`, and the server refuses it because `guitarra-c-2.wav` exists. `nombreLibre` only looks at the names of the lineages, not at the files of each take. FIXED 7-Nov (afternoon): `/api/gpu/tomas`
  returns each take's WAV names (`outputs[].file` of the lineage) and both Repeat and the proposed name avoid them. Simulated path: Repeat of a
  3-take run `prueba-bugs` (files -1..-3) proposes `prueba-bugs-4`.
- **23. A new project's folder and name differ.** Seen by Carlos on 7-Nov: the project "toma" lives in `proyectos/ace-step/`. With Name empty,
  Review chose the folder before proposing the name (`revisar`: `prepararFuente` first, the name after), so the folder took the default
  `ace-step` and the project the proposed "toma". The same if the name was changed on Review: the folder kept the form's. FIXED 7-Nov: the
  name is proposed first, and a new project's folder is taken from the name as it leaves Review (unless a File source was already uploaded
  into the earlier folder). typecheck and unit tests green. Checked by Carlos's run on 7-Nov: `bateria-1` landed in `proyectos/bateria-1/`.
  The existing "toma" keeps its folder.
- **24. "Bars 1 to (end)" with a tracks source gives a clip one bar too long.** Seen 7-Nov with `bajo-1` over `bateria-1` (8 bars): the render
  runs 0.27 s (0.19 bars) past the last clip, `prepararFuente` rounds `segundosPedidos` up, so `entrega.compases` = 9 and the clip lasts 36
  beats; Repeat inherits it (`bajo-1-2`). Fix proposed: with no last bar, take the end of the chosen tracks' clips, not the render's length.
  Workaround: type the last bar. FIXED 7-Nov (afternoon): with no last bar, the source ends at the last bar the chosen tracks' clips reach
  (`ultimoCompasDeClips`), and Review says "bars 1-8 (end)". Simulated path: source 14.118 s = 8+2 bars at 170, clips 32 beats. `bajo-1` and
  `bajo-1-2` in `bateria-1` keep their 9-bar clips: shorten them by hand or leave them.
- **25. A chosen file looks unchosen.** Seen by Carlos on 7-Nov (screenshot): the Reference row says "Ningún archivo seleccionado" next to
  "Chosen: Depeche Mode - Ghosts Again….mp3". The window repaints its HTML and the browser empties every `<input type="file">`, while the app
  keeps the file (`archivoReferencia`). The same for the File source. What is sent is right, but it made him doubt it. Fix proposed: hide the
  browser's text and show only "Chosen: …" with Change and Remove. FIXED 7-Nov (Carlos: "arregla los bugs"): the Reference row is gone,
  and the File source is a hidden input inside a button-styled label ("Choose a file…" / "Change…") beside the kept file's name. Seen
  headless: "Choose a file… none chosen", then "Change… corto.wav".
- **26. A reload leaves the app empty and the next drop starts another project.** Seen 7-Nov: my edit to `web/` reloaded the page, and the app
  does not reopen the last project. Carlos dropped `vein-cover-1.wav`, which made a new project `vein-cover-1` at the default 120 BPM instead
  of vein's 92. The run `vein-cover-ref` then went there: bars 1-24 = 48 s, bpm 120 sent. The fix is the pending proposal "reopen the last
  project on load"; until then a reload must be announced together with "reopen your project". FIXED 7-Nov: the open project's folder
  was already kept in localStorage but never read. `main.ts` reads it before the session exists and reopens it through the Projects
  path, so nothing is rewritten. A folder deleted since is skipped. Seen headless: open `vein`, reload, it comes back with
  "Opened from disk “vein”… 92 BPM".
- **27. A drums .mid with no Program Change imports as a piano.** Seen by Carlos on 8-Nov importing MuLaCover's `drums.mid`: "los tres suenan
  a piano". `midi_lector.py` took the channel only from a Program Change, so notes on channel 10 read as channel 1 and became `synth`
  program 0. (melody.mid and chord.mid sounding as piano is right: no program in a MIDI means GM 0, the piano.) FIXED 8-Nov: with no
  Program Change the channel is taken from the first note. Measured on the three files: drums ch9 (→ drumkit), melody and chord ch0.
  Already imported tracks stay as they are: import `drums.mid` again.
- **28. Short ssh commands to the GPU hang now and then, and one retry is not enough.** 8-Nov, five times in one day: "ssh cut off
  after 20 s" at sync or upload (q03, r03, r-ext-q01-keyboard, sa2-transformar), and once the outputs listing after a good run
  (`sa2-drums-x2`: two takes generated, "the outputs could not be listed (ssh exit 1)", nothing brought back; the files were there).
  Measured right after: five ssh connections at 1.3-1.4 s, and the same listing by hand answered at once. The cause is still unknown
  (same as 5-Nov: 3 of 16). FIXED 8-Nov: `sshControl` tries three times instead of two, each still capped at 20 s.
