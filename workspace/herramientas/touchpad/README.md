# Touchpad as an instrument

Playing the laptop touchpad like a keyboard or pads, with no MIDI hardware.
It comes from humseed (spike 001 and `cliente_touchpad/`), where it was validated on
Carlos's laptop (HP 15s-fq, ELAN0712 touchpad).

## Pieces

| File | What it does |
|---|---|
| `captura_win32.py` | Reads the Precision Touchpad with Raw Input (multitouch, absolute position, ~140 reports/s) and freezes the cursor while a finger is resting |
| `modelo.py` | Turns individual reports into `down` / `move` / `up` per finger |
| `principal.py` | The server's child process: commands over stdin, fingers over stdout (JSON lines) |

The server starts and stops it (`server/api/pad.ts`) and forwards the fingers to the
page over SSE. The mapping to notes lives in `src/core/pad.ts`, because it is the page
that knows the key, the track and the instrument.

## Why there is a native process

A browser does not receive the touchpad's multitouch: it only sees a mouse. Windows
Raw Input does give each finger with its id and position.

## What you need to know

- **Windows with Precision Touchpad only.** Without PTP there is nothing to read.
- **No pressure**: the descriptor does not bring Tip Pressure. The dynamics come from
  the vertical position (bottom = loud).
- **The cursor freezes with the pad armed** (while a finger is resting): otherwise,
  playing drags the pointer off the app. It is armed by pressing on the page's pad and
  released with **Esc** (or **Ctrl+Alt+T** if the page does not respond).
- The logical range (3520 × 1784) is that of the ELAN0712; another pad may have another.

## Report layout (ELAN0712, report ID 4, one report per finger)

| Bits | Field |
|---|---|
| 0-1 | Confidence, Tip Switch |
| 4-7 | Contact Identifier |
| 8-23 | X, logical 0..3520 |
| 24-39 | Y, logical 0..1784 |
| 40-55 | Scan Time |
| 56-63 | Contact Count |
| 64 | Button 1 |

With two fingers, two reports arrive per frame, ids 0 and 1, with the same Scan Time.

## Do not try again (measured in humseed)

- Turning the touchpad off in Windows Settings: it kills the HID, zero reports.
- Disabling the pad's mouse collection: the driver keeps moving the pointer.
- Repositioning the cursor afterwards: Windows applies the movement after
  our report and the cursor escapes. The `WH_MOUSE_LL` hook wins the race.
- Locking the pointer with the hook without the finger-down condition.

## Traps already paid for

- The window class is registered ONCE per process; otherwise, access violation when
  restarting the capture.
- `bRawData` is declared as `c_ubyte * 1`: it is read with
  `ctypes.string_at(addressof + offset, n)`, not by indexing.
- Without `argtypes` in `DefWindowProcW`, ctypes passes the `LRESULT`s as `c_int` and
  blows up with `OverflowError`.
- With the handle that arrives in `WM_INPUT`, asking first for the size of the device
  name returns 0: a fixed buffer has to be passed.
