"""Sandbox for the scripts the agent writes (ejecutar_python, crear_sonido).

Usage (launched by server/api/python.ts):
    python -u server/python/caja.py <script.py> [arguments...]

Variables set by the server:
    MIUZIKA_ESCRIBIR   folders where writing is allowed (os.pathsep between them)
    MIUZIKA_REPO       repository root
    MIUZIKA_WORKSPACE  workspace/ (the only part of the repository that can be read)

Why (STATUS Oct 28, pending item 5): the agent's Python ran with Carlos's permissions
and the server's whole environment. A wrong script could delete things
outside the project, read .env or .miuzika/proveedores.json (the keys), launch
processes or leak data over the network.

What it is and what it is not: a guardrail with audit hooks (PEP 578). It stops the model's
mistakes, which arrive through the normal doors (open, os.remove, subprocess, socket).
It is NOT an operating-system jail: code written to escape can
do it (for example, with ctypes already loaded by another library). That would need
another Windows user or a container.

It lives in server/ and not in workspace/ on purpose: the agent only writes to workspace/,
so it cannot edit its own sandbox.
"""

import atexit
import os
import runpy
import shutil
import sys
import tempfile


def _norm(ruta):
    # fsdecode: open() also accepts byte paths, and commonpath does not mix bytes and str.
    return os.path.normcase(os.path.realpath(os.fsdecode(os.fspath(ruta))))


def _dentro(ruta, raiz):
    try:
        return os.path.commonpath([ruta, raiz]) == raiz
    except ValueError:  # another drive on Windows
        return False


ESCRIBIBLES = [_norm(p) for p in os.environ.get("MIUZIKA_ESCRIBIR", "").split(os.pathsep) if p]
# The script's temp lives inside the project (and is deleted when it finishes): opening the whole
# system temp allowed writing to anything hanging from it.
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

AYUDA = "Agent scripts only write inside the project folder and do not touch anything outside workspace/."


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
        _prohibir(f"{que} {objetivo} is outside the project folder")


_ESCRIBE = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC
_PROCESOS = ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.startfile", "os.fork", "os.forkpty")
# Things that are only closed once the script starts: libraries (numpy) use
# ctypes while being imported, and they are imported earlier.
_SOLO_SCRIPT = ("ctypes.dlopen", "ctypes.dlsym", "ctypes.cdata")

_fase_script = False


def _vigilante(evento, args):
    if evento == "open":
        ruta, modo, flags = args
        if isinstance(ruta, int) or ruta is None:
            return
        escribe = (isinstance(modo, str) and any(c in modo for c in "wax+")) or bool((flags or 0) & _ESCRIBE)
        if escribe:
            _comprobar_escritura(ruta, "write")
        elif not _leer_permitido(_norm(ruta)):
            _prohibir(f"reading {ruta} is not allowed (app keys or code)")
    elif evento in ("os.remove", "os.rmdir", "os.mkdir", "os.truncate", "os.chmod", "os.utime", "shutil.rmtree"):
        _comprobar_escritura(args[0], "touch")
    elif evento in ("os.rename", "os.link", "os.symlink", "shutil.copyfile", "shutil.move"):
        _comprobar_escritura(args[0], "move")
        _comprobar_escritura(args[1], "move to")
    elif evento.startswith(_PROCESOS):
        _prohibir("agent scripts do not launch other programs")
    elif evento in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
        _prohibir("agent scripts do not open network connections (for the web use buscar_web and leer_web)")
    elif _fase_script and evento in _SOLO_SCRIPT:
        _prohibir("ctypes is not allowed in agent scripts")


def main():
    global _fase_script
    if len(sys.argv) < 2:
        raise SystemExit("usage: caja.py <script.py> [arguments...]")
    script = os.path.abspath(sys.argv[1])
    sys.dont_write_bytecode = True  # engine .pyc files would end up outside the project
    os.makedirs(TEMPORAL, exist_ok=True)
    for variable in ("TMP", "TEMP", "TMPDIR"):
        os.environ[variable] = TEMPORAL
    tempfile.tempdir = TEMPORAL
    atexit.register(shutil.rmtree, TEMPORAL, True)
    sys.addaudithook(_vigilante)
    # numpy loads its DLLs with ctypes while importing: it is imported before closing ctypes.
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
