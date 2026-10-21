# Arquitectura de miuzika

## Capas

```text
GUI (web/)
  ├── openDAW WASM: reproducción, timeline, piano roll
  ├── Strudel → WAV: código generativo a pista de audio
  ├── audio WAV: importación y clips
  └── persistencia: localStorage + IndexedDB

Core (src/core/)
  ├── Project IR
  ├── ops transaccionales
  ├── teoría
  └── proyecto

Host (src/host/opendaw/)
  ├── mapping.ts
  ├── adapter.ts
  └── check.ts
```

## Flujo de audio

1. La GUI crea o importa un `Project`.
2. openDAW reproduce pistas MIDI y audio.
3. Strudel renderiza un patrón a WAV en el navegador.
4. El WAV se registra como asset y se inserta como pista de audio.
5. La GUI reproduce, edita y persiste.

## Strudel

- `code-lab.ts` edita el patrón.
- `strudel-audio.ts` evalúa con `superdough` y renderiza en un
  `OfflineAudioContext`.
- `strudel-source.ts` contiene los helpers de bloques `$:` y métodos visuales.
- El límite actual es de 64 compases por render.
- No hay compilación Strudel → MIDI.

## Persistencia

- `Project` e historial: localStorage + IndexedDB (`miuzika-projects`).
- WAVs: IndexedDB (`miuzika/audio-assets`).
- **Abrir** importa un JSON o un bundle `.miuzika.zip` existente.
- No hay exportación de proyecto desde esta versión.

## Lo que no existe

No hay planner, LLM, agente, worker Python, motor Rendered, Sample Lab,
exportadores ni compilación Strudel → MIDI.
