# Arquitectura de miuzika

**Estado: 26-oct-2026.** Este documento sustituye al anterior, que describía una app
sin agente ni motor Python («No hay planner, LLM, agente, worker Python»). Era falso
desde hacía varias sesiones. Todo lo que sigue está comprobado contra el código de
este commit: si algo no cuadra, manda el código y este fichero se corrige.

Cifras medidas hoy: `tsc` 0 errores · **121** tests en verde · OPENDAW OK ·
`build:web` OK · 12.638 líneas de TypeScript propio + ~4.100 de motor Python.

---

## 1. Qué es, en una frase

Un DAW en el navegador (openDAW WASM para reproducir, Strudel para patrones) en el
que **un modelo de lenguaje escribe y ejecuta Python** en tu disco para componer,
sintetizar, medir y entregar pistas; el navegador pinta y manda.

No hay base de datos, ni servidor de producción, ni nube propia. Lo que hay:

| pieza | dónde corre | quién la arranca |
|---|---|---|
| GUI + agente | navegador (Chrome, `localhost:5173`) | `npm run dev` |
| API + ejecución de Python | **servidor de desarrollo de Vite** (`vite.config.ts`) | el mismo proceso |
| motor numpy | tu portátil, un proceso por script | el servidor |
| motor torch (GPU) | instancia Lambda Cloud (SSH/SCP) | el servidor, con tu clave |
| LLM | Ollama Cloud, vía proxy del servidor | el navegador |

Consecuencia que hay que tener presente: **no hay nada desplegado**. Todo esto vive
dentro de `npm run dev`. Si Vite no corre, no hay app.

---

## 2. Las capas y sus fronteras

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR  (web/src/, ~9.400 líneas)                                        │
│                                                                              │
│  main.ts (2.567)  ── orquestador: estado, ops, guardado, arranque            │
│    ├─ timeline.ts (737)         lienzo: pistas, clips, onda, arrastre        │
│    ├─ chat.ts (258)             panel del chat (no guarda nada)              │
│    ├─ editor.ts (175)           piano roll                                   │
│    ├─ code-lab.ts (150)         editor Strudel                               │
│    ├─ opendaw-engine.ts (411)   reproducción WASM   ──┐                      │
│    ├─ stem-player.ts (180)      stems largos por <audio>  mismo transporte   │
│    └─ agent/                                                    │            │
│        agent.ts (280)    bucle: piensa → herramienta → observa  │            │
│        tools.ts (1.187)  17 herramientas: el contrato con el LLM│            │
│        contexto.ts (158) recorte de salidas y turnos guardados   │            │
│        actividad.ts (105) frases de la barra de estado           │            │
│                                                                              │
│  llm.ts (374)  ── SSE contra /api/llm (la clave NUNCA llega aquí)            │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ fetch /api/*   (25 endpoints)
┌───────────────────────────────────────▼──────────────────────────────────────┐
│  SERVIDOR DE DESARROLLO  (vite.config.ts, 1.861 líneas)                      │
│                                                                              │
│  · resuelve rutas y confina todo a workspace/                                │
│  · escribe/lee ficheros, lanza Python, sirve WAV con Range                   │
│  · puertas: smoke del motor, 409 de duplicados, ast.parse en gpu/            │
│  · proxy /api/llm con la clave del .env                                      │
│  · server/lambda.ts (587): encender, sincronizar por scp, ejecutar, traer    │
└──────────┬──────────────────────────────────────────────┬────────────────────┘
           │ spawn python -u                              │ ssh / scp
┌──────────▼───────────────────────────┐   ┌──────────────▼─────────────────────┐
│  MOTOR numpy  workspace/codigo/      │   │  MOTOR torch  workspace/gpu/       │
│  dsp · instruments · midi            │   │  motor_gpu · voces_gpu             │
│  render · cancion  ← obra, no API    │   │  (sólo en Lambda)                  │
│  voces · gate_voz · sfz2sf2 …        │   │                                    │
└──────────────────────────────────────┘   └────────────────────────────────────┘
```

### Fronteras que hay que respetar

- **El navegador no toca el disco.** No hay IndexedDB (se quitó a propósito). Todo va
  por `/api/*`. En `localStorage` sólo queda: qué proyecto está abierto, si el chat
  está plegado, el modelo del LLM, el destino cpu/GPU y el gasto de GPU de la sesión.
- **La clave de Ollama y la de Lambda viven en `.env`.** Sólo las usa el servidor.
  El bundle del cliente no las contiene: `/api/llm` es un proxy.
- **El agente escribe con herramientas, no con `fs`.** Sus 17 herramientas son la
  única puerta; todo pasa por `ejecutarHerramienta()` en `tools.ts`.

---

## 3. Quién es la fuente de verdad

Tres verdades distintas, y no se sustituyen entre sí:

| pregunta | dueño | dónde |
|---|---|---|
| ¿qué hay en la canción? | **`proyectos/<slug>/proyecto.json`** | disco; lo escribe el navegador con autoguardado (1,5 s tras un cambio) |
| ¿cómo suena un sonido? | **el render** (duración, pico, crest, centroide) | se mide, no se declara |
| ¿qué recuerda el agente de este proyecto? | **`proyectos/<slug>/agente.json`** | disco; 8 turnos + resumen rodante |

Reglas que se deducen de esto:

1. **El navegador es el único que escribe `proyecto.json`.** Si lo editas desde
   fuera, la pestaña que lo tiene abierto lo pisa al siguiente cambio. Para que un
   arreglo sobreviva tiene que ser una **op** ejecutada en la pestaña.
2. **El agente no tiene memoria propia.** Si no está en `agente.json` (o en su
   resumen), no existe para él. Al abrir un proyecto se le inyecta ese bloque en el
   prompt de sistema, junto al manifiesto del motor.
3. **Ningún WAV se guarda dentro del JSON.** Cada asset lleva su `ruta` relativa a la
   carpeta del proyecto; los bytes viven en disco. Por eso el proyecto es portable y
   por eso el máster de 6 stems no son 760 MB de base64.

---

## 4. El ciclo de un turno, paso a paso

Esto es lo que ocurre cuando escribes en el chat:

```text
1. chat.ts          submit → onSend(texto) → main.responderAlUsuario(texto)
2. main.ts          refrescarManifiesto(): pide /api/manifiesto (regenera con ast)
                    y rehace el prompt de sistema:
                       AGENTE_SISTEMA (literal, con huella)
                     + carpeta del proyecto
                     + manifiesto del motor (firmas)
                     + bloqueContexto(agente.json)   ← memoria del proyecto
3. main.ts          arranca el latido (1 s) y la burbuja «pensando · N s · N tokens»
4. agent.ts         while (pasos < 12):
                     chat() → llm.ts → POST /api/llm/v1/chat/completions (SSE)
                     si finish_reason == "load"      → espera con una petición de 1 token
                     si finish_reason == "sin_salida" → repite con reasoning_effort:none
                     si hay tool_calls → ejecutarHerramienta() una por una
5. tools.ts         cada herramienta: fetch al servidor (o al navegador, si toca el
                    proyecto) y devuelve texto para el modelo
6. servidor         confina la ruta a workspace/, escribe/ejecuta y devuelve
                    {ok, codigo, salida, errores, escritos}
7. tools.ts         si la salida pasa de 4.000 caracteres: cabeza + cola al modelo y
                    el texto entero a _salidas/<herramienta>_<id>.txt
8. main.ts          al terminar: burbuja final, línea «✓ N pasos · N herramientas» y
                    agregarTurno() → POST agente.json
```

### Los topes que evitan que un turno se coma la sesión

| tope | valor | dónde | por qué |
|---|---|---|---|
| pasos por turno | 12 | `agent.ts` | un bucle no puede ser infinito |
| salida por petición | 32.768 tokens | `agent.ts` | el modelo **razona** y eso gasta del mismo presupuesto |
| un fichero escrito | 8.000 caracteres | `tools.ts` | un `escribir_fichero` de 9.700 tokens provoca `load` en la llamada siguiente |
| espera por petición | 180 s | `llm.ts` | sin timeout, una petición colgada no contesta nunca |
| salida de herramienta | 4.000 caracteres | `contexto.ts` | un render imprime cientos de líneas |

Y tres cortes automáticos, cada uno porque ya pasó: **3 fallos idénticos** seguidos
cortan el turno; **3 escrituras** sin ejecutar nada cortan el turno; un vacío se
reintenta hasta **5** veces (1-2-4-8-16 s) y luego **una** reanudación automática.

---

## 5. El modelo de datos

`src/core/types.ts` (198 líneas). Es independiente del motor: openDAW es una vista.

```text
Project { schemaVersion: 1, id, name, bpm, key{tonic,mode}, timeSignature,
          lengthBars, seed, tracks[], audioAssets[], codeSources[],
          master{gainDb}, meta{createdAt,prompt?,generator?} }

Track   { id, name, kind: midi|audio, instrument{type,preset?,program?,archivo?},
          gainDb, pan, muted, solo, devices[], clips[] }

Clip    { id, name, start (beats), length (beats), notes[], audio?{assetId,offset,gainDb} }

Note    { pitch 0..127, start, duration, velocity 1..127 }
Device  { id, type, enabled, params }   ← 10 tipos, rangos en DEVICE_PARAMS
```

Detalles que importan:

- **El tiempo se cuenta en negras (beats)**, no en segundos ni píxeles. Se pasa a
  pulsos (960 por negra) sólo al hablar con openDAW, y a PPQN sólo al exportar MIDI.
- **Un clip con audio de más de dos compases dura un número entero de compases**
  (`src/core/tiempo.ts`): el MIDI acaba en su última nota y el WAV lleva cola de
  reverb; si no se igualan, la timeline enseña dos rejillas.
- **La duración de un clip nunca supera el fichero**: si el agente pide 90 compases
  de un WAV que dura 84,17, el clip se queda en 84,17 y el resultado lo dice.

### Las 17 operaciones (`src/core/ops.ts`, 672 líneas)

`set_song · add_track · set_track · remove_track · add_notes · replace_clip_notes ·
remove_clip · add_device · set_device · remove_device · register_audio_asset ·
add_audio_clip · set_audio_clip · set_clip_length · move_clip · duplicate_clip ·
set_master`

Cada una valida con zod, se aplica sobre un `structuredClone` y **o entra entera o no
entra nada**: si el proyecto quedaría inválido (`validateProject`), se descarta el
lote completo y el original queda intacto. Eso es lo que permite que el agente
proponga cambios sin poder romper el proyecto.

### En disco

```text
workspace/
├── proyectos/<slug>/
│   ├── proyecto.json      ← el maestro (formato miuzika-proyecto, version 1)
│   ├── agente.json        ← memoria del agente para ESE proyecto
│   ├── entrada/           ← WAV importados por el usuario
│   ├── salida/            ← WAV y MIDI que generan el agente y el motor
│   ├── sonidos/           ← receta .json + su .wav
│   ├── samples/           ← samples traídos del catálogo (ya convertidos)
│   └── instrumentos/      ← .sf2 del proyecto (gitignored)
├── codigo/                ← MOTOR numpy (compartido por todos los proyectos)
├── gpu/                   ← MOTOR torch (sólo se ejecuta en Lambda)
├── herramientas/          ← manifiesto, picos, verificar_audio, midi_lector, smoke
├── plantillas/            ← one_shot.py y demás
├── catalogo/              ← 4.231 samples CC0 de VCSL (9,6 GB, gitignored)
├── _salidas/              ← salidas largas de herramientas (fuera del proyecto a propósito)
└── _referencias/, _archivo/
```

**`_salidas/` está fuera del proyecto y es compartida** por un motivo concreto: el
agente puede llamar a `crear_proyecto` a mitad de turno, y una ruta relativa que le
dimos antes dejaría de apuntar al mismo sitio. Las carpetas compartidas se declaran
en **un solo sitio**: `src/core/rutas.ts` (lo leen el servidor y el navegador).

---

## 6. Los 25 endpoints

Todos son middlewares del servidor de desarrollo; ninguno existe en producción
porque no hay producción.

| ruta | método | qué hace | quién la llama |
|---|---|---|---|
| `/api/llm/*` | proxy | reescribe a Ollama y pone la clave | `llm.ts` |
| `/api/agent-log` | POST | una línea por petición en `tmp/llm.log` | `llm.ts` |
| `/api/build` | GET | id del código servido (aviso de bundle viejo) | `build.ts` |
| `/api/fs/write` | POST | escribe en workspace; 409 si duplica el motor o es `patch*.py` | `escribir_fichero` |
| `/api/fs/read` | POST | lee hasta 20.000 caracteres | `leer_fichero` |
| `/api/fs/edit` | POST | busca/reemplaza exacto; smoke si es el motor | `editar_fichero` |
| `/api/fs/list` | GET | inventario; `?carpeta=` (por defecto, el proyecto) | `listar_ficheros` |
| `/api/proyectos` | GET/POST | lista maestros / lee entero / escribe validando el formato | `proyecto-disco.ts` |
| `/api/manifiesto` | GET | regenera `MANIFEST.md` con `ast` y lo devuelve | `main.ts` |
| `/api/audio` | GET | WAV con Range (streaming) | `<audio>`, `audio-store.ts` |
| `/api/audio/subir` | POST | WAV del navegador → `entrada/` (tope 512 MB) | `proyecto-disco.ts` |
| `/api/picos` | GET | picos para dibujar la onda, **con caché por mtime** | `audio-store.ts` |
| `/api/midi` | GET | notas de un `.mid` normalizadas a beats | `anadir_pistas` |
| `/api/verificar` | POST | medidas de un WAV (`verificar_audio.py`) | `verificar_audio` |
| `/api/referencia/medir` | POST | tempo, tono y forma de un audio o de YouTube | `medir_referencia` |
| `/api/instrumentos/crear` | POST | `.sfz` → `.sf2` dentro del proyecto | `usar_instrumento` |
| `/api/catalogo/buscar` | POST | búsqueda en lenguaje natural sobre 4.231 samples | `buscar_sonido`, diálogo |
| `/api/catalogo/audio` | GET | escuchar un sample sin traerlo | diálogo «Sonidos» |
| `/api/catalogo/importar` | POST | traer un sample convertido al proyecto | `usar_sample` |
| `/api/voces` | GET | catálogo de voces leído del motor (`?medir=1` renderiza) | `listar_voces` |
| `/api/voces/nueva` | POST | puerta: renderiza, mide y cuece la voz en `instruments.py` | `crear_voz` |
| `/api/run/python` | POST | ejecuta un script en el portátil | `ejecutar_python` |
| `/api/run/lambda` | POST | el mismo contrato en la GPU (409 si el script es numpy puro) | `ejecutar_python` |
| `/api/gpu/estado` | GET | fase, tarifa real y gasto | `gpu-coste.ts` |
| `/api/gpu/encender` · `/apagar` | POST | ciclo de vida de la instancia | botón de la cabecera |

---

## 7. Las 17 herramientas del agente

`web/src/agent/tools.ts` es el contrato con el modelo. Tres clases:

**Las que cambian el proyecto (se ejecutan en el navegador, como ops):**
`crear_proyecto` · `anadir_pistas` · `ajustar_pistas` · `igualar_clips` ·
`usar_sample` · `usar_instrumento` · `crear_sonido`

**Las que hablan con el servidor:**
`escribir_fichero` · `leer_fichero` · `listar_ficheros` · `editar_fichero` ·
`ejecutar_python` · `verificar_audio` · `buscar_sonido` · `listar_voces` ·
`crear_voz` · `medir_referencia`

Por qué esa división: las siete primeras cambian el proyecto, y el proyecto **sólo lo
puede cambiar la pestaña** (es la dueña del fichero maestro). Las otras no.

Todas comparten el mismo envoltorio: timeout propio, cancelación con `AbortSignal`, y
si la respuesta pasa de 4.000 caracteres se recorta y se guarda entera en `_salidas/`.

---

## 8. Los dos motores Python, y el problema de fondo

| | `workspace/codigo/` | `workspace/gpu/` |
|---|---|---|
| tecnología | numpy puro (sin scipy) | torch + CUDA |
| dónde | tu portátil | Lambda (`gpu_1x_a10`, 1,29 $/h) |
| coste | 0 | ~3 min de arranque + por hora |
| qué hace | timbres, MIDI, mezcla, análisis, catálogo | saturación ×4, IR estéreo, reverb FFT, shimmer, granular, compresor multibanda, voces pesadas |
| qué **no** hace | nada de GPU | **no escribe `.mid`** |

### La deuda central: el «motor» son dos cosas distintas

`codigo/` mezcla, en la misma carpeta y con el mismo estatus en el manifiesto:

- **biblioteca reutilizable**: `dsp.py` (filtros, STFT, reverb, LUFS, crest),
  `instruments.py` (timbres), `midi.py` (escritor MIDI), `voces.py`, `gate_voz.py`,
  `sfz2sf2.py`, `catalogo.py`, `importar_sample.py`;
- **una obra concreta**: `cancion.py` (BPM 90, 140 compases, secciones y armonía de
  «quiéreme despacio») y `render.py` (el arreglo que la convierte en stems).

El manifiesto se lo presenta al agente como si todo fuera API. El agente importa
`cancion` y hereda el tempo y la estructura de otra canción. **Esto es lo primero que
hay que separar**: `cancion.py` y `render.py` a `workspace/obras/<slug>/` y el
manifiesto sin ellos. No lo he hecho porque cambia lo que el agente ve.

### El reparto, en la práctica

- Audio del tema → GPU (`saturar(veces=4)`, `ir_estereo(dur>=3)`, `reverb`, `shimmer`,
  `congelar`, `granular`, `compresor_multibanda`, 24 bits).
- MIDI y muestras rápidas → numpy local, gratis.
- **Un script numpy en Lambda es CPU a precio de GPU**, y el servidor lo rechaza
  (409) *antes* de encender la máquina: lee el fuente y, si importa
  `dsp`/`instruments`/`render`/`cancion` sin `motor_gpu`, corta.

---

## 9. Acoplamientos peligrosos (leer antes de tocar)

1. **Editar `vite.config.ts` o `server/` reinicia el servidor** y mata el turno en
   vuelo; la pestaña abierta se queda con el JavaScript viejo (el HMR se desconecta
   en silencio). La app lo detecta (`/api/build`) y ofrece «↻ versión nueva».
2. **Añadir una dependencia exige reiniciar el servidor a mano**: Vite reoptimiza y
   el navegador falla con «Failed to fetch dynamically imported module».
3. **El prompt de sistema es un literal con huella** (`agente-prompt.ts` +
   `HUELLA_PROMPT` + prueba que falla si cambia). Cambiarlo es un acto deliberado.
4. **Los `.sf2` no se cargan con el gestor de openDAW**: se queda en `progress` para
   siempre porque lee de su OPFS. Hay un gestor propio en `opendaw-engine.ts`.
5. **`middlewares.use("/api/x", …)` casa por prefijo**: un handler de `/api/voces` se
   come `/api/voces/nueva` si no hace `next()`.
6. **Play con `element.click()` no arranca openDAW**: no es gesto de usuario y el
   `AudioContext` queda suspendido. En pruebas, clic real por coordenadas.
7. **`confirm()` bloquea el renderer en pruebas headless**: hay que aceptarlo por CDP
   (`Page.handleJavaScriptDialog`) en una llamada aparte.

---

## 10. Cómo se verifica (las puertas)

```bash
cd /c/Users/carlos/proyectos/miuzika
npx tsc --noEmit        # 0 errores
npm run test:unit       # 121 tests (dominio puro: ops, proyecto, sonidos, palabras…)
npm test                # + contrato con openDAW (exportar/importar un .odw)
npm run build:web       # bundle de producción
```

Y a mano, porque ningún test lo cubre: abrir `localhost:5173`, abrir un proyecto con
pistas, darle a play y **oír** que suena; guardar y comprobar que `proyecto.json`
tiene el `guardadoEn` de ahora.

Para probar herramientas sin pasar por el modelo, la app expone en desarrollo:

```js
await __miuzika.herramienta('anadir_pistas', JSON.stringify({ wavs:['salida/x.wav'], compases:16 }))
```

---

## 11. Deuda conocida (honesta)

**Arreglado el 26-oct** (con medida antes/después):

| qué | antes | después |
|---|---|---|
| `listar_ficheros` metía el workspace entero en el contexto | 586.682 B (recortados: el agente no veía sus ficheros) | 11.097 B la raíz · 5.022 B el proyecto · catálogo excluido |
| `ejecutar_python` devolvía el árbol en cada llamada | recorrido de 4.231 ficheros por ejecución | sólo `escritos` (lo que cambió en el proyecto) |
| abrir un proyecto de 21 pistas / 11 WAV | 38 s (un proceso Python por asset, en serie) | 16,8 s en frío · **0,5 s** con la caché de picos |
| el texto del reintento sin razonamiento se descartaba | una respuesta buena se tiraba como turno vacío | se recalcula tras el reintento |
| `resolveClip` con un solo clip | borraba el único clip aunque el nombre no coincidiera | error con la lista de clips |
| `fallosIguales` vivía en el módulo | un fallo de ayer cortaba el turno de hoy | por turno |
| dos listas de carpetas compartidas | al navegador le faltaba `catalogo/` | una sola en `src/core/rutas.ts` |
| alias `oboe` con «е» cirílica | el oboe no se reconocía | arreglado |
| `boot()` con 50 líneas muertas | prometía abrir el último proyecto (ya no lo hace) | arranque limpio real |
| `leerCuerpo` sin tope | un POST de 9 MB se comía la memoria | 413 por encima de 8 MB |

**Pendiente, por orden de importancia:**

1. **Separar biblioteca de obra** en `codigo/` (§8). Es lo que más confunde al agente.
2. **Partitura como dato**: que la canción sea un `partitura.json` validado y un
   renderizador fijo, en vez de un guion Python por pieza. Propuesto, sin aceptar.
3. **Mezcla**: no hay buses, ni automatización, ni medidores en vivo. `set_device`
   existe pero con unidades normalizadas 0..1, no en Hz/dB/ms.
4. **`parecidosA`** (búsqueda por parecido acústico) y **`theory.ts`** (acordes,
   grados, voicings) existen y tienen tests, pero **no están conectados** a ninguna
   herramienta: nadie los llama.
5. **`codigo/experimental/`** acumula 20 ficheros del agente, incluidos dos
   `render_final*.py` de 484 y 279 líneas que reimplementan el motor. Es justo lo que
   la puerta intenta impedir; están ahí por haber nacido antes que ella.
6. **`openDawToProject`** sólo lo usa la prueba de contrato, no la UI: no hay
   importación de `.odw` desde la app.
7. Tres clases CSS usadas sin estilo (`.cancel`, `.code-example`, `.texto`).

---

## 12. Mapa de ficheros, para orientarse

**Navegador (`web/src/`)**

| fichero | líneas | de qué es dueño |
|---|---|---|
| `main.ts` | 2.567 | estado de la app, ops, autoguardado, arranque, diálogos |
| `agent/tools.ts` | 1.187 | las 17 herramientas y su envoltorio |
| `timeline.ts` | 737 | canvas: pistas, clips, onda, arrastre, zoom |
| `opendaw-engine.ts` | 411 | arranque del engine WASM y sincronización de mezcla |
| `llm.ts` | 374 | SSE, timeouts, reintentos por `load` |
| `agent/agent.ts` | 280 | bucle del turno y sus cortes |
| `chat.ts` | 258 | panel del chat (no persiste nada) |
| `audio-store.ts` | 246 | caché de AudioBuffers + hidratación en paralelo |
| `proyecto-archivo.ts` | 206 | serializar/validar el maestro, slug, nombre |
| `stem-player.ts` | 180 | stems largos por `<audio>` sincronizados por reloj |
| `editor.ts` · `code-lab.ts` | 175 · 150 | piano roll y editor Strudel |
| `agent/contexto.ts` | 158 | recorte de salidas, turnos, `agente.json` |
| `gpu-texto.ts` · `gpu-coste.ts` | 152 · 97 | texto y contador del gasto de GPU |
| `plantilla.ts` · `agente-prompt.ts` | 98 · 63 | encargo y prompt con huella |
| `build.ts` · `proyecto-disco.ts` · `project-bundle.ts` · `wav.ts` | 56 · 69 · 80 · 40 | aviso de bundle viejo, HTTP del maestro, ZIP, codificador WAV |

**Dominio (`src/`)**

| fichero | líneas | de qué es dueño |
|---|---|---|
| `core/ops.ts` | 672 | las 17 operaciones, transaccionales |
| `core/sonidos.ts` | 339 | receta de sonido → script Python |
| `core/palabras.ts` | 298 | 16 palabras humanas → parámetros |
| `core/taxonomia.ts` | 229 | 55 etiquetas (GM + BST + AudioSet) y alias |
| `core/theory.ts` | 222 | escalas y acordes (**no conectado**) |
| `core/project.ts` | 213 | crear, validar, estadísticas, `idsDeAssets` |
| `core/types.ts` | 198 | el modelo de datos |
| `core/buscar.ts` | 192 | búsqueda en lenguaje natural |
| `core/rutas.ts` · `tiempo.ts` · `params.ts` · `rng.ts` | 45 · 36 · 12 · 10 | carpetas compartidas, compases, parámetros, hash |
| `host/opendaw/adapter.ts` | 479 | IR ↔ proyecto de openDAW |
| `host/opendaw/mapping.ts` | 214 | 10 dispositivos y 4 instrumentos al SDK |
