"""Spike 001: leer el multitactil del touchpad Precision (PTP) en Windows.

Dos modos:
  python main.py --listar
      Enumera los dispositivos de entrada crudos y sus usages. Sirve para
      confirmar que el touchpad expone la coleccion de digitalizador.

  python main.py --segundos 30 [--salida log.jsonl]
      Registra con Raw Input API y va escribiendo cada informe HID crudo.

No envia MIDI ni nada: solo captura y vuelca. Es desechable.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import signal
import sys
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WM_INPUT = 0x00FF
WM_DESTROY = 0x0002
WM_CLOSE = 0x0010

RID_INPUT = 0x10000003
RIDI_DEVICENAME = 0x20000007
RIDI_DEVICEINFO = 0x2000000B
RIM_TYPEHID = 2
RIDEV_INPUTSINK = 0x00000100

# Colecciones de digitalizador que nos interesan.
USAGE_PAGE_DIGITIZER = 0x0D
USAGE_TOUCHPAD = 0x05
USAGE_TOUCHSCREEN = 0x04
USAGE_FINGER = 0x22  # "Finger" / touchpad sin botones fisicos

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
        ("hIconSm", wintypes.HICON),
    ]


class RAWINPUTDEVICELIST(ctypes.Structure):
    _fields_ = [("hDevice", wintypes.HANDLE), ("dwType", wintypes.DWORD)]


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD),
        ("hwndTarget", wintypes.HWND),
    ]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [
        ("dwType", wintypes.DWORD),
        ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE),
        ("wParam", wintypes.WPARAM),
    ]


class RAWHID(ctypes.Structure):
    _fields_ = [
        ("dwSizeHid", wintypes.DWORD),
        ("dwCount", wintypes.DWORD),
        ("bRawData", ctypes.c_ubyte * 1),
    ]


class RID_DEVICE_INFO_HID(ctypes.Structure):
    _fields_ = [
        ("dwVendorId", wintypes.DWORD),
        ("dwProductId", wintypes.DWORD),
        ("dwVersionNumber", wintypes.DWORD),
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
    ]


class RID_DEVICE_INFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("dwType", wintypes.DWORD),
        ("hid", RID_DEVICE_INFO_HID),
    ]


user32.GetRawInputData.argtypes = [
    wintypes.HANDLE,
    wintypes.UINT,
    ctypes.c_void_p,
    ctypes.POINTER(wintypes.UINT),
    wintypes.UINT,
]
user32.GetRawInputData.restype = wintypes.UINT
user32.GetRawInputDeviceList.argtypes = [
    ctypes.POINTER(RAWINPUTDEVICELIST),
    ctypes.POINTER(wintypes.UINT),
    wintypes.UINT,
]
user32.GetRawInputDeviceList.restype = wintypes.UINT
user32.GetRawInputDeviceInfoW.argtypes = [
    wintypes.HANDLE,
    wintypes.UINT,
    ctypes.c_void_p,
    ctypes.POINTER(wintypes.UINT),
]
user32.GetRawInputDeviceInfoW.restype = wintypes.UINT
user32.RegisterRawInputDevices.argtypes = [
    ctypes.POINTER(RAWINPUTDEVICE),
    wintypes.UINT,
    wintypes.UINT,
]
user32.RegisterRawInputDevices.restype = wintypes.BOOL

LRESULT_T = ctypes.c_ssize_t
for _fn, _args in (
    ("DefWindowProcW", [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]),
    ("PeekMessageW", [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]),
    ("TranslateMessage", [ctypes.POINTER(wintypes.MSG)]),
    ("DispatchMessageW", [ctypes.POINTER(wintypes.MSG)]),
    ("DestroyWindow", [wintypes.HWND]),
    ("PostQuitMessage", [ctypes.c_int]),
    ("RegisterClassExW", [ctypes.c_void_p]),
    (
        "CreateWindowExW",
        [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
         ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
         wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p],
    ),
):
    _f = getattr(user32, _fn)
    _f.argtypes = _args
    _f.restype = LRESULT_T if _fn in ("DefWindowProcW",) else wintypes.BOOL


def nombre_dispositivo(hdevice) -> str:
    tam = wintypes.UINT(0)
    user32.GetRawInputDeviceInfoW(hdevice, RIDI_DEVICENAME, None, ctypes.byref(tam))
    if tam.value == 0:
        return "?"
    buf = ctypes.create_unicode_buffer(tam.value)
    user32.GetRawInputDeviceInfoW(hdevice, RIDI_DEVICENAME, buf, ctypes.byref(tam))
    return buf.value


def info_dispositivo(hdevice) -> RID_DEVICE_INFO | None:
    info = RID_DEVICE_INFO()
    info.cbSize = ctypes.sizeof(RID_DEVICE_INFO)
    tam = wintypes.UINT(ctypes.sizeof(RID_DEVICE_INFO))
    ctypes.set_last_error(0)
    ok = user32.GetRawInputDeviceInfoW(
        hdevice, RIDI_DEVICEINFO, ctypes.byref(info), ctypes.byref(tam)
    )
    if ok == 0xFFFFFFFF:
        return None
    if ok == 0:
        print(f"  (deviceinfo vacio, err={ctypes.get_last_error()})")
        return None
    return info


def enumerar() -> list[dict]:
    n = wintypes.UINT(0)
    user32.GetRawInputDeviceList(None, ctypes.byref(n), ctypes.sizeof(RAWINPUTDEVICELIST))
    lista = (RAWINPUTDEVICELIST * n.value)()
    if user32.GetRawInputDeviceList(
        lista, ctypes.byref(n), ctypes.sizeof(RAWINPUTDEVICELIST)
    ) == 0xFFFFFFFF:
        raise ctypes.WinError(ctypes.get_last_error())

    salida = []
    for d in lista:
        e = {"nombre": nombre_dispositivo(d.hDevice), "tipo": d.dwType}
        info = info_dispositivo(d.hDevice)
        if info is not None:
            e["info_tipo"] = info.dwType
        if info is not None and info.dwType == RIM_TYPEHID:
            e["vid"] = f"{info.hid.dwVendorId:04x}"
            e["pid"] = f"{info.hid.dwProductId:04x}"
            e["usage_page"] = f"{info.hid.usUsagePage:#04x}"
            e["usage"] = f"{info.hid.usUsage:#04x}"
        salida.append(e)
    return salida


def decodificar_informe(informe: bytes) -> dict:
    """Decodifica un informe de la coleccion Touch Pad (UP 0x0D / U 0x05) del ELAN0712.

    Layout obtenido de su HID report descriptor (254 bytes, report ID 4):
        bits  0- 1: Confidence (0x0D/0x47), Tip Switch (0x0D/0x42)
        bits  2- 3: constante
        bits  4- 7: Contact Identifier (0x0D/0x51)
        bits  8-23: X, logico 0..3520
        bits 24-39: Y, logico 0..1784
        bits 40-55: Scan Time (0x0D/0x56)
        bits 56-63: Contact Count (0x0D/0x54): total en el primer informe del
                    cuadro, 0 en los informes de continuacion
        bit  64   : Button 1 (click del pad)
        bits 65-87: constante

    Cada dedo llega en su propio informe; los del mismo cuadro comparten Scan Time.
    """
    x = int.from_bytes(informe[2:4], "little")
    y = int.from_bytes(informe[4:6], "little")
    return {
        "report_id": informe[0],
        "confianza": bool(informe[1] & 0x01),
        "tip": bool(informe[1] & 0x02),
        "id": informe[1] >> 4,
        "x": x,
        "y": y,
        "x_norm": round(x / 3520, 5),
        "y_norm": round(y / 1784, 5),
        "scan": int.from_bytes(informe[6:8], "little"),
        "count": informe[8],
        "boton": bool(informe[9] & 0x01),
    }


class Capturador:
    def __init__(self, salida, usages):
        self.salida = salida
        self.usages = usages
        self.hwnd = None
        self._proc = None  # mantener vivo el callback
        self.n_informes = 0
        self.errores = 0
        self.dispositivos: dict[int, str] = {
            d["nombre"]: d["nombre"] for d in enumerar()
        }
        self._por_handle: dict[int, str] = {}

    def _wndproc(self, hwnd, msg, wparam, lparam):
        if msg == WM_INPUT:
            try:
                self._procesar(lparam)
            except Exception as exc:  # no inundar la consola si algo falla
                self.errores += 1
                if self.errores <= 5:
                    print(f"  error procesando informe: {exc!r}", flush=True)
            # 0 = ya procesado por la aplicacion
            return 0
        if msg == WM_CLOSE:
            user32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _procesar(self, lparam):
        tam = wintypes.UINT(0)
        user32.GetRawInputData(lparam, RID_INPUT, None, ctypes.byref(tam), ctypes.sizeof(RAWINPUTHEADER))
        if tam.value == 0:
            return
        buf = ctypes.create_string_buffer(tam.value)
        leido = user32.GetRawInputData(
            lparam, RID_INPUT, buf, ctypes.byref(tam), ctypes.sizeof(RAWINPUTHEADER)
        )
        if leido == 0xFFFFFFFF:
            return
        cab = ctypes.cast(buf, ctypes.POINTER(RAWINPUTHEADER)).contents
        if cab.dwType != RIM_TYPEHID:
            return
        # RAWHID empieza justo tras la cabecera
        rawhid = ctypes.cast(
            ctypes.addressof(buf) + ctypes.sizeof(RAWINPUTHEADER), ctypes.POINTER(RAWHID)
        ).contents
        n = rawhid.dwSizeHid * rawhid.dwCount
        datos = ctypes.string_at(
            ctypes.addressof(rawhid) + RAWHID.bRawData.offset, n
        )

        nombre = self._por_handle.get(cab.hDevice)
        if nombre is None:
            nombre = nombre_dispositivo(cab.hDevice)
            self._por_handle[cab.hDevice] = nombre

        self.n_informes += 1
        registro = {
            "t": round(time.perf_counter(), 6),
            "dispositivo": nombre,
            "size_hid": rawhid.dwSizeHid,
            "count": rawhid.dwCount,
            "hex": datos.hex(),
            "contacto": decodificar_informe(datos),
        }
        self.salida.write(json.dumps(registro) + "\n")
        self.salida.flush()
        if self.n_informes % 25 == 0:
            print(f"  ... {self.n_informes} informes", flush=True)

    def crear_ventana(self):
        hinst = kernel32.GetModuleHandleW(None)
        self._proc = WNDPROC(self._wndproc)
        clase = WNDCLASSEXW()
        clase.cbSize = ctypes.sizeof(WNDCLASSEXW)
        clase.lpfnWndProc = self._proc
        clase.hInstance = hinst
        clase.lpszClassName = "HumseedSpikeTouchpad"
        if not user32.RegisterClassExW(ctypes.byref(clase)):
            err = ctypes.get_last_error()
            if err != 1410:  # ERROR_CLASS_ALREADY_EXISTS
                raise ctypes.WinError(err)
        self.hwnd = user32.CreateWindowExW(
            0, "HumseedSpikeTouchpad", "spike", 0, 0, 0, 0, 0, None, None, hinst, None
        )
        if not self.hwnd:
            raise ctypes.WinError(ctypes.get_last_error())
        return self.hwnd

    def registrar(self):
        registrados = []
        for page, usage in self.usages:
            rd = RAWINPUTDEVICE(page, usage, RIDEV_INPUTSINK, self.hwnd)
            ok = user32.RegisterRawInputDevices(ctypes.byref(rd), 1, ctypes.sizeof(RAWINPUTDEVICE))
            print(
                f"registrar usage_page={page:#04x} usage={usage:#04x}: "
                f"{'OK' if ok else 'FALLO ' + str(ctypes.WinError(ctypes.get_last_error()))}",
                flush=True,
            )
            if ok:
                registrados.append((page, usage))
        return registrados

    def bucle(self, segundos: float):
        fin = time.perf_counter() + segundos if segundos else None
        msg = wintypes.MSG()
        while True:
            if fin and time.perf_counter() >= fin:
                break
            # PeekMessage con espera corta para poder comprobar el tiempo
            if user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            else:
                time.sleep(0.005)
        print(f"\ntotal informes: {self.n_informes}", flush=True)


def pitar(freq: int, ms: int):
    try:
        import winsound

        winsound.Beep(freq, ms)
    except Exception:
        pass


def aviso_inicio():
    """Dos tonos agudos = empieza a tocar."""
    pitar(1000, 120)
    time.sleep(0.10)
    pitar(1000, 120)


def aviso_fin():
    pitar(400, 600)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--segundos", type=float, default=0, help="0 = hasta Ctrl+C")
    ap.add_argument("--salida", default="captura.jsonl")
    ap.add_argument("--solo-touchpad", action="store_true", help="solo usage 0x0D/0x05")
    args = ap.parse_args(argv)

    if args.listar:
        for d in enumerar():
            print(
                f"tipo={d['tipo']} info_tipo={d.get('info_tipo')} "
                f"usage_page={d.get('usage_page')} usage={d.get('usage')} "
                f"vid={d.get('vid')} pid={d.get('pid')}  {d['nombre']}"
            )
        return 0

    usages = [(USAGE_PAGE_DIGITIZER, USAGE_TOUCHPAD)]
    if not args.solo_touchpad:
        usages.append((USAGE_PAGE_DIGITIZER, USAGE_USAGE_FINGER := USAGE_FINGER))

    with open(args.salida, "w", encoding="utf-8") as f:
        cap = Capturador(f, usages)
        cap.crear_ventana()
        cap.registrar()
        print(f"\n>>> TOCA EL PAD AHORA ({args.segundos or 'Ctrl+C'} s) <<<\n", flush=True)
        aviso_inicio()
        try:
            cap.bucle(args.segundos)
        except KeyboardInterrupt:
            pass
        aviso_fin()
        print(f"\ntotal informes: {cap.n_informes}  errores: {cap.errores}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
