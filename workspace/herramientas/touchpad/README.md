# Touchpad como instrumento

Tocar el touchpad del portátil como un teclado o unos pads, sin hardware MIDI.
Viene de humseed (spike 001 y `cliente_touchpad/`), donde se validó en el
portátil de Carlos (HP 15s-fq, touchpad ELAN0712).

## Piezas

| Fichero | Qué hace |
|---|---|
| `captura_win32.py` | Lee el Precision Touchpad con Raw Input (multitáctil, posición absoluta, ~140 informes/s) y congela el cursor mientras hay un dedo apoyado |
| `modelo.py` | Convierte informes sueltos en `down` / `move` / `up` por dedo |
| `principal.py` | Proceso hijo del servidor: órdenes por stdin, dedos por stdout (líneas JSON) |

El servidor lo arranca y lo para (`server/api/pad.ts`) y reenvía los dedos a la
página por SSE. El mapeo a notas vive en `src/core/pad.ts`, porque es la página
la que conoce la tonalidad, la pista y el instrumento.

## Por qué hay un proceso nativo

Un navegador no recibe el multitáctil del touchpad: sólo ve un ratón. El Raw
Input de Windows sí da cada dedo con su id y su posición.

## Lo que hay que saber

- **Sólo Windows con Precision Touchpad.** Sin PTP no hay nada que leer.
- **No hay presión**: el descriptor no trae Tip Pressure. La dinámica sale de la
  posición vertical (abajo = fuerte).
- **El cursor se congela con el pad armado** (mientras hay un dedo apoyado): si
  no, tocar arrastra el puntero fuera de la app. Se arma pulsando en el pad de la
  página y se suelta con **Esc** (o **Ctrl+Alt+T** si la página no responde).
- El rango lógico (3520 × 1784) es el del ELAN0712; otro pad puede tener otro.

## Layout del informe (ELAN0712, report ID 4, un informe por dedo)

| Bits | Campo |
|---|---|
| 0-1 | Confidence, Tip Switch |
| 4-7 | Contact Identifier |
| 8-23 | X, lógico 0..3520 |
| 24-39 | Y, lógico 0..1784 |
| 40-55 | Scan Time |
| 56-63 | Contact Count |
| 64 | Button 1 |

Con dos dedos llegan dos informes por cuadro, ids 0 y 1, con el mismo Scan Time.

## No volver a intentar (medido en humseed)

- Apagar el touchpad en Ajustes de Windows: mata el HID, cero informes.
- Deshabilitar la colección de ratón del pad: el driver sigue moviendo el puntero.
- Recolocar el cursor a posteriori: Windows aplica el movimiento después de
  nuestro informe y el cursor se escapa. El gancho `WH_MOUSE_LL` gana la carrera.
- Bloquear el puntero con el gancho sin la condición de dedo apoyado.

## Trampas ya pagadas

- La clase de ventana se registra UNA vez por proceso; si no, access violation al
  rearrancar la captura.
- `bRawData` está declarado como `c_ubyte * 1`: se lee con
  `ctypes.string_at(addressof + offset, n)`, no indexando.
- Sin `argtypes` en `DefWindowProcW`, ctypes pasa los `LRESULT` como `c_int` y
  revienta con `OverflowError`.
- Con el handle que llega en `WM_INPUT`, pedir primero el tamaño del nombre del
  dispositivo devuelve 0: hay que pasar un buffer fijo.
