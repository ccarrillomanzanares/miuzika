# Phased plan

Status: **Phase 0 done -> Phase 3 almost done (3.6 and 3.7 missing) -> 1, 2, 4 and 5
pending**.

**27-Oct**: the decision that blocked the rest ("score as data, yes or no") is
made: **yes, and it already existed**. It is `proyecto.json` with its ops; the agent
uses them with `editar_proyecto` and `escribir_progresion` (see
`docs/REVISION-2026-10-27.md`). Phase 1 becomes the next step.
The order is not the list order: we started with sound creation because it depends on
nothing and unblocks the rest (to mix you need sounds to mix). Architecture and live
debt are in `docs/ARCHITECTURE.md`.

---

## Phase 0 — Foundation — DONE

Agent context per project (`proyectos/<slug>/agente.json`: 8 turns + summary), long
outputs by reference in `_salidas/`, bounded logs with rotation, clips measured in bars
(`anadir_pistas(compases=N)`, `igualar_clips`), and the agent asks before delivering
(MIDI vs WAV, stems 12 dB down).

---

## Phase 3 — Sound creation — ALMOST

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

---

## Phase 1 — Teach the agent to mix (after 3)

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

---

## Phase 2 — Minimal mix UI

- **Insert list per track** (add/remove/enable, sliders with real units).
- **Meter** (`MeterWorklet`) on track and master.
- "Bounce" (to `salida/mezcla.wav`) and "Freeze" buttons.
- **Sends** panel (A/B to a reverb/delay bus).
- **Verify**: UI fader and chat produce the same `proyecto.json`; meter and bounce
  match within ±0.3 dB; 21 tracks without underruns.

**Out of scope**: automation, curves, snapshots.

---

## Phase 4 — Analysis and suggestions

- `analizar_mezcla`: peak, RMS, LUFS, crest, DC and correlation per stem and in the sum
  (already in `dsp.py`), plus `AutoEq` for the suggested curve.
- Table in chat + suggestions applicable only if the user says yes.
- Permanent warning about duplicated material (MIDI + WAV of the same instrument).
- **Verify**: on "Stahl" it flags the `sint` at -31.7 dBFS and proposes the correction
  without touching anything.

**Out of scope**: automatic mastering.

---

## Phase 5 — A single engine job

- Generic `trabajo`: `{id, tipo: render|bounce|analisis|sonido, destino: cpu|gpu,
  script, estado, progreso, salida, coste, cancelar}`.
- Replaces `/api/run/python` and `/api/run/lambda`; the numpy 409 and the cost counter
  become job properties.
- GPU only if the job asks for it (`motor_gpu`), with real cost warning and shutdown at
  the end.
- **Verify**: two jobs at once do not step on each other; cancel leaves the instance
  shutting down; displayed cost matches the invoice.

---

## Usual gates

In every phase: `npx tsc --noEmit` = 0, `npm run test:unit` green, `npm test`
(openDAW), `npm run build:web`, and a real browser test on `localhost:5173`.
