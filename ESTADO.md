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

## 2. Pendiente de comprobar en el navegador (Carlos)

Nada de esto se ha podido oír desde la sesión anterior:
1. **El Steinway y la biblioteca VCSL suenan** (regenerados en «Hard» y «Stairway»).
2. **Lo del compás 1 suena** con la espera de carga del Play.
3. **`exportar` WAV** (OfflineEngineRenderer) y MIDI.
4. **«Models» → Probar** con Ollama Cloud de verdad (el proxy sólo se probó contra un
   servidor simulado).
5. **El pad** en el portátil: que arranque la captura, suene y grabe.

## 3. Pendiente de hacer

1. La conversación del agente **se pierde si no hay proyecto abierto** (sólo se
   guarda en `proyectos/<c>/agente.json`). Guardarla en `sin-proyecto` o similar.
2. En «Hard»: volver a poner el Steinway en el piano y quitar los 2 compases de
   silencio que añadió el agente como parche.
3. **Unidades reales en los efectos** (Hz, dB, ms) y buses/envíos.
4. **WAV largos** (> 30 s) fuera del mezclador de openDAW (van por `<audio>`).
5. **Aislamiento** del Python del agente (corre con los permisos de Carlos).
6. Textos de coste de la GPU (`gpu-texto.ts`) siguen en español; la GPU está apagada.
7. El agente aún tiende a diagnosticar «de oído» con su propio render numpy, que no
   es lo que suena en openDAW: valorar darle una herramienta que mida el WAV de
   `exportar`.

## 4. Cómo empezar

1. `npm run typecheck` y `npm run test:unit` (160 pruebas en verde el 28-oct).
2. `python workspace/herramientas/smoke.py`.
3. `npm run dev` y repasar la lista de la sección 2 con Carlos.
