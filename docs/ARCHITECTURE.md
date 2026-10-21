# Arquitectura de miuzika

## Capas

```text
GUI (web/)
  ├── openDAW WASM: reproducción, timeline, piano roll, mezcla
  ├── Strudel → WAV: código generativo a pista de audio
  ├── audio WAV: importación y clips
  └── export: WAV, stems, MIDI, JSON, .miuzika.zip, .odw

Core (src/core/)
  ├── Project IR
  ├── ops transaccionales
  ├── teoría y MIDI
  └── persistencia

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
5. La GUI mezcla y exporta.

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
- Bundle `.miuzika.zip`: `project.json` + manifest + WAVs.
- El JSON no contiene los bytes de audio.

## Lo que no existe

No hay planner, LLM, agente de canción, worker Python ni motor Rendered. La app
solo necesita Node para la GUI y el navegador para el audio.
