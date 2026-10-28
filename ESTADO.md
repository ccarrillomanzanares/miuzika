# ESTADO · 28-oct-2026

Documento de relevo: qué hay, qué funciona, qué falta y por dónde seguir. Las
reglas de trabajo están en `CLAUDE.md`; la arquitectura, en `docs/ARCHITECTURE.md`;
la revisión del 27-oct con sus fallos, en `docs/REVISION-2026-10-27.md`.

Repositorio: `github.com/ccarrillomanzanares/miuzika`, rama `master` (la historia
anterior, humseed, está en la rama `humseed`). En el portátil, la carpeta sigue a
`origin/master`; `master-antiguo` y `revision-arquitectura` son ramas viejas.

## 1. Qué se hizo el 27 y 28 de octubre

**El agente**
- Compone en el proyecto, no en scripts: `escribir_notas` (notación compacta:
  `"D2:1.5 D2:.5 F2 | r:2 [D3 F3 A3]:4"`, con repeticiones `( … )x4`),
  `escribir_bateria` (rejilla `x...x...`), `escribir_progresion`, `editar_proyecto`
  (ops transaccionales, se deshacen con Ctrl+Z). Reescribir un tramo conserva lo de
  fuera; los compases que no cuadran se rechazan.
- Instrumentos: General MIDI (GeneralUser GS en `workspace/catalogo/gm/`) y la
  biblioteca VCSL (142 instrumentos grabados: Steinway, órganos, arpas…) con
  `usar_instrumento("Grand Piano, Steinway B", pista=…)`.
- Busca en internet (`buscar_web`, `leer_web`, servicios de Ollama).
- `versiones`: foto del proyecto al empezar cada turno (`proyectos/<c>/versiones/`,
  últimas 40); restaura una pista o todo.
- `exportar(midi, wav)`: MIDI tipo 1 desde el proyecto; WAV de la mezcla con el
  `OfflineEngineRenderer` de openDAW (mismo sonido que el Play).
- Prompt v4 (huella `0eaa1767`): termina la canción entera en el turno y no pregunta
  por MIDI/WAV salvo que se pida. Tope: 80 pasos por turno; freno de bucles por
  ciclos fallidos (4), no por escrituras.

**La app**
- Interfaz en inglés (base) con español opcional (`?lang=es`); `i18n.ts`.
- «Brief» (antes «Plantilla»): formulario que escribe el encargo en el chat. Modos
  nueva / versión (a dónde se lleva, qué se conserva, tempo y tonalidad relativos) /
  arreglo; entrega MIDI y/o WAV.
- «Models»: proveedor, clave y modelo del agente (Ollama Cloud por defecto,
  Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, Mistral, Groq, Ollama local, LM
  Studio, cualquiera compatible con OpenAI). Claves en `.miuzika/proveedores.json`.
  La búsqueda web usa siempre la clave de Ollama Cloud.
- «Pad»: el touchpad del portátil como instrumento (Raw Input de Windows,
  `workspace/herramientas/touchpad/`): teclas en la escala del proyecto, pads de
  batería, deslizar; graba en un clip con cuenta atrás y metrónomo.
- El Play espera a que el motor cargue samples y SoundFonts (antes lo primero sonaba
  en silencio).

**El motor Python** (`workspace/codigo`)
- `pan`, `reverb`, `delay` y `place` aceptan mono y estéreo; `render.stem(ruta, fn,
  datos…)` sólo recalcula lo que cambia; `write_wav` baja a −1 dBFS lo que recortaba.
- `sfz2sf2.py` escribe SF2 válidos (antes TODOS los instrumentos VCSL sonaban en
  silencio: EOP/EOI y rangos mal escritos) y caben en el navegador (≤ 40 MB).

**Hecho el 28-oct por la tarde** (un commit por punto, con su porqué):
- La conversación del agente sin proyecto se guarda en `proyectos/sin-proyecto/agente.json`.
- «Hard»: el Steinway ya estaba; quitados los 2 compases de silencio (todo empieza en
  el compás 1, 46 compases). Copia de antes en `hard/versiones/…_antes-de-quitar-…`.
- `escuchar_mezcla`: renderiza con openDAW la mezcla y cada pista sola y da el RMS por
  tramos cruzado con las notas (MUDO = notas sin señal). `src/core/escucha.ts`.
- Efectos en unidades reales (`cutoffHz`, `timeMs`, `thresholdDb`…; EQ con frecuencias).
  Los proyectos viejos se migran al abrirse y suenan igual (las pruebas lo fijan).
- Buses y envíos: `add_bus`, `set_bus`, `remove_bus`, `set_send`; los efectos de un bus
  con `add_device` sobre su nombre. En openDAW: AudioBusBox + unidad «aux» + AuxSendBox.
  La interfaz aún no dibuja los buses (sólo los ve el agente en `leer_proyecto`).
- WAV largos: entran en openDAW mientras quepan en 400 MB decodificados
  (`PRESUPUESTO_DECODIFICADO_MB`); sólo el resto va por `<audio>`.
- El Python del agente corre en `server/python/caja.py`: escribe sólo en su proyecto,
  no lee claves, sin procesos, red ni ctypes; entorno mínimo. Guardarraíl, no jaula.
- Contador de la GPU en inglés (español con `?lang=es`).

## 2. Pendiente de comprobar en el navegador (Carlos)

Nada de esto se ha podido oír desde las sesiones anteriores:
1. **El Steinway y la biblioteca VCSL suenan** (regenerados en «Hard» y «Stairway»).
2. **Lo del compás 1 suena** con la espera de carga del Play.
3. **`exportar` WAV** (OfflineEngineRenderer) y MIDI.
4. **«Models» → Probar** con Ollama Cloud de verdad (el proxy sólo se probó contra un
   servidor simulado).
5. **El pad** en el portátil: que arranque la captura, suene y grabe.
6. **`escuchar_mezcla`** sobre «Hard»: que la tabla salga y cuadre con lo que se oye.
7. **Un bus** con reverb y envíos: que la cola se oiga (el `.odw` carga, pero no se ha oído).
8. **Un proyecto con stems largos** (p. ej. «hurt-instrumental»): que abra y la memoria
   aguante con el presupuesto de 400 MB.
9. **Hablar con el agente sin proyecto**, F5, y que la conversación siga ahí.

## 3. Pendiente de hacer

1. Dibujar los buses y los envíos en la interfaz (mezclador).
2. Si la caja de Python se queda corta: otro usuario de Windows o un contenedor. Los
   scripts de la GPU (Lambda) no pasan por la caja.

## 4. Cómo empezar

1. `npm run typecheck` y `npm run test:unit` (186 pruebas en verde el 28-oct por la tarde; `npm test` añade el contrato con openDAW).
2. `python workspace/herramientas/smoke.py`.
3. `npm run dev` y repasar la lista de la sección 2 con Carlos.
