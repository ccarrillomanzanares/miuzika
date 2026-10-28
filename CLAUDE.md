# miuzika — instrucciones para Claude Code

DAW en el navegador (openDAW en WASM) con un agente LLM que compone, arregla y
produce. El usuario es Carlos: escribe en español; la interfaz de la app está en
inglés; el agente contesta en el idioma de quien le escribe.

Lee primero `ESTADO.md` (dónde estamos y qué falta) y, si vas a tocar estructura,
`docs/ARCHITECTURE.md`.

## Reglas de la casa (no negociables)

1. **El prompt del agente** (`web/src/agente-prompt.ts`) no se toca sin el
   consentimiento explícito de Carlos. Si lo autoriza: se cambia el texto, se
   actualiza `HUELLA_PROMPT` (FNV-1a, la calcula `huellaDe`) y su prueba, y se apunta
   en `docs/PROMPT-CAMBIO-2026-10-27.md` qué cambió y por qué.
2. **No recargar la app sin avisar.** Tocar `web/`, `server/` o `vite.config.ts`
   recarga la página o reinicia el servidor y corta lo que Carlos esté escuchando o
   el turno del agente. Pregunta antes, o espera a que diga que no la está usando.
   Mirar el final de `tmp/llm.log` dice si el agente está trabajando.
3. **Secretos**: `.env` y `.miuzika/proveedores.json` tienen claves. No se imprimen
   ni se copian. `.miuzika/` está fuera de git y fuera de `workspace/` a propósito.
4. **Nada de afirmar que algo suena sin comprobarlo.** El conversor de VCSL dijo
   «84 zonas» durante un día mientras todo sonaba en silencio. Si no se puede oír,
   se dice y se pide a Carlos que lo pruebe.
5. Commits en español, con el porqué medido («medido el 28-oct: …»). Los
   comentarios del código, igual: explican por qué, con el dato que lo justificó.

## Comandos

```
npm run dev            # localhost:5173 (servidor de Vite + API en server/)
npm run typecheck      # tsc --noEmit
npm run test:unit      # node --test de src/, web/, server/
npm test               # + contrato con openDAW (check.ts)
npm run build:web
python workspace/herramientas/smoke.py   # motor Python (workspace/codigo)
```

## Mapa rápido

- `src/core/` — dominio puro, con pruebas: tipos, ops transaccionales (`ops.ts`),
  teoría, notación compacta, batería en rejilla, biblioteca VCSL, proveedores de
  modelos, exportación MIDI, versiones, pad.
- `src/host/opendaw/` — proyecto miuzika → proyecto openDAW.
- `server/` — la API (plugin de Vite): ficheros, proyectos, audio, catálogo,
  Python, GPU, pad, proveedores/proxy del LLM.
- `web/src/` — interfaz. `main.ts` (orquesta), `agent/` (bucle del agente,
  herramientas, acciones), `opendaw-engine.ts` (reproducir y exportar WAV),
  `formulario-encargo.ts`, `ajustes-modelos.ts`, `pad.ts`.
- `workspace/` — lo que el agente lee y escribe: `codigo/` (motor numpy),
  `catalogo/` (VCSL, GM; fuera de git), `herramientas/` (smoke, manifiesto,
  touchpad), `proyectos/<carpeta>/` (fuera de git).
- Logs: `tmp/llm.log` (cada llamada al modelo) y `tmp/herramientas.log`.
