# miuzika

Un DAW en el navegador con un agente que compone, arregla y produce. Se le habla
en cualquier idioma; el agente escribe directamente en el proyecto (notas, acordes,
efectos, mezcla) y, cuando hace falta audio sintetizado, ejecuta Python en tu equipo
o en una GPU de Lambda Cloud.

```text
GUI + openDAW (WASM)    timeline, piano roll, reproducción, batería, SoundFonts
agente (LLM)            lee y edita el proyecto con ops; compone con teoría musical
motor numpy / torch     síntesis, render, análisis (workspace/codigo, workspace/gpu)
Strudel → WAV           patrones generativos renderizados a pista de audio
disco                   cada proyecto es su carpeta: proyecto.json + sus WAV
```

La arquitectura, las fronteras y los acoplamientos peligrosos están en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). El parte del día, en
[`ESTADO.md`](ESTADO.md); las fases pendientes, en [`PLAN.md`](PLAN.md); la revisión
del 27-oct, en [`docs/REVISION-2026-10-27.md`](docs/REVISION-2026-10-27.md).

## Arranque

Requisitos: **Node 24** y **Python 3 con numpy** (`MIUZIKA_PYTHON` en `.env` si no se
llama `python`).

```bash
npm install
npm run dev          # http://localhost:5173  (no 127.0.0.1: el origen importa)
```

`.env` (sólo lo lee el servidor; el navegador nunca ve las claves):

```text
OLLAMA_API_KEY=...            # Ollama Cloud (y la búsqueda web); otros proveedores y claves, en el menú «Modelos»
OLLAMA_BASE_URL=https://ollama.com
# Opcional, GPU en Lambda Cloud:
LAMBDA_API_KEY=...  LAMBDA_SSH_KEY=...  LAMBDA_SSH_KEY_NAME=...  LAMBDA_SSH_USER=ubuntu
LAMBDA_REGION=us-east-1  LAMBDA_INSTANCE_TYPE=gpu_1x_a10  LAMBDA_NOMBRE=miuzika-gpu
```

## Comprobaciones

| comando | qué |
|---|---|
| `npm run typecheck` | TypeScript sin emitir (0 errores) |
| `npm run test:unit` | dominio, agente y ficheros (`node --test`) |
| `npm test` | lo anterior + contrato con openDAW (exportar/importar un `.odw`) |
| `npm run build:web` | bundle de producción |

Y a mano, porque ningún test lo cubre: abrir un proyecto, darle a play y **oírlo**.

## Cómo se trabaja

- **Proyectos**: `workspace/proyectos/<carpeta>/proyecto.json` es la única verdad. La
  carpeta se fija al crear el proyecto y no cambia al renombrarlo; admite nombres en
  cualquier alfabeto. Autoguardado 1,5 s tras cada cambio (y `Guardar` / Ctrl+S).
- **Abrir**: proyecto (`.json`, `.miuzika.zip`), audio o MIDI, desde el botón o
  arrastrándolo a la ventana.
- **Agente**: panel de la derecha. Lee el proyecto, escribe progresiones y notas,
  ajusta mezcla y efectos, busca sonidos en la biblioteca CC0 (4.231 samples de
  VCSL), convierte instrumentos SFZ a SoundFont, crea sonidos con palabras y
  ejecuta Python. Su memoria es del proyecto (`agente.json`). El prompt de sistema
  es un literal con huella: no cambia sin querer.
- **Strudel**: botón «Strudel», un patrón y «Renderizar WAV»; entra como pista de
  audio (1 ciclo = 1 compás).
- **GPU**: selector CPU / GPU en el chat. La instancia **no se apaga sola**: el
  contador de la cabecera enseña la tarifa real y el gasto; apágala desde ahí.

## Estructura

```text
src/core/          dominio puro: tipos, ops transaccionales, teoría, composición,
                   resumen para el agente, sonidos y palabras, búsqueda, nombres
src/host/opendaw/  proyecto ↔ openDAW (adapter, mapping, contrato)
web/src/           la app: main.ts (estado y UI), timeline, piano roll, openDAW,
                   stems, Strudel, chat, i18n
web/src/agent/     bucle del agente, herramientas (contrato con el LLM), acciones
                   sobre el proyecto, contexto y actividad
server/            API del servidor de desarrollo: contexto + un módulo por área
                   (ficheros, proyectos, audio, catálogo, voces, gpu, python) y Lambda
workspace/         motor numpy (codigo/), motor torch (gpu/), herramientas/,
                   plantillas/, obras/, catálogo CC0 y proyectos (fuera de git)
docs/              arquitectura, openDAW, legal, plan de pruebas, revisiones
```

## Limitaciones

- Sólo existe con `npm run dev`: la API (`/api/*`) son middlewares de Vite. No hay
  despliegue, ni usuarios, ni aislamiento: el agente ejecuta Python con tus
  permisos. Ver «Producto» en `docs/REVISION-2026-10-27.md`.
- Los WAV de más de 30 s se reproducen por streaming (`<audio>`), fuera del mezclador
  de openDAW: no les afectan los efectos de pista ni el master.
- Efectos con parámetros normalizados 0..1 (salvo el eq, en dB); sin buses ni
  automatización.
- El motor de patrones asume 4/4. Strudel depende de sample maps remotos.
- La interfaz está en español e inglés; los avisos del chat, sólo en español.

## Licencia

**AGPL-3.0-or-later**. openDAW tiene licencia dual (AGPL/comercial); Strudel,
superdough y los sample packs son de terceros. Ver [LICENSE](LICENSE),
[NOTICE.md](NOTICE.md) y [docs/LEGAL.md](docs/LEGAL.md).
