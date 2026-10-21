# Plan de pruebas de miuzika

Versión objetivo: **0.11.0**. Alcance: GUI/openDAW + Strudel → WAV.

Se ejecuta en `http://localhost:5173`. Evidencia por caso: resultado, mensajes de
la UI, errores de consola y estado de `window.__miuzika`.

## P0 — humo

- [ ] **A1. Arranque limpio**: `npm run dev`; la UI carga sin errores no
  controlados; `crossOriginIsolated === true`.
- [ ] **A2. Origen único**: `127.0.0.1:5173` no sirve la app.
- [ ] **A3. Persistencia**: crear proyecto, recargar; proyecto e historial vuelven.
- [ ] **A4. Nuevo proyecto**: **Nueva** limpia la timeline.

## GUI / openDAW

- [ ] **D1. Playback MIDI**: la posición avanza y hay señal.
- [ ] **D2. Playfield**: batería con peak/RMS distinto de cero.
- [ ] **D3. Mute/solo en caliente**: no se reinicia el playhead.
- [ ] **D4. Stop/seek**.
- [ ] **D5. WAV**: importar audio, colocarlo y reproducirlo.
- [ ] **C1. Timeline**: zoom, seek.
- [ ] **C2. Piano roll**: añadir/mover/borrar notas.
- [ ] **C3. Selección y borrado**.

## Strudel → WAV

- [ ] **F1. Synth**: `note("c3 e3 g3").s("sawtooth")`; WAV y pista de audio.
- [ ] **F2. Samples**: `s("bd sd hh")`; WAV con señal.
- [ ] **F3. Bloques `$:`**: patrón con varios bloques; renderiza sin errores.
- [ ] **F4. Re-render**: reemplaza la pista; no duplica.
- [ ] **F5. Reproducción**: el WAV suena vía openDAW.
- [ ] **F6. Sin red**: error/warnings claros; no se cuelga.

## Persistencia

- [ ] **J1. Recarga** con proyecto y audio.
- [ ] **J2. Asset ausente**: aviso, sin crash.
- [ ] **J3. Abrir JSON** existente.
- [ ] **J4. Abrir bundle `.miuzika.zip`** existente.
