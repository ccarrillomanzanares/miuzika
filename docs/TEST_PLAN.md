# Plan de pruebas de miuzika

Versión objetivo: **0.9.0 alpha**.

Este documento es el paquete de pruebas funcionales para revisar antes de publicar.
Las pruebas están pensadas para ejecutarse en `http://localhost:5173` con el
navegador y, cuando se indique, con Docker/WSL2.

## Cómo se ejecutarán

- Navegador automatizado sobre el mismo perfil/origen que usa el usuario.
- Evidencia por caso: resultado, captura si aplica, mensajes de la UI, errores de
  consola y estado de `window.__miuzika`.
- Para audio: posición del engine, `isPlaying`, peak/RMS del analyser, no solo
  “parece que suena”.
- Las pruebas subjetivas de timbre, mezcla y latencia perceptiva quedan marcadas
  como **requieren oído humano**.
- Antes de ejecutar: exportar JSON/WAV del proyecto actual o usar un proyecto de
  prueba, porque varias pruebas crean, reemplazan y borran pistas.

## Fixtures

| Id | Contenido | Uso |
|---|---|---|
| F1 | Proyecto vacío creado desde **Código** | arranque Strudel |
| F2 | Patrón Strudel MIDI: `s("bd ~ sd ~")` + `note("c2 e2 g2").s("sawtooth")` | compilador MIDI |
| F3 | Código de usuario con `$:`, Dirt, `gm_acoustic_bass` y `wt_vgame` | render Strudel audio |
| F4 | WAV corto: `web/public/drums/kick-hard.wav` | importación de audio |
| F5 | Proyecto generado por LLM | planner/chat |
| F6 | Proyecto con muchos stems/MIDI | rendimiento de playback |

## P0 — humo mínimo

Estas deben pasar antes de considerar la build publicable.

### Arranque

- [ ] **A1. Arranque limpio**
  - Pasos: `npm run dev`; abrir `http://localhost:5173`.
  - Esperado: UI carga, sin errores de consola no controlados, `crossOriginIsolated === true`.
- [ ] **A2. Origen único**
  - Pasos: abrir `http://127.0.0.1:5173`.
  - Esperado: redirige a `localhost`; no se crea almacenamiento separado.
- [ ] **A3. Sin clave LLM**
  - Pasos: arrancar sin `OLLAMA_API_KEY`.
  - Esperado: la app abre; los flujos LLM muestran un error claro, no se rompe la UI.
- [ ] **A4. Persistencia básica**
  - Pasos: crear proyecto, recargar.
  - Esperado: proyecto y pistas vuelven; si localStorage falla, se recupera de IndexedDB.

### Proyecto

- [ ] **B1. Crear canción por chat**
  - Pasos: pedir una canción corta; esperar planner.
  - Esperado: pistas, clips y notas coherentes; mensaje final; sin fallback silencioso.
- [ ] **B2. Editar por chat**
  - Pasos: “sube el reverb del bajo”, “cambia el bajo del compás 5 al 8”.
  - Esperado: cambio aplicado como ops; historial actualizado.
- [ ] **B3. Undo/redo**
  - Pasos: hacer un cambio y deshacer/rehacer.
  - Esperado: estado y audio vuelven al proyecto correspondiente.
- [ ] **B4. Op inválida**
  - Pasos: forzar una edición inválida o ambigua.
  - Esperado: no se aplica nada; error accionable en el chat.

### Playback

- [ ] **D1. Playback MIDI**
  - Pasos: proyecto con batería/bajo/pad; ▶.
  - Esperado: engine openDAW arranca, la posición avanza, hay señal de audio.
- [ ] **D2. Batería Playfield**
  - Pasos: solo pista de batería; ▶.
  - Esperado: peak/RMS distinto de cero; sin warnings de samples.
- [ ] **D3. Mute/solo en caliente**
  - Pasos: mutear y solear pistas mientras suena.
  - Esperado: el máster cambia; no se reinicia el playhead.
- [ ] **D4. Stop y seek**
  - Pasos: ▶, clic en timeline, ■.
  - Esperado: seek mueve el engine; stop lo detiene y deja el playhead en 0.
- [ ] **D5. Proyecto con WAV**
  - Pasos: importar F4, colocar clip, ▶.
  - Esperado: la pista WAV suena vía openDAW; sin fallback al player viejo.

## P1 — funcionalidad principal

### Chat, planner y agente

- [ ] **B5. Prompt con restricciones**
  - Pasos: “sin batería”, “4 compases”, “en mi menor”, “132 BPM”.
  - Esperado: el planner respeta las restricciones o explica el conflicto.
- [ ] **B6. Edición ambigua**
  - Pasos: “cambia el track 2” sin más contexto.
  - Esperado: pregunta o enumera opciones; no inventa.
- [ ] **B7. Herramientas**
  - Pasos: pedir un cambio que requiera `get_project_digest` + `apply_ops`.
  - Esperado: tool log coherente; errores de herramienta visibles.

### Timeline y editor

- [ ] **C1. Playhead y zoom**
  - Pasos: clic, Ctrl+rueda.
  - Esperado: playhead y zoom sin errores de `ResizeObserver`.
- [ ] **C2. Piano roll**
  - Pasos: doble clic en clip MIDI; añadir, mover y borrar notas.
  - Esperado: notas persisten y el clip se actualiza.
- [ ] **C3. Selección**
  - Pasos: clic, Ctrl/Cmd+clic, Shift+clic, Ctrl+A, Esc.
  - Esperado: selección correcta; barra de selección coherente.
- [ ] **C4. Borrar pistas**
  - Pasos: seleccionar y borrar.
  - Esperado: confirmación, undo disponible, engine se detiene sin romperse.

### Strudel MIDI

- [ ] **E1. Patrón sencillo**
  - Pasos: compilar F2.
  - Esperado: pistas MIDI creadas; notas visibles en el piano roll.
- [ ] **E2. Bloques `$:`**
  - Pasos: compilar un patrón con varios `$:`.
  - Esperado: se combinan; no aparece `.p is not a function`.
- [ ] **E3. Recompilar**
  - Pasos: editar el código y compilar la misma fuente.
  - Esperado: se reemplazan sus pistas; no se duplican.
- [ ] **E4. Samples sin nota en MIDI**
  - Pasos: compilar `s("gm_acoustic_bass")`.
  - Esperado: warning claro; no se crea una pista falsa con pitch incorrecto.
- [ ] **E5. Persistencia de fuente**
  - Pasos: compilar, recargar, abrir Código.
  - Esperado: código, compases y pistas siguen ahí.
- [ ] **E6. LLM escribe Strudel**
  - Pasos: pedir en el chat un patrón Strudel.
  - Esperado: `add_code_source`, compilación automática y pistas.

### Strudel audio

- [ ] **F1. Synth**
  - Pasos: `note("c3 e3 g3").s("sawtooth")`, Renderizar audio.
  - Esperado: WAV insertado como pista de audio; peak > 0.
- [ ] **F2. Samples por defecto**
  - Pasos: `s("bd sd hh")`, Renderizar audio.
  - Esperado: pista de audio con señal; sin warnings de samples.
- [ ] **F3. Código de usuario completo**
  - Pasos: F3 con `$:`, `gm_acoustic_bass`, `wt_vgame`, `_punchcard()`.
  - Esperado: renderiza sin warnings; `_punchcard` no rompe.
- [ ] **F4. Sin red**
  - Pasos: bloquear red y renderizar samples.
  - Esperado: error/warnings claros; la app no se queda colgada.
- [ ] **F5. Pack propio**
  - Pasos: `samples("github:...")` + sonido del pack.
  - Esperado: se carga y suena en el render.
- [ ] **F6. Re-render**
  - Pasos: renderizar dos veces la misma fuente.
  - Esperado: reemplaza la pista de audio; no duplica pistas.
- [ ] **F7. Reproducción del WAV renderizado**
  - Pasos: cerrar Código, ▶.
  - Esperado: la pista de audio suena vía openDAW; no hay fallback.

### Sample Lab y Rendered

- [ ] **G1. Sample Lab con Docker**
  - Pasos: pedir un one-shot y un loop; insertar en pistas.
  - Esperado: WAV validado, insertado y reproducible.
- [ ] **G2. Sample Lab sin Docker**
  - Pasos: parar Docker y pedir sample.
  - Esperado: error claro; no se ejecuta Python en el host.
- [ ] **G3. Rendered**
  - Pasos: seleccionar una pista MIDI y pulsar Rendered.
  - Esperado: pista `[Rendered]`, MIDI original silenciada, undo disponible.
- [ ] **G4. Rendered falla**
  - Pasos: parar el sandbox/entorno.
  - Esperado: error explícito; proyecto intacto.

### Audio, mezcla y exportación

- [ ] **H1. Importar WAV**
  - Pasos: importar F4; mover el clip.
  - Esperado: waveform, duración y playback correctos.
- [ ] **H2. WAV en openDAW**
  - Pasos: ▶ con pista WAV.
  - Esperado: engine openDAW reproduce; sin player viejo.
- [ ] **H3. Mixdown WAV**
  - Pasos: exportar WAV.
  - Esperado: archivo válido, loudness/pico razonables.
- [ ] **H4. Stems**
  - Pasos: exportar stems de todas/seleccionadas.
  - Esperado: un WAV por pista; ZIP válido.
- [ ] **I1. MIDI**
  - Pasos: exportar MIDI.
  - Esperado: SMF tipo 1 válido; notas y tempo correctos.
- [ ] **I2. JSON**
  - Pasos: exportar JSON.
  - Esperado: IR completo; no incluye bytes WAV.
- [ ] **I3. openDAW `.odw`**
  - Pasos: exportar `.odw`; abrir/reimportar.
  - Esperado: MIDI/notas preservadas; audio referenciado sin bytes.
- [ ] **I4. Importar JSON**
  - Pasos: abrir un JSON exportado.
  - Esperado: proyecto restaurado; avisos de audio ausente si aplica.

## P2 — persistencia, errores y rendimiento

### Persistencia

- [ ] **J1. Recarga normal**
  - Pasos: guardar proyecto, recargar.
  - Esperado: proyecto, historial y audio.
- [ ] **J2. localStorage lleno**
  - Pasos: simular cuota llena.
  - Esperado: aviso; IndexedDB conserva la copia.
- [ ] **J3. WAV huérfanos**
  - Pasos: borrar proyecto dejando audio; reiniciar.
  - Esperado: proyecto de recuperación con pistas al inicio y aviso.
- [ ] **J4. WAV ausente**
  - Pasos: borrar un asset de IndexedDB y abrir el proyecto.
  - Esperado: aviso de audio faltante; no crash.

### Errores y seguridad

- [ ] **K1. Código Strudel inválido**
  - Pasos: compilar/renderizar código roto.
  - Esperado: error en el modal; worker termina; UI sigue usable.
- [ ] **K2. Código Strudel infinito**
  - Pasos: patrón que bloquea el worker.
  - Esperado: timeout y terminación del worker.
- [ ] **K3. API caída**
  - Pasos: parar el plugin/API.
  - Esperado: error de red claro y opción de reintentar.
- [ ] **K4. Consola limpia**
  - Pasos: recorrer flujos principales.
  - Esperado: sin errores no controlados; los warnings de terceros se documentan.

### Rendimiento

- [ ] **L1. Un stem**
  - Medir tiempo hasta ▶ y estabilidad.
- [ ] **L2. Diez stems**
  - Medir carga, peak/RMS, avance de posición y cortes.
  - Esperado: se documenta el límite real; no se promete estabilidad total.
- [ ] **L3. Proyecto grande**
  - 6.000+ notas, 10 pistas MIDI + audio.
  - Esperado: UI responde; playback documentado.

## Criterios de aceptación

- **P0:** 100 % en verde.
- **P1:** sin blockers; los fallos se documentan con workaround.
- **P2:** pueden quedar avisos conocidos si están en README/limitaciones.
- No publicar con:
  - pérdida de proyecto sin aviso;
  - mute/solo roto durante playback;
  - Strudel audio que deja warnings falsos en el código de referencia;
  - errores de consola no controlados en el arranque.

## Evidencia que entregaré

Para cada caso ejecutado:

- `PASS`, `FAIL` o `BLOCKED`.
- Acciones realizadas.
- Resultado observado.
- Captura/estado/console si hay fallo.
- Si es subjetivo: “requiere oído humano”.

## Nota sobre la ejecución automatizada

Puedo ejecutar las pruebas con el navegador como si fuera el usuario: clics,
teclado, modales, chat, timeline, compilación, recarga y comprobaciones de estado.
No puedo valorar timbre, mezcla o comodidad de uso como una persona; esas filas
quedarán marcadas para tu revisión.
