# Rendered

Motor Python de sonido para miuzika. Es la parte reutilizada del renderizador que
generó el material de referencia; se copió **sin modificar** desde
`C:\Users\carlos\dm-song` (el original sigue intacto).

## Módulos

- `dsp_core.py` — base DSP: notas, wavetables con límite de banda, FM, ruido espectral,
  envolventes, SVF/FFT, saturación, paneo, Haas, WAV.
- `voices_drums.py` — kick, snare, hat, clap, metal, sweep, impact, rev_cymbal.
- `voices_synths.py` — bass, pad, strings, choir por formantes, lead, pluck.
- `mix_master.py` — IR de reverb, convolución FFT, ping-pong, bus glue, limitador,
  stereo width, medición y escritura.
- `verify_song.py` — verificación independiente de WAVs y figura de análisis.
- `reference/` — contrato original, render de la canción de referencia y datos musicales.
  Es material de consulta, no la ruta de producción.

## Estado

Conectado al sandbox como librería de solo lectura. `sandbox/sound/render_track.py` renderiza
una pista MIDI con estas voces y `/api/rendered/track` la expone a la app. La UI añade una pista
`[Rendered]` y silencia la MIDI original para comparar.

Los scripts generados por el LLM también pueden importar `dsp_core`, `voices_drums`,
`voices_synths` y `mix_master`; el runner los permite explícitamente.

Los módulos se probaron con Python + numpy:

```text
python dsp_core.py
python -c "import voices_drums, voices_synths, mix_master"
```
