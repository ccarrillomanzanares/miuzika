# Integración con openDAW

Este documento fija la frontera entre miuzika y el motor. Está **implementada y verificada**
la integración de `src/host/opendaw/` (export/import con ida y vuelta de notas, tempo, mezcla y
audio) y el playback WASM de `web/src/opendaw-engine.ts`. Lo que sigue explica las decisiones y
lo que queda pendiente.

## Estado real

| Pieza | Estado |
|---|---|
| Crear `Project` de openDAW sin navegador | ✅ (shims mínimos en `shims.ts`) |
| Tempo, compases, master, pistas MIDI | ✅ |
| Clips/regiones y notas | ✅ |
| Volumen, pan, mute, solo | ✅ |
| Reverb, delay, waveshaper, crusher, compressor, gate, stereotool | ✅ |
| EQ y filtro (aproximados con Revamp), chorus (delay modulado) | ✅ |
| Import (openDAW → IR): pistas, notas, tempo, mezcla | ✅ |
| Playback en navegador: `WasmEngine` + `EngineWorklet` | ✅ `web/src/opendaw-engine.ts`; ▶ en proyectos MIDI |
| Batería Playfield con samples WAV | ✅ `SampleProvider` sobre `web/public/drums` |
| Mute/solo/volumen/pan en caliente | ✅ `syncMix` actualiza los `AudioUnitBox` del engine |
| Import de dispositivos | 📋 (se conservan las notas; los FX no se reconstruyen) |
| Pistas/regiones de audio dentro del engine | ✅ `AudioFileBox` + `AudioRegionBox`; WAV largos partidos en bloques de 2 min |

Comandos:

```bash
npm run test:opendaw                       # ida y vuelta contra el SDK real
npm run export:opendaw -- out/noche.json   # escribe out/noche.odw
```

Resultado medido: 6 pistas, 24 clips, 666 notas y 11 FX exportados; al reimportar se conservan
las 666 notas, el tempo, la duración y las ganancias.

## Por qué openDAW

- Motor de audio en Rust/WASM + Web Audio, pensado para navegador.
- SDK público en npm (subpaquetes: `studio-core`, `studio-boxes`, `studio-adapters`,
  `studio-core-wasm`, `lib-dsp`, `lib-midi`, `lib-dawproject`…).
- Import/export **DAWproject**, lo que da interoperabilidad con Bitwig, Studio One, etc.
- Dispositivos propios: Vaporisateur (sustractivo), Playfield (batería), Nano (sampler),
  reproductor de SoundFont, y efectos (reverb Dattorro/FreeVerb, delay, vocoder, waveshaper,
  crusher, compresor, maximizador…).
- Ya incluye inferencia para separación de stems y audio-to-MIDI (`lib-inference`, solo en el
  estudio, no en el SDK).

## Licencia (leer antes de escribir código)

openDAW es **dual**:

| Opción | Obligación |
|---|---|
| AGPL-3.0-or-later | Todo el trabajo combinado se publica bajo AGPL, **incluido SaaS** (§13). |
| Comercial | Se paga y se puede mantener el código cerrado. Contacto: andre.michelle@opendaw.org |

La licencia comercial **excluye** componentes con copyleft de terceros o servicios externos:

- compresor CTAGDRC (GPL-3.0) → sustituir por otro compresor
- Neural Amp / Tone3000 (servicio y licencias por modelo) → omitir
- detección de tempo TempoCNN (AGPL-3.0) → sustituir

Como el producto va a ser abierto, la ruta es AGPL: hay que mantener avisos de copyright y
publicar las modificaciones de openDAW. Nuestro código (`src/core`) también se
licencia AGPL-3.0 para que el conjunto sea coherente.

## Arranque técnico

Requisitos que condicionan el despliegue:

1. **Cross-origin isolation** (`COOP: same-origin`, `COEP: require-corp`) porque el motor usa
   `SharedArrayBuffer`. Está configurado en `vite.config.ts` para `server` y `preview`.
2. Servir los artefactos WASM del paquete. `web/public/opendaw-wasm/wasm/` contiene
   `engine.wasm`, `stretch_wasm.wasm` y `plugins/*.wasm`; los worklets/workers se importan con
   `?url` para que Vite los empaquete. El arranque real está en `web/src/opendaw-engine.ts`:

```ts
import workletsUrl from "@opendaw/studio-core/processors.js?url"
import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url"
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url"
import { WasmEngine } from "@opendaw/studio-core-wasm"
import { AudioWorklets, Workers } from "@opendaw/studio-core"

await Workers.install(workersUrl)
AudioWorklets.install(workletsUrl)
await AudioWorklets.createFor(audioContext) // añade processors.js a ESTE contexto
WasmEngine.install({
  processorUrl: wasmProcessorUrl,
  offlineWorkerUrl: wasmOfflineWorkerUrl,
  wasmUrl: `${import.meta.env.BASE_URL}opendaw-wasm`,
})
await WasmEngine.ensureReady(audioContext) // añade wasm-processor.js
```

   El processor WASM se registra **una vez por contexto**. Por eso hay un único `AudioContext`
   guardado en `globalThis` (`__miuzikaOpenDawBoot`), incluso si Vite recarga el módulo por HMR.

3. Si se compila el motor desde fuente: Rust ≥ 1.82, target `wasm32-unknown-unknown` y toolchain
   nightly con `rust-src`. Con los artefactos prebuilt del npm no hace falta.

## Dos formas de integrar

### A. SDK embebido (recomendada)

Nuestra app (React/Solid/vanilla) monta el `Project` del SDK y usa sus dispositivos. Mantenemos
nuestra timeline y el piano roll puede ser propio o reutilizado.

- Ventaja: control total del producto.
- Coste: hay que construir timeline, mixer y piano roll, o adaptar los del estudio.

### B. Fork del estudio

Se parte del repo de openDAW y se añade el panel de la GUI.

- Ventaja: DAW completo desde el día 1.
- Coste: mantener un fork grande, UI no basada en React, y todo el código queda AGPL.

Para miuzika, **A** es más limpio: el `Project` del SDK es el ejecutor y nuestro IR manda.
Si se elige B, el adaptador sigue siendo el mismo; solo cambia dónde se engancha.

## Mapeo conceptual

| miuzika | openDAW | Notas |
|---|---|---|
| `Project.bpm`, `key`, `lengthBars` | tempo map y escala del proyecto | openDAW tiene automatización de tempo |
| `Track` | `AudioUnitBox` + `TrackBox` | una unidad de audio por pista |
| `Track.instrument.type` | `InstrumentFactories` | drumkit→Playfield, bass/pad/lead/synth→Vaporisateur, soundfont→SoundFont player, sampler→Nano |
| `Clip` (MIDI) | región MIDI + `ValueEventCollectionBox` | convertir `beat × PPQN` |
| `Note` | note event (pitch, position, duration, velocity) | `lib-midi` puede ayudar |
| `Clip` (audio) | `AudioRegionBox` + `AudioFileBox` | playback y referencias; los bytes WAV se cargan desde IndexedDB |
| `Device` | dispositivo del grafo | los nombres de parámetros **no** coinciden; hace falta tabla |
| `Track.gainDb/pan` | gain/pan de la unidad | dB vs ganancia lineal: convertir |
| `master.gainDb` | salida/master | ídem |
| `Project` completo | `ProjectBundle` (OPFS) | serialización y assets |
| export | DAWproject | interop con otros DAW |

### Dispositivos

| miuzika | openDAW | conversión aplicada |
|---|---|---|
| reverb | Reverb (FreeVerb) | `wet`/`dry` a dB, `preDelay` a segundos |
| delay | Delay | `time` a ms, feedback, cross, wet/dry dB |
| chorus | Delay modulado | delay 16-28 ms + LFO (aproximación) |
| distortion | Waveshaper | `drive` a inputGain dB, mix |
| filter | Revamp (low-pass) | `cutoff` 0..1 → 20 Hz..20 kHz, `resonance` → Q |
| eq | Revamp | lowShelf 100 Hz, midBell 1 kHz, highShelf 8 kHz |
| compressor | Compressor | umbral dB, ratio, attack/release ms |
| bitcrusher | Crusher | bits, mix |
| gate | Gate | umbral dB, release ms |
| width | StereoTool | `width` 0..2 → stereo -1..1 |

Los dispositivos sin equivalente exacto se aproximan a propósito; la alternativa sería omitirlos.
El adaptador devuelve avisos cuando algo no se puede mapear.

### Conversion de parámetros

Nuestros dispositivos usan 0..1 normalizado (salvo eq en dB, ratio 1..20, bits 1..16). openDAW
usa unidades propias por dispositivo. El adaptador debe tener una tabla explícita:

```ts
type ParamMap = Record<string, (value: number) => number>
const REVERB: ParamMap = {
  wet: (v) => v,          // verificar: ¿0..1 o porcentaje?
  decay: (v) => 0.5 + v * 9.5, // segundos, verificar
  preDelay: (v) => v * 0.2,
  damping: (v) => v,
}
```

Regla: si un parámetro no tiene mapeo, **fallar** en vez de adivinar. Es preferible que el
usuario reciba "no puedo mapear ese parámetro" a que genere un proyecto silencioso.

## Contrato del adaptador

```ts
// pseudocódigo: define la frontera, no se ha ejecutado
interface HostAdapter {
  load(project: Project): Promise<void>          // crea/actualiza el proyecto en el host
  apply(project: Project): Promise<void>         // sincroniza tras applyOps
  render(project: Project): Promise<AudioBuffer> // OfflineEngineRenderer
  exportDawproject(project: Project): Promise<Uint8Array>
}
```

Flujo con la GUI:

1. Una operaci?n produce un `Project` nuevo (inmutable).
2. `adapter.apply(project)` reconcilia por id: crea lo que falta, actualiza lo que cambi?,
   borra lo que desapareci?.
3. La UI escucha el resultado y mantiene su propia pila de undo.

### Sincronización

No serializar el proyecto entero en cada cambio. El adaptador debe aplicar un **diff por id**:

```
tracks: added / removed / updated(gain, pan, mute, devices)
clips:  added / removed / updated(notes)
```

Nuestros ids (`trk_bass`, `clp_3`) se pueden mapear 1:1 a ids del host si el SDK acepta UUIDs
propios; si no, mantener una tabla `miuzikaId ↔ hostId`.

## Import/export hoy

- **MIDI**: ya implementado (`src/core/midi.ts`). Formato 1, PPQN 960, canal 10 para batería,
  armadura y tempo. Sirve para validar el resultado en cualquier DAW antes de integrar.
- **DAWproject**: siguiente export. El SDK trae `lib-dawproject`; habría que generar el XML y
  empaquetar assets.
- **JSON**: el IR completo, pensado para versionar y depurar.

## Plan de implementación

1. ~~**Spike de SDK**: montar un proyecto en blanco, cargar el WASM y reproducir.~~
   Hecho: `web/src/opendaw-engine.ts` carga el IR como `.odw`, arranca `EngineWorklet` y suena
   con `WasmEngine`. MIDI, batería Playfield y pistas WAV usan el mismo camino; ya no hay
   reproductor WebAudio alternativo.
2. ~~**Adaptador de lectura**: volcar un `Project` nuestro a openDAW.~~ Hecho.
3. ~~**Adaptador de escritura**: leer un proyecto de openDAW y convertirlo a IR.~~ Hecho para
   notas/pistas/mezcla; los FX no se reconstruyen.
4. **Reconciliación**: diff por id + undo compartido entre la UI y openDAW.
5. **Piano roll**: hecho en miuzika (edita el IR); falta sincronizar con el editor de openDAW.
6. **Render offline**: `OfflineEngineRenderer` para previsualizar dentro de openDAW. Mientras
   tanto, el mixdown usa nuestro renderizador WebAudio (`web/src/render.ts`).
7. ~~**Audio**: `AudioFileBox` + `SampleService` para reproducir los WAV.~~
   Hecho en playback con `AudioFileBox`/`AudioRegionBox`; los WAV largos se parten en chunks
   de 2 minutos. Falta exportar audio en `.odw`/DAWproject standalone.

## Checklist de verificación contra el SDK real

- [x] Nombre y firma exactos de `WasmEngine.install` / `ensureReady` en la versión instalada.
- [x] Constante `PPQN` y utilidades de conversión de beats.
- [x] API para crear región MIDI y volcar eventos (`ValueEventCollectionBox`).
- [x] Factorías de instrumentos disponibles y sus parámetros.
- [ ] Nombres y rangos de parámetros de cada efecto (mapeados y probados en ida/vuelta).
- [ ] Cómo se expone el historial de undo.
- [ ] Formato de `ProjectBundle` y gestión de assets en OPFS.
- [ ] `OfflineEngineRenderer`: entrada, salida y límites.
- [ ] Comportamiento con `AudioContext` suspendido y con pestañas en segundo plano.

## Riesgos específicos

- **Sin VST3**: el catálogo de instrumentos es el del host. Si el usuario espera Serum, no está.
- **Madurez**: openDAW está en desarrollo activo; fijar una versión y aislar el adaptador.
- **AGPL**: cualquier despliegue público obliga a publicar el código. Decisión ya tomada, pero
  afecta a integraciones futuras (plugins de terceros, SDK cerrados).
- **Rendimiento**: muchos clips con miles de notas; medir antes de asumir.
