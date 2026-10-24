# Plan por fases

Estado: **0 hecha · 3 en curso**. El orden no es el de la lista: se empieza por la
creación de sonidos porque es la que no depende de nada y la que desbloquea el
resto (para mezclar hay que tener sonidos que mezclar).

---

## Fase 0 — Base · HECHA

Contexto del agente por proyecto (`proyectos/<slug>/agente.json`: 8 turnos +
resumen), salidas largas por referencia en `_salidas/`, logs acotados con rotación,
clips medidos en compases (`anadir_pistas(compases=N)`, `igualar_clips`), y el
agente pregunta antes de entregar (MIDI vs WAV, stems 12 dB abajo).

---

## Fase 3 — Creación de sonidos · EN CURSO

**Idea**: un sonido es **receta JSON + WAV**, no un sintetizador nuevo. El motor
Python ya tiene los timbres; openDAW ya tiene sampler.

| paso | entregable | dónde |
|---|---|---|
| 3.1 | catálogo de voces con parámetros reales y rangos, receta y generación del script de render | `src/core/sonidos.ts` + tests |
| 3.2 | panel «Sonidos»: catálogo, sliders, ▶ escuchar, «Guardar en el proyecto» | `web/index.html`, `web/src/main.ts`, `style.css` |
| 3.3 | herramienta `crear_sonido` para el agente (receta → script → `/api/run/python` → medir → guardar) | `web/src/agent/tools.ts` |
| 3.4 | colocar el sonido: clip de audio o carga en el sampler para tocarlo por MIDI | `main.ts` |

**Criterios de aceptación**
- Misma receta y misma semilla dan el mismo WAV (mismo hash).
- El preview suena en menos de 2 s (render CPU, one-shot).
- El fichero queda en `proyectos/<slug>/sonidos/<nombre>.wav` + `<nombre>.json`, y
  aparece en la timeline.
- `tsc` 0, `test:unit` verde, `build:web` OK, prueba en navegador.

**No entra**: sintetizador propio, edición gráfica de onda, DDSP.

---

## Fase 1 — Que el agente sepa mezclar (después de 3)

- `set_device` con **unidades reales** (Hz, dB, ratio, ms, %) en vez de 0..1.
- `sends` en el modelo → `AuxSendBox` de openDAW.
- Herramientas `medir_mezcla` (bounce con `OfflineEngineRenderer` → `verificar_audio`)
  y `congelar` (`AudioUnitFreeze`).
- Prompt: catálogo de unidades, rangos sensatos, orden de inserts y reglas
  (no comprimir stems ya comprimidos, headroom −6 dB en la suma, no limitar stems).
- **Verifica**: bounce con crest 12-14 dB y picos ≤ −1 dBFS, y los valores que dice
  el chat coinciden con `proyecto.json`.

Reutiliza: `EffectFactories`, `EffectParameterDefaults`, `Mixer`,
`OfflineEngineRenderer`, `AudioUnitFreeze`, `/api/verificar`.

---

## Fase 2 — UI de mezcla mínima

- Lista de **inserts por pista** (añadir/quitar/encender, sliders con unidad real).
- **Medidor** (`MeterWorklet`) en pista y master.
- Botones «Bounce» (a `salida/mezcla.wav`) y «Congelar».
- Panel de **sends** (A/B a un bus de reverb/delay).
- **Verifica**: fader de UI y del chat dan el mismo `proyecto.json`; medidor y bounce
  coinciden a ±0,3 dB; 21 pistas sin underruns.

**No entra**: automatización, curvas, snapshots.

---

## Fase 4 — Análisis y sugerencias

- `analizar_mezcla`: pico, RMS, LUFS, crest, DC y correlación por stem y en la suma
  (ya están en `dsp.py`), más `AutoEq` para la curva sugerida.
- Tabla en el chat + sugerencias aplicables sólo si el usuario dice que sí.
- Aviso permanente de material duplicado (MIDI + WAV del mismo instrumento).
- **Verifica**: sobre `Stahl` señala el `sint` a −31,7 dBFS y propone la corrección
  sin tocar nada.

**No entra**: mastering automático.

---

## Fase 5 — Un solo trabajo de motor

- `trabajo` genérico: `{id, tipo: render|bounce|analisis|sonido, destino: cpu|gpu,
  script, estado, progreso, salida, coste, cancelar}`.
- Sustituye `/api/run/python` y `/api/run/lambda`; el 409 de numpy y el contador de
  coste pasan a ser propiedades del trabajo.
- GPU sólo si el trabajo lo pide (`motor_gpu`), con aviso de coste real y apagado al
  terminar.
- **Verifica**: dos trabajos a la vez sin pisarse; cancelar deja la instancia
  apagándose; el coste mostrado coincide con la factura.

---

## Puertas de siempre

En cada fase: `npx tsc --noEmit` = 0, `npm run test:unit` verde, `npm test`
(openDAW), `npm run build:web`, y prueba real en el navegador de `localhost:5173`.
