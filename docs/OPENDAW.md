# openDAW integration

This document sets the boundary between miuzika and the engine. The integration in
`src/host/opendaw/` (export/import with round-trip of notes, tempo, mix and
audio) and the WASM playback in `web/src/opendaw-engine.ts` are **implemented and verified**.
What follows explains the decisions and what remains pending.

## Actual status

| Piece | Status |
|---|---|
| Create an openDAW `Project` without a browser | ✅ (minimal shims in `shims.ts`) |
| Tempo, bars, master, MIDI tracks | ✅ |
| Clips/regions and notes | ✅ |
| Volume, pan, mute, solo | ✅ |
| Reverb, delay, waveshaper, crusher, compressor, gate, stereotool | ✅ |
| EQ and filter (approximated with Revamp), chorus (modulated delay) | ✅ |
| Import (openDAW → IR): tracks, notes, tempo, mix | ✅ |
| Playback in the browser: `WasmEngine` + `EngineWorklet` | ✅ `web/src/opendaw-engine.ts`; ▶ on MIDI projects |
| Playfield drums with WAV samples | ✅ `SampleProvider` over `web/public/drums` |
| Mute/solo/volume/pan on the fly | ✅ `syncMix` updates the engine's `AudioUnitBox`es |
| Device import | 📋 (notes are preserved; FX are not rebuilt) |
| Audio tracks/regions inside the engine | ✅ `AudioFileBox` + `AudioRegionBox`; long WAVs split into 2-minute blocks |

Commands:

```bash
npm run test:opendaw                       # round trip against the real SDK
```

Measured result: 6 tracks, 24 clips, 666 notes and 11 FX exported; on re-import the
666 notes, the tempo, the length and the gains are preserved.

## Why openDAW

- Audio engine in Rust/WASM + Web Audio, designed for the browser.
- Public SDK on npm (subpackages: `studio-core`, `studio-boxes`, `studio-adapters`,
  `studio-core-wasm`, `lib-dsp`, `lib-midi`, `lib-dawproject`…).
- **DAWproject** import/export, which gives interoperability with Bitwig, Studio One, etc.
- Its own devices: Vaporisateur (subtractive), Playfield (drums), Nano (sampler),
  SoundFont player, and effects (Dattorro/FreeVerb reverb, delay, vocoder, waveshaper,
  crusher, compressor, maximizer…).
- It already includes inference for stem separation and audio-to-MIDI (`lib-inference`, only in the
  studio, not in the SDK).

## License (read before writing code)

openDAW is **dual**:

| Option | Obligation |
|---|---|
| AGPL-3.0-or-later | All combined work is published under AGPL, **including SaaS** (§13). |
| Commercial | You pay and can keep the code closed. Contact: andre.michelle@opendaw.org |

The commercial license **excludes** components with third-party copyleft or external services:

- CTAGDRC compressor (GPL-3.0) → replace with another compressor
- Neural Amp / Tone3000 (service and per-model licenses) → omit
- TempoCNN tempo detection (AGPL-3.0) → replace

Since the product is going to be open, the route is AGPL: copyright notices must be kept and
modifications to openDAW must be published. Our code (`src/core`) is also
licensed AGPL-3.0 so that the whole is coherent.

## Technical startup

Requirements that condition deployment:

1. **Cross-origin isolation** (`COOP: same-origin`, `COEP: require-corp`) because the engine uses
   `SharedArrayBuffer`. It is configured in `vite.config.ts` for `server` and `preview`.
2. Serve the package's WASM artifacts. `web/public/opendaw-wasm/wasm/` contains
   `engine.wasm`, `stretch_wasm.wasm` and `plugins/*.wasm`; worklets/workers are imported with
   `?url` so that Vite bundles them. The actual startup is in `web/src/opendaw-engine.ts`:

```ts
import workletsUrl from "@opendaw/studio-core/processors.js?url"
import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url"
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url"
import { WasmEngine } from "@opendaw/studio-core-wasm"
import { AudioWorklets, Workers } from "@opendaw/studio-core"

await Workers.install(workersUrl)
AudioWorklets.install(workletsUrl)
await AudioWorklets.createFor(audioContext) // adds processors.js to THIS context
WasmEngine.install({
  processorUrl: wasmProcessorUrl,
  offlineWorkerUrl: wasmOfflineWorkerUrl,
  wasmUrl: `${import.meta.env.BASE_URL}opendaw-wasm`,
})
await WasmEngine.ensureReady(audioContext) // adds wasm-processor.js
```

   The WASM processor is registered **once per context**. That is why there is a single `AudioContext`
   stored on `globalThis` (`__miuzikaOpenDawBoot`), even if Vite reloads the module through HMR.

3. If the engine is built from source: Rust ≥ 1.82, target `wasm32-unknown-unknown` and a nightly
   toolchain with `rust-src`. With the npm prebuilt artifacts this is not necessary.

## Two ways to integrate

### A. Embedded SDK (recommended)

Our app (React/Solid/vanilla) mounts the SDK's `Project` and uses its devices. We keep
our timeline and the piano roll can be our own or reused.

- Advantage: full control of the product.
- Cost: the timeline, mixer and piano roll must be built, or the studio's adapted.

### B. Fork of the studio

Start from the openDAW repo and add the GUI panel.

- Advantage: a complete DAW from day 1.
- Cost: maintaining a large fork, a UI not based on React, and all the code ends up AGPL.

For miuzika, **A** is cleaner: the SDK's `Project` is the executor and our IR rules.
If B is chosen, the adapter is still the same; only where it hooks in changes.

## Conceptual mapping

| miuzika | openDAW | Notes |
|---|---|---|
| `Project.bpm`, `key`, `lengthBars` | project tempo map and scale | openDAW has tempo automation |
| `Track` | `AudioUnitBox` + `TrackBox` | one audio unit per track |
| `Track.instrument.type` | `InstrumentFactories` | drumkit→Playfield, bass/pad/lead/synth→Vaporisateur, soundfont→SoundFont player, sampler→Nano |
| `Clip` (MIDI) | MIDI region + `ValueEventCollectionBox` | convert `beat × PPQN` |
| `Note` | note event (pitch, position, duration, velocity) | `lib-midi` can help |
| `Clip` (audio) | `AudioRegionBox` + `AudioFileBox` | playback and references; WAV bytes are loaded from disk (`/api/audio`) |
| `Device` | graph device | parameter names **do not** match; a table is needed |
| `Track.gainDb/pan` | unit gain/pan | dB vs linear gain: convert |
| `master.gainDb` | output/master | same |
| `Project` complete | `ProjectBundle` (OPFS) | serialization and assets |
| export | DAWproject | interop with other DAWs |

### Devices

| miuzika | openDAW | Conversion applied |
|---|---|---|
| reverb | Reverb (FreeVerb) | `wet`/`dry` to dB, `preDelay` to seconds |
| delay | Delay | `time` to ms, feedback, cross, wet/dry dB |
| chorus | Modulated delay | 16-28 ms delay + LFO (approximation) |
| distortion | Waveshaper | `drive` to inputGain dB, mix |
| filter | Revamp (low-pass) | `cutoff` 0..1 → 20 Hz..20 kHz, `resonance` → Q |
| eq | Revamp | lowShelf 100 Hz, midBell 1 kHz, highShelf 8 kHz |
| compressor | Compressor | threshold dB, ratio, attack/release ms |
| bitcrusher | Crusher | bits, mix |
| gate | Gate | threshold dB, release ms |
| width | StereoTool | `width` 0..2 → stereo -1..1 |

Devices without an exact equivalent are approximated on purpose; the alternative would be to omit them.
The adapter returns warnings when something cannot be mapped.

### Parameter conversion

Our devices use normalized 0..1 (except eq in dB, ratio 1..20, bits 1..16). openDAW
uses its own units per device. The adapter must have an explicit table:

```ts
type ParamMap = Record<string, (value: number) => number>
const REVERB: ParamMap = {
  wet: (v) => v,          // check: 0..1 or percentage?
  decay: (v) => 0.5 + v * 9.5, // seconds, check
  preDelay: (v) => v * 0.2,
  damping: (v) => v,
}
```

Rule: if a parameter has no mapping, **fail** instead of guessing. It is better for the
user to get "I cannot map that parameter" than to generate a silent project.

## Adapter contract

```ts
// pseudocode: defines the boundary, has not been run
interface HostAdapter {
  load(project: Project): Promise<void>          // creates/updates the project in the host
  apply(project: Project): Promise<void>         // synchronizes after applyOps
  render(project: Project): Promise<AudioBuffer> // OfflineEngineRenderer
  exportDawproject(project: Project): Promise<Uint8Array>
}
```

Flow with the GUI:

1. An operation produces a new `Project` (immutable).
2. `adapter.apply(project)` reconciles by id: creates what is missing, updates what changed,
   deletes what disappeared.
3. The UI listens to the result and keeps its own undo stack.

### Synchronization

Do not serialize the whole project on every change. The adapter must apply a **diff by id**:

```
tracks: added / removed / updated(gain, pan, mute, devices)
clips:  added / removed / updated(notes)
```

Our ids (`trk_bass`, `clp_3`) can be mapped 1:1 to host ids if the SDK accepts its own UUIDs;
if not, keep a `miuzikaId ↔ hostId` table.

## Import today

- **Open**: the GUI imports an existing JSON or `.miuzika.zip` bundle with its WAVs.
- **openDAW**: the adapter converts the `Project` into an engine project for playback.
- There is no project or MIDI export from the interface.

## Implementation plan

1. ~~**SDK spike**: mount a blank project, load the WASM and play.~~
   Done: `web/src/opendaw-engine.ts` loads the IR as `.odw`, starts `EngineWorklet` and it sounds
   with `WasmEngine`. MIDI, Playfield drums and WAV tracks use the same path; there is no longer an
   alternative WebAudio player.
2. ~~**Read adapter**: dump one of our `Project`s into openDAW.~~ Done.
3. ~~**Write adapter**: read an openDAW project and convert it to IR.~~ Done for
   notes/tracks/mix; FX are not rebuilt.
4. **Reconciliation**: diff by id + undo shared between the UI and openDAW.
5. **Piano roll**: done in miuzika (edits the IR); still to be synchronized with the openDAW editor.
6. **Offline render**: not implemented; the app plays with the engine.
7. ~~**Audio**: `AudioFileBox` + `SampleService` to play the WAVs.~~
   Done in playback with `AudioFileBox`/`AudioRegionBox`; long WAVs are split into chunks
   of 2 minutes.

## Verification checklist against the real SDK

- [x] Exact name and signature of `WasmEngine.install` / `ensureReady` in the installed version.
- [x] `PPQN` constant and beat conversion utilities.
- [x] API to create a MIDI region and dump events (`ValueEventCollectionBox`).
- [x] Available instrument factories and their parameters.
- [ ] Parameter names and ranges for each effect (mapped and tested in the round trip).
- [ ] How the undo history is exposed.
- [ ] `ProjectBundle` format and asset management in OPFS.
- [ ] `OfflineEngineRenderer`: input, output and limits.
- [ ] Behavior with a suspended `AudioContext` and with background tabs.

## Specific risks

- **No VST3**: the instrument catalog is the host's. If the user expects Serum, it is not there.
- **Maturity**: openDAW is under active development; pin a version and isolate the adapter.
- **AGPL**: any public deployment forces publishing the code. The decision is already made, but
  it affects future integrations (third-party plugins, closed SDKs).
- **Performance**: many clips with thousands of notes; measure before assuming.
