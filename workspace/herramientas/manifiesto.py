"""Generates MANIFEST.json (and MANIFEST.md) by scanning codigo/*.py with AST.

Does not execute the code: it only reads signatures, docstrings and imports. Deterministic.
Usage: python herramientas/manifiesto.py
"""

import ast
import datetime
import json
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[1]
# Two engines: the reference numpy one and the native GPU one. Both go into the
# manifest; if only codigo/ went in, the agent would not know that motor_gpu exists and
# would rewrite it on every turn (which is exactly what this manifest avoids).
CAPETAS = [(RAIZ / "codigo", "codigo"), (RAIZ / "gpu", "gpu")]
JSON_OUT = RAIZ / "MANIFEST.json"
MD_OUT = RAIZ / "MANIFEST.md"

# Modules that make up the ENGINE. One-off scripts (sample_*.py, tests) do NOT go in:
# if they did, the gate would reject any new script that defined "main".
NUCLEO = {"dsp", "instruments", "render", "midi", "motor_gpu"}
# The WORKS (workspace/obras/<slug>/cancion.py, tema.py) are not the engine and do not go in:
# they are the data of a specific song, not reusable API.

# Entry-point names, not API: any script can define its own main().
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
            "These symbols ALREADY exist. Reuse them with 'from <module> import <symbol>'. "
            "Writing a new file that redefines them will be rejected (409)."
        ),
        "modulos": {},
    }

    # 1) who imports whom: it goes in if it is core or if another module imports it
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

    lineas = ["# Available engines: workspace/codigo/ (numpy) and workspace/gpu/ (torch)", ""]
    lineas.append("Reuse these symbols; do NOT redefine them.")
    lineas.append("")
    for nombre, mod in manifest["modulos"].items():
        if "error" in mod:
            lineas.append(f"- **{mod['archivo']}**  (DOES NOT PARSE: {mod['error']})")
            continue
        deps = ", ".join(sorted(set(mod["importa_de"]))) or "-"
        lineas.append(f"- **{mod['archivo']}**  (imports from: {deps})")
        for sym, info in mod["simbolos"].items():
            if info["tipo"] == "funcion":
                doc = f"  -- {info['doc']}" if info["doc"] else ""
                lineas.append(f"    - `{sym}{info['firma']}`{doc}")
            else:
                met = ", ".join(f"{k}{v}" for k, v in info["metodos"].items())
                lineas.append(f"    - class `{sym}`: {met}")
    MD_OUT.write_text("\n".join(lineas) + "\n", encoding="utf-8")

    total = sum(len(m.get("simbolos", {})) for m in manifest["modulos"].values())
    print(f"MANIFEST.json: {len(manifest['modulos'])} modules, {total} symbols")
    print(f"MANIFEST.md  : {MD_OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
