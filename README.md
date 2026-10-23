# miuzika

**GUI de DAW con openDAW y Strudel → WAV.**

Alcance actual, deliberadamente pequeño:

```text
GUI / openDAW          timeline, piano roll, audio y reproducción
Strudel → WAV          código generativo convertido en pista de audio
```

No hay LLM, planner, agente, worker Python ni exportadores.

## Qué incluye

- **Timeline y piano roll**: edición de clips y notas, mute/solo, selección,
  undo/redo.
- **openDAW WASM**: reproducción, batería Playfield y pistas de audio.
- **Strudel → WAV**: editor de patrones y render con `superdough` en un
  `OfflineAudioContext`.
- **Audio WAV**: importación, waveform, clips y persistencia en IndexedDB.
- **Abrir**: JSON o bundle `.miuzika.zip` existente.
- **Persistencia automática** en localStorage + IndexedDB.

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

- El proyecto y el historial viven en `localStorage` e IndexedDB.
- Los WAVs viven en IndexedDB (`miuzika` / `audio-assets`).
- **Abrir** acepta un `.json` o un `.miuzika.zip` existente.
- No hay botón de exportación; la app no descarga el proyecto.

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
    audio-store.ts       assets y rehidratación
    audio-db.ts          IndexedDB de WAVs
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
- **Contador de gasto de la GPU** junto al selector CPU/GPU: `1,29 $/h · 00:01:02 ·
  0,02 $ (sesión 0,01 $)`. Sale de `/api/gpu/estado`, cuya forma es genérica
  (`precio_hora`, `moneda`, `proveedor`, `activo`, `desde`, `gastado`): otro
  proveedor sólo tiene que rellenarla. Sólo cuentan las instancias `active` — una
  colgada en `terminating` durante días metía 7.877 $ en el contador.
- **Barra de actividad sin tarjetas**: las burbujas `⚙ herramienta(...)` ya no
  ensucian el historial. La barra de abajo muestra la frase de lo que se está
  haciendo, **lo que lleva la herramienta en curso** y el reloj del turno
  (`verificar_audio(…) · 5 s · turno 5 s`). Al terminar cada llamada deja su
  tiempo con un `✓` delante (`✓ verificar_audio 5,2 s`): ese ✓ es lo único que
  distingue una herramienta ya hecha de una que sigue corriendo mientras el
  modelo redacta. Al cerrar el turno resume `✓ listo · N paso(s) · N herramienta(s) ·
  X s · modelo`, y si falla muestra `✗ error: …` en vez de quedarse con los puntos
  suspensivos.
- **Una línea de resumen al final del historial** (rol `meta`, gris y
  monoespaciada, sin burbuja) con el desglose por herramienta:
  `✓ 2 paso(s) · 1 herramienta(s) · 6,9 s — verificar_audio 5,2 s · modelo`.
  Se agrupa por nombre y se ordena por tiempo (primero lo que se comió el turno);
  a partir de 4 herramientas resume `+N más`, y marca `⚠N fallo(s)` si alguna
  falló. La contabilidad vive en `web/src/agent/actividad.ts` —sin DOM, con
  tests— y el bucle sólo la alimenta midiendo cada llamada.

### Cómo retomar en otra sesión

```bash
cd C:/Users/carlos/proyectos/miuzika
npm run dev                      # http://localhost:5173
npm run typecheck && npm run test:unit
```

En este portátil `npm run dev` escucha **sólo en `[::1]`**: `curl 127.0.0.1:5173`
no conecta y `curl localhost:5173` sí. No cambies el binding a `127.0.0.1`: el
proyecto y los WAV viven en IndexedDB/localStorage, que están atados al origen,
y abrir `127.0.0.1` te deja con la app vacía.

Estado al cerrar (2026-10-23, última sesión): typecheck 0, 45/45 tests, **ninguna
instancia encendida** (sólo queda una A100 vieja en `terminating`, caso de soporte, que
no factura). El proyecto **Vitrina** está cargado en el navegador del usuario con la
mezcla elegida en los faders.

Commits de la tanda: `b5463e5` (motor GPU, buscador, faders por chat), `71aec76`
(motor GPU en manifiesto y puerta 409, colores por pista), `376c42c` (contador de
gasto y barra de actividad), `8fdd952` (manifiesto regenerado), `8c73531` (README).

`workspace/gpu/prueba_nueva.py` (el fichero de 2 líneas de la prueba de la puerta
409) se **borró con permiso del usuario**; era untracked, así que no hizo falta
commitear nada por él.

### Pendiente

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
