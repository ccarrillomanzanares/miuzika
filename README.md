# miuzika

**GUI de DAW con openDAW y Strudel → WAV.**

Esta versión es deliberadamente pequeña:

```text
GUI / openDAW          timeline, piano roll, audio, mezcla y export
Strudel → WAV          código generativo convertido en pista de audio
```

No hay LLM, ni planner, ni agente, ni worker Python.

## Qué incluye

- **Timeline y piano roll**: edición de clips y notas, mute/solo, selección,
  undo/redo.
- **openDAW WASM**: reproducción, Playfield para batería, pistas de audio y FX.
- **Strudel → WAV**: editor de patrones y render con `superdough` en un
  `OfflineAudioContext`.
- **Audio WAV**: importación, waveform, clips y persistencia en IndexedDB.
- **Export**: WAV, stems, MIDI, JSON, bundle `.miuzika.zip` y `.odw`.

## Arranque

Requisitos:

- **Node 24**.

```bash
npm install
npm run dev
```

Abre **http://localhost:5173**. No uses `127.0.0.1`: el almacenamiento está ligado
al origen y la app está configurada para `localhost`.

Comprobaciones:

```bash
npm test
npm run typecheck
npm run build:web
```

## Strudel → WAV

En **Strudel**, pega un patrón y pulsa **Renderizar WAV**. El motor real de Strudel
renderiza en el navegador y el WAV se inserta como pista de audio.

```js
stack(
  s("bd ~ sd ~"),
  note("c2 e2 g2").s("sawtooth").slow(2)
)
```

- 1 ciclo = 1 compás.
- Límite actual: 64 compases.
- Carga sample packs y soundfonts de Strudel; la primera renderización puede tardar.
- El resultado es audio, no MIDI.

## Persistencia

- El proyecto y el historial viven en `localStorage` e IndexedDB.
- Los WAVs viven en IndexedDB (`miuzika` / `audio-assets`).
- **Proyecto** descarga un `.miuzika.zip` con `project.json` + WAVs.
- **Abrir** acepta ese ZIP y restaura MIDI, audio y assets.
- El JSON no incluye los bytes de audio.

## Scripts

| Comando | Uso |
|---|---|
| `npm run dev` | Vite en `localhost:5173` |
| `npm test` | Tests unitarios + openDAW |
| `npm run test:unit` | Solo tests de `src/` y `web/` |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run build:web` | Build de producción |
| `npm run drums:build` | Regenera el kit WAV de batería |
| `npm run export:opendaw -- out/song.json` | Exporta `.odw` |

## Estructura

```text
src/
  core/             IR, teoría, ops, MIDI, proyecto
  host/opendaw/     mapping + adapter + checks del SDK
web/
  src/
    main.ts              estado, timeline, audio y persistencia
    timeline.ts          timeline
    editor.ts            piano roll
    opendaw-engine.ts    playback WASM
    code-lab.ts          editor Strudel → WAV
    strudel-audio.ts     render con superdough
    render.ts            mixdown offline de la GUI
    audio-store.ts       assets y rehidratación
    audio-db.ts          IndexedDB de WAVs
    project-bundle.ts    export/import .miuzika.zip
  public/drums/          kit WAV para Playfield
  public/opendaw-wasm/   engine.wasm y plugins
docs/                   arquitectura, openDAW y plan de pruebas
```

## Limitaciones

- Strudel → WAV: máximo 64 compases por render.
- Strudel depende de sample maps remotos y de sus licencias.
- openDAW puede consumir CPU/memoria con muchos WAV largos.
- El proyecto usa 4/4 en el motor de patrones clásico.

## Licencia

miuzika se distribuye bajo **AGPL-3.0-or-later**. openDAW tiene licencia dual
(AGPL/comercial); Strudel, superdough y los sample packs son de terceros.
Consulta [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

En un despliegue público (incluido SaaS) la AGPL exige publicar el código
correspondiente. Si se usa la licencia comercial de openDAW, revisa `NOTICE.md`.
