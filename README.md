# miuzika

**DAW web con openDAW, planner/ops, agente de canción y Strudel → WAV.**

miuzika mantiene cuatro caminos separados:

```text
GUI / openDAW          reproducción, timeline, piano roll, mezcla y export
Planner / ops          cambios rápidos sobre el proyecto
Song worker (Python)   render disk-backed de canciones completas
Agente de canción      escribe song_data.py, ejecuta el worker y exporta
Strudel → WAV          código generativo convertido en pista de audio
```

La GUI es la fuente de verdad. openDAW reproduce el IR. El worker Python produce
un master y MIDI; la app importa el master y deja los stems como descarga.

> Estado: **alpha**. El render completo tarda varios minutos y los stems pueden
> ocupar ~1 GB en disco.

## Qué incluye

- **Chat musical** con Ollama Cloud/local y tool-calling.
- **IR propio**: `Project`, `Track`, `Clip`, `Note`, `Device`, `CodeSource`.
- **Timeline y piano roll**: edición, selección, mute/solo, undo/redo.
- **openDAW WASM**: playback, Playfield para batería, pistas de audio y FX.
- **Planner/ops**: composición rápida y cambios transaccionales.
- **Canción completa**: el agente escribe una partitura Python y el worker la
  renderiza en disco.
- **Strudel → WAV**: editor de código y render con el motor real de Strudel.
- **Audio**: importación, waveform, clips, IndexedDB.
- **Export**: WAV, stems, MIDI, JSON, bundle `.miuzika.zip` y `.odw`.

## Arranque

Requisitos:

- **Node 24**.
- **Python 3.12** con `numpy` y `mido`.
- Una clave de Ollama Cloud o un Ollama local compatible con OpenAI.

```bash
npm install
cp .env.example .env
# edita .env y pon OLLAMA_API_KEY=...
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

## Canción completa

El botón **Canción** abre el agente. El flujo es:

```text
prompt
  → workspace en out/song-jobs/<id>/
  → el agente escribe song_data.py
  → python render_song.py --bars 1 8 --out out
  → inspecciona el WAV (pico, RMS, clipping)
  → python render_song.py --out out
  → python bundle.py --out out
  → la GUI abre el .miuzika.zip
```

El agente no mete audio en el chat. Solo ve logs y métricas. El renderer escribe
los stems por trozos de 30 s y la mezcla se reconstruye desde disco.

### Memoria

- 140 compases × 15 pistas estéreo en `float64` ≈ **3,6 GB**.
- El portátil objetivo tiene ~**1,8 GB** libres.
- Solo se mantiene una pista viva y una matriz de mezcla `(2, n)` (~255 MB).
- Los stems completos pesan ~**958 MB**; el master ~67 MB.
- La GUI importa **master + MIDI**; los stems no se cargan en el navegador.

## Strudel

### Strudel → WAV

En **Strudel**, pega un patrón y pulsa **Renderizar WAV**. El motor real de Strudel
(`superdough`) renderiza en un `OfflineAudioContext` y el WAV se inserta como
pista de audio.

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

## Planner / ops

El planner sigue disponible para cambios rápidos:

```text
prompt → SongPlan → Op[] validados con zod → Project
```

El LLM elige estructura, roles, estilos, progresiones y densidad; el motor
determinista genera las notas. Todo cambio es transaccional y reversible.

## Scripts

| Comando | Uso |
|---|---|
| `npm run dev` | Vite + API en `localhost:5173` |
| `npm test` | Tests unitarios + openDAW |
| `npm run test:unit` | Solo tests de `src/` y `web/` |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run build:web` | Build de producción |
| `npm run compose -- "..."` | Composición por CLI |
| `npm run eval` | Evaluación offline del planner |
| `npm run drums:build` | Regenera el kit WAV de batería |

## Estructura

```text
src/
  core/             IR, teoría, patrones, ops, MIDI, planner
  agent/            cliente LLM, prompts, tools, planner, song-agent/jobs/workspace
  cli/              composición y evaluación
  host/opendaw/     mapping + adapter + checks del SDK
web/
  src/
    main.ts              chat, estado, timeline, persistencia
    timeline.ts          timeline
    editor.ts            piano roll
    opendaw-engine.ts    playback WASM
    song-agent.ts        UI del agente de canción
    code-lab.ts          editor Strudel → WAV
    strudel-audio.ts     render con superdough
    render.ts            mixdown offline de la GUI
    audio-store.ts       assets y rehidratación
    audio-db.ts          IndexedDB de WAVs
    project-bundle.ts    export/import .miuzika.zip
song-worker/            renderer Python disk-backed + bundle
rendered/               DSP Python (voces, mezcla, MIDI)
out/song-jobs/          workspaces y artefactos (ignorado por git)
```

## Persistencia

- Proyecto e historial en `localStorage` e IndexedDB.
- WAVs en IndexedDB (`miuzika` / `audio-assets`).
- **Proyecto** descarga un `.miuzika.zip` con `project.json` + WAVs.
- **Abrir** acepta ese ZIP y restaura MIDI, audio y assets.
- El master de una canción del worker se importa como pista de audio; las pistas
  MIDI quedan silenciadas para comparar.
- Usa siempre `http://localhost:5173`.

## Limitaciones

- Render completo del worker: varios minutos y ~1 GB de stems.
- Strudel → WAV: máximo 64 compases por render.
- Strudel depende de sample maps remotos y de sus licencias.
- openDAW con muchos stems puede consumir CPU/memoria; la canción completa importa
  el master, no los 15 stems.
- El LLM no es determinista y puede fallar; el agente recibe el error y reintenta.
- El modo canción ejecuta Python local. Es una herramienta de desarrollo, no un
  servicio multiusuario.

## Licencia

miuzika se distribuye bajo **AGPL-3.0-or-later**. openDAW tiene licencia dual
(AGPL/comercial); Strudel, superdough y los sample packs son de terceros.
Consulta [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

En un despliegue público (incluido SaaS) la AGPL exige publicar el código
correspondiente. Si se usa la licencia comercial de openDAW, revisa `NOTICE.md`.
