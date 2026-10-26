"""Genera MANIFEST.json (y MANIFEST.md) escaneando codigo/*.py con AST.

No ejecuta el codigo: solo lee firmas, docstrings e imports. Determinista.
Uso: python herramientas/manifiesto.py
"""

import ast
import datetime
import json
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[1]
# Dos motores: el numpy de referencia y el nativo de GPU. Los dos entran en el
# manifiesto; si solo entrara codigo/, el agente no sabria que motor_gpu existe y
# lo reescribiria en cada turno (que es justo lo que este manifiesto evita).
CAPETAS = [(RAIZ / "codigo", "codigo"), (RAIZ / "gpu", "gpu")]
JSON_OUT = RAIZ / "MANIFEST.json"
MD_OUT = RAIZ / "MANIFEST.md"

# Modulos que forman el MOTOR. Los scripts one-off (sample_*.py, pruebas) NO entran:
# si entraran, la puerta rechazaria cualquier script nuevo que definiera "main".
NUCLEO = {"dsp", "instruments", "render", "midi", "motor_gpu"}
# Las OBRAS (workspace/obras/<slug>/cancion.py, tema.py) no son motor y no entran:
# son los datos de una canción concreta, no API reutilizable.

# Nombres de entrada, no API: cualquier script puede definir su propio main().
IGNORAR = {"main", "run"}


def firma(fn: ast.AST) -> str:
    a = fn.args
    partes = []
    pos = list(a.posonlyargs) + list(a.args)
    defs = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
    for arg, d in zip(pos, defs):
        s = arg.arg
        if d is not None:
            s += "=" + ast.unparse(d)
        partes.append(s)
    if a.vararg:
        partes.append("*" + a.vararg.arg)
    elif a.kwonlyargs:
        partes.append("*")
    for arg, d in zip(a.kwonlyargs, a.kw_defaults):
        s = arg.arg
        if d is not None:
            s += "=" + ast.unparse(d)
        partes.append(s)
    if a.kwarg:
        partes.append("**" + a.kwarg.arg)
    return "(" + ", ".join(partes) + ")"


def primera_linea_doc(n: ast.AST) -> str:
    d = (ast.get_docstring(n) or "").strip()
    return d.splitlines()[0][:110] if d else ""


def main() -> None:
    manifest = {
        "generado": datetime.datetime.now().isoformat(timespec="seconds"),
        "raiz": "workspace/",
        "regla": (
            "Estos simbolos YA existen. Reutilizalos con 'from <modulo> import <simbolo>'. "
            "Escribir un fichero nuevo que los redefina sera rechazado (409)."
        ),
        "modulos": {},
    }

    # 1) quien importa a quien: entra si es nucleo o si otro modulo lo importa
    arboles: dict[str, ast.Module] = {}
    importados: set[str] = set()
    ficheros: list[tuple[pathlib.Path, str]] = []
    for carpeta, prefijo in CAPETAS:
        for p in sorted(carpeta.glob("*.py")):
            ficheros.append((p, prefijo))
            try:
                arboles[p.stem] = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            for n in ast.walk(arboles[p.stem]):
                if isinstance(n, ast.Import):
                    for alias in n.names:
                        importados.add(alias.name.split(".")[0])
                elif isinstance(n, ast.ImportFrom) and n.module:
                    importados.add(n.module.split(".")[0])

    for p, prefijo in ficheros:
        if p.stem not in NUCLEO and p.stem not in importados:
            continue
        tree = arboles.get(p.stem)
        if tree is None:
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError as exc:
                manifest["modulos"][p.stem] = {"archivo": f"{prefijo}/{p.name}", "error": str(exc)}
                continue
        mod = {"archivo": f"{prefijo}/{p.name}", "importa_de": [], "simbolos": {}}
        for n in tree.body:
            if isinstance(n, ast.ImportFrom) and n.module:
                mod["importa_de"].append(n.module)
            elif (
                isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and not n.name.startswith("_")
                and n.name not in IGNORAR
            ):
                mod["simbolos"][n.name] = {
                    "tipo": "funcion",
                    "firma": firma(n),
                    "doc": primera_linea_doc(n),
                }
            elif isinstance(n, ast.ClassDef) and not n.name.startswith("_"):
                metodos = {
                    m.name: firma(m)
                    for m in n.body
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and not m.name.startswith("_")
                }
                mod["simbolos"][n.name] = {"tipo": "clase", "doc": primera_linea_doc(n), "metodos": metodos}
        manifest["modulos"][p.stem] = mod

    JSON_OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    lineas = ["# Motores disponibles: workspace/codigo/ (numpy) y workspace/gpu/ (torch)", ""]
    lineas.append("Reutiliza estos simbolos; NO los redefinas.")
    lineas.append("")
    for nombre, mod in manifest["modulos"].items():
        if "error" in mod:
            lineas.append(f"- **{mod['archivo']}**  (NO PARSEA: {mod['error']})")
            continue
        deps = ", ".join(sorted(set(mod["importa_de"]))) or "-"
        lineas.append(f"- **{mod['archivo']}**  (importa de: {deps})")
        for sym, info in mod["simbolos"].items():
            if info["tipo"] == "funcion":
                doc = f"  -- {info['doc']}" if info["doc"] else ""
                lineas.append(f"    - `{sym}{info['firma']}`{doc}")
            else:
                met = ", ".join(f"{k}{v}" for k, v in info["metodos"].items())
                lineas.append(f"    - clase `{sym}`: {met}")
    MD_OUT.write_text("\n".join(lineas) + "\n", encoding="utf-8")

    total = sum(len(m.get("simbolos", {})) for m in manifest["modulos"].values())
    print(f"MANIFEST.json: {len(manifest['modulos'])} modulos, {total} simbolos")
    print(f"MANIFEST.md  : {MD_OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
