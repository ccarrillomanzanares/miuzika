# Arquitectura de miuzika

## Capas

```text
GUI (web/)
  ├── openDAW WASM: reproducción, timeline, piano roll
  ├── Strudel → WAV: código generativo a pista de audio
  ├── audio WAV: importación y clips
  └── persistencia: disco (proyecto.json) + /api/*

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

- El proyecto es su carpeta: `workspace/proyectos/<slug>/proyecto.json` (estado
  completo, con la ruta de cada WAV) + `entrada/` y `salida/` con los WAV.
- Cada asset guarda su `ruta` relativa; el audio no se incrusta en el JSON.
- En el navegador sólo queda `miuzika.proyecto-abierto` (qué proyecto reabrir).
  IndexedDB se retiró: existía porque los WAV no se grababan a disco.
- El historial de undo (8 pasos) es de sesión, en memoria.
- **Abrir** acepta un `.json`, un bundle `.miuzika.zip` (sus WAV se escriben en
  la carpeta) o un `proyecto.json` elegido en el botón `Proyectos`.
- No hay exportación de proyecto desde esta versión.

## Lo que no existe

No hay planner, LLM, agente, worker Python, motor Rendered, Sample Lab,
exportadores ni compilación Strudel → MIDI.
