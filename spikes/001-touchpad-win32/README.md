# Spike 001 — touchpad como instrumento en Windows (Raw Input API)

**Pregunta:** ¿se puede leer el multitáctil del touchpad del portátil (HP 15s-fq,
ELAN0712) desde un proceso propio, con posición absoluta y varios dedos, para
usarlo como superficie de instrumento?

## Verdict: VALIDATED

### Qué se probó

`main.py` abre una ventana oculta, registra los usages de digitalizador
(0x0D/0x05 Touch Pad y 0x0D/0x22) con `RegisterRawInputDevices` +
`RIDEV_INPUTSINK` y vuelca cada informe HID crudo a JSONL.

Comprobaciones:

- `--listar`: el pad aparece como `HID#ELAN0712&Col03` con
  `HID\VID_04F3&UP:000D_U:0005`, o sea es un Precision Touchpad de verdad
  (service `PTPFilter`). Col01 es el ratón, Col02 es vendor y Col04 es 0x0D/0x0E.
- Captura real de 1452 informes mientras Carlos tocaba el pad.
- El HID report descriptor (254 bytes) se obtuvo con `hidapi`
  (`hid.device.get_report_descriptor()`), no con el registro: Windows **no**
  guarda `ReportDescriptor` bajo `Enum\HID\...\Device Parameters` en este equipo.

### Layout deducido y verificado

Report ID **4**, 11 bytes de payload (total 12). Un informe **por dedo**:

| Bits | Campo | Evidencia |
|---|---|---|
| 0-1 | Confidence (0x0D/0x47), Tip Switch (0x0D/0x42) | tip=1 en 1446 de 1452; tip=0 al levantar |
| 4-7 | Contact Identifier (0x0D/0x51) | ids 0 y 1, uno por dedo |
| 8-23 | X, lógico 0..3520 | 82..3518 en el arrastre horizontal |
| 24-39 | Y, lógico 0..1784 | 112..1784 en la otra pasada |
| 40-55 | Scan Time (0x0D/0x56) | contador creciente |
| 56-63 | Contact Count (0x0D/0x54) | 1 con un dedo; 2 en el primer informe del cuadro con dos y 0 en el de continuación |
| 64 | Button 1 | click del pad, 0 en toda la captura |

Verificado con dos dedos: llegan dos informes por cuadro, ids 0 y 1, **con el
mismo Scan Time**, separados ~0,2 ms.

### Lo que funciona

- Multitáctil real con ID de contacto estable: sirve para disparar y soltar notas.
- Posición absoluta de 16 bits (3520 x 1784), no deltas de ratón.
- Frecuencia ~100-170 informes por segundo.
- Funciona **en segundo plano** (`RIDEV_INPUTSINK`): el cliente puede estar
  detrás del navegador y seguir leyendo.
- El registro no requiere privilegios de administrador.

### Lo que no

- **No hay presión**: el descriptor no incluye Tip Pressure (0x0D/0x30), así que
  la velocidad de nota no puede salir de la fuerza. Hay que deducirla de otra
  cosa (duración, distancia recorrida, tamaño... y tamaño tampoco hay).
- **No hay In Range** (0x0D/0x32): el dedo simplemente deja de informar al
  levantarse, con el aviso de Tip Switch=0 en el último informe.
- El cursor sigue moviéndose mientras se toca. Para tocar en serio hay que
  enganchar un hook de ratón (`WH_MOUSE_LL`) y tragarse el movimiento.
- Solo va en Windows PTP. Sin PTP no hay nada que leer.

### Trampas que costaron tiempo

- `bRawData` está declarado como `c_ubyte * 1`: indexar más allá del byte 0 lanza
  `IndexError`. Hay que leer con `ctypes.string_at(addressof + offset, n)`.
- Sin `argtypes` en `DefWindowProcW`, ctypes pasa los `LRESULT` como `c_int` y
  revienta con `OverflowError` en cada mensaje de ventana.
- El modo `--listar` no debe asumir que `RIDI_DEVICEINFO` funciona: en este
  equipo devuelve vacío y hay que tirar del hardware ID del registro.

### Recomendación para el cliente de verdad

- Reutilizar este archivo como backend `windows_rawinput` del cliente local.
- Normalizar X/Y a 0..1 con 3520/1784 y aplicar zona muerta en los bordes.
- Agrupar informes por Scan Time para reconstruir el cuadro completo.
- Añadir el hook de ratón para congelar el cursor mientras se toca.
- Presión no hay: la dinámica tiene que venir del mapeo (posición Y, duración del
  toque o velocidad del gesto calculada entre informes).
