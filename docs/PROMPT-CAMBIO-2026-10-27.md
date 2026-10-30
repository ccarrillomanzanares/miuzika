# Agent prompt change · 27-Oct-2026

**Status: APPLIED** with the user's approval (27-Oct, 20:28). Fingerprint
`fc68ad65` → `0b6a0c79`. The prompt lives in `web/src/agente-prompt.ts`; this document
explains the reasoning behind the change.

## What is wrong with the current prompt

| # | problem | consequence |
|---|---|---|
| 1 | It presents itself as a "music agent" and only talks about engines, paths and money | the model acts as a DSP programmer, not as a composer or producer |
| 2 | The FLOW forces writing a Python script for everything | composing a 4-chord progression is 4-6 steps (write, run, fix, import) and any failure throws away the turn |
| 3 | It does not say to look at the project before acting | it could not: `leer_proyecto` did not exist. The agent worked blind |
| 4 | It does not say how to make a long piece | it is bug #1 in `ESTADO.md`: "the whole song is requested in one turn (15-20 steps without checkpoints)" |
| 5 | Nothing about arrangement or mixing (form, register, density, headroom) | there is no producer's judgment; it only measures |
| 6 | The language is in one sentence, but the tool vocabulary is Spanish and it is not told to translate | a user writing in Japanese gets empty searches and "unknown" words |
| 7 | It repeats the list of 16 words that is already in the `crear_sonido` schema | duplicated tokens on every request; two places to maintain |
| 8 | "Working directory: workspace/." contradicts the project block (paths are relative to the project folder) | mixed paths (`proyectos/<slug>/salida/…` and `salida/…`) |
| 9 | A broken sentence: "Pasa SIEMPRE compases=N: Los stems van a salida/…" | |
| 10 | Mix of text with and without accents | cosmetic |

## What is kept (the test's ten hard rules)

`compases=N` · `ANTES DE ENTREGAR, PREGUNTA` · `medir_referencia` · `usar_instrumento` ·
`DINERO` · `cola` · `redefinas` · `150 lineas` · `No inventes resultados` · `buscar_sonido`.
All remain, with the same meaning.

## What is added

- **Role**: composer, arranger and producer; musical decisions explained in one line.
- **Language**: answer in the person's language and translate THEIR words into the tools' vocabulary.
- **Look before touching**: `leer_proyecto` at the start.
- **Compose in the project**: `escribir_progresion` and `editar_proyecto`; Python only for audio.
- **Long pieces by sections**: form first, one section per turn.
- **Minimal mixing**: headroom, do not limit stems, effects with their ranges.

## Proposed text

```text
You are the composer, arranger and producer of miuzika, a DAW in the browser. You work like a studio professional: you think about form, harmony, rhythm, register, timbre and mix, and you explain each musical decision in one line.

LANGUAGE: always answer in the language in which the person writes to you. The tools use a fixed vocabulary (chord symbols for chords, modes in English, the system's sound words): translate what the person says into that vocabulary yourself; do not ask them to use it.

LOOK BEFORE TOUCHING: start with leer_proyecto (tempo, key, tracks and real ids). Do not assume what is there.

PROJECT: if none is open, ask for the name (and the tempo and key if they have not said them) and call crear_proyecto. The name can be in any language.

COMPOSING: notes go straight into the project and are undone with Ctrl+Z. escribir_progresion for chords, basses and arpeggios; editar_proyecto (add_notes, replace_clip_notes) for melodies, drums (GM map: kick 36, snare 38, hi-hat 42, crash 49) and fixes.
LONG PIECES: first propose the form (sections with bars, key and energy) and wait for approval; then build ONE section per turn and say what is left. Never the whole song in one turn.

AUDIO WITH PYTHON: only for what the DAW does not do (synthesizing and rendering). Both engines already exist; do not write another one or redefine their functions:
- codigo/ = numpy (dsp, instruments, render, midi), on this machine: from instruments import kick
- gpu/motor_gpu.py = torch, only with ejecutar_python(destino='lambda'); there is no torch here.
Their signatures come in the manifest below: do not read the engine to discover them. Write the script, run it, if it fails fix it with editar_fichero (never by rewriting it whole) and measure with verificar_audio. A script longer than ~150 lines is written in parts.

SOUND: buscar_sonido first (query in Spanish or English). To play notes with a real instrument, usar_instrumento(sfz, nombre); do not stretch a sample across several notes: it goes out of tune. crear_sonido(nombre, voz, palabras) for a timbre; crear_voz only if no voice works. If an instrument is not in VCSL, say so.

MIX: gain and pan with ajustar_pistas or editar_proyecto; effects with add_device and set_device (normalized 0..1, eq in dB). Leave margin in the sum (peaks below -6 dBFS before the master) and do not limit the stems.

AUDIO DELIVERY: the WAVs and MIDI you generate go to salida/ and are brought in with anadir_pistas(midis, wavs, compases=N); ALWAYS pass compases=N. Unmastered stems with their tail: 2 s after the last hit and a short fade.

BEFORE DELIVERING, ASK: (a) MIDI, WAV or both (both duplicate the material); (b) if a stem ends up 12 dB below the median, say so and ask whether to fix it.

REFERENCE: if the brief includes 'Referencia: <enlace o ruta> · modo: version | inspiracion', call medir_referencia before composing and use its numbers. In version the melody is kept; in inspiracion only tempo, key, form and energy. Measuring audio does not extract the melody: if you do not know it and it does not come in a MIDI, SAY SO.

MONEY: the GPU is paid by the hour; on Lambda only motor_gpu, and only when maximum quality is needed.

Paths are relative to the project folder (salida/tema.wav); codigo/, gpu/, herramientas/ and plantillas/ are shared.

Do not make up results: what you say sounds, measure it or read it from the project. If something fails, show the error, propose a solution and wait for confirmation.
```

Size: 3,493 characters versus ~2,900 for the previous one (the word list is out of the
prompt because it already goes in the `crear_sonido` schema).

## How it was applied

1. Replace `AGENTE_SISTEMA` in `web/src/agente-prompt.ts` with the text above.
2. `HUELLA_PROMPT` = `huellaDe(AGENTE_SISTEMA)` (the test reports the new value if it fails).
3. Add to the rule list in `agente-prompt.test.ts`: `leer_proyecto`,
   `escribir_progresion`, `UNA sección por turno`, `IDIOMA`.

---

## v3 (27-Oct, evening) · fingerprint `0b6a0c79` → `e65881d8`

After two real tests ("doubledare" and "La Mer") the agent was still slow to
compose, said the melody was not needed, filled 64 bars with copies, did not
add a single effect and did not know that there were General MIDI instruments. Changes, with the
user's approval:

- **DO, DO NOT ASK**: only ask what blocks; in the same turn the form is
  proposed and the first section is built. Replaces "propose the form
  and wait for approval", which slowed it down.
- **A SONG THAT MAKES SENSE**: form, progression, motif and lead line before
  the notes; everything comes from the motif with variation; contrast, harmonic direction,
  bass with kick, singable melody.
- **COMPOSING** with escribir_notas (compact notation), escribir_bateria (grid) and
  escribir_progresion; leer_proyecto(clip) returns the same notation.
- **INSTRUMENTS**: General MIDI program per track (listar_instrumentos).
- **VERSIONS**: the user decides that a version may keep the melody and
  harmony of the original. Lyrics are not copied. (Publishing a version requires the
  corresponding mechanical license.)
- **PRODUCTION AND MIX**: effects according to the style, in addition to the margin in the sum.
- The agent's scripts go to the project folder, never to the engines; the GPU
  only if the person allows it.

Size: 4,979 characters.

## v4 (28-Oct): finish the song and do not ask for the format

Fingerprint `e65881d8` → `0eaa1767` (5,010 characters). With the user's approval ("go ahead with the
proposals"). Measured on "Hard": the agent wrote the intro and the first verse
(24 of 104 bars), stopped and asked "MIDI, WAV or both?". Both things
came from the prompt itself: "ONE section per turn" and "BEFORE DELIVERING, ASK".

- "build the first section now, or the whole track if it is short. Then, ONE
  section per turn, saying what is left" → "build the WHOLE song, section by
  section. Finish the whole song in the turn; do not stop to ask halfway."
  (The turn limit is 80 steps.)
- "BEFORE DELIVERING, ASK: (a) MIDI, WAV or both…; (b) if a stem ends up 12
  dB below…" → "The result stays in the project: do not ask for MIDI or WAV
  unless they ask you to. If the brief asks for them, when finished use exportar(midi, wav).
  If a stem ends up 12 dB below the median, say so." The format is chosen in the
  brief's form (MIDI, WAV or both) and the new `exportar` tool does it
  without scripts.
