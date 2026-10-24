# miuzika

**GUI de DAW con openDAW y Strudel → WAV.**

Alcance actual:

```text
GUI / openDAW          timeline, piano roll, audio y reproducción
Strudel → WAV          código generativo convertido en pista de audio
agente (LLM)           escribe y ejecuta los scripts de workspace/
motor de GPU           DSP nativo en Lambda (torch)
disco                  cada proyecto es su carpeta: proyecto.json + WAV
```

No hay exportadores ni planner separado: el estado del proyecto *es* su
`proyecto.json`.

## Qué incluye

- **Timeline y piano roll**: edición de clips y notas, mute/solo, selección,
  undo/redo.
- **openDAW WASM**: reproducción, batería Playfield y pistas de audio.
- **Strudel → WAV**: editor de patrones y render con `superdough` en un
  `OfflineAudioContext`.
- **Audio WAV**: importación, waveform, clips. Los WAV se copian a la carpeta
  del proyecto y se sirven desde el disco.
- **Abrir**: JSON, bundle `.miuzika.zip` o **proyectos del disco** (`Proyectos`).
- **Fichero maestro** `workspace/proyectos/<slug>/proyecto.json`, escrito solo
  1,5 s después de cada cambio (o con «Guardar» / Ctrl+S).

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
- El render de Strudel va por compases (sin tope de clips: los WAV largos ya no se
  recortan).
- Carga sample packs y soundfonts de Strudel; la primera renderización puede tardar.
- El resultado es audio, no MIDI.

## Persistencia

**El disco es la única fuente de verdad.** No hay IndexedDB ni copia del
proyecto en el navegador: se quitó a propósito, porque existía sólo porque los
WAV no se grababan a disco.

- Cada proyecto es una carpeta: `workspace/proyectos/<slug>/` con
  - `proyecto.json` — el **fichero maestro**: pistas, clips, notas, faders,
    mute/solo, BPM, tonalidad y la ruta de cada WAV;
  - `entrada/` — los WAV que se importan con «Audio»;
  - `salida/` — los que genera el motor o el agente;
  - los `.py` del proyecto.
- En el navegador sólo queda una clave: `miuzika.proyecto-abierto` (el slug del
  último proyecto). Al arrancar se abre ese; si no existe, el `proyecto.json`
  más reciente del disco.
- El historial de undo/redo (8 pasos) vive en memoria: al recargar se pierde.
- **Abrir** acepta `.json` (un fichero maestro o un `Project` suelto) y
  `.miuzika.zip`, cuyos WAV se escriben en la carpeta antes de abrirlo.
- La app no exporta: no hay botón de descarga, el proyecto ya está en disco.

## Scripts

| Comando | Uso |
|---|---|
| `npm run dev` | Vite en `localhost:5173` |
| `npm test` | Tests unitarios + openDAW |
| `npm run test:unit` | Solo tests de `src/` y `web/` |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run build:web` | Build de producción |

## Estructura

```text
src/
  core/             IR, teoría, ops, proyecto
  host/opendaw/     mapping + adapter + checks del SDK
web/
  src/
    main.ts              estado, timeline, audio y persistencia
    timeline.ts          timeline
    editor.ts            piano roll
    opendaw-engine.ts    playback WASM
    code-lab.ts          editor Strudel → WAV
    strudel-audio.ts     render con superdough
    audio-store.ts       WAVs del disco: metadatos, streaming y decodificación
    proyecto-archivo.ts  fichero maestro: serializar, validar y slug del proyecto
    proyecto-disco.ts    /api/proyectos y /api/audio/subir desde el navegador
  public/drums/          kit WAV para Playfield
  public/opendaw-wasm/   engine.wasm y plugins
docs/                   arquitectura, openDAW, plan de pruebas y notas legales
  LEGAL.md              qué es y qué no es obra; licencias de datos y modelos
server/
  lambda.ts             instancias GPU de Lambda: encender, sincronizar, ejecutar, apagar
workspace/
  codigo/               motor numpy (referencia y tests)
  gpu/                  motor DSP de GPU, buscador de mezclas, pruebas de calidad
  plantillas/           ejemplos de composicion (vitrina_base.py)
  proyectos/<slug>/     cada proyecto: scripts y salida/ (fuera de git por tamano)
```

## Motor DSP de GPU y ejecución en Lambda

Además del motor numpy de `workspace/codigo/` —que sigue siendo la referencia y el
que usan los tests— hay un **motor DSP nativo de GPU** en `workspace/gpu/`. No es un
port: cada familia de voces se renderiza entera como tensor `(voces, muestras)` y se
deposita en el bus con `index_add`, sin bucle por nota.

| Medida en una A10 (24 GB, 1,29 USD/h) | numpy | GPU |
|---|---|---|
| Bajo de un tema (212 notas) | 63 s para 735 notas | **0,43 s** |
| Tema completo 3:28, 9 stems, 24 bits | 6-8 min | **6,3 s** |
| Aliasing de la saturación (seno 997 Hz, drive 8) | −44,4 dB (1×) | **−65,3 dB (4×)** |

Piezas del motor: osciladores por tabla con mipmaps band-limited, percusión por
síntesis modal, filtros FIR y variables en el tiempo por STFT batcheada, saturación
a 4× con antialias Blackman de 255 taps, reverb por convolución FFT con IR estéreo
por bandas, shimmer realimentado, congelado espectral, nube granular, compresor
multibanda y limitador con lookahead.

```bash
cd workspace/gpu
python -c "import motor_gpu; motor_gpu.prueba()"   # autotest de cada primitiva
```

Avisos que costaron una tarde (están en el código): el FIR necesita el factor `2·fc`
en `h[n] = 2·fc·sinc(2·fc·n)·ventana` (sin él el filtro degenera en una ventana y se
come todo por encima de unos cientos de Hz); el limitador **no** debe promediar la
envolvente (dejaba pasar picos y el máster salía a +3,6 dBFS); la IR se normaliza por
energía, no por pico; el congelado espectral congela **magnitud**, no complejos; y los
WAV se escriben vectorizados (con un bucle por muestra eran 129 s de los 129 s).

### Ejecutar en Lambda desde la app

`.env` (nunca en el bundle; el navegador no ve la clave):

```text
LAMBDA_API_KEY=...            # clave de Lambda Cloud
LAMBDA_SSH_KEY=C:/Users/<usuario>/.ssh/<clave>
LAMBDA_SSH_KEY_NAME=<nombre de la clave registrada en Lambda>
LAMBDA_SSH_USER=ubuntu
LAMBDA_REGION=us-east-1
LAMBDA_INSTANCE_TYPE=gpu_1x_a10
LAMBDA_NOMBRE=miuzika-gpu
LAMBDA_PRECIO_HORA=1.29
```

- `server/lambda.ts` enciende (o **reutiliza** por nombre) la instancia, sube el motor
  y los scripts del proyecto, ejecuta y trae de vuelta sólo los ficheros nuevos.
- Endpoints: `GET /api/gpu/estado`, `POST /api/gpu/encender`, `POST /api/gpu/apagar`
  y `POST /api/run/lambda` (mismo contrato que `/api/run/python`).
- En el panel hay un selector **CPU / GPU Lambda** (se recuerda en `localStorage`) y la
  herramienta `ejecutar_python` acepta `destino: "cpu" | "lambda"`.
- **La instancia no se apaga sola**: `/api/gpu/apagar` la termina (~90 s en desaparecer).
  Encendida cuesta 1,29 USD/h; el arranque tarda ~5 min.

### Buscador de mezclas

`workspace/gpu/buscar_mezcla.py` sintetiza los stems una vez y prueba **N variantes**
de mezcla/máster (ganancia por stem ±3 dB, estante de graves 120 Hz, estante de agudos
3 kHz, objetivo de crest, compresión sí/no). Puntúa cada una con métricas objetivas
(crest, pico, RMS, energía por bandas, anchura estéreo) y guarda las mejores.

Medido: **80 variantes en 17 s** (215 ms cada una), con puntuaciones de 4,15 a 23,54.
`master()` normaliza **por crest**, no por RMS (normalizar a RMS fijo deja el tema en
7 dB de crest, que suena a ladrillo).

### Proyecto Vitrina (base industrial, 90 BPM, re menor)

`workspace/proyectos/vitrina/base.py` (copia versionada en
`workspace/plantillas/vitrina_base.py`) — 76 compases, 3:28, 9 stems. Estructura:
intro (colchón y metales) → A (bombo mínimo y pedal en re con escape a mi♭) → B (caja,
pad y susurros) → **descanso psicodélico** (congelado espectral, nube granular, sin
batería) → C (todo, shimmer y metales) → outro.

- Máster: pico −1,0 dBFS, RMS −14,0, crest 13,0 (el brief pedía 12-14).
- Mezcla elegida de oído entre las 80 variantes: la **3** (crest 12,2), documentada en
  `workspace/proyectos/vitrina/MEZCLA_ELEGIDA.md` y aplicada a los faders del DAW con
  la herramienta `ajustar_pistas`.
- `vitrina_master_crest13.wav` conserva la variante anterior; nada se borró.

### Herramienta `ajustar_pistas`

El agente puede mover faders por nombre de pista (`gainDb`, `pan`, `muted`, `solo`),
aplicando ops `set_track` en un solo lote: entra en el historial y se deshace con
Ctrl+Z, y el audio se reajusta en vivo (no reinicia el engine). Verificado: 9 pistas
ajustadas y deshechas en la prueba.

### Que el agente NO reescriba el motor de GPU

El mecanismo que ya protegía el motor numpy vale también para el de GPU, y sin él
el agente reescribía `gpu/motor_gpu.py` en cada turno (no sabía que existía):

- `herramientas/manifiesto.py` escanea **`codigo/` y `gpu/`**: `MANIFEST.json` pasa
  a 108 símbolos y el agente ve `motor_gpu` con sus 36 funciones (`osc`, `saturar`,
  `reverb`, `shimmer`, `congelar`, `granular`, `master`…).
- La **puerta 409** de `/api/fs/write` cubre `gpu/`: un fichero nuevo que redefina
  un símbolo del motor se rechaza con el aviso de importarlo.
- El **prompt del sistema** describe los dos motores y cuándo usar cada uno: numpy
  en CPU para samples y MIDI; `motor_gpu.py` con `destino="lambda"` para trabajo
  pesado o calidad.
- En `gpu/` no hay smoke posible (este portátil no tiene torch): al escribir se
  comprueba que el fichero parsea y se avisa de que la validación real se hace en
  la instancia.

### Interfaz: colores por pista, contador de gasto y barra de actividad

- **Un color por pista**, no por tipo de instrumento. Antes todos los WAV (sampler)
  salían del mismo verde y todos los synth del mismo tono. Reparto por ángulo áureo
  (137,5°) con luminosidad alterna y las pistas de audio algo más apagadas.
- **Contador de gasto de la GPU** junto al selector CPU/GPU. La regla es: **la
  tarifa es la real de la instancia que hay delante**, no la del `.env`.
  - Sale de `/api/gpu/estado`, que ahora devuelve `fase` (`apagada`, `arrancando`,
    `activa`, `apagandose`), `precio_hora` **por tipo** y el gasto por instancia.
  - La tabla de precios se pide a Lambda (`/instance-types`, cacheada 10 min) y se
    usa sólo el `.env` como último respaldo. De ahí que un A10 salga a 1,29 $/h y
    un A100 SXM4 a 1,99 $/h sin tocar nada.
  - Textos (`web/src/gpu-texto.ts`, con tests): `A10 · 1,29 $/h · 00:03:12 ·
    0,04 $ (sesión 0,09 $)` · `A10 arrancando · 2 min 34 s · aún sin facturar` ·
    `A10 apagándose…` · `GPU apagada · sesión 0,07 $`. **Apagada no enseña
    tarifa**: eso era lo que confundía (parecía que seguía cobrando).
  - Sólo cuentan las instancias `active`; una zombi en `terminating` desde mayo
    (caso de soporte) se ignora para el contador **y** para la fase.
- **Barra de actividad sin tarjetas**: las burbujas `⚙ herramienta(...)` ya no
  ensucian el historial. La barra de abajo muestra la frase de lo que se está
  haciendo, **lo que lleva la herramienta en curso** y el reloj del turno
  (`verificar_audio(…) · 5 s · turno 5 s`). Al terminar cada llamada deja su
  tiempo con un `✓` delante (`✓ verificar_audio 5,2 s`): ese ✓ es lo único que
  distingue una herramienta ya hecha de una que sigue corriendo mientras el
  modelo redacta. Al cerrar el turno resume `✓ listo · N paso(s) · N herramienta(s) ·
  X s · modelo`, y si falla muestra `✗ error: …` en vez de quedarse con los puntos
  suspensivos.
- **¿Está pensando o colgado?** La barra añade la fase cuando el silencio es
  legítimo y avisa cuando no lo es:
  - `GPU arrancando 2 min 34 s · aún no factura` (mientras Lambda enciende),
  - `GPU ejecutando · sin salida todavía` (llamada `@lambda` en curso),
  - `⚠ sin señales hace 132 s` (ningún evento del modelo ni de la herramienta).
  La fuente de verdad es `ultimoEventoMs`, que se toca con cada evento del bucle.
  La cuenta de "sin señales" es `sinSenales()` en `gpu-texto.ts`, con tests.
- **Botón «Cancelar»** en la barra de estado mientras hay turno: `AbortController`
  que corta la llamada al modelo y la herramienta en vuelo (`fetch` con `signal`
  hasta `/api/run/*` y `/api/verificar`). No apaga la GPU: el botón lo dice y el
  contador queda a mano.
- **Una línea de resumen al final del historial** (rol `meta`, gris y
  monoespaciada, sin burbuja) con el desglose por herramienta:
  `✓ 2 paso(s) · 1 herramienta(s) · 6,9 s — verificar_audio 5,2 s · modelo`.
  Se agrupa por nombre y se ordena por tiempo (primero lo que se comió el turno);
  a partir de 4 herramientas resume `+N más`, y marca `⚠N fallo(s)` si alguna
  falló. La contabilidad vive en `web/src/agent/actividad.ts` —sin DOM, con
  tests— y el bucle sólo la alimenta midiendo cada llamada.

### Ruta remota en Lambda: `$HOME` no se expande

`ejecutar_python(destino="lambda")` con un script de `codigo/` fallaba con
`can't open file '/home/ubuntu/miuzika/proyectos/<slug>/$HOME/miuzika/codigo/...'`.
El comando remoto hacía `cd ~/miuzika/proyectos/<slug> && python3 -u '$HOME/miuzika/codigo/x.py'`:
la ruta va entrecomillada, la shell no expande `$HOME` y python la resolvía
**relativa al cwd**. Ahora lo compartido se pasa como `../../codigo/x.py`, que no
depende de ninguna expansión. El agente llegó a inventarse un lanzador en
`proyectos/final/$HOME/...` para rodearlo; se borró.


### Cómo retomar en otra sesión

```bash
cd C:/Users/carlos/proyectos/miuzika
npm run dev                      # http://localhost:5173
npm run typecheck && npm run test:unit
```

En este portátil `npm run dev` escucha **sólo en `[::1]`**: `curl 127.0.0.1:5173`
no conecta y `curl localhost:5173` sí. No cambies el binding a `127.0.0.1`: el
`localStorage` que apunta el proyecto abierto está atado al origen, así que abrir
`127.0.0.1` te deja con la app «vacía» (sin proyecto apuntado; el disco sigue ahí,
y el arranque abre el más reciente, pero el botón `Proyectos` te lo confirma).

Estado al cerrar (2026-10-23, tercera sesión del día): typecheck 0, **67/67 unit +
OPENDAW OK**. El fichero maestro, la apertura desde disco, la elección
añadir/nuevo y la retirada de IndexedDB están hechos y probados en el navegador:
proyecto abierto tras `localStorage.clear()`, WAV traído del disco
(`/api/picos` 200 y `/api/audio` 200), reproducción con openDAW y autoguardado
(`✓ guardado proyectos/demo-disco/proyecto.json · 2 pistas`).

Esa misma tarde el agente pidió un proyecto (`final`, 140 compases, 6:13) y se
quedó 6 minutos reintentando un render que **no podía arrancar** por el `$HOME`
de la ruta remota (ver arriba). Se terminó la A10 a mano (`0,07 $` facturados) y
se arregló la ruta. Los `.mid` de `final/salida/` están en disco; el audio de
`final` **no** se llegó a renderizar. De ahí salen el contador con tarifa real y
el «sin señales / Cancelar».

Los proyectos de prueba de esta sesión (`demo-disco`, `tono`, `prueba-audio`,
`prueba-dos`, `migracion-prueba`) se borraron al terminar. **Vitrina** sigue en
`workspace/proyectos/vitrina/` con su `salida/` intacta.

Al recargar la app, si el navegador todavía tiene el proyecto viejo en
`localStorage` (`miuzika.project`), se **migra solo**: se escribe
`proyectos/<slug>/proyecto.json` y se adoptan los WAV de `salida/`/`entrada/`
cuyo nombre coincida con el del asset — primero exacto y después por sufijo,
porque el asset puede llamarse `seno` y el fichero `vitrina_seno.wav`
(probado con los dos casos). Los WAV que sólo existían en IndexedDB no se pueden
recuperar; se avisa en el chat.

**Aviso que cuesta un susto**: si el servidor de Vite se cae con la app abierta en el
navegador, todo parece funcionar hasta que le das a **play**: arrancar el engine hace
un `import()` dinámico de `web/src/opendaw-engine.ts` y el navegador responde
`Failed to fetch dynamically imported module: http://localhost:5173/src/opendaw-engine.ts`.
No es openDAW ni el WASM: es que no hay servidor. Se arregla levantando `npm run dev`
y recargando la página. Y un servidor de dev lanzado **desde un turno del agente muere
si ese turno se interrumpe**, así que conviene levantar el servidor en una terminal
propia (o con `persist_on_release`) antes de ponerse a escuchar.

### Fichero maestro por proyecto (hecho)

El estado del proyecto ya no vive en el navegador: **cada carpeta de proyecto
tiene su `proyecto.json`** y los WAV se quedan en su sitio.

```text
workspace/proyectos/demo-disco/
  proyecto.json      fichero maestro: pistas, clips, notas, faders, mute/solo,
                     BPM, tonalidad y la ruta de cada WAV
  entrada/           WAV traídos con «Audio» (y los de un .miuzika.zip)
  salida/            WAV y MIDI que generan el motor o el agente
  *.py               los scripts del proyecto
```

- **Referencia, no incrusta**: cada asset guarda `ruta` relativa a la carpeta
  (`entrada/kick.wav`, `salida/vitrina_bajo.wav`). Los stems son de 95 MB: en
  base64 un máster de 6 stems serían ~760 MB de JSON.
- **Autoguardado con retardo** (1,5 s tras el último cambio) más `Guardar` y
  `Ctrl+S`. Escribir en cada arrastre de fader sería un POST por movimiento. Un
  cambio durante una escritura en vuelo se reencola en vez de perderse.
- **Al abrir** un proyecto (botón `Proyectos`, que lista los `proyecto.json` del
  disco) se cargan los WAV de la carpeta por `/api/audio`; los cortos se
  decodifican para openDAW y los largos van por streaming. Abrir **no**
  reescribe el fichero maestro (`restoring` lo impide): se respeta lo que hay.
- **Al elegir WAV** con un proyecto abierto se pregunta (`<dialog>`): «Añadir a
  …» los mete en el proyecto y en el compás del cursor; «Proyecto nuevo …»
  empieza de cero con el nombre de la carpeta elegida. Si no hay proyecto, va
  directo a «nuevo».
- **Los WAV importados se copian al disco** (`POST /api/audio/subir`, hasta
  512 MB) a `entrada/`, con nombre saneado y sufijo `_2`, `_3`… si ya existe. Sin
  esa copia el proyecto no podría referenciarlos y morirían con el navegador.
- **«Abrir»** acepta `.json` (fichero maestro o `Project` suelto) y
  `.miuzika.zip`: los WAV del bundle se escriben en la carpeta y el proyecto se
  queda con sus rutas.
- El render de **Strudel** también va al disco (`salida/<slug>_strudel_*.wav`)
  antes de entrar como pista.

Decisiones tomadas (con el usuario delante):

- Ruta relativa, nunca base64.
- Autoguardado con retardo + botón explícito.
- `proyectos/<slug>/proyecto.json`, listado por un endpoint nuevo `/api/proyectos`
  (`GET` lista, `GET ?path=` devuelve el fichero completo — `/api/fs/read` corta
  a 20 000 caracteres y un proyecto con miles de notas no cabe —, `POST` escribe).
- Preguntar cada vez al elegir WAV, en vez de recordar la última elección.

**IndexedDB se quitó del todo** (`audio-db.ts` y `project-db.ts` ya no existen):
existía sólo porque los WAV no se grababan a disco. Ahora el proyecto son el
`proyecto.json` y sus WAV; lo único que queda en el navegador es
`miuzika.proyecto-abierto`, el slug del último proyecto para reabrirlo.

Lo que se perdió al quitarla, dicho claro: **la subida a disco es obligatoria**.
Un WAV de más de 512 MB o en un formato que `herramientas/picos.py` no sepa leer
no entra, y el proyecto no lo referenciará (se avisa en el chat). El historial
de undo tampoco sobrevive a una recarga: son 8 pasos en memoria.

### Duración de los clips: en compases

Un clip dura un número de compases, y **ese número es el mismo para el MIDI y para
el WAV del mismo material**. Por eso `anadir_pistas` acepta `compases=N` (la
duración de la toma): todos los clips de esa llamada miden `N` compases y acaban
en el mismo sitio, sin importar que el `.mid` termine en su última nota o que el
`.wav` lleve cola de reverb.

- Sin `compases`: el audio se redondea al compás (`336,667 → 340`) y los MIDI se
  estiran hasta esa misma longitud. Un one-shot de menos de dos compases conserva
  su duración exacta.
- Si `compases` pide más de lo que dura el fichero, el clip se queda en lo que hay
  y el resultado lo dice: «pediste 90 compases pero el WAV dura 84,17».
- Op nueva `set_clip_length` en `src/core/ops.ts` para igualar un clip existente
  (es lo que usa el importador); `src/core/tiempo.ts` decide las longitudes y
  tiene 5 tests.

### Contexto y retención del agente

Tres cosas distintas, cada una en su sitio:

| | Dónde | Cuánto |
|---|---|---|
| **Contexto del modelo** | RAM: prompt de sistema + últimos 25 mensajes | se pierde al recargar, y por eso… |
| **Historial del proyecto** | `proyectos/<slug>/agente.json`: últimos 8 turnos + resumen rodante de los anteriores | se rehidrata en el prompt al abrir el proyecto |
| **Transcripción visible** | `localStorage miuzika.chat.log` | últimos 300 mensajes |
| **Depuración** | `tmp/llm.log`, `tmp/herramientas.log` | 5 y 2 MB con una copia `.1` (`renameSync`) |

- **`agente.json`** guarda turnos *conversacionales* (petición + respuesta final),
  sin el fontanería de `tool_calls`: así se puede volver a meter en el prompt sin
  ids huérfanos. Al pasar de 8 turnos, los viejos se funden en una línea cada uno
  (`agregarTurno` en `web/src/agent/contexto.ts`, con tests). Al abrir otro
  proyecto se cambia de conversación; la visible no se borra.
- **Las salidas largas no viajan.** Si una herramienta devuelve más de 1200
  caracteres, al modelo le llega la cabeza + la cola y el texto completo se
  guarda en `proyectos/<slug>/_salidas/<herramienta>_<id>.txt`, que puede releer
  con `leer_fichero`. Medido: `leer_fichero('codigo/dsp.py')` pasa de 10.133 a
  1.352 caracteres de contexto.
- **El log de turnos va compactado** salvo `MIUZIKA_LOG_COMPLETO=1`: de cada
  mensaje guarda rol, tamaño y primeras 200 letras (y 400 del prompt de sistema),
  más la petición y la respuesta. Antes eran ~40 KB por turno con el manifiesto
  dentro; ahora ~1,3 KB, y rota al pasar de 5 MB.
- Lo que **no** hay: memoria semántica ni RAG. La memoria durable es el propio
  `proyecto.json` (estado medible) y, si se quiere prosa, un `NOTAS.md` por
  proyecto. Para 3-5 proyectos, un RAG sería opaco y podría inyectar recuerdos
  falsos.

### Pendiente

- **Importar `.mid` por el selector de ficheros** (el `accept` no lo incluye).
  El agente sí crea pistas MIDI con `anadir_pistas(midis=[...])`.
- **DDSP** (Apache-2.0) entrenado con nuestros propios stems: timbre real de
  instrumento en lugar de síntesis. Es el siguiente salto de calidad de verdad; el
  resto (sobremuestreo, reverb, búsqueda de mezcla) ya está medido y en su sitio.
- **Intentar de verdad que el agente reutilice el motor de GPU** en un script
  nuevo: encender, pedir un sample al agente y mirar el log del turno.
- **A/B ciego** GPU 1× vs 4× para confirmar de oído lo que dice el número.
- Reverb con IR de 5 s sobre el pad, y escuchar si gana densidad.
- El motor GPU no tiene todavía `midi` propio: los .mid salen del motor numpy.
- El agente no sabe puntuar con CLAP desde dentro de la app (el piloto vive en
  `tools/piloto-gpu/`).
- **Progreso en vivo de las herramientas largas**: hoy la barra dice «GPU
  ejecutando» pero no lo que imprime el script (`marca("charles")`…). El
  `herramientas.log` ya recibe cada aviso de Lambda; faltaría un `/api/progreso`
  (o SSE en `/api/run/*`) para enseñar la última línea dentro de la app en vez de
  en la terminal.
- Valorar meter `proyecto.json` en git: hoy `workspace/proyectos/` está ignorado
  entero (los WAV pesan demasiado). Si se quiere versionar el estado, hay que
  cambiar el `.gitignore` para ignorar sólo `entrada/`, `salida/` y `__pycache__/`.

## Limitaciones

- Hace falta el servidor de dev: `/api/*` (audio, picos, proyectos, agente) son
  middlewares de Vite. Sin él la app no abre ni reproduce nada.
- Strudel → WAV: máximo 64 compases por render.
- Strudel depende de sample maps remotos y de sus licencias.
- Los WAV de más de 30 s se reproducen por streaming (`<audio>`), no decodificados:
  10 stems de 6 minutos ocupan ~20 MB en lugar de ~1,3 GB.
- openDAW sigue decodificando los WAV cortos y los samples de batería.
- El motor de patrones clásico asume 4/4.

### Pendiente

- **Fichero maestro por proyecto y abrir proyecto desde disco** (sección de arriba):
  es la tarea con la que empieza la próxima sesión.
- **DDSP** (Apache-2.0) entrenado con nuestros propios stems: timbre real de
  instrumento en lugar de síntesis. Es el siguiente salto de calidad de verdad; el
  resto (sobremuestreo, reverb, búsqueda de mezcla) ya está medido y en su sitio.
- **Intentar de verdad que el agente reutilice el motor de GPU** en un script
  nuevo: encender, pedir un sample al agente y mirar el log del turno.
- **A/B ciego** GPU 1× vs 4× para confirmar de oído lo que dice el número.
- Reverb con IR de 5 s sobre el pad, y escuchar si gana densidad.
- El motor GPU no tiene todavía `midi` propio: los .mid salen del motor numpy.
- El agente no sabe puntuar con CLAP desde dentro de la app (el piloto vive en
  `tools/piloto-gpu/`).

## Limitaciones

- Strudel → WAV: máximo 64 compases por render.
- Strudel depende de sample maps remotos y de sus licencias.
- Los WAV de más de 30 s se reproducen por streaming (`<audio>`), no decodificados:
  10 stems de 6 minutos ocupan ~20 MB en lugar de ~1,3 GB.
- openDAW sigue decodificando los WAV cortos y los samples de batería.
- El motor de patrones clásico asume 4/4.

## Licencia

miuzika se distribuye bajo **AGPL-3.0-or-later**. openDAW tiene licencia dual
(AGPL/comercial); Strudel, superdough y los sample packs son de terceros.
Consulta [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

En un despliegue público (incluido SaaS) la AGPL exige publicar el código
correspondiente. Si se usa la licencia comercial de openDAW, revisa `NOTICE.md`.
