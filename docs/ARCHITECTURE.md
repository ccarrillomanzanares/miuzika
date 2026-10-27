# Arquitectura de miuzika

**Estado: 27-oct-2026** (revisión de arquitectura: ver `docs/REVISION-2026-10-27.md`).
Todo lo que sigue está comprobado contra el código de este commit: si algo no cuadra,
manda el código y este fichero se corrige.

---

## 1. Qué es, en una frase

Un DAW en el navegador (openDAW WASM para reproducir, Strudel para patrones) con un
agente que **compone, arregla y mezcla escribiendo directamente en el proyecto**
(ops transaccionales: notas, acordes, efectos, faders) y que, para el audio
sintetizado, **escribe y ejecuta Python** en tu disco o en una GPU. Se le habla en
cualquier idioma. El navegador pinta y manda.

No hay base de datos, ni servidor de producción, ni nube propia. Lo que hay:

| pieza | dónde corre | quién la arranca |
|---|---|---|
| GUI + agente | navegador (Chrome, `localhost:5173`) | `npm run dev` |
| API + ejecución de Python | **servidor de desarrollo de Vite** (plugin `server/api.ts`) | el mismo proceso |
| motor numpy | tu portátil, un proceso por script | el servidor |
| motor torch (GPU) | instancia Lambda Cloud (SSH/SCP) | el servidor, con tu clave |
| LLM | Ollama Cloud, vía proxy del servidor | el navegador |

Consecuencia que hay que tener presente: **no hay nada desplegado**. Todo esto vive
dentro de `npm run dev`. Si Vite no corre, no hay app.

---

## 2. Las capas y sus fronteras

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR  (web/src/)                                                       │
│                                                                              │
│  main.ts  ── estado de la app, historial, autoguardado, diálogos, arranque   │
│    ├─ timeline.ts · editor.ts (piano roll) · code-lab.ts (Strudel)          │
│    ├─ opendaw-engine.ts (WASM) + stem-player.ts (<audio>)  mismo transporte │
│    ├─ chat.ts (panel, no guarda nada) · i18n.ts (textos fijos es/en)        │
│    └─ agent/                                                                 │
│        agent.ts     bucle: piensa → herramienta → observa (12 pasos máx.)    │
│        tools.ts     20 herramientas: el contrato con el LLM                  │
│        acciones.ts  las que leen/cambian el proyecto (contrato «Estudio»)    │
│        contexto.ts  recortes, agente.json, recorte seguro de la conversación │
│                                                                              │
│  llm.ts  ── SSE contra /api/llm (la clave NUNCA llega aquí)                  │
│                                                                              │
│  src/core/ (dominio puro, compartido con el servidor y los tests)            │
│    types · ops (17, transaccionales) · project · theory · composicion ·      │
│    resumen · sonidos · palabras · taxonomia · buscar · nombres · rutas       │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ fetch /api/*   (25 endpoints)
┌───────────────────────────────────────▼──────────────────────────────────────┐
│  SERVIDOR DE DESARROLLO  (server/)                                           │
│                                                                              │
│  api.ts       monta las rutas en Vite (orden importa: casan por prefijo)     │
│  contexto.ts  confina todo a workspace/, resuelve rutas, lanza Python,       │
│               lee cuerpos con tope, escribe logs                              │
│  api/         ficheros · proyectos · audio · catalogo · voces · gpu · python │
│  lambda.ts    encender, sincronizar por scp, ejecutar, traer, apagar         │
│  (vite.config.ts sólo monta el plugin y el proxy /api/llm con la clave)      │
└──────────┬──────────────────────────────────────────────┬────────────────────┘
           │ spawn python -u                              │ ssh / scp
┌──────────▼───────────────────────────┐   ┌──────────────▼─────────────────────┐
│  MOTOR numpy  workspace/codigo/      │   │  MOTOR torch  workspace/gpu/       │
│  dsp · instruments · midi · render   │   │  motor_gpu · voces_gpu             │
│  voces · gate_voz · sfz2sf2 …        │   │  (sólo en Lambda)                  │
│                                      │   │                                    │
│  OBRAS  workspace/obras/<slug>/      │   │                                    │
└──────────────────────────────────────┘   └────────────────────────────────────┘
```

### Fronteras que hay que respetar

- **El navegador no toca el disco.** No hay IndexedDB (se quitó a propósito). Todo va
  por `/api/*`. En `localStorage` sólo queda: qué proyecto está abierto, si el chat
  está plegado, el modelo del LLM, el destino cpu/GPU y el gasto de GPU de la sesión.
- **La clave de Ollama y la de Lambda viven en `.env`.** Sólo las usa el servidor.
  El bundle del cliente no las contiene: `/api/llm` es un proxy.
- **El agente escribe con herramientas, no con `fs`.** Sus 20 herramientas son la
  única puerta; todo pasa por `ejecutarHerramienta()` en `tools.ts`.
- **Las herramientas hablan un vocabulario canónico; el modelo traduce.** Palabras de
  sonido, tipos de efecto e instrumento, modos y patrones son `enum` en el esquema;
  los acordes, cifrado americano; la búsqueda de sonidos, español o inglés. La
  persona escribe en su idioma y el LLM hace de capa de traducción.

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
3. **La carpeta es del proyecto, no de su nombre.** `meta.carpeta` se fija al crearlo
   (o al abrirlo de disco) y no cambia al renombrarlo. Los nombres admiten cualquier
   alfabeto (`slugDe` en `src/core/nombres.ts`, la única función de slug).
4. **Ningún WAV se guarda dentro del JSON.** Cada asset lleva su `ruta` relativa a la
   carpeta del proyecto; los bytes viven en disco. Por eso el proyecto es portable y
   por eso el máster de 6 stems no son 760 MB de base64.

---

> Los mismos dos recorridos, dibujados: `docs/esquema-arquitectura.html` (capas) y
> `docs/flujo-aplicacion.html` (abrir/tocar y un turno del agente).

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

### Las 17 operaciones (`src/core/ops.ts`)

`set_song · add_track · set_track · remove_track · add_notes · replace_clip_notes ·
remove_clip · add_device · set_device · remove_device · register_audio_asset ·
add_audio_clip · set_audio_clip · set_clip_length · move_clip · duplicate_clip ·
set_master`

Cada una valida con zod, se aplica sobre un `structuredClone` y **o entra entera o no
entra nada**: si el proyecto quedaría inválido (`validateProject`), se descarta el
lote completo y el original queda intacto. Eso es lo que permite que el agente
cambie el proyecto sin poder romperlo: `editar_proyecto` le da estas ops tal cual, y
la chuleta que ve el modelo sale del propio esquema (`firmasDeOps`).

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
├── obras/<slug>/          ← cancion.py (datos) + tema.py (arreglo): UNA canción, no API
├── _salidas/              ← salidas largas de herramientas (fuera del proyecto a propósito)
├── _referencias/, _archivo/
```

**`_salidas/` está fuera del proyecto y es compartida** por un motivo concreto: el
agente puede llamar a `crear_proyecto` a mitad de turno, y una ruta relativa que le
dimos antes dejaría de apuntar al mismo sitio. Las carpetas compartidas se declaran
en **un solo sitio**: `src/core/rutas.ts` (lo leen el servidor y el navegador).

---

## 6. Los 25 endpoints

Todos son middlewares del servidor de desarrollo, uno o varios por módulo de
`server/api/`; ninguno existe en producción porque no hay producción.

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

## 7. Las 20 herramientas del agente

`web/src/agent/tools.ts` es el contrato con el modelo (esquemas y despacho);
`web/src/agent/acciones.ts`, la implementación de las que tocan el proyecto.

**Componer y producir en el proyecto (se ejecutan en la pestaña):**
`leer_proyecto` · `editar_proyecto` · `escribir_progresion` · `crear_proyecto` ·
`anadir_pistas` · `ajustar_pistas` · `igualar_clips` · `usar_sample` ·
`usar_instrumento` · `crear_sonido`

**Las que hablan con el servidor:**
`escribir_fichero` · `leer_fichero` · `listar_ficheros` · `editar_fichero` ·
`ejecutar_python` · `verificar_audio` · `buscar_sonido` · `listar_voces` ·
`crear_voz` · `medir_referencia`

Por qué esa división: el proyecto **sólo lo puede cambiar la pestaña** (es la dueña
del fichero maestro). La pestaña registra sus acciones una vez con
`registrarAcciones()` y `acciones.ts` sólo depende de un contrato de cuatro métodos
(`Estudio`: proyecto, fijar, enVivo, avisar).

Todas comparten el mismo envoltorio: timeout propio, cancelación con `AbortSignal`
(que en `/api/run/python` mata también el proceso), y si la respuesta pasa de 4.000
caracteres se recorta y se guarda entera en `_salidas/`.

---

## 8. Los dos motores Python, y el problema de fondo

| | `workspace/codigo/` | `workspace/gpu/` |
|---|---|---|
| tecnología | numpy puro (sin scipy) | torch + CUDA |
| dónde | tu portátil | Lambda (`gpu_1x_a10`, 1,29 $/h) |
| coste | 0 | ~3 min de arranque + por hora |
| qué hace | timbres, MIDI, mezcla, análisis, catálogo | saturación ×4, IR estéreo, reverb FFT, shimmer, granular, compresor multibanda, voces pesadas |
| qué **no** hace | nada de GPU | **no escribe `.mid`** |

### Biblioteca y obra: separadas el 26-oct

`codigo/` mezclaba dos cosas con el mismo estatus en el manifiesto, y el agente
importaba la segunda creyendo que era la primera:

- **la biblioteca** — `dsp.py` (filtros, STFT, reverb, LUFS, crest), `instruments.py`
  (24 timbres), `midi.py` (escritor MIDI), `render.py` (utilidades de mezcla:
  `place`, `reverb_st`, `StemWriter`, `write_wav`), `voces.py`, `gate_voz.py`,
  `sfz2sf2.py`, `catalogo.py`, `importar_sample.py`;
- **una obra** — `cancion.py` (140 compases a 90 BPM, secciones, armonía, letra) y el
  `render.py` de antes, que era el arreglo de **esa** canción.

Lo que estaba mal, en concreto:

1. `cancion.py` se llamaba como si fuera infraestructura: el agente lo importaba y
   heredaba el tempo y la forma de otra canción.
2. **`dsp.py` llevaba el tempo dentro** (`BPM = 90.0`, `SPB`, `BAR`) y el smoke test
   *obligaba* a que siguiera casando con `cancion.BPM`: un candado que impedía
   arreglarlo sin tocar dos ficheros.
3. `render.py` era mitad biblioteca (lo que usan `proyectos/stahl` y
   `proyectos/ghosts-again`) y mitad obra.

Ahora:

```text
workspace/codigo/render.py            150 líneas · biblioteca (place, reverb_st, StemWriter…)
workspace/codigo/dsp.py               302 líneas · sin BPM, sin SPB, sin BAR
workspace/herramientas/smoke.py                  · sin cancion, sin tempo
workspace/obras/quereme-despacio/
    cancion.py                        250 líneas · datos de la obra
    tema.py                           476 líneas · sus gen_* y su master
workspace/_archivo/experimental-26oct/           · 21 scripts del agente, archivados
```

El manifiesto ya no lista `cancion` (7 módulos, 8,9 KB de firmas). `render` sigue
apareciendo: es biblioteca de verdad y la usan dos proyectos.

`obras/` no está en las carpetas compartidas a propósito: se llega a ella con una ruta
explícita (`obras/<slug>/...`) desde el proyecto, no por el atajo de `COMPARTIDO`.

### El reparto, en la práctica

- Audio del tema → GPU (`saturar(veces=4)`, `ir_estereo(dur>=3)`, `reverb`, `shimmer`,
  `congelar`, `granular`, `compresor_multibanda`, 24 bits).
- MIDI y muestras rápidas → numpy local, gratis.
- **Un script numpy en Lambda es CPU a precio de GPU**, y el servidor lo rechaza
  (409) *antes* de encender la máquina: lee el fuente y, si importa
  `dsp`/`instruments`/`render`/`midi`/`cancion`/`tema` sin `motor_gpu`, corta.

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
| el motor mezclaba biblioteca y obra | `cancion.py` y el `render.py` de una obra en el manifiesto; `dsp.BPM = 90` con un smoke que lo blindaba | biblioteca en `codigo/`, obra en `obras/quereme-despacio/`, `dsp` sin tempo |
| `codigo/experimental/` | 21 scripts del agente, dos reimplementando el motor | archivados en `_archivo/experimental-26oct/` |
| prompt en reposo | sin manifiesto (salida temprana en `cargarAgenteDelProyecto`) | 2.890 → 11.939 caracteres con manifiesto y contexto |

**Pendiente, por orden de importancia:**

**Resuelto el 27-oct**: la «partitura como dato» es el propio `proyecto.json` con
sus ops, ahora al alcance del agente (`leer_proyecto`, `editar_proyecto`,
`escribir_progresion`); `theory.ts` está conectado; `parecidosA` se quitó. La lista
completa, en `docs/REVISION-2026-10-27.md`.

1. **Mezcla**: no hay buses, ni automatización, ni medidores en vivo. `set_device`
   existe pero con unidades normalizadas 0..1, no en Hz/dB/ms.
2. **Dos transportes**: los WAV de más de 30 s suenan por `<audio>`, fuera del
   mezclador de openDAW (sin efectos de pista ni master).
3. **Aislamiento**: el agente ejecuta Python con los permisos del usuario.
4. **`openDawToProject`** sólo lo usa la prueba de contrato, no la UI: no hay
   importación de `.odw` desde la app.
5. Tres clases CSS usadas sin estilo (`.cancel`, `.code-example`, `.texto`).

---

## 12. Mapa de ficheros, para orientarse

**Navegador (`web/src/`)**

| fichero | líneas | de qué es dueño |
|---|---|---|
| `main.ts` | 1.839 | estado de la app, historial, autoguardado, arranque, diálogos |
| `agent/tools.ts` | 1.256 | las 20 herramientas: esquemas, despacho y envoltorio |
| `agent/acciones.ts` | 931 | las acciones sobre el proyecto (contrato `Estudio`) |
| `timeline.ts` | 737 | canvas: pistas, clips, onda, arrastre, zoom |
| `opendaw-engine.ts` | 411 | arranque del engine WASM y sincronización de mezcla |
| `llm.ts` | 374 | SSE, timeouts, reintentos por `load` |
| `agent/agent.ts` | 280 | bucle del turno y sus cortes |
| `chat.ts` | 258 | panel del chat (no persiste nada) |
| `audio-store.ts` | 239 | caché de AudioBuffers + hidratación en paralelo |
| `proyecto-archivo.ts` | 199 | serializar/validar el maestro |
| `stem-player.ts` | 180 | stems largos por `<audio>` sincronizados por reloj |
| `agent/contexto.ts` | 196 | recortes, turnos, `agente.json`, recorte de la conversación |
| `i18n.ts` | 120 | textos fijos de la página (es/en) |
| `editor.ts` | 175 | piano roll |
| `code-lab.ts` | 143 | editor Strudel |
| `agente-prompt.ts` | 65 | prompt con huella |

**Dominio (`src/`)**

| fichero | líneas | de qué es dueño |
|---|---|---|
| `core/ops.ts` | 688 | las 17 operaciones, transaccionales, y su chuleta |
| `core/sonidos.ts` | 338 | receta de sonido → script Python |
| `core/palabras.ts` | 272 | 16 palabras de sonido → parámetros |
| `core/taxonomia.ts` | 226 | 55 etiquetas (GM + BST + AudioSet) y alias |
| `core/theory.ts` | 195 | escalas, acordes, tríadas diatónicas |
| `core/composicion.ts` | 166 | progresión → notas, con conducción de voces |
| `core/resumen.ts` | 109 | lo que ve el agente con `leer_proyecto` |
| `core/project.ts` | 231 | crear, validar, estadísticas, carpeta del proyecto |
| `core/types.ts` | 204 | el modelo de datos |
| `core/buscar.ts` | 178 | búsqueda en lenguaje natural |
| `core/nombres.ts` | 50 | slugs y normalización en cualquier alfabeto |
| `core/rutas.ts` | 46 | carpetas compartidas |
| `host/opendaw/adapter.ts` | 479 | IR ↔ proyecto de openDAW |
| `host/opendaw/mapping.ts` | 214 | 10 dispositivos y 4 instrumentos al SDK |

**Servidor (`server/`)**

| fichero | líneas | de qué es dueño |
|---|---|---|
| `api.ts` | 36 | monta las rutas |
| `contexto.ts` | 458 | rutas, Python, cuerpos y logs compartidos |
| `api/ficheros.ts` | 287 | fs/*, manifiesto, build, agent-log |
| `api/proyectos.ts` | 88 | proyecto.json |
| `api/audio.ts` | 215 | subir, servir, picos, MIDI, verificar, referencia |
| `api/catalogo.ts` | 244 | biblioteca CC0 e instrumentos SFZ |
| `api/voces.ts` | 188 | catálogo de voces y su puerta |
| `api/gpu.ts` | 260 | Lambda: estado, encender, apagar, ejecutar |
| `api/python.ts` | 162 | ejecutar un script con tope y cancelación |
| `lambda.ts` | 587 | cliente de Lambda Cloud (API + ssh/scp) |
