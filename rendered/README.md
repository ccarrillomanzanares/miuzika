# Rendered

Motor Python de sonido de miuzika. Se usa desde `song-worker/` para renderizar
canciones completas en disco.

## Módulos

- `dsp_core.py`: base DSP (notas, wavetables, FM, ruido, filtros, envolventes,
  saturación, paneo, WAV).
- `voices_drums.py`: kick, snare, hat, clap, metal, sweep, impact, rev_cymbal.
- `voices_synths.py`: bass, pad, strings, choir, lead, pluck.
- `voices_extras.py`: piano, órgano drawbar, guitarra crunch, squelch, growl, vinilo.
- `mix_master.py`: reverb, delay, bus glue, limitador, stereo width, medición.
- `midi_export.py`: eventos → SMF tipo 1 por pista y multitrack.

## Uso

```bash
python rendered/voices_extras.py
python rendered/midi_export.py
```

El renderer de canción los importa vía `MIUZIKA_RENDERED`; no hay que copiarlos
al workspace.

## Memoria

Las voces devuelven arrays mono; el streaming, la mezcla por trozos y la reverb
overlap-add viven en `song-worker/render_song.py`. No se carga la canción entera
en memoria.
