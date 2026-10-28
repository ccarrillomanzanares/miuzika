"""Caja para los scripts que escribe el agente (ejecutar_python, crear_sonido).

Uso (lo lanza server/api/python.ts):
    python -u server/python/caja.py <script.py> [argumentos...]

Variables que pone el servidor:
    MIUZIKA_ESCRIBIR   carpetas donde se puede escribir (os.pathsep entre ellas)
    MIUZIKA_REPO       raíz del repositorio
    MIUZIKA_WORKSPACE  workspace/ (lo único del repositorio que se puede leer)

Por qué (ESTADO 28-oct, pendiente 5): el Python del agente corría con los permisos
de Carlos y con todo el entorno del servidor. Un script equivocado podía borrar
fuera del proyecto, leer .env o .miuzika/proveedores.json (las claves), lanzar
procesos o sacar datos por la red.

Qué es y qué no: un guardarraíl con audit hooks (PEP 578). Frena los errores del
modelo, que llegan por las puertas normales (open, os.remove, subprocess, socket).
NO es una jaula del sistema operativo: un código escrito para escaparse puede
hacerlo (por ejemplo, con ctypes ya cargado por otra librería). Para eso haría
falta otro usuario de Windows o un contenedor.

Vive en server/ y no en workspace/ a propósito: el agente sólo escribe en workspace/,
así que no puede editar su propia caja.
"""

import atexit
import os
import runpy
import shutil
import sys
import tempfile


def _norm(ruta):
    # fsdecode: open() también acepta rutas en bytes, y commonpath no mezcla bytes y str.
    return os.path.normcase(os.path.realpath(os.fsdecode(os.fspath(ruta))))


def _dentro(ruta, raiz):
    try:
        return os.path.commonpath([ruta, raiz]) == raiz
    except ValueError:  # otra unidad en Windows
        return False


ESCRIBIBLES = [_norm(p) for p in os.environ.get("MIUZIKA_ESCRIBIR", "").split(os.pathsep) if p]
# El temp del script vive dentro del proyecto (y se borra al acabar): abrir el temp
# del sistema entero dejaba escribir en cualquier cosa que colgara de él.
TEMPORAL = os.path.join(ESCRIBIBLES[0] if ESCRIBIBLES else os.getcwd(), ".tmp-caja")
REPO = _norm(os.environ.get("MIUZIKA_REPO") or os.getcwd())
WORKSPACE = _norm(os.environ.get("MIUZIKA_WORKSPACE") or os.path.join(REPO, "workspace"))

_casa = os.path.expanduser("~")
SECRETOS = [
    _norm(os.path.join(_casa, nombre))
    for nombre in (
        ".ssh",
        ".aws",
        ".azure",
        ".gnupg",
        ".claude",
        ".config",
        ".docker",
        ".kube",
        ".git-credentials",
        ".netrc",
        os.path.join("AppData", "Roaming", "Microsoft", "Credentials"),
        os.path.join("AppData", "Roaming", "Mozilla"),
        os.path.join("AppData", "Local", "Google", "Chrome", "User Data"),
        os.path.join("AppData", "Local", "Microsoft", "Edge", "User Data"),
    )
]

AYUDA = "Los scripts del agente sólo escriben en la carpeta del proyecto y no tocan nada fuera de workspace/."


class Prohibido(PermissionError):
    pass


def _prohibir(motivo):
    raise Prohibido(f"miuzika: {motivo}. {AYUDA}")


def _leer_permitido(ruta):
    if _dentro(ruta, REPO) and not _dentro(ruta, WORKSPACE):
        return False  # .env, .miuzika/, server/, .git/…
    partes = ruta.split(os.sep)
    if ".miuzika" in partes or os.path.basename(ruta).startswith(".env"):
        return False
    return not any(_dentro(ruta, secreto) for secreto in SECRETOS)


def _escribir_permitido(ruta):
    return any(_dentro(ruta, raiz) for raiz in ESCRIBIBLES)


def _comprobar_escritura(objetivo, que):
    if isinstance(objetivo, int) or objetivo is None:
        return
    ruta = _norm(objetivo)
    if not _escribir_permitido(ruta):
        _prohibir(f"{que} {objetivo} está fuera de la carpeta del proyecto")


_ESCRIBE = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC
_PROCESOS = ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.startfile", "os.fork", "os.forkpty")
# Cosas que sólo se cierran cuando arranca el script: las librerías (numpy) usan
# ctypes al importarse, y se importan antes.
_SOLO_SCRIPT = ("ctypes.dlopen", "ctypes.dlsym", "ctypes.cdata")

_fase_script = False


def _vigilante(evento, args):
    if evento == "open":
        ruta, modo, flags = args
        if isinstance(ruta, int) or ruta is None:
            return
        escribe = (isinstance(modo, str) and any(c in modo for c in "wax+")) or bool((flags or 0) & _ESCRIBE)
        if escribe:
            _comprobar_escritura(ruta, "escribir")
        elif not _leer_permitido(_norm(ruta)):
            _prohibir(f"leer {ruta} no está permitido (claves o código de la app)")
    elif evento in ("os.remove", "os.rmdir", "os.mkdir", "os.truncate", "os.chmod", "os.utime", "shutil.rmtree"):
        _comprobar_escritura(args[0], "tocar")
    elif evento in ("os.rename", "os.link", "os.symlink", "shutil.copyfile", "shutil.move"):
        _comprobar_escritura(args[0], "mover")
        _comprobar_escritura(args[1], "mover a")
    elif evento.startswith(_PROCESOS):
        _prohibir("los scripts del agente no lanzan otros programas")
    elif evento in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
        _prohibir("los scripts del agente no abren conexiones de red (para la web están buscar_web y leer_web)")
    elif _fase_script and evento in _SOLO_SCRIPT:
        _prohibir("ctypes no está permitido en los scripts del agente")


def main():
    global _fase_script
    if len(sys.argv) < 2:
        raise SystemExit("uso: caja.py <script.py> [argumentos...]")
    script = os.path.abspath(sys.argv[1])
    sys.dont_write_bytecode = True  # los .pyc del motor caerían fuera del proyecto
    os.makedirs(TEMPORAL, exist_ok=True)
    for variable in ("TMP", "TEMP", "TMPDIR"):
        os.environ[variable] = TEMPORAL
    tempfile.tempdir = TEMPORAL
    atexit.register(shutil.rmtree, TEMPORAL, True)
    sys.addaudithook(_vigilante)
    # numpy carga sus DLL con ctypes al importarse: se importa antes de cerrar ctypes.
    try:
        import numpy  # noqa: F401
    except ImportError:
        pass
    _fase_script = True
    sys.argv = [script, *sys.argv[2:]]
    sys.path.insert(0, os.path.dirname(script))
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
