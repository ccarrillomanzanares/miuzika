"""Backend de captura para Windows: Raw Input API sobre un Precision Touchpad.

Se puede arrancar y parar en caliente (`iniciar()` / `parar()`), que es lo que
necesita la aplicacion para tener botones de encender y apagar la prueba.

El layout de los informes esta verificado contra el HID report descriptor de un
ELAN0712: ver spikes/001-touchpad-win32/README.md.

Solo Windows. En otro sistema operativo, este modulo no debe importarse.
"""

from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes

from modelo import X_MAX, Y_MAX

WM_INPUT = 0x00FF
WM_HOTKEY = 0x0312
WM_CLOSE = 0x0010
RID_INPUT = 0x10000003
RIM_TYPEHID = 2
RIDEV_INPUTSINK = 0x00000100
USAGE_PAGE_DIGITIZER = 0x0D
USAGE_TOUCHPAD = 0x05
WH_MOUSE_LL = 14
WM_MOUSEMOVE = 0x0200
ERROR_CLASS_ALREADY_EXISTS = 1410

# Ctrl+Alt+T alterna congelar el cursor (si el cursor esta congelado, no hay
# otra forma de pulsar un boton de la pagina).
HOTKEY_ID = 1
MOD_ALT, MOD_CONTROL = 0x0001, 0x0002

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT), ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON), ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH), ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", wintypes.HICON),
    ]


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [
        ("usUsagePage", wintypes.USHORT), ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD), ("hwndTarget", wintypes.HWND),
    ]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [
        ("dwType", wintypes.DWORD), ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE), ("wParam", wintypes.WPARAM),
    ]


class RAWHID(ctypes.Structure):
    _fields_ = [
        ("dwSizeHid", wintypes.DWORD), ("dwCount", wintypes.DWORD),
        ("bRawData", ctypes.c_ubyte * 1),
    ]


user32.GetRawInputData.argtypes = [
    wintypes.HANDLE, wintypes.UINT, ctypes.c_void_p,
    ctypes.POINTER(wintypes.UINT), wintypes.UINT]
user32.GetRawInputData.restype = wintypes.UINT
user32.DefWindowProcW.argtypes = [
    wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.PeekMessageW.argtypes = [
    ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT,
    wintypes.UINT]
user32.PeekMessageW.restype = wintypes.BOOL
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.RegisterClassExW.argtypes = [ctypes.c_void_p]
user32.RegisterClassExW.restype = wintypes.WORD
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
    wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p]
user32.CreateWindowExW.restype = wintypes.HWND
user32.RegisterRawInputDevices.argtypes = [
    ctypes.POINTER(RAWINPUTDEVICE), wintypes.UINT, wintypes.UINT]
user32.RegisterRawInputDevices.restype = wintypes.BOOL
user32.SetWindowsHookExW.argtypes = [
    ctypes.c_int, ctypes.c_void_p, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HANDLE
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT,
                                  wintypes.UINT]
user32.RegisterHotKey.restype = wintypes.BOOL
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                wintypes.LPARAM]
user32.PostMessageW.restype = wintypes.BOOL


def decodificar_informe(datos: bytes) -> dict:
    """Un informe del Touch Pad (report ID 4) -> campos con nombre."""
    return {
        "report_id": datos[0],
        "confianza": bool(datos[1] & 0x01),
        "tip": bool(datos[1] & 0x02),
        "id": datos[1] >> 4,
        "x": int.from_bytes(datos[2:4], "little"),
        "y": int.from_bytes(datos[4:6], "little"),
        "scan": int.from_bytes(datos[6:8], "little"),
        "count": datos[8],
        "boton": bool(datos[9] & 0x01),
    }


NOMBRE_CLASE = "HumseedTouchpad"

# La clase de ventana se registra UNA vez por proceso y su WNDPROC vive en el
# modulo para siempre. Si se registrara por captura, al parar y volver a
# arrancar la clase seguiria apuntando al callback ya liberado y Windows se
# llevaria por delante el proceso con un access violation al crear la ventana.
_PROC_GLOBAL = None
_CLASE_REGISTRADA = False
_INSTANCIA: "CapturaWin32 | None" = None


def _wndproc_global(hwnd, msg, wparam, lparam):
    instancia = _INSTANCIA
    if instancia is not None:
        return instancia._wndproc(hwnd, msg, wparam, lparam)
    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


def _registrar_clase() -> bool:
    global _PROC_GLOBAL, _CLASE_REGISTRADA
    if _CLASE_REGISTRADA:
        return True
    _PROC_GLOBAL = WNDPROC(_wndproc_global)
    clase = WNDCLASSEXW()
    clase.cbSize = ctypes.sizeof(WNDCLASSEXW)
    clase.lpfnWndProc = _PROC_GLOBAL
    clase.hInstance = kernel32.GetModuleHandleW(None)
    clase.lpszClassName = NOMBRE_CLASE
    if not user32.RegisterClassExW(ctypes.byref(clase)):
        if ctypes.get_last_error() != ERROR_CLASS_ALREADY_EXISTS:
            return False
    _CLASE_REGISTRADA = True
    return True


class CapturaWin32:
    """Lee el Precision Touchpad en un hilo propio, arrancable y pararable."""

    def __init__(self, al_informe, al_latido=None, al_aviso=None):
        self.al_informe = al_informe
        self.al_latido = al_latido or (lambda: None)
        self.al_aviso = al_aviso or (lambda msg: None)
        self.n_informes = 0
        self.n_errores = 0
        self.ultimo_informe_t = 0.0
        self.tasa = 0.0  # informes por segundo (medido cada segundo)
        # Mientras haya un dedo en el pad, el puntero se congela: el touchpad
        # nunca arrastra el cursor fuera de la aplicacion. El raton USB queda
        # libre en cuanto se levanta el dedo.
        self.bloquear_cursor = True
        self.hotkey_ok = False
        self._contactos: set[int] = set()
        self._ultimo_tip_t = 0.0
        self.hwnd = None
        self._hook = None
        self._hook_proc = None
        self._proc = None
        self._hilo: threading.Thread | None = None
        self._parar = threading.Event()
        self._lock = threading.Lock()
        self._ventana_lista = threading.Event()
        self._t0 = 0.0
        self._informes_ultimo_segundo = 0

    # -- API publica ------------------------------------------------------
    @property
    def en_marcha(self) -> bool:
        return bool(self._hilo and self._hilo.is_alive())

    def iniciar(self) -> bool:
        with self._lock:
            if self.en_marcha:
                return False
            self.n_informes = 0
            self.n_errores = 0
            self.tasa = 0.0
            self._parar.clear()
            self._ventana_lista.clear()
            self._t0 = time.perf_counter()
            self._informes_ultimo_segundo = 0
            self._hilo = threading.Thread(target=self._bucle, name="captura", daemon=True)
            self._hilo.start()
        self._ventana_lista.wait(timeout=3)
        return self.en_marcha

    def parar(self) -> bool:
        with self._lock:
            if not self.en_marcha:
                return False
            self._parar.set()
            if self.hwnd:
                user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
            hilo = self._hilo
        if hilo:
            hilo.join(timeout=3)
        return not self.en_marcha

    def alternar_bloquear_cursor(self) -> bool:
        """El gancho siempre se pone y se quita desde el bucle de captura (es el
        unico hilo con bucle de mensajes); aqui solo se cambia la intencion."""
        self.bloquear_cursor = not self.bloquear_cursor
        self.al_aviso(
            f"el pad {'NO mueve' if self.bloquear_cursor else 'SI mueve'} el cursor")
        return self.bloquear_cursor

    def estado(self) -> dict:
        return {
            "en_marcha": self.en_marcha,
            "informes": self.n_informes,
            "errores": self.n_errores,
            "tasa": round(self.tasa, 1),
            "bloquear_cursor": self.bloquear_cursor,
            "cursor_bloqueado": self._hook is not None,
            "dedos": len(self._contactos),
            "hotkey": self.hotkey_ok,
        }

    # -- hilo de captura --------------------------------------------------
    def _bucle(self):
        global _INSTANCIA
        hinst = kernel32.GetModuleHandleW(None)
        if not _registrar_clase():
            self.al_aviso(f"RegisterClassExW fallo: {ctypes.get_last_error()}")
            return
        _INSTANCIA = self
        self.al_aviso("paso: clase registrada, creando ventana")
        self.hwnd = user32.CreateWindowExW(
            0, NOMBRE_CLASE, "cliente", 0, 0, 0, 0, 0, None, None, hinst, None)
        if not self.hwnd:
            self.al_aviso(f"CreateWindowExW fallo: {ctypes.get_last_error()}")
            _INSTANCIA = None
            return

        self.al_aviso(f"paso: ventana {self.hwnd}, registrando raw input")
        rd = RAWINPUTDEVICE(USAGE_PAGE_DIGITIZER, USAGE_TOUCHPAD, RIDEV_INPUTSINK,
                            self.hwnd)
        if not user32.RegisterRawInputDevices(
                ctypes.byref(rd), 1, ctypes.sizeof(RAWINPUTDEVICE)):
            self.al_aviso(
                f"registro del touchpad fallo: {ctypes.WinError(ctypes.get_last_error())} "
                "(¿no es un Precision Touchpad?)")
            return

        self.al_aviso("paso: raw input OK, registrando tecla")
        self.hotkey_ok = bool(user32.RegisterHotKey(
            self.hwnd, HOTKEY_ID, MOD_ALT | MOD_CONTROL, ord("T")))
        self._ventana_lista.set()
        self.al_aviso("captura en marcha")

        msg = wintypes.MSG()
        ultimo_latido = 0.0
        ultimo_segundo = time.perf_counter()
        while not self._parar.is_set():
            if user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            else:
                time.sleep(0.002)
            ahora = time.perf_counter()
            if ahora - ultimo_latido > 0.02:
                ultimo_latido = ahora
                self._ajustar_bloqueo_cursor(ahora)
                self.al_latido()
            if ahora - ultimo_segundo >= 1.0:
                self.tasa = (self.n_informes - self._informes_ultimo_segundo) / (
                    ahora - ultimo_segundo)
                self._informes_ultimo_segundo = self.n_informes
                ultimo_segundo = ahora

        if self._hook is not None:
            user32.UnhookWindowsHookEx(self._hook)
            self._hook = None
        user32.UnregisterHotKey(self.hwnd, HOTKEY_ID)
        user32.DestroyWindow(self.hwnd)
        self.hwnd = None
        _INSTANCIA = None
        self.al_aviso("captura parada")

    def _ajustar_bloqueo_cursor(self, ahora: float):
        """Con un dedo apoyado, el puntero no se mueve; al levantar, se suelta."""
        quiere = self.bloquear_cursor and bool(self._contactos)
        if quiere and self._hook is None:
            self._instalar_hook()
        elif (not quiere and self._hook is not None
              and ahora - self._ultimo_tip_t > 0.12):
            user32.UnhookWindowsHookEx(self._hook)
            self._hook = None
            self.al_aviso("cursor suelto")

    def _instalar_hook(self):
        def proc(ncode, wparam, lparam):
            if ncode >= 0 and wparam == WM_MOUSEMOVE:
                return 1  # tragarse el movimiento del puntero
            return user32.CallNextHookEx(None, ncode, wparam, lparam)

        self._hook_proc = ctypes.WINFUNCTYPE(
            ctypes.c_ssize_t, ctypes.c_int, ctypes.c_ulonglong, ctypes.c_longlong)(proc)
        self._hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._hook_proc, 0, 0)
        self.al_aviso("hook de raton instalado" if self._hook else "hook de raton fallo")

    def _wndproc(self, hwnd, msg, wparam, lparam):
        if msg == WM_INPUT:
            try:
                self._procesar(lparam)
            except Exception as exc:
                self.n_errores += 1
                if self.n_errores <= 5:
                    self.al_aviso(f"error procesando informe: {exc!r}")
            return 0
        if msg == WM_HOTKEY and wparam == HOTKEY_ID:
            self.alternar_bloquear_cursor()
            return 0
        if msg == WM_CLOSE:
            user32.DestroyWindow(hwnd)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _procesar(self, lparam):
        tam = wintypes.UINT(0)
        user32.GetRawInputData(lparam, RID_INPUT, None, ctypes.byref(tam),
                               ctypes.sizeof(RAWINPUTHEADER))
        if not tam.value:
            return
        buf = ctypes.create_string_buffer(tam.value)
        if user32.GetRawInputData(lparam, RID_INPUT, buf, ctypes.byref(tam),
                                  ctypes.sizeof(RAWINPUTHEADER)) == 0xFFFFFFFF:
            return
        cab = ctypes.cast(buf, ctypes.POINTER(RAWINPUTHEADER)).contents
        if cab.dwType != RIM_TYPEHID:
            return
        rawhid = ctypes.cast(
            ctypes.addressof(buf) + ctypes.sizeof(RAWINPUTHEADER),
            ctypes.POINTER(RAWHID)).contents
        n = rawhid.dwSizeHid * rawhid.dwCount
        datos = ctypes.string_at(
            ctypes.addressof(rawhid) + RAWHID.bRawData.offset, n)
        if len(datos) < 10 or datos[0] != 4:
            return

        self.n_informes += 1
        self.ultimo_informe_t = time.perf_counter()
        inf = decodificar_informe(datos)
        if inf["tip"]:
            self._contactos.add(inf["id"])
            self._ultimo_tip_t = self.ultimo_informe_t
        else:
            self._contactos.discard(inf["id"])
        self.al_informe(
            inf["id"],
            min(1.0, inf["x"] / X_MAX),
            min(1.0, inf["y"] / Y_MAX),
            inf["tip"],
            inf["boton"],
        )
