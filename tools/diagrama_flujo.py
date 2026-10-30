#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generates docs/flujo-aplicacion.html: two flowcharts with lanes.

None of this runs in the app: it is a documentation generator. It draws SVG from
lists of nodes so that coordinates are not invented by hand.
"""
import html
import os

W = 980                 # canvas width
CALLE_W = 214           # width of each lane (recomputed per flow)
GAP = 16
X0 = 16
ALTO_CAB = 30
FUENTE = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"

def repartir(n_calles, margen=16):
    """Distributes the canvas width among however many lanes there are.

    A larger `margen` leaves room for the loop drawn on the left side.
    """
    global CALLE_W, CENTRO, X0
    X0 = margen
    CALLE_W = (W - 2 * X0 - (n_calles - 1) * GAP) / n_calles
    CENTRO = [calle_x(i) + CALLE_W / 2 for i in range(n_calles)]


def calle_x(i):
    return X0 + i * (CALLE_W + GAP)

CENTRO = [calle_x(i) + CALLE_W / 2 for i in range(4)]

# arrow marker id; changes per SVG so ids are not duplicated in the document
MARCA = ["flecha"]


def envolver(texto, maximo):
    palabras, lineas, actual = texto.split(), [], ""
    for p in palabras:
        if not actual:
            actual = p
        elif len(actual) + 1 + len(p) <= maximo:
            actual += " " + p
        else:
            lineas.append(actual)
            actual = p
    if actual:
        lineas.append(actual)
    return lineas


def nodo(nid, calle, tipo, titulo, sub, y, *, alto_extra=0, no=None, no_y=None):
    """A diagram node. tipo: proceso | decision | datos | extremo.

    The "no" branch of a decision is written INSIDE the shape: a side arrow
    ran into the next lane and looked as if it went to another actor.
    """
    # the diamond narrows at the sides: its text has to be shorter than a
    # box's, or it spills out through the corners
    # ~5.1 px per character at 9.4 px: the limit comes from the available width. The oval
    # rounds the corners and the parallelogram is slanted: both lose width.
    util = CALLE_W - {"extremo": 58, "datos": 34}.get(tipo, 16)
    max_sub = max(14, int(util / 5.45))
    max_tit = max(14, int(max_sub * (0.72 if tipo == "decision" else 0.86)))
    ancho_titulo = max_tit if tipo != "decision" else max(14, int(max_sub * 0.7))
    ancho_sub = max_sub if tipo != "decision" else max(14, int(max_sub * 0.78))
    tl = envolver(titulo, ancho_titulo)
    sl = envolver(sub, ancho_sub) if sub else []
    al = envolver("no: " + no, ancho_sub) if no else []
    extra = {"decision": 20, "extremo": 22}.get(tipo, 8)
    alto = 12 + 13 * len(tl) + 10 * len(sl) + (10 * len(al) if al else 0) + extra
    return {
        "id": nid, "calle": calle, "tipo": tipo, "titulo": titulo, "sub": sub,
        "y": y, "alto": alto, "tl": tl, "sl": sl, "al": al, "no": no, "no_y": no_y,
    }


def dibujar_nodo(n, idx):
    x = calle_x(n["calle"])
    y = n["y"]
    h = n["alto"]
    cx = x + CALLE_W / 2
    clase = {"proceso": "p", "decision": "d", "datos": "b", "extremo": "e"}[n["tipo"]]
    if n["tipo"] == "decision":
        # diamond: 8 px margin inside the lane
        m = 10
        pts = f"{cx},{y} {x + CALLE_W - m},{y + h / 2} {cx},{y + h} {x + m},{y + h / 2}"
        forma = f'<polygon class="forma d" points="{pts}"/>'
    elif n["tipo"] == "extremo":
        r = h / 2
        forma = f'<rect class="forma e" x="{x + 14}" y="{y}" width="{CALLE_W - 28}" height="{h}" rx="{r}"/>'
    elif n["tipo"] == "datos":
        d = 12
        pts = (f"{x + d},{y} {x + CALLE_W},{y} {x + CALLE_W - d},{y + h} {x},{y + h}")
        forma = f'<polygon class="forma b" points="{pts}"/>'
    else:
        forma = f'<rect class="forma" x="{x}" y="{y}" width="{CALLE_W}" height="{h}" rx="7"/>'

    yt = y + 15
    textos = f'<text class="t" x="{cx}" y="{yt}" text-anchor="middle">'
    for i, l in enumerate(n["tl"]):
        textos += f'<tspan x="{cx}" dy="{0 if i == 0 else 12}">{html.escape(l)}</tspan>'
    textos += "</text>"
    ys = yt + 13 * (len(n["tl"]) - 1) + 14
    textos += f'<text class="s" x="{cx}" y="{ys}" text-anchor="middle">'
    for i, l in enumerate(n["sl"]):
        textos += f'<tspan x="{cx}" dy="{0 if i == 0 else 10}">{html.escape(l)}</tspan>'
    textos += "</text>"
    # "no" branch, inside the shape
    if n.get("al"):
        yn = ys + 12 * len(n["sl"]) + 2 if n["sl"] else ys + 12
        textos += f'<text class="sn" x="{cx}" y="{yn}" text-anchor="middle">'
        for i, l in enumerate(n["al"]):
            textos += f'<tspan x="{cx}" dy="{0 if i == 0 else 10}">{html.escape(l)}</tspan>'
        textos += "</text>"
    # step number
    num = f'<text class="n" x="{x + 9}" y="{y + 12}">{idx}</text>'
    return forma + textos + num


def dibujar_conector(a, b, clase="f", etiqueta=None):
    ax = calle_x(a["calle"]) + CALLE_W / 2
    ay = a["y"] + a["alto"]
    bx = calle_x(b["calle"]) + CALLE_W / 2
    by = b["y"]
    if abs(ax - bx) < 1:
        d = f"M {ax} {ay} V {by - 2}"
    else:
        # the elbow goes to the middle of the actual gap: with a fixed cap, two nodes almost at
        # the same height left the arrow passing below the destination
        medio = ay + (by - ay) / 2
        d = f"M {ax} {ay} V {medio} H {bx} V {by - 2}"
    etq = ""
    if etiqueta:
        etq = f'<text class="etq" x="{ax + 4}" y="{ay + 11}">{html.escape(etiqueta)}</text>'
    return f'<path class="{clase}" d="{d}" marker-end="url(#{MARCA[0]})"/>' + etq


def dibujar_flujo(titulo, subtitulo, calles, nodos, notas):
    """Returns the complete SVG and the detail table."""
    alto = (nodos[-1]["y"] + nodos[-1]["alto"] + 26) if nodos else 200
    partes = [
        f'<svg class="diag" viewBox="0 0 {W} {alto}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" '
        f'aria-label="{html.escape(titulo)}">',
        f'<defs><marker id="{MARCA[0]}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 z" fill="var(--doc-muted)"/></marker></defs>',
    ]
    # lanes
    for i, nombre in enumerate(calles):
        x = calle_x(i)
        partes.append(
            f'<rect class="calle" x="{x}" y="{ALTO_CAB}" width="{CALLE_W}" height="{alto - ALTO_CAB}" rx="8"/>'
        )
        partes.append(f'<text class="cc" x="{x + CALLE_W / 2}" y="{ALTO_CAB - 10}" text-anchor="middle">{html.escape(nombre)}</text>')
    # connectors first (not below the boxes: they go in between, SVG respects the order)
    for i in range(len(nodos) - 1):
        partes.append(dibujar_conector(nodos[i], nodos[i + 1]))
    for i, n in enumerate(nodos, start=1):
        partes.append(dibujar_nodo(n, i))
    partes.append("</svg>")

    filas = "".join(
        f'<tr><td>{i}</td><td><code>{html.escape(n["titulo"])}</code></td>'
        f'<td>{html.escape(n["sub"])}</td><td>{html.escape(notas.get(n["id"], ""))}</td></tr>'
        for i, n in enumerate(nodos, start=1)
    )
    tabla = (
        '<table><thead><tr><th>#</th><th>step</th><th>what it does exactly</th>'
        f'<th>if it fails / branch</th></tr></thead><tbody>{filas}</tbody></table>'
    )
    return "".join(partes), tabla


def dibujar_bucle(desde, hasta, etiqueta):
    """Loop return along the left margin (the turn's loop)."""
    yd = desde["y"] + desde["alto"] / 2
    yh = hasta["y"] + hasta["alto"] / 2
    xd = calle_x(desde["calle"])
    xh = calle_x(hasta["calle"])
    carril = X0 / 2
    d = f"M {xd} {yd} H {carril} V {yh} H {xh - 2}"
    medio = (yd + yh) / 2
    # The label goes horizontally over lane 0, which is empty in that stretch:
    # rotated against the margin it was cut off and unreadable.
    x_etq = calle_x(0) + 6
    texto = (
        f'<text class="etq" x="{x_etq}" y="{medio}">{html.escape(etiqueta)}</text>'
        f'<text class="etq2" x="{x_etq}" y="{medio + 11}">back to the model call</text>'
    )
    return f'<path class="f bucle" d="{d}" marker-end="url(#{MARCA[0]})"/>' + texto


# ====================================================================== data
CALLE_NAV, CALLE_SRV, CALLE_PY = 1, 2, 3
PERSONA = 0


def construir(calles, pasos):
    """pasos: (lane, type, title, sub, no) -> list of nodes with computed y."""
    nodos, y = [], ALTO_CAB + 26
    for calle, tipo, titulo, sub, no in pasos:
        n = nodo(len(nodos) + 1, calle, tipo, titulo, sub, y, no=no)
        nodos.append(n)
        y += n["alto"] + (62 if tipo == "decision" else 42)
    return nodos


FLUJO1 = [
    (PERSONA, "extremo", "You open localhost:5173", "Chrome. The app only listens on [::1]", None),
    (CALLE_SRV, "proceso", "Vite serves web/ and mounts /api/*", "25 endpoints · COOP/COEP · /api/llm proxy", None),
    (CALLE_NAV, "proceso", "boot()", "migrates an old project from localStorage · empty canvas · prompt with manifest", None),
    (CALLE_NAV, "decision", "does any project open by itself?", "product decision: no", "nothing open"),
    (PERSONA, "proceso", "presses “Proyectos”", "or drags a WAV / asks the agent for a piece", None),
    (CALLE_SRV, "datos", "GET /api/proyectos", "lists folders with proyecto.json: name, BPM, bars, tracks, guardadoEn, bytes", None),
    (PERSONA, "proceso", "chooses one", "dialog with date and size", None),
    (CALLE_SRV, "datos", "GET /api/proyectos?path=", "whole master (without the 20 KB cut; 64 MB cap)", None),
    (CALLE_NAV, "decision", "is the JSON from miuzika?", "formato + schemaVersion 1", "warning, it is not opened"),
    (CALLE_NAV, "proceso", "interpretarProyectoEnDisco()", "→ Project in memory; each asset keeps its relative path", None),
    (CALLE_NAV, "proceso", "hidratarAssets()", "4 assets at a time; for each one it requests /api/picos (cache by mtime)", None),
    (CALLE_SRV, "proceso", "/api/picos + /api/audio", "peaks computed with a Python process; the WAV is served with Range", None),
    (CALLE_NAV, "decision", "does the WAV last more than 30 s?", "≤30 s is decoded", "Range streaming"),
    (CALLE_NAV, "proceso", "projectToOpenDaw()", "IR in beats → pulses (960/quarter); .sf2 through its own manager, not the library's", None),
    (CALLE_NAV, "proceso", "▶ play", "engine.position/960 → onTick: playhead + synchronized stems (corrects drift >120 ms)", None),
    (CALLE_NAV, "decision", "beat ≥ end of project?", "lengthBars × bar", "stop()"),
    (CALLE_NAV, "proceso", "edit", "drag/move/delete clip, mute, solo, piano roll → transactional applyOps()", None),
    (CALLE_NAV, "proceso", "autosave · 1.5 s", "programarGuardado() after the last change; Ctrl+S forces it", None),
    (CALLE_SRV, "datos", "POST /api/proyectos", "validates {formato, schemaVersion:1} before writing; guardadoEn reveals who", None),
    (CALLE_SRV, "extremo", "project on disk", "what sounds is what is in the folder", None),
]

FLUJO2 = [
    (PERSONA, "extremo", "you type and press Enter", "chat.ts → onSend → responderAlUsuario()", None),
    (CALLE_NAV, "decision", "is a turn in progress?", "only one turn at a time", "yes: warning, it does not start"),
    (CALLE_SRV, "proceso", "GET /api/manifiesto", "regenerates signatures with ast: 8,949 characters, 7 modules", None),
    (CALLE_NAV, "proceso", "system prompt", "literal with fingerprint + folder + manifest + agente.json (11,939 chars)", None),
    (CALLE_NAV, "proceso", "POST /api/llm (SSE)", "180 s cap · 32,768 tokens · progress every 700 ms", None),
    (CALLE_SRV, "proceso", "proxy + key from .env", "the key does not enter the client bundle", None),
    (CALLE_NAV, "decision", "finish_reason?", "load · sin_salida · empty · stop", "all three are retried"),
    (CALLE_NAV, "decision", "does it request tools?", "tool_calls in order", "no: final answer"),
    (CALLE_NAV, "proceso", "ejecutarHerramienta()", "17 tools · own timeout · turn's AbortSignal", None),
    (CALLE_NAV, "decision", "does the tool touch the project?", "7 of the 17", "no: to the server"),
    (CALLE_NAV, "proceso", "op in the tab", "enters the history, undone with Ctrl+Z, the tab is the only one that writes the master", None),
    (CALLE_SRV, "proceso", "gates", "409 if it redefines the engine or is patch*.py · 413 if >8 MB · 409 if numpy on Lambda", None),
    (CALLE_SRV, "proceso", "run/python | run/lambda", "cwd = project folder · PYTHONPATH = codigo/ · GPU: scp + ssh", None),
    (CALLE_PY, "proceso", "runs and writes salida/", "returns escritos: only what changed in the project", None),
    (CALLE_NAV, "proceso", "result → model", ">4,000 characters: head + tail and the rest to _salidas/", None),
    (CALLE_NAV, "decision", "are there steps left?", "maximum 12", "cuts the turn"),
    (CALLE_NAV, "proceso", "final answer", "bubble in the chat + meta line (steps, tools, ms, model)", None),
    (CALLE_NAV, "datos", "agregarTurno() → agente.json", "8 full turns + rolling summary of 1,800 characters", None),
    (CALLE_NAV, "extremo", "turn closed", "the disk is the memory; the next request reads it from there", None),
]

NOTAS1 = {
    1: "Without a dev server there is no app: /api/* are Vite middlewares.",
    2: "If Vite restarts, the tab keeps the old bundle; /api/build warns about it and offers to reload.",
    3: "Migrates an old project from localStorage and opens nothing by itself: the empty canvas explains it.",
    4: "It used to open the last project and replace what you were looking at (on an empty one, it looked like a bug).",
    5: "You can also ask the agent for a piece, with its 17 tools.",
    6: "It only lists folders that have proyecto.json; the others do not exist for the app.",
    7: "Shows the date, the master's size and the number of tracks before opening.",
    8: "400 if the format is not miuzika-proyecto or schemaVersion is not 1.",
    9: "A hand-exported .json also works (standalone Project).",
    10: "Each asset keeps its path relative to the project folder.",
    11: "Four at a time. Without a path: “missing N WAVs” and those tracks sound empty.",
    12: "First cold opening: 16.8 s with 21 tracks / 11 WAVs. With the cache: 0.5 s.",
    13: "Above 30 s it is never decoded: 10 stems of 6 min take 20 MB, not 1.3 GB.",
    14: "The WASM engine is installed once per page; Playfield uses /drums/*.wav.",
    15: "A synthetic click does not start the audio: the AudioContext needs a user gesture.",
    16: "The end is decided by lengthBars, not by how long the last file lasts.",
    17: "Everything goes through applyOps(): transactional, with an 8-step history.",
    18: "1.5 s after the last change; Ctrl+S writes it immediately and counts it in the chat.",
    19: "If ready=false it is not saved and the canvas stays blank: it is diagnosed by reading the file.",
    20: "What sounds is exactly what is in the folder.",
}

NOTAS2 = {
    1: "The chat starts empty: its memory is agente.json, from the project.",
    2: "Only one turn at a time; the heartbeat displays “thinking · N s · N tokens”.",
    3: "If /api/manifiesto fails, the turn continues with the basic prompt.",
    4: "It goes from 2,890 to 11,939 characters: literal + folder + manifest + memory.",
    5: "load = provider loading (0 tokens in 250 ms), not a lack of context.",
    6: "The key lives in the .env and never enters the client bundle.",
    7: "sin_salida repeats without reasoning; empty: 5 retries (1-2-4-8-16 s) + 1 resumption.",
    8: "If it does not request any tool, that response is the turn's final one.",
    9: "One by one, in order, with its own timeout and the turn's AbortSignal.",
    10: "The 7 that change the project do it in the tab: it owns the master.",
    11: "Enters the history, is undone with Ctrl+Z and saves itself.",
    12: "Smoke imports the engine and renders a kick: if it fails, the change is reverted.",
    13: "Without an explicit destination the panel selector is used; the 409 avoids paying for GPU at CPU speed.",
    14: "Writing in codigo/ regenerates the manifest with ast, without executing anything.",
    15: "Above 4,000 characters: head + tail and the rest to _salidas/.",
    16: "Cuts: 3 identical failures · 3 writes without running · 12 steps.",
    17: "Bubble + meta line: steps, tools, time and model.",
    18: "8 full turns and a rolling summary of 1,800 characters.",
    19: "The disk is the project's memory: the next request reads it from there.",
}


CSS = """
  /* Own palette, with a --doc- prefix: this file is opened by double click, without the
     app's theme. With plain var(--doc-card), outside Hermes the fill is invalid and
     the boxes came out BLACK with the text black inside. */
  :root{
    --doc-bg:#0c0e13; --doc-fg:#e6e8ee; --doc-muted:#8b91a1;
    --doc-accent:#ff5f6d; --doc-border:#2a2f3d; --doc-card:#141822;
    color-scheme:dark;
  }
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--doc-bg)}
  body{font-family:__FUENTE__;color:var(--doc-fg);font-size:13px;line-height:1.45;padding:18px 20px 28px}
  .wrap{width:100%;max-width:1040px;display:flex;flex-direction:column;gap:26px}
  h1{font-size:15px;font-weight:650;margin:0}
  h2{font-size:12px;font-weight:600;margin:0;text-transform:uppercase;letter-spacing:.08em;color:var(--doc-muted)}
  .lead{font-size:11.5px;color:var(--doc-muted);margin:2px 0 0}

  .diag{display:block;width:100%;height:auto;margin:10px 0 14px;overflow:visible}
  .calle{fill:color-mix(in oklab, var(--doc-card) 46%, transparent);stroke:var(--doc-border);stroke-width:1}
  .cc{fill:var(--doc-muted);font-size:9.5px;letter-spacing:.10em;text-transform:uppercase;font-weight:600}
  .forma{fill:color-mix(in oklab, var(--doc-card) 92%, transparent);stroke:var(--doc-border);stroke-width:1.2}
  .forma.e{fill:color-mix(in oklab, var(--doc-accent) 12%, var(--doc-card));stroke:color-mix(in oklab, var(--doc-accent) 55%, var(--doc-border))}
  .forma.d{fill:color-mix(in oklab, #e5c07b 10%, var(--doc-card));stroke:color-mix(in oklab, #e5c07b 45%, var(--doc-border))}
  .forma.b{fill:color-mix(in oklab, #61afef 9%, var(--doc-card));stroke:color-mix(in oklab, #61afef 40%, var(--doc-border));stroke-dasharray:4 2}
  .t{fill:var(--doc-fg);font-size:10.5px;font-weight:600}
  .s{fill:var(--doc-muted);font-size:9.4px}
  .sn{fill:color-mix(in oklab, var(--doc-accent) 78%, var(--doc-fg));font-size:8.5px;font-weight:600}
  .n{fill:var(--doc-muted);font-size:8px;font-family:__MONO__}
  .f{fill:none;stroke:var(--doc-muted);stroke-width:1.1;opacity:.85}
  .f.bucle{stroke-dasharray:5 3;opacity:.7}
  .etq{fill:var(--doc-muted);font-size:8.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .etq2{fill:var(--doc-muted);font-size:8px;opacity:.8}

  table{border-collapse:collapse;width:100%;font-size:10.8px;margin-top:6px}
  th{text-align:left;font-weight:600;color:var(--doc-muted);font-size:9.5px;text-transform:uppercase;
     letter-spacing:.06em;padding:0 10px 5px 0;border-bottom:1px solid var(--doc-border)}
  td{padding:5px 10px 5px 0;border-bottom:1px solid color-mix(in oklab,var(--doc-border) 50%,transparent);vertical-align:top}
  td:first-child{color:var(--doc-muted);font-family:__MONO__;font-size:9.5px;width:22px}
  td:nth-child(2){width:190px}
  td:nth-child(2) code{font-family:__MONO__;font-size:10px;color:var(--doc-fg)}
  td:nth-child(3){width:300px}
  td:nth-child(4){color:var(--doc-muted)}

  .leyenda{display:flex;gap:18px;flex-wrap:wrap;font-size:10px;color:var(--doc-muted);align-items:center}
  .leyenda b{font-weight:600;color:var(--doc-fg)}
  .muestra{display:inline-flex;align-items:center;gap:6px}
  .muestra i{display:block;width:22px;height:11px;border:1.2px solid var(--doc-border);background:color-mix(in oklab,var(--doc-card) 92%,transparent)}
  .muestra i.rombo{width:16px;height:16px;transform:rotate(45deg);border-color:color-mix(in oklab,#e5c07b 45%,var(--doc-border))}
  .muestra i.datos{transform:skewX(-18deg);border-style:dashed;border-color:color-mix(in oklab,#61afef 40%,var(--doc-border))}
  .muestra i.oval{border-radius:9px;border-color:color-mix(in oklab,var(--doc-accent) 55%,var(--doc-border))}
  .seccion{border:1px solid var(--doc-border);border-radius:12px;padding:16px 18px 18px}
  .nota{font-size:10px;color:var(--doc-muted);border-top:1px solid var(--doc-border);padding-top:9px;margin-top:12px}
"""


def main():
    # Flow 1 has no steps in the engine: Python is launched by the server and
    # openDAW runs in the browser. Three lanes, wider and more legible.
    calles1 = ["person", "browser · web/src", "server · vite / lambda"]
    calles2 = ["person", "browser · turn loop and tools", "server · gates and execution", "engine · python / gpu"]

    repartir(len(calles1))
    nodos1 = construir(calles1, FLUJO1)
    repartir(len(calles2), 52)   # 26 px lane for the loop
    nodos2 = construir(calles2, FLUJO2)

    MARCA[0] = "flecha1"
    svg1, tabla1 = dibujar_flujo("Flow 1 · open and play", "", calles1, nodos1, NOTAS1)
    MARCA[0] = "flecha2"
    svg2, tabla2 = dibujar_flujo("Flow 2 · an agent turn", "", calles2, nodos2, NOTAS2)
    # turn loop: from step 16 (are there steps left?) to 5 (POST /api/llm)
    bucle = dibujar_bucle(nodos2[15], nodos2[4], "loop: up to 12 steps")
    svg2 = svg2.replace("</svg>", bucle + "</svg>")

    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>miuzika · flowcharts</title>
<style>{CSS.replace("__FUENTE__", FUENTE).replace("__MONO__", MONO)}</style>
</head>
<body>
<div class="wrap">

  <div>
    <h1>miuzika · flowcharts</h1>
    <p class="lead">Notation: oval = start or end · rectangle = process · diamond = decision · dotted parallelogram = data or HTTP call.
    Each lane is an actor: what happens in one lane cannot be done by another.</p>
    <div class="leyenda" style="margin-top:9px">
      <span class="muestra"><i class="oval"></i> start / end</span>
      <span class="muestra"><i></i> process</span>
      <span class="muestra"><i class="rombo"></i> decision</span>
      <span class="muestra"><i class="datos"></i> data / HTTP</span>
      <span><b>n</b> = step number in the table below</span>
    </div>
  </div>

  <div class="seccion">
    <h2>Flow 1 · open and play</h2>
    <p class="lead">From disk to speakers: {len(nodos1)} steps. What breaks here is a missing WAV, a .sf2 that will not load or an empty project.</p>
    {svg1}
    {tabla1}
    <div class="nota">Measured times: 21 tracks / 11 WAVs open in 16.8 s cold and 0.5 s with the peak cache.
    Autosave 1.5 s after the last change.</div>
  </div>

  <div class="seccion">
    <h2>Flow 2 · an agent turn</h2>
    <p class="lead">{len(nodos2)} steps and a loop. Here are the gates that keep the model from breaking the engine and the cuts that keep a turn from eating the session.</p>
    {svg2}
    {tabla2}
    <div class="nota">Turn cuts: 3 identical failures in a row · 3 writes without running · 12 steps.
    An empty response is retried 5 times (1-2-4-8-16 s) and then an automatic resumption.</div>
  </div>

  <div class="nota" style="border:0;padding:0">
    What is not in any flow because it does not exist: buses, automation, live meters, stem or project export.
    Architecture and debt: <code>docs/ARCHITECTURE.md</code> · layers: <code>docs/esquema-arquitectura.html</code>.
  </div>

</div>
</body>
</html>
"""
    # flow 2 has the loop drawn inside its SVG
    salida = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "flujo-aplicacion.html")
    with open(salida, "w", encoding="utf-8", newline="") as f:
        f.write(doc)
    print("written", salida, len(doc), "chars")
    print("flujo1:", len(nodos1), "nodes ·", len(tabla1), "chars of table")
    print("flujo2:", len(nodos2), "nodes")


if __name__ == "__main__":
    main()
