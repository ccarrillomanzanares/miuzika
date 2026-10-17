"""Convierte un .md a un HTML suelto, para leerlo en el panel de previsualizacion.

Uso: python scripts/md_a_html.py ESTADO.md [salida.html]
"""
from __future__ import annotations

import sys
from pathlib import Path

import markdown

PLANTILLA = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{titulo}</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{
    margin: 0 auto; max-width: 78ch; padding: 2.2rem 1.4rem 4rem;
    font: 16px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fdfdfd;
  }}
  @media (prefers-color-scheme: dark) {{
    body {{ color: #e6e6e6; background: #16181c; }}
    h1, h2, h3 {{ color: #fff; }}
    code {{ background: #24272e; }}
    pre {{ background: #1b1e24; border-color: #2e323a; }}
    th {{ background: #1f232a; }}
    th, td {{ border-color: #2e323a; }}
    hr {{ border-color: #2e323a; }}
    a {{ color: #7cb0ff; }}
  }}
  h1 {{ font-size: 1.9rem; margin: 0 0 .3rem; letter-spacing: -.02em; }}
  h2 {{ font-size: 1.28rem; margin: 2.4rem 0 .7rem; padding-bottom: .3rem;
        border-bottom: 1px solid #e2e2e2; }}
  h3 {{ font-size: 1.06rem; margin: 1.6rem 0 .5rem; }}
  p, li {{ margin: .5rem 0; }}
  code {{ background: #f1f1f3; padding: .12em .38em; border-radius: 4px;
          font: .88em ui-monospace, SFMono-Regular, Consolas, monospace; }}
  pre {{ background: #f6f6f8; border: 1px solid #e4e4e8; border-radius: 8px;
         padding: .85rem 1rem; overflow-x: auto; }}
  pre code {{ background: none; padding: 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .94rem; }}
  th, td {{ border: 1px solid #e4e4e8; padding: .45rem .6rem; text-align: left;
            vertical-align: top; }}
  th {{ background: #f6f6f8; font-weight: 600; }}
  hr {{ border: none; border-top: 1px solid #e4e4e8; margin: 2.2rem 0; }}
  blockquote {{ margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #d0d0d6; }}
  strong {{ font-weight: 650; }}
</style>
</head>
<body>
{cuerpo}
</body>
</html>
"""


def main() -> int:
    entrada = Path(sys.argv[1] if len(sys.argv) > 1 else "ESTADO.md")
    salida = Path(sys.argv[2]) if len(sys.argv) > 2 else entrada.with_suffix(".html")
    texto = entrada.read_text(encoding="utf-8")
    cuerpo = markdown.markdown(
        texto, extensions=["tables", "fenced_code", "sane_lists", "toc"])
    salida.write_text(
        PLANTILLA.format(titulo=entrada.stem, cuerpo=cuerpo), encoding="utf-8")
    print(f"{entrada} -> {salida}  ({len(cuerpo)} car. de HTML)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
