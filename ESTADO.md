# ESTADO · 27-oct-2026

Documento de relevo: qué hay, qué funciona, qué falta y por dónde seguir. La
arquitectura está en `docs/ARCHITECTURE.md`; la revisión de hoy, con todos los
fallos y su porqué, en `docs/REVISION-2026-10-27.md`.

## 1. Sesión del 27-oct: revisión de arquitectura (rama `revision-arquitectura`)

- **El agente compone en el proyecto**: `leer_proyecto`, `editar_proyecto` (las 17
  ops, transaccionales) y `escribir_progresion` (acordes o grados → notas, con
  conducción de voces). `theory.ts` ya no está muerto. Python queda para el audio.
- **Prompt nuevo** (aprobado; huella `fc68ad65` → `0b6a0c79`): compositor, arreglista
  y productor; mira antes de tocar; piezas largas por secciones; traduce él al
  vocabulario de las herramientas. Porqué: `docs/PROMPT-CAMBIO-2026-10-27.md`.
- **Cualquier idioma**: una sola función de slug (`src/core/nombres.ts`) que admite
  cualquier alfabeto; la carpeta del proyecto se fija al crearlo (`meta.carpeta`) y
  ya no cambia al renombrar; cabecera del proyecto codificada; vocabulario canónico
  en `enum` para que el modelo traduzca. Interfaz en español e inglés (`i18n.ts`).
- **Estructura**: `vite.config.ts` de 1.863 a 74 líneas (la API en `server/`);
  `main.ts` de 2.665 a ~1.840 (las acciones del agente en `agent/acciones.ts`); un
  solo registro de acciones.
- **Fallos arreglados**: 19, en la tabla de la revisión. Los más graves: proyectos
  no latinos en la misma carpeta, renombrar perdía los WAV, «Cancelar» no mataba el
  Python, recorte de conversación con `tool` huérfanos, `anadir_notas` inexistente.
- **Limpieza**: migración antigua, funciones sin uso, siete scripts del agente fuera
  del motor, WAV de YouTube fuera de git, finales de línea normalizados.

## 2. Lo que funciona hoy

- **Disco como verdad**: `proyectos/<carpeta>/proyecto.json` + WAV por ruta.
- **Arranque limpio**: no abre ningún proyecto; se elige con «Proyectos».
- **Chat con memoria del proyecto** (`agente.json`: resumen + 8 turnos).
- **Agente**: 20 herramientas; compone, mezcla faders y efectos, busca en 4.231
  samples CC0, instrumentos SFZ → SF2, sonidos con palabras, Python en CPU o GPU.
- **Abrir** proyecto, audio o MIDI, también arrastrando a la ventana.

## 3. Lo que sigue a medias

1. **Unidades reales en los efectos** (Hz, dB, ms) y buses/envíos: sin esto la mezcla
   del agente es a ciegas.
2. **Dos transportes**: los WAV largos (> 30 s) van por `<audio>`, fuera del mezclador
   de openDAW.
3. **Aislamiento**: el agente ejecuta Python con tus permisos. Imprescindible antes de
   que lo use nadie más.
4. Avisos del chat sólo en español (`main.ts`).
5. Sin prueba en navegador de esta rama todavía: `tsc` y tests sí (ver abajo).

## 4. Cómo empezar la próxima sesión

1. `npx tsc --noEmit` y `npm run test:unit`: 0 errores, todo en verde.
2. `npm run dev`, abrir `localhost:5173` y probar en el navegador lo que no cubren
   los tests: abrir un proyecto y oírlo; pedir al agente «una progresión i-VI-III-VII
   en la menor, pad y bajo, 8 compases» y comprobar que aparece en el piano roll y
   se deshace con Ctrl+Z; crear un proyecto con nombre en japonés.
3. `npm test` (contrato openDAW) y `npm run build:web`.
4. Si todo va bien, fusionar `revision-arquitectura` en `gui-strudel`.
