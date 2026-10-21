# Plan de pruebas de miuzika

Versión objetivo: **0.10.0 alpha**.

Se ejecuta en `http://localhost:5173`. Evidencia por caso: resultado, mensajes de
la UI, errores de consola y estado de `window.__miuzika`.

## P0 — humo

### Arranque

- [ ] **A1. Arranque limpio**: `npm run dev`; la UI carga sin errores no
  controlados; `crossOriginIsolated === true`.
- [ ] **A2. Origen único**: `127.0.0.1:5173` no sirve la app.
- [ ] **A3. Persistencia**: crear proyecto, recargar; proyecto e historial vuelven.

### Planner / ops

- [ ] **B1. Canción por chat**: pedir una canción corta; pistas, clips y notas
  coherentes.
- [ ] **B2. Edición por chat**: cambiar un parámetro; se aplica como ops.
- [ ] **B3. Undo/redo**.
- [ ] **B4. Op inválida**: no se aplica nada; error accionable.

### openDAW

- [ ] **D1. Playback MIDI**: la posición avanza y hay señal.
- [ ] **D2. Mute/solo en caliente**: no se reinicia el playhead.
- [ ] **D3. Stop/seek**.
- [ ] **D4. Proyecto con WAV**: importar un WAV y reproducirlo.

## P1 — funciones principales

### Canción completa

- [ ] **S1. Job desde la UI**: el botón **Canción** crea un job y muestra log.
- [ ] **S2. Prueba corta**: el agente ejecuta `--bars` antes del render completo.
- [ ] **S3. Render completo**: aparecen master, `render.json`, `midi/` y
  `.miuzika.zip`.
- [ ] **S4. Importación**: **Abrir proyecto** importa el bundle; el master suena y
  las pistas MIDI están silenciadas.
- [ ] **S5. Memoria**: el render completo termina con ~1,8 GB libres; los stems no
  se cargan en el navegador.
- [ ] **S6. Fallo de Python**: el log muestra el error; el job termina en `error`.

### Strudel → WAV

- [ ] **F1. Synth**: `note("c3 e3 g3").s("sawtooth")`; WAV y pista de audio.
- [ ] **F2. Samples**: `s("bd sd hh")`; WAV con señal.
- [ ] **F3. Re-render**: reemplaza la pista; no duplica.
- [ ] **F4. Reproducción**: el WAV suena vía openDAW.
- [ ] **F5. Sin red**: error/warnings claros; no se cuelga.

### GUI y persistencia

- [ ] **C1. Timeline**: zoom, seek, fit.
- [ ] **C2. Piano roll**: añadir/mover/borrar notas.
- [ ] **C3. Selección y borrado**.
- [ ] **H1. Bundle**: **Proyecto** y **Abrir** conservan MIDI, WAV y disposición.
- [ ] **H2. Export WAV/MIDI/JSON/openDAW**.

## P2 — errores y rendimiento

- [ ] **J1. Reload** con proyecto y audio.
- [ ] **J2. Asset ausente**: aviso, sin crash.
- [ ] **J3. localStorage lleno**: IndexedDB conserva copia.
- [ ] **J4. Playback con master de 6 min**: CPU/memoria aceptables.
- [ ] **J5. Canción de 140 compases**: render completo, master y MIDI.
