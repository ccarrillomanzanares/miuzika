# miuzika

**Un DAW web con asistente LLM, Strudel y motor de audio openDAW.**

miuzika convierte lenguaje natural y código generativo en un proyecto musical
editable: pistas, clips, notas, samples y efectos. El proyecto es la fuente de
verdad; openDAW ejecuta el audio; Strudel puede generar pistas MIDI o audio real;
y Rendered añade un motor Python para stems de sonido.

> Estado: **alpha**. La app es usable para pruebas, pero el playback de proyectos
> grandes y algunos flujos de audio siguen en desarrollo.

## Qué incluye

- **Chat musical**: Ollama Cloud/local + tool-calling para componer y editar por
  operaciones transaccionales.
- **IR propio**: `Project`, `Track`, `Clip`, `Note`, `Device` y `CodeSource`.
- **Timeline y piano roll**: edición de clips y notas, mute/solo, selección,
  undo/redo persistente.
- **openDAW WASM**: playback con `WasmEngine` + `EngineWorklet`; Playfield para
  batería, `AudioFileBox`/`AudioRegionBox` para WAVs y mute/solo/pan en caliente.
- **Strudel**:
  - editor de código;
  - compilación a pistas MIDI editables (`note`, `s`, `stack`, `slow`, `fast`,
    `euclid`, bloques `$:`…);
  - render con el motor real de Strudel (`superdough`) a una pista de audio.
- **Rendered**: render offline de pistas MIDI con voces Python y sandbox Docker.
- **Sample Lab**: el LLM diseña un sample, Python lo renderiza y se inserta como
  clip de audio.
- **Audio WAV**: importación, waveform, clips, persistencia en IndexedDB.
- **Exportación**: WAV, stems por pista, MIDI SMF tipo 1, JSON y `.odw` de openDAW.
- **Persistencia**: proyecto e historial en `localStorage` + IndexedDB; WAVs en
  IndexedDB y recuperación de assets huérfanos.

## Arranque rápido

Requisitos:

- **Node 24** (el proyecto ejecuta TypeScript con Node).
- Una clave de Ollama Cloud (o un Ollama local compatible con OpenAI).
- Docker/WSL2 solo si vas a usar **Sample Lab** o **Rendered**.

```bash
npm install
cp .env.example .env
# edita .env y pon OLLAMA_API_KEY=...
npm run dev
```

Abre **http://localhost:5173**. No uses `127.0.0.1`: el proyecto se guarda por
origen y la app está configurada para `localhost`.

Comprobaciones:

```bash
npm test
npm run typecheck
npm run build:web
npm run preview
```

## Configuración

`.env.example`:

```dotenv
OLLAMA_API_KEY=
OLLAMA_BASE_URL=https://ollama.com/v1
OLLAMA_MODEL=deepseek-v4.1-flash:1017
MIUZIKA_PLANNER_MODEL=
```

`MIUZIKA_PLANNER_MODEL` es opcional; si está vacío se usa `OLLAMA_MODEL`.
La clave se queda en el plugin de Vite y nunca se envía al navegador.
También puedes apuntar a Ollama local:

```dotenv
OLLAMA_BASE_URL=http://localhost:11434/v1
```

`src/config.ts` expone `MIDI_ENABLED`. En el modo por defecto (`true`) MIDI y audio
conviven. Si se pone a `false`, la UI oculta las funciones MIDI y el chat se centra
en samples de audio.

## Cómo funciona

```text
prompt
  ├─ planner/agente LLM
  │    └─ Op[] validados con zod
  │         └─ Project IR
  ├─ Strudel
  │    ├─ compilador → notas MIDI → pistas editables
  │    └─ superdough → WAV → AudioFileBox/AudioRegionBox
  └─ Rendered / Sample Lab
       └─ WAVs → pistas de audio

Project IR
  └─ openDAW: WasmEngine + EngineWorklet → reproducción
  └─ export: MIDI / WAV / stems / JSON / .odw
```

Reglas de diseño:

1. **El IR manda.** openDAW, Strudel y Rendered son ejecutores, no el almacén.
2. **El LLM no escribe notas a mano.** Elige estructura, roles, estilos,
   progresiones y densidad; un motor determinista genera las notas.
3. **Todo cambio es una operación validada y transaccional.** Si una op falla, no
   se aplica ninguna.
4. **Todo es reversible.** Historial de proyecto y undo/redo.

## Scripts

| Comando | Uso |
|---|---|
| `npm run dev` | Vite + API local en `localhost:5173` |
| `npm test` | Tests unitarios + integración real con openDAW |
| `npm run test:unit` | Solo tests de `src/` y `web/` |
| `npm run test:opendaw` | Ida y vuelta contra el SDK de openDAW |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run build:web` | Build de producción en `dist-web/` |
| `npm run preview` | Sirve el build con COOP/COEP |
| `npm run compose -- "..."` | Composición por CLI |
| `npm run eval` | Evaluación offline del pipeline musical |
| `npm run sandbox:build` | Construye la imagen Docker de sonido |
| `npm run drums:build` | Regenera el kit WAV de batería |
| `npm run export:opendaw -- out/song.json` | Exporta `.odw` |

## Strudel

### Compilar a MIDI

En **Código**, pega un patrón y pulsa **Compilar a pistas**. El compilador corre
en un Web Worker; no ejecuta audio. Un ciclo Strudel equivale a un compás.

Admite, entre otras cosas:

```js
$: s("hh!8").gain(.2)

$: s("bd").struct("{1 0 0 1 0 1 0 1 0 1 0 1}%8")

$: note("c2 e2 g2").s("sawtooth").slow(2)
```

Los sonidos de kit (`bd`, `sd`, `hh`…) se convierten a notas de batería; los
sonidos sintetizados se convierten a pistas MIDI. Los samples sin `note` no se
pueden representar como MIDI y se avisan.

### Renderizar audio

**Renderizar audio** ejecuta el motor real de Strudel en un
`OfflineAudioContext` y añade el WAV como pista de audio en openDAW. Es la ruta
para samples, soundfonts, wavetables y efectos de `superdough`.

Carga automáticamente los packs por defecto de Strudel (Uzu/Tidal drums, VCSL,
wavetables y soundfonts GM). Los packs propios se declaran en el código:

```js
samples("github:usuario/repo")
s("mi_sample")
```

La primera renderización puede tardar unos segundos por la descarga de mapas de
samples. El resultado es audio, no una pista MIDI editable.

## Estructura

```text
src/
  core/             IR, teoría, patrones, ops, MIDI, digest, planner
  agent/            cliente LLM, prompts, tools, planner, Sample Lab, Rendered
  cli/              composición y evaluación
  host/opendaw/     mapping.ts + adapter.ts + checks del SDK
web/
  src/
    main.ts              chat, estado, timeline, persistencia
    timeline.ts          timeline y piano roll
    editor.ts            editor de notas
    opendaw-engine.ts    playback WASM de openDAW
    code-lab.ts          editor Strudel
    strudel-compiler.ts  Strudel → notas MIDI
    strudel-worker.ts    worker aislado
    strudel-audio.ts     Strudel → WAV con superdough
    audio-store.ts       assets decodificados y rehidratación
    audio-db.ts          IndexedDB de WAVs
    project-db.ts        IndexedDB de proyecto/historial
    render.ts            mixdown offline
    synth.ts / fx.ts     síntesis y efectos del mixdown
  public/drums/          kit WAV para Playfield
  public/opendaw-wasm/   engine.wasm y plugins
rendered/               motor Python Rendered
sandbox/sound/          Dockerfile + runner del Sample Lab
docs/                   arquitectura y notas de openDAW
```

## Persistencia

- El proyecto y el historial viven en `localStorage` y en IndexedDB
  (`miuzika-projects`).
- Los WAVs viven en IndexedDB (`miuzika` / `audio-assets`).
- El JSON del proyecto guarda metadatos, no los bytes de audio.
- Al arrancar se recupera la última copia de IndexedDB y se rehidratan los WAVs.
- Si solo quedan WAVs, se crea un proyecto de recuperación con una pista por WAV.
- El origen importa: usa siempre `http://localhost:5173`.

## Limitaciones conocidas

- **Alpha**: el playback con muchos stems puede consumir mucha CPU/memoria. Los
  WAVs largos se parten en bloques de 2 minutos; el primer ▶ puede tardar.
- **4/4** en el motor de patrones clásico.
- **Rendered** es offline, usa 1 CPU y no lee la cadena de FX de la pista MIDI.
- **Sample Lab** necesita Docker/WSL2; la receta Python no se guarda todavía en el
  proyecto.
- **Strudel MIDI** soporta un subconjunto de patrones; los samples sin altura no
  se convierten a MIDI.
- **Strudel audio** depende de sample maps remotos y de las licencias de cada
  pack; la pista resultante es audio, no MIDI.
- **Export openDAW**: `.odw` incluye referencias de audio, pero no los bytes WAV;
  un proyecto autocontenido está pendiente.
- **LLM**: puede tardar y consumir tokens; no es determinista entre generaciones.
- **JSON**: no embebe WAVs; para mover un proyecto con audio a otro navegador hay
  que reimportar los ficheros.
- **Sin Sonic Pi**: la integración de código se centra en Strudel.

## Licencia

miuzika se distribuye bajo **AGPL-3.0-or-later**. openDAW tiene licencia dual
(AGPL/comercial); Strudel, superdough y los sample packs son de terceros y tienen
sus propias licencias. Consulta [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

En un despliegue público (incluido SaaS) la AGPL exige publicar el código
correspondiente. Si se usa la licencia comercial de openDAW, revisa `NOTICE.md` y
`docs/OPENDAW.md`.

## Contribuir

Antes de un PR:

```bash
npm run typecheck
npm test
npm run build:web
```

Mantén los cambios pequeños, añade tests para la lógica de `src/core` y evita
introducir dependencias de audio nuevas sin revisar su licencia.
