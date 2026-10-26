# ESTADO · 26-oct-2026

Documento de relevo. Lo que hay, lo que funciona, lo que está roto y por dónde seguir.
La arquitectura completa está en `docs/ARCHITECTURE.md`; esto es el parte de hoy.

## 1. Sesión del 26-oct: revisión de código y limpieza

Se revisó el árbol entero (12.638 líneas TS + ~4.100 Python) y se arregló lo que
estaba mal, con medida antes/después:

| qué | antes | después |
|---|---|---|
| `listar_ficheros` metía el workspace entero en el contexto del modelo | 586.682 B, recortados a cabeza y cola (el agente no veía sus ficheros) | 11.097 B la raíz · 5.022 B el proyecto · `catalogo/` excluido |
| `ejecutar_python` devolvía el árbol en cada llamada | recorrido de 4.231 ficheros por ejecución | sólo `escritos` (lo que cambió en el proyecto) |
| abrir un proyecto de 21 pistas / 11 WAV | 38 s | 16,8 s en frío · **0,5 s** con la caché de picos |
| el texto del reintento sin razonamiento | se descartaba (una respuesta buena se tiraba como turno vacío) | se recalcula tras el reintento |
| `resolveClip` en pista de un solo clip | borraba el clip aunque el nombre no coincidiera | error con la lista de clips |
| `fallosIguales` vivía en el módulo | un fallo de ayer cortaba el turno de hoy | por turno |
| dos listas de carpetas compartidas | al navegador le faltaba `catalogo/` | una sola, en `src/core/rutas.ts` |
| alias `oboe` con «е» cirílica | no se reconocía | arreglado |
| `boot()` con ~50 líneas muertas | prometía abrir el último proyecto | arranque limpio real |
| `leerCuerpo` sin tope | un POST de 9 MB se comía la memoria | 413 por encima de 8 MB |
| `chat.ts` guardaba y borraba claves muertas; `clear()` dejaba la burbuja de progreso | — | limpio |
| `README.md` con dos «Limitaciones» y un «Pendiente» de hace tres sesiones; `docs/ARCHITECTURE.md` decía «no hay agente» | — | ambos corregidos |

Puertas: `tsc` 0 · **121** tests (5 nuevos) · OPENDAW OK · `build:web` OK.

## 2. Lo que funciona hoy

- **Disco como verdad**: `proyectos/<slug>/proyecto.json` + WAV por ruta. Sin IndexedDB.
- **Arranque limpio**: no abre ningún proyecto; se elige con «Proyectos».
- **Chat sin memoria de pestaña**: al abrir un proyecto se pinta lo guardado en
  `agente.json` (resumen + últimos turnos).
- **Prompt con huella**: `web/src/agente-prompt.ts` + `HUELLA_PROMPT` + prueba que
  falla si cambia. **No se toca sin permiso.**
- **Instrumentos reales**: `usar_instrumento(sfz, nombre)` → `.sf2` en el proyecto.
- **Referencia medida**: `medir_referencia(url|ruta)`.
- **Catálogo**: 4.231 muestras CC0 indexadas; 24 voces del motor leídas con `ast`.
- **Transporte del LLM**: SSE, timeout 180 s, calentamiento en `load`, 32.768 tokens
  de salida, segunda pasada con `reasoning_effort: "none"` si el turno se va razonando.
- **Progreso visible**: burbuja en el chat con tokens y segundos.

## 3. Lo que sigue roto o a medias

1. **El agente no entrega piezas de forma fiable**: se le pide la canción entera en un
   turno (15-20 pasos sin checkpoints) y un fallo tira todo el trabajo.
2. **`codigo/` mezcla biblioteca y obra**: `cancion.py` (140 compases a 90 BPM de una
   canción concreta) y `render.py` aparecen en el manifiesto como API. El agente los
   importa y hereda el tempo de otra obra. **Es la deuda más gorda.**
3. **Mezcla**: sin empezar. Sin buses, sin automatización, sin medidores en vivo, y
   `set_device` en unidades 0..1 en vez de Hz/dB/ms.
4. **`theory.ts` y `parecidosA`** existen, tienen tests y nadie los llama.
5. **`codigo/experimental/`**: 20 ficheros del agente, con dos `render_final*.py` que
   reimplementan el motor.

## 4. Cómo empezar la próxima sesión

1. `npx tsc --noEmit` y `npm run test:unit` → 121 tests en verde, 0 errores.
2. `npm run dev` y la app en `localhost:5173` (sólo `[::1]`).
3. Logs de diagnóstico: `tmp/llm.log` (una línea por petición) y
   `tmp/herramientas.log`. **Mira la hora del último antes de editar código**: si
   hay turno en vuelo, un guardado en `vite.config.ts` se lo lleva por delante.
4. La decisión que bloquea el resto: **partitura como dato, sí o no**.
