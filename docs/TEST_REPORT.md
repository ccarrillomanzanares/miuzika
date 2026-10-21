# Informe de pruebas — P0

Fecha: 2026-10-21  
Commit probado: `e48f2f5`  
Entorno: Windows, Node 24, Vite en `http://localhost:5173`, Chromium automatizado.

## Resumen

- **P0:** 12 PASS, 1 PARTIAL, 1 NOT RUN.
- **P1/P2:** no ejecutados completos; se han probado los flujos relacionados con
  Strudel, bundle, generación larga y export openDAW.
- **Bugs corregidos durante la sesión:**
  1. No había forma de guardar/abrir un proyecto MIDI+WAV completo.
  2. El export a openDAW omitía las referencias de audio.
  3. La palabra “bucles” en el arreglo se interpretaba como petición de loop y
     recortaba el plan a 64 compases.
- **Funcionalidad añadida:** bundle `.miuzika.zip` con `project.json` + WAVs.
- `npm test`: **117/117**.
- `npm run typecheck`: OK.
- `npm run build:web`: OK (avisos de `eval` de terceros y tamaño de chunks).

## Resultados P0

| Caso | Resultado | Evidencia / notas |
|---|---|---|
| A1 Arranque limpio | PASS | `GET /` 200; `crossOriginIsolated: true`; COOP/COEP presentes |
| A2 Origen único | PASS | `127.0.0.1:5173` devuelve 502; no sirve la app ni crea origen usable |
| A3 Sin clave LLM | NOT RUN | requiere reiniciar sin `.env`; no se hizo para no tocar la sesión |
| A4 Persistencia básica | PASS | recarga restaura “Strudel” y 2 WAVs desde IndexedDB |
| B1 Crear canción por chat | PASS | “Fundición Cromática”: 140 compases, 90 BPM, 6 pistas; antes corrigió el falso loop de 64 |
| B2 Editar por chat | PASS | “baja QA MIDI 3 dB” → track de `0` a `−3 dB` |
| B3 Undo/redo | PASS | undo recuperó la pista de audio tras una recompilación accidental |
| B4 Op inválida | PASS | tests unitarios de `applyOps` transaccional |
| D1 Playback MIDI | PASS | engine openDAW arranca; posición avanza |
| D2 Batería Playfield | PARTIAL | pista de batería presente y playback activo; no se aisló peak en esta sesión |
| D3 Mute/solo en caliente | PASS | mute de QA MIDI cambia estado y clase de cabecera; `syncMix` ya medido antes |
| D4 Stop/seek | PASS | stop deja el handle a `null` y el botón en ▶ |
| D5 Proyecto con WAV | PASS | audio + MIDI suenan en openDAW; `beat` avanza |
| E1 Strudel MIDI | PASS | fuente “QA MIDI” compilada: 1 pista, 4 notas |
| J5 Bundle MIDI+WAV | PASS | bundle 6,1 MB; reimporta 2 pistas (1 audio, 1 MIDI) y 2 fuentes |

## Pruebas adicionales ejecutadas

| Caso | Resultado | Evidencia |
|---|---|---|
| Bundle desde UI | PASS | “Proyecto guardado con MIDI, metadatos y WAVs (5,9 MB)” |
| Abrir bundle desde UI | PASS | “Abierto Strudel”; 2 pistas restauradas |
| Strudel audio con `gm_acoustic_bass` + `wt_vgame` | PASS | render de 8 s, pico ≈0,869, sin warnings |
| Strudel audio con `s("bd sd hh")` | PASS | WAV generado, pico ≈0,79 |
| Export openDAW con audio | PASS | 2 pistas, 2 clips, 4 notas, sin warning de WAV ausente |
| Prompt largo de 6:13 | PASS | “Fundición Cromática”: 140 compases, 6 pistas, ~8.000 notas; playback inicia |
| Bug “bucles” → loop | PASS | primer intento 64 compases; corregido y segundo intento 140 |
| JSON / MIDI / WAV / stems | NOT RUN | pendientes de una pasada P1 |
| Sample Lab / Rendered | NOT RUN | requieren Docker/WSL y una sesión más larga |
| Persistencia cuota llena / huérfanos | NOT RUN | P2 |

## Incidencias encontradas

1. **No existía bundle de proyecto.** El JSON no incluye WAVs y abrir otro
   proyecto dejaba el audio en IndexedDB sin una forma clara de volver a enlazarlo.
   Corregido con **Proyecto** (`.miuzika.zip`) y **Abrir** aceptando ZIP.
2. **Export openDAW sin audio.** El botón llamaba a `projectToOpenDaw` sin el mapa
   de assets. Corregido; ahora incluye las referencias de audio (los bytes WAV no
   van dentro del `.odw`).
3. **Recompilar una fuente Strudel reemplaza sus pistas.** Es el comportamiento
   esperado, pero si el usuario cambia el nombre sin seleccionar “Nueva fuente”
   puede reemplazar la fuente anterior. El editor muestra el aviso; se recuperó
   con undo. Candidato a mejorar en UX.

## Pendiente antes de publicar

- Ejecutar A3, B1 y el resto de P1/P2 en una sesión dedicada.
- Probar Sample Lab y Rendered con Docker/WSL.
- Probar export WAV/stems y JSON/MIDI en archivos reales.
- Medir playback con 10 stems; documentar el límite de CPU/memoria.
- Repetir P0 en una ventana/perfil limpio, sin datos de pruebas.

## Conclusión

El flujo principal MIDI+WAV ya se puede guardar y recuperar en un único archivo.
P0 queda en verde salvo las pruebas que requieren reiniciar el entorno o una
generación LLM nueva. Antes de publicar faltan las pruebas P1/P2 y,
especialmente, Sample Lab/Rendered y rendimiento con stems.
