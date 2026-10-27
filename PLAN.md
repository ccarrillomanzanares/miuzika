# Plan por fases

Estado: **Fase 0 hecha · Fase 3 casi (faltan 3.6 y 3.7) · 1, 2, 4 y 5 pendientes**.

**27-oct**: la decisión que bloqueaba el resto («partitura como dato, sí o no») está
tomada: **sí, y ya existía**. Es `proyecto.json` con sus ops; el agente las usa con
`editar_proyecto` y `escribir_progresion` (ver `docs/REVISION-2026-10-27.md`). La
Fase 1 pasa a ser lo siguiente.
El orden no es el de la lista: se empezó por la creación de sonidos porque es la que
no depende de nada y desbloquea el resto (para mezclar hay que tener sonidos que
mezclar). La arquitectura y la deuda viva están en `docs/ARCHITECTURE.md`.

---

## Fase 0 — Base · HECHA

Contexto del agente por proyecto (`proyectos/<slug>/agente.json`: 8 turnos +
resumen), salidas largas por referencia en `_salidas/`, logs acotados con rotación,
clips medidos en compases (`anadir_pistas(compases=N)`, `igualar_clips`), y el
agente pregunta antes de entregar (MIDI vs WAV, stems 12 dB abajo).

---

## Fase 3 — Creación de sonidos · CASI

**Idea**: un sonido es **receta JSON + WAV**, no un sintetizador nuevo. El motor
Python ya tiene los timbres; openDAW ya tiene sampler. Y no hay panel de perillas:
se pide con palabras y con el ▶.

| paso | estado |
|---|---|
| 3.1 catálogo **leído del motor** (`codigo/voces.py` + `/api/voces`), con familia, rango, unidad y perfil medido | HECHO |
| 3.2 se descarta el panel de parámetros: el idioma es el chat + palabras | DECIDIDO |
| 3.3 puerta para voces nuevas (`codigo/gate_voz.py` + `/api/voces/nueva`): se cuecen en `instruments.py` | HECHO |
| 3.4 vocabulario de 16 palabras con ejes y post-proceso universal (`src/core/palabras.ts`) | HECHO |
| 3.5 herramientas del agente: `listar_voces`, `crear_sonido`, `crear_voz` | HECHO |
| 3.6 escuchar en contexto: que el agente coloque el sonido en la pista y se oiga dentro del tema | PENDIENTE |
| 3.7 lista de sonidos del proyecto con ▶ (lo mínimo de interfaz) | PENDIENTE |

**Criterios de aceptación (cumplidos salvo 3.6-3.7)**
- Misma receta y misma semilla dan el mismo WAV (mismo hash). ✔
- La puerta rechaza lo que no es un sonido y dice por qué. ✔ (onda cuadrada:
  «crest 0.0 dB fuera de 2.0-30.0»; duplicada: 409; sin semilla: «no es
  reproducible»).
- El fichero queda en `proyectos/<slug>/sonidos/<nombre>.wav` + `.json`. ✔
- Las palabras cambian el sonido de forma medible (cola −30 dB, centroide
  +1.393 Hz, crest de 11,1 a 18,1). ✔
- `tsc` 0, `test:unit` 103/103, `npm test` con OPENDAW OK, prueba en navegador. ✔

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
