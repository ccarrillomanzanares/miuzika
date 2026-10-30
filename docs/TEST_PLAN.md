# miuzika test plan

Target version: **0.11.0**. Scope: GUI/openDAW + Strudel → WAV.

Runs at `http://localhost:5173`. Evidence per case: result, UI messages,
console errors and the state of `window.__miuzika`.

## P0 — smoke

- [ ] **A1. Clean start**: `npm run dev`; the UI loads with no uncaught
  errors; `crossOriginIsolated === true`.
- [ ] **A2. Single origin**: `127.0.0.1:5173` does not serve the app.
- [ ] **A3. Persistence**: create a project, reload; project and history come back.
- [ ] **A4. New project**: **New** clears the timeline.

## GUI / openDAW

- [ ] **D1. MIDI playback**: the position advances and there is signal.
- [ ] **D2. Playfield**: drums with a non-zero peak/RMS.
- [ ] **D3. Mute/solo on the fly**: the playhead is not restarted.
- [ ] **D4. Stop/seek**.
- [ ] **D5. WAV**: import audio, place it and play it back.
- [ ] **C1. Timeline**: zoom, seek.
- [ ] **C2. Piano roll**: add/move/delete notes.
- [ ] **C3. Selection and deletion**.

## Strudel → WAV

- [ ] **F1. Synth**: `note("c3 e3 g3").s("sawtooth")`; WAV and audio track.
- [ ] **F2. Samples**: `s("bd sd hh")`; WAV with signal.
- [ ] **F3. `$:` blocks**: pattern with several blocks; renders without errors.
- [ ] **F4. Re-render**: replaces the track; does not duplicate it.
- [ ] **F5. Playback**: the WAV plays through openDAW.
- [ ] **F6. No network**: clear error/warnings; does not hang.

## Persistence

- [ ] **J1. Reload** with a project and audio.
- [ ] **J2. Missing asset**: warning, no crash.
- [ ] **J3. Open** an existing **JSON**.
- [ ] **J4. Open** an existing **`.miuzika.zip` bundle**.
