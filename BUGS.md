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
  in a screenshot; listed, not fixed.
- **16. Other POST routes do not check where a request comes from.** Settings refuses other origins, but `/api/gpu/ejecutar` and `/api/gpu/apagar` do not, so a
  web page open in the same browser could in principle reach them, and the first spends money. Read in the code on 6-Nov, not tried; listed, not fixed.
- **17. In a narrow window the header's texts and buttons overlap.** Seen by Carlos on 7-Nov at about 950 px: the GPU text and "Off" fall under Modules and the buttons, and Off is what stops the billing. FIXED 7-Nov: the header wraps. Measured at 1400, 1100, 950, 700, 480 and 360 px: no overlaps, nothing outside the window, Off clickable.
- **18. Under 980 px the lower half of the window stayed empty.** A grid row left over from the chat panel, which does not exist here. Seen in the same measurement on 7-Nov. FIXED the same day: rule removed.
- **19. A take's track appeared without its waveform.** Seen by Carlos on 7-Nov with `toma-2`, the second real take in the open tab. On disk all is right (WAV, clip, asset) and the browser fetched audio and peaks with 200. Not reproduced: a second take with the simulated GPU draws, and a copy of the project opened with both real WAVs draws. After reloading the tab and reopening the project, both waveforms showed (Carlos, 7-Nov): so it was only that tab's drawing, the data was right. FIXED the same day. Cause: the canvas kept the height of the tracks there were when the project opened, and a track added to the open project was drawn below it, until something resized it. The simulated runs hid it: their lineage has no readable commit, so a red message opened the log, which resizes. Reproduced without that message (row empty), and drawn after the fix. Nothing to do with the CSS changes.
- **20. With a random seed, the take recorded a seed that was not the one used.** ACE-Step `ca1e85f` draws one seed to report (`inference.py`, `prepare_seeds`) and, told "random", the handler draws another to generate. So Repeat could not repeat such a take: measured 7-Nov, `toma` (random, reported 1097560858) against `toma-2` (asked for 1097560858), 99.66 % of samples differ, while `toma-2` against `toma-2-2` (same fixed seed, same machine) are identical byte for byte. FIXED the same day in `generar_audio.py`: the script always draws the seed itself and asks for it fixed. Checked with the simulated GPU only; `toma` keeps its false number, the only take affected.
- **21. A source made of several tracks can clip.** Measured 7-Nov: `toma`, `bajo-1` and `bajo-2` sum to +3.5 dBFS and the 16-bit WAV cuts it at full scale (0.052 % of samples), while Review shows the +3.5 without saying so. Should come down in level before sending, without touching the tracks. Listed, not fixed.
- **22. Repeat proposes a name that is taken.** Seen 7-Nov: Repeat of `guitarra-c` (3 takes) proposes `guitarra-c-2`, and the server refuses it because `guitarra-c-2.wav` exists. `nombreLibre` only looks at the names of the lineages, not at the files of each take. Listed, not fixed.
