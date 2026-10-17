# Estado del proyecto — traspaso

Documento de arranque para la siguiente sesión. Resume **qué es el proyecto
ahora**, **qué está decidido**, **qué está descartado** y **qué trampas ya nos
costaron tiempo**. No repetir lo descartado.

---

## 1. Qué es esto ahora

Una aplicación web **local** para **grabar o cargar un tarareo, transcribirlo y
exportar el resultado como archivo MIDI**. Nada más por ahora; Ardour se ocupa
de la edición musical después de importar el MIDI.

## 2. Alcance decidido

- Flujo: micrófono o archivo de audio → Basic Pitch en el VPS por SSH → MIDI
  crudo descargable/importable en Ardour.
- La app no edita notas, no crea pistas/instrumentos, no renderiza ni reproduce
  mezclas, no usa metrónomo y no compone con LLM.
- El MIDI conserva los tiempos y demás datos generados por Basic Pitch; no
  reconstruirlo desde ABC ni cuantizarlo.
- No cambiar el transcriptor por ahora; verificarlo con tomas reales y corregir
  errores manualmente en Ardour.

## 3. Estado implementado y verificación

Arranque: `.venv/Scripts/python.exe app/servidor.py --puerto 8770` →
`http://127.0.0.1:8770`.

- La nueva interfaz mínima está en `app/transcribir.html`: grabar del micrófono
o cargar un archivo de audio, preescucharlo, transcribir y descargar MIDI.
- El servidor recibe audio en `POST /analizar`, lo envía al transcriptor Basic
  Pitch remoto y devuelve el MIDI crudo (`audio/midi`). La importación en Ardour
  ya fue probada por Carlos y funciona.
- `GET /` sirve la interfaz mínima. Se retiraron de las rutas activas el editor,
  instrumentos, render y exportación de proyectos. Los archivos antiguos del
  editor y del modelo de proyectos aún están en el repositorio como legado, pero
  no los carga la app ni los necesita el servidor actual.
- Pruebas en `tests/test_app_transcripcion.py` cubren transcripción, descarga
  MIDI, audio inválido y ausencia de funciones del editor. La compatibilidad en
  `tests/test_app_multitrack.py` confirma que la antigua API de proyecto no existe.
- Verificación ejecutada: `python -m unittest discover -s tests -p 'test_*.py' -q`
  — 8 pruebas OK; `node --check cache/transcribir.js` pasó; import del servidor OK.
  No se ejerció una transcripción real en este turno porque depende del VPS.
- No se probó en esta tarea una toma real con micrófono; Carlos confirmó antes
  que el MIDI generado por Humseed se importa correctamente en Ardour.

**Alcance actual:** sólo transcribir tarareo y exportar MIDI. Sin edición de
notas, multipista, selección de instrumentos, metrónomo, reproducción/render de
mezcla ni LLM.

## 4. Arquitectura: dónde corre cada cosa

```
   PORTÁTIL (i5, sin GPU)                 VPS 31.220.80.78 (16 núcleos)
   ┌─────────────────────┐               ┌──────────────────────────┐
   │ app/servidor.py     │  audio stdin  │ ~/transcribe/one_shot.py │
   │   :8770             │ ─────SSH────► │   Basic Pitch   6,7 s    │
   │ app/index.html      │ ◄───MIDI b64──│                          │
   │ el micrófono        │               │ llama-server    :8091    │
   └─────────────────────┘               └──────────────────────────┘
```

**Decisión tomada: opción B.** La app vive en el portátil (tiene que estar ahí:
el micro es local) y **todo el trabajo pesado va al VPS por SSH**. No se abre
ningún puerto a internet. Publicar (opción A) queda para más adelante, y el
usuario pidió explícitamente **no preparar nada para eso ahora**.

### Por qué el trabajo va al VPS

Medido con la misma toma: Basic Pitch tarda **19 s en el VPS y 100 s en el
portátil**. Cinco veces más.

## 5. Decisiones y límites actuales

- Ardour es el destino para editar y trabajar el MIDI; Carlos ya importó un MIDI
  de Humseed y confirmó que funciona.
- La app de Humseed se mantiene local en el portátil; audio al VPS por SSH, sin
  exponer puertos públicamente. La transcripción Basic Pitch corre con Python
  3.11 en `ssh vps`.
- El LLM de música y el entrenamiento están pausados. No construir editor MIDI,
  arreglo, instrumentos, render ni otras funciones en Humseed hasta que Carlos
  lo pida expresamente.

## 6. Descartado o en pausa (no reabrir sin motivo)

- **El LLM de música: EN PAUSA** por decisión del usuario.
- **Nuestro transcriptor propio** (`pyin` + ataques): sustituido por Basic
  Pitch. Se conserva solo como respaldo (`analyse(..., motor="propio")`).
- **El ABC como fuente del audio**: el ABC queda únicamente como notación para
  el LLM (si algún día se retoma). **El audio sale del MIDI crudo.**
- **Cuantizar como norma**: destruye el ritmo (ver trampas).

## 7. Trampas y límites que siguen siendo relevantes

- **No cuantizar el MIDI**: ya se midió una desviación mediana de 543 ms con
  cuantización. Exportar siempre el MIDI crudo de Basic Pitch.
- **Basic Pitch usa un entorno Python 3.11 separado** (`tensorflow<2.15`,
  `numpy<2`, `setuptools<81`); se ejecuta en el VPS por SSH.
- No tocar servicios del VPS: llama-server y Ollama son ajenos a esta app; no
  abrir puertos ni enviar credenciales.

## 8. Entorno, en corto

| Cosa | Dónde |
|---|---|
| App | `app/servidor.py --puerto 8770`, venv `.venv` (Python 3.12) |
| Cliente touchpad | `cliente_touchpad/servidor.py --puerto 8771` (o doble clic en `cliente_touchpad/arrancar.cmd`) |
| Transcripción | VPS `~/transcribe/.venv` (Python 3.11) + `~/transcribe/one_shot.py` |
| Soundfont | `tools/MuseScore_General.sf3` (GM, 128 instrumentos) |
| fluidsynth | `tools/fluidsynth-v2.6.1-win10-x64-cpp11/bin/fluidsynth.exe` |
| Claves | `LAMBDA_API_KEY` y `HF_TOKEN` en el `.env` del perfil. **Nunca imprimirlas** |
| Acceso VPS | `ssh vps` (clave `~/.ssh/id_rsa`) |

## 9. Cómo arrancar y continuar

1. Revisar `git status` en `C:/Users/carlos/proyectos/llm-musica`.
2. Ejecutar `.venv/Scripts/python.exe app/servidor.py --puerto 8770` y abrir
   `http://127.0.0.1:8770`.
3. Probar en navegador grabar un tarareo, obtener el MIDI y descargarlo; importar
   el archivo en Ardour.
4. No volver a añadir características del editor ni reactivar el LLM sin una
   petición explícita de Carlos.

## 10. Cliente del touchpad como instrumento (nuevo, en curso)

Objetivo de Carlos: tocar el pad del portátil como instrumento, sin hardware.
Reparto: **la captura no puede ser web** (un navegador no recibe el multitáctil
del touchpad), así que hay un proceso nativo que lee Raw Input y sirve una
aplicación web local.

- `cliente_touchpad/modelo.py` — núcleo común sin nada de Windows: contactos
  normalizados (0..1), eventos `down/move/up/click` con duración y recorrido,
  seguimiento de cada dedo y publicador SSE.
- `cliente_touchpad/entrada_win32.py` — backend de captura (Raw Input, usages
  0x0D/0x05 y 0x0D/0x22), arrancable y pararable en caliente.
- `cliente_touchpad/servidor.py` — aplicación web en `127.0.0.1:8771` con botones
  **Empezar prueba / Parar prueba**, dibujo en vivo de los dedos, pitido por
  pulsación y contadores.
- Layout de los informes verificado contra el HID report descriptor del ELAN0712
  (report ID 4, un informe por dedo, ~100-170 informes/s, sin presión). Ver
  `spikes/001-touchpad-win32/README.md`.
- Conocimiento reutilizable en la skill `precision-touchpad-windows`.

**Verificado**: captura real de 1452 informes; arrancar/parar varias veces sin
morir; botones de la página funcionando; encierro del pad por zona (`/zona`)
comprobado con informes falsos (`/_test/informe`): con la zona inactiva no pasa
nada, con la zona armada llegan los contactos y al salir se sueltan; 142
informes/s reales tocando el pad.

**Pendiente, en este orden**:
1. Carlos apagó el touchpad en Ajustes de Windows y hay que **volver a
   encenderlo** (apagarlo mata el HID entero, no solo el ratón).
2. Confirmar que al reencenderlo vuelven los informes y que el cursor se congela
   mientras hay un dedo apoyado (congelado automático, casilla «el pad no mueve
   el cursor», atajo Ctrl+Alt+T).
3. Decidir el **mapeo**: qué toca cada zona del pad (notas por columna, X/Y como
   expresión, un dedo por voz). Sin presión en el hardware: la dinámica tiene que
   salir del mapeo.

**Trampas ya pagadas**: la clase de ventana se registra una vez por proceso (si
no, access violation al rearrancar); los volcados de faulthandler en
`RegisterClassExW`/`CreateWindowExW` son ruido benigno; el panel de vista previa
del chat no reenvía POST (los mandos van por GET); el servidor lanzado desde el
agente muere con la shell, por eso `arrancar.cmd` y el log a
`cliente_touchpad/cliente.log`.
