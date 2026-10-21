# Arquitectura de miuzika

## Capas

```text
GUI (web/)
  ├── openDAW WASM: reproducción, timeline, piano roll, mezcla
  ├── planner/ops: composición rápida y edición transaccional
  ├── Strudel → WAV: código generativo a pista de audio
  └── Agente de canción: UI de jobs, log y apertura del bundle

Servidor local (vite-plugin-api.ts)
  ├── /api/generate: planner
  ├── /api/chat: agente de ops
  └── /api/song/jobs: agente de canción + artefactos

Song worker (song-worker/)
  ├── render_song.py: render disk-backed
  ├── bundle.py: master + MIDI → .miuzika.zip
  └── template/song_data.py: contrato de composición

Rendered (rendered/)
  ├── dsp_core.py
  ├── voices_drums.py / voices_synths.py / voices_extras.py
  ├── mix_master.py
  └── midi_export.py
```

## Flujo de canción completa

1. La GUI crea un job vía `POST /api/song/jobs`.
2. `SongWorkspace` crea `out/song-jobs/<id>/` y copia el renderer y la plantilla.
3. El agente (`song-agent.ts`) tiene herramientas de ficheros, Python y métricas.
4. Escribe `song_data.py`.
5. Ejecuta una prueba corta (`--bars`), mide el WAV y corrige.
6. Ejecuta el render completo y `bundle.py`.
7. La GUI descarga el `.miuzika.zip`, lo importa y lo abre en openDAW.

### Memoria

El worker no mantiene la canción en RAM. Cada pista se escribe a disco en trozos
de 30 s; la mezcla se reconstruye leyendo los stems; la reverb usa overlap-add.
Los stems completos (~958 MB) no se cargan en el navegador. La GUI importa el
master (~67 MB) y el MIDI (~108 KB).

## Flujo planner/ops

```text
prompt → SongPlan → Op[] (zod) → Project IR → openDAW
```

El LLM no escribe notas: elige roles, estilos, progresiones y densidad. Las ops
son transaccionales y reversibles.

## Strudel

Solo queda la ruta **Strudel → WAV**:

- `code-lab.ts` edita el patrón;
- `strudel-audio.ts` evalúa con `superdough` y renderiza en `OfflineAudioContext`;
- el WAV se registra como asset y se inserta como pista de audio.

No hay compilación Strudel → MIDI.

## Persistencia

- `Project` e historial: localStorage + IndexedDB (`miuzika-projects`).
- WAVs: IndexedDB (`miuzika/audio-assets`).
- Bundle `.miuzika.zip`: `project.json` + manifest + WAVs.
- Los artefactos del song worker viven en `out/song-jobs/` y no se versionan.
