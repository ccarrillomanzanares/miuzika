#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera docs/flujo-aplicacion.html: dos diagramas de flujo con calles.

Nada de esto se ejecuta en la app: es un generador de documentación. Dibuja SVG a
partir de listas de nodos para que las coordenadas no se inventen a mano.
"""
import html
import os

W = 980                 # ancho del lienzo
CALLE_W = 214           # ancho de cada calle (se recalcula por flujo)
GAP = 16
X0 = 16
ALTO_CAB = 30
FUENTE = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"

def repartir(n_calles, margen=16):
    """Reparte el ancho del lienzo entre las calles que haya.

    `margen` mayor deja sitio al bucle dibujado por el lado izquierdo.
    """
    global CALLE_W, CENTRO, X0
    X0 = margen
    CALLE_W = (W - 2 * X0 - (n_calles - 1) * GAP) / n_calles
    CENTRO = [calle_x(i) + CALLE_W / 2 for i in range(n_calles)]


def calle_x(i):
    return X0 + i * (CALLE_W + GAP)

CENTRO = [calle_x(i) + CALLE_W / 2 for i in range(4)]

# id del marcador de flecha; cambia por SVG para no duplicar ids en el documento
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
    """Un nodo del diagrama. tipo: proceso | decision | datos | extremo.

    La rama «no» de una decisión se escribe DENTRO de la forma: una flecha lateral
    se metía en la calle de al lado y parecía que iba a otro actor.
    """
    # el rombo estrecha por los lados: su texto tiene que ser más corto que el de
    # una caja, o se sale por las esquinas
    # ~5,1 px por carácter a 9,4 px: el límite sale del ancho disponible. El óvalo
    # redondea las esquinas y el paralelogramo está inclinado: los dos pierden ancho.
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
        # rombo: 8 px de margen dentro de la calle
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
    # rama «no», dentro de la forma
    if n.get("al"):
        yn = ys + 12 * len(n["sl"]) + 2 if n["sl"] else ys + 12
        textos += f'<text class="sn" x="{cx}" y="{yn}" text-anchor="middle">'
        for i, l in enumerate(n["al"]):
            textos += f'<tspan x="{cx}" dy="{0 if i == 0 else 10}">{html.escape(l)}</tspan>'
        textos += "</text>"
    # número del paso
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
        # el codo va a la mitad del hueco real: con un tope fijo, dos nodos casi a
        # la misma altura dejaban la flecha pasando por debajo del destino
        medio = ay + (by - ay) / 2
        d = f"M {ax} {ay} V {medio} H {bx} V {by - 2}"
    etq = ""
    if etiqueta:
        etq = f'<text class="etq" x="{ax + 4}" y="{ay + 11}">{html.escape(etiqueta)}</text>'
    return f'<path class="{clase}" d="{d}" marker-end="url(#{MARCA[0]})"/>' + etq


def dibujar_flujo(titulo, subtitulo, calles, nodos, notas):
    """Devuelve el SVG completo y la tabla de detalle."""
    alto = (nodos[-1]["y"] + nodos[-1]["alto"] + 26) if nodos else 200
    partes = [
        f'<svg class="diag" viewBox="0 0 {W} {alto}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" '
        f'aria-label="{html.escape(titulo)}">',
        f'<defs><marker id="{MARCA[0]}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 z" fill="var(--doc-muted)"/></marker></defs>',
    ]
    # calles
    for i, nombre in enumerate(calles):
        x = calle_x(i)
        partes.append(
            f'<rect class="calle" x="{x}" y="{ALTO_CAB}" width="{CALLE_W}" height="{alto - ALTO_CAB}" rx="8"/>'
        )
        partes.append(f'<text class="cc" x="{x + CALLE_W / 2}" y="{ALTO_CAB - 10}" text-anchor="middle">{html.escape(nombre)}</text>')
    # conectores primero (debajo de las cajas no: van entre medias, el SVG respeta el orden)
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
        '<table><thead><tr><th>#</th><th>paso</th><th>qué hace exactamente</th>'
        f'<th>si falla / rama</th></tr></thead><tbody>{filas}</tbody></table>'
    )
    return "".join(partes), tabla


def dibujar_bucle(desde, hasta, etiqueta):
    """Vuelta del bucle por el margen izquierdo (el bucle del turno)."""
    yd = desde["y"] + desde["alto"] / 2
    yh = hasta["y"] + hasta["alto"] / 2
    xd = calle_x(desde["calle"])
    xh = calle_x(hasta["calle"])
    carril = X0 / 2
    d = f"M {xd} {yd} H {carril} V {yh} H {xh - 2}"
    medio = (yd + yh) / 2
    # La etiqueta va en horizontal sobre la calle 0, que en ese tramo está vacía:
    # rotada contra el margen se cortaba y no se leía.
    x_etq = calle_x(0) + 6
    texto = (
        f'<text class="etq" x="{x_etq}" y="{medio}">{html.escape(etiqueta)}</text>'
        f'<text class="etq2" x="{x_etq}" y="{medio + 11}">vuelve a la llamada al modelo</text>'
    )
    return f'<path class="f bucle" d="{d}" marker-end="url(#{MARCA[0]})"/>' + texto


# ====================================================================== datos
CALLE_NAV, CALLE_SRV, CALLE_PY = 1, 2, 3
PERSONA = 0


def construir(calles, pasos):
    """pasos: (calle, tipo, titulo, sub, no) -> lista de nodos con y calculada."""
    nodos, y = [], ALTO_CAB + 26
    for calle, tipo, titulo, sub, no in pasos:
        n = nodo(len(nodos) + 1, calle, tipo, titulo, sub, y, no=no)
        nodos.append(n)
        y += n["alto"] + (62 if tipo == "decision" else 42)
    return nodos


FLUJO1 = [
    (PERSONA, "extremo", "Abres localhost:5173", "Chrome. La app sólo escucha en [::1]", None),
    (CALLE_SRV, "proceso", "Vite sirve web/ y monta /api/*", "25 endpoints · COOP/COEP · proxy /api/llm", None),
    (CALLE_NAV, "proceso", "boot()", "migra un proyecto viejo de localStorage · lienzo vacío · prompt con manifiesto", None),
    (CALLE_NAV, "decision", "¿se abre algún proyecto solo?", "decisión de producto: no", "nada abierto"),
    (PERSONA, "proceso", "pulsa «Proyectos»", "o arrastra un WAV / pide una pieza al agente", None),
    (CALLE_SRV, "datos", "GET /api/proyectos", "lista carpetas con proyecto.json: nombre, BPM, compases, pistas, guardadoEn, bytes", None),
    (PERSONA, "proceso", "elige uno", "diálogo con fecha y tamaño", None),
    (CALLE_SRV, "datos", "GET /api/proyectos?path=", "maestro entero (sin el recorte de 20 KB; tope 64 MB)", None),
    (CALLE_NAV, "decision", "¿el JSON es de miuzika?", "formato + schemaVersion 1", "aviso, no se abre"),
    (CALLE_NAV, "proceso", "interpretarProyectoEnDisco()", "→ Project en memoria; cada asset conserva su ruta relativa", None),
    (CALLE_NAV, "proceso", "hidratarAssets()", "4 assets a la vez; por cada uno pide /api/picos (caché por mtime)", None),
    (CALLE_SRV, "proceso", "/api/picos + /api/audio", "picos calculados con un proceso Python; el WAV se sirve con Range", None),
    (CALLE_NAV, "decision", "¿el WAV dura más de 30 s?", "≤30 s se decodifica", "streaming por Range"),
    (CALLE_NAV, "proceso", "projectToOpenDaw()", "IR en beats → pulsos (960/negra); .sf2 por un gestor propio, no el de la librería", None),
    (CALLE_NAV, "proceso", "▶ play", "engine.position/960 → onTick: playhead + stems sincronizados (corrige deriva >120 ms)", None),
    (CALLE_NAV, "decision", "¿beat ≥ fin del proyecto?", "lengthBars × compás", "stop()"),
    (CALLE_NAV, "proceso", "editar", "arrastrar/mover/borrar clip, mute, solo, piano roll → applyOps() transaccional", None),
    (CALLE_NAV, "proceso", "autoguardado · 1,5 s", "programarGuardado() tras el último cambio; Ctrl+S lo fuerza", None),
    (CALLE_SRV, "datos", "POST /api/proyectos", "valida {formato, schemaVersion:1} antes de escribir; guardadoEn delata quién", None),
    (CALLE_SRV, "extremo", "proyecto en disco", "lo que suena es lo que hay en la carpeta", None),
]

FLUJO2 = [
    (PERSONA, "extremo", "escribes y pulsas Enter", "chat.ts → onSend → responderAlUsuario()", None),
    (CALLE_NAV, "decision", "¿hay un turno en marcha?", "un solo turno a la vez", "sí: aviso, no arranca"),
    (CALLE_SRV, "proceso", "GET /api/manifiesto", "regenera firmas con ast: 8.949 caracteres, 7 módulos", None),
    (CALLE_NAV, "proceso", "prompt de sistema", "literal con huella + carpeta + manifiesto + agente.json (11.939 car.)", None),
    (CALLE_NAV, "proceso", "POST /api/llm (SSE)", "180 s de tope · 32.768 tokens · progreso cada 700 ms", None),
    (CALLE_SRV, "proceso", "proxy + clave del .env", "la clave no entra en el bundle del cliente", None),
    (CALLE_NAV, "decision", "¿finish_reason?", "load · sin_salida · vacío · stop", "los tres se reintentan"),
    (CALLE_NAV, "decision", "¿pide herramientas?", "tool_calls en orden", "no: respuesta final"),
    (CALLE_NAV, "proceso", "ejecutarHerramienta()", "17 herramientas · timeout propio · AbortSignal del turno", None),
    (CALLE_NAV, "decision", "¿la herramienta toca el proyecto?", "7 de las 17", "no: al servidor"),
    (CALLE_NAV, "proceso", "op en la pestaña", "entra en el historial, se deshace con Ctrl+Z, la pestaña es la única que escribe el maestro", None),
    (CALLE_SRV, "proceso", "puertas", "409 si redefine el motor o es patch*.py · 413 si >8 MB · 409 si numpy en Lambda", None),
    (CALLE_SRV, "proceso", "run/python | run/lambda", "cwd = carpeta del proyecto · PYTHONPATH = codigo/ · GPU: scp + ssh", None),
    (CALLE_PY, "proceso", "ejecuta y escribe salida/", "devuelve escritos: sólo lo que cambió en el proyecto", None),
    (CALLE_NAV, "proceso", "resultado → modelo", ">4.000 caracteres: cabeza + cola y el resto a _salidas/", None),
    (CALLE_NAV, "decision", "¿quedan pasos?", "máximo 12", "corta el turno"),
    (CALLE_NAV, "proceso", "respuesta final", "burbuja en el chat + línea meta (pasos, herramientas, ms, modelo)", None),
    (CALLE_NAV, "datos", "agregarTurno() → agente.json", "8 turnos íntegros + resumen rodante de 1.800 caracteres", None),
    (CALLE_NAV, "extremo", "turno cerrado", "el disco es la memoria; la siguiente petición lo lee de ahí", None),
]

NOTAS1 = {
    1: "Sin servidor de dev no hay app: /api/* son middlewares de Vite.",
    2: "Si Vite se reinicia, la pestaña sigue con el bundle viejo; /api/build lo avisa y ofrece recargar.",
    3: "Migra un proyecto viejo de localStorage y no abre nada solo: el lienzo vacío lo explica.",
    4: "Antes abría el último proyecto y sustituía lo que estabas mirando (en uno vacío, parecía fallo).",
    5: "También se puede pedir una pieza al agente, con sus 17 herramientas.",
    6: "Sólo lista carpetas que tienen proyecto.json; las demás no existen para la app.",
    7: "Enseña fecha, tamaño del maestro y número de pistas antes de abrir.",
    8: "400 si el formato no es miuzika-proyecto o schemaVersion no es 1.",
    9: "Un .json exportado a mano también vale (Project suelto).",
    10: "Cada asset conserva su ruta relativa a la carpeta del proyecto.",
    11: "Cuatro a la vez. Sin ruta: «faltan N WAV» y esas pistas suenan vacías.",
    12: "Primera apertura en frío: 16,8 s con 21 pistas / 11 WAV. Con la caché: 0,5 s.",
    13: "Por encima de 30 s no se decodifica nunca: 10 stems de 6 min ocupan 20 MB, no 1,3 GB.",
    14: "El engine WASM se instala una vez por página; Playfield usa /drums/*.wav.",
    15: "Un clic sintético no arranca el audio: el AudioContext necesita gesto de usuario.",
    16: "El final lo decide lengthBars, no lo que dure el último fichero.",
    17: "Todo pasa por applyOps(): transaccional, con historial de 8 pasos.",
    18: "1,5 s tras el último cambio; Ctrl+S lo escribe ya y lo cuenta en el chat.",
    19: "Si ready=false no se guarda y el lienzo queda en blanco: se diagnostica leyendo el fichero.",
    20: "Lo que suena es exactamente lo que hay en la carpeta.",
}

NOTAS2 = {
    1: "El chat arranca vacío: su memoria es agente.json, del proyecto.",
    2: "Un solo turno a la vez; el latido pinta «pensando · N s · N tokens».",
    3: "Si /api/manifiesto falla, el turno sigue con el prompt básico.",
    4: "Pasa de 2.890 a 11.939 caracteres: literal + carpeta + manifiesto + memoria.",
    5: "load = proveedor cargando (0 tokens en 250 ms), no falta de contexto.",
    6: "La clave vive en el .env y nunca entra en el bundle del cliente.",
    7: "sin_salida se repite sin razonar; vacío: 5 reintentos (1-2-4-8-16 s) + 1 reanudación.",
    8: "Si no pide ninguna herramienta, esa respuesta es la final del turno.",
    9: "Una por una, en orden, con timeout propio y el AbortSignal del turno.",
    10: "Las 7 que cambian el proyecto lo hacen en la pestaña: es la dueña del maestro.",
    11: "Entra en el historial, se deshace con Ctrl+Z y se guarda sola.",
    12: "El smoke importa el motor y renderiza un bombo: si falla, el cambio se revierte.",
    13: "Sin destino explícito se usa el selector del panel; el 409 evita pagar GPU por CPU.",
    14: "Escribir en codigo/ regenera el manifiesto con ast, sin ejecutar nada.",
    15: "Por encima de 4.000 caracteres: cabeza + cola y el resto a _salidas/.",
    16: "Cortes: 3 fallos idénticos · 3 escrituras sin ejecutar · 12 pasos.",
    17: "Burbuja + línea meta: pasos, herramientas, tiempo y modelo.",
    18: "8 turnos íntegros y un resumen rodante de 1.800 caracteres.",
    19: "El disco es la memoria del proyecto: la siguiente petición lo lee de ahí.",
}


CSS = """
  /* Paleta propia, con prefijo --doc-: este fichero se abre con doble clic, sin el
     tema de la app. Con var(--doc-card) a secas, fuera de Hermes el fill es inválido y
     las cajas salían NEGRAS con el texto negro dentro. */
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
    # El flujo 1 no tiene pasos en el motor: el Python lo lanza el servidor y
    # openDAW corre en el navegador. Tres calles, más anchas y legibles.
    calles1 = ["persona", "navegador · web/src", "servidor · vite / lambda"]
    calles2 = ["persona", "navegador · bucle y herramientas", "servidor · puertas y ejecución", "motor · python / gpu"]

    repartir(len(calles1))
    nodos1 = construir(calles1, FLUJO1)
    repartir(len(calles2), 52)   # 26 px de carril para el bucle
    nodos2 = construir(calles2, FLUJO2)

    MARCA[0] = "flecha1"
    svg1, tabla1 = dibujar_flujo("Flujo 1 · abrir y tocar", "", calles1, nodos1, NOTAS1)
    MARCA[0] = "flecha2"
    svg2, tabla2 = dibujar_flujo("Flujo 2 · un turno del agente", "", calles2, nodos2, NOTAS2)
    # bucle del turno: del paso 16 (¿quedan pasos?) al 5 (POST /api/llm)
    bucle = dibujar_bucle(nodos2[15], nodos2[4], "bucle: hasta 12 pasos")
    svg2 = svg2.replace("</svg>", bucle + "</svg>")

    doc = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>miuzika · diagramas de flujo</title>
<style>{CSS.replace("__FUENTE__", FUENTE).replace("__MONO__", MONO)}</style>
</head>
<body>
<div class="wrap">

  <div>
    <h1>miuzika · diagramas de flujo</h1>
    <p class="lead">Notación: óvalo = inicio o fin · rectángulo = proceso · rombo = decisión · paralelogramo punteado = dato o llamada HTTP.
    Cada calle es un actor: lo que ocurre en una calle no lo puede hacer otra.</p>
    <div class="leyenda" style="margin-top:9px">
      <span class="muestra"><i class="oval"></i> inicio / fin</span>
      <span class="muestra"><i></i> proceso</span>
      <span class="muestra"><i class="rombo"></i> decisión</span>
      <span class="muestra"><i class="datos"></i> dato / HTTP</span>
      <span><b>n</b> = número del paso en la tabla de abajo</span>
    </div>
  </div>

  <div class="seccion">
    <h2>Flujo 1 · abrir y tocar</h2>
    <p class="lead">Del disco a los altavoces: {len(nodos1)} pasos. Lo que se rompe aquí es un WAV que falta, un .sf2 que no carga o un proyecto vacío.</p>
    {svg1}
    {tabla1}
    <div class="nota">Tiempos medidos: 21 pistas / 11 WAV abren en 16,8 s en frío y 0,5 s con la caché de picos.
    Autoguardado 1,5 s tras el último cambio.</div>
  </div>

  <div class="seccion">
    <h2>Flujo 2 · un turno del agente</h2>
    <p class="lead">{len(nodos2)} pasos y un bucle. Aquí están las puertas que impiden que el modelo rompa el motor y los cortes que impiden que un turno se coma la sesión.</p>
    {svg2}
    {tabla2}
    <div class="nota">Cortes del turno: 3 fallos idénticos seguidos · 3 escrituras sin ejecutar · 12 pasos.
    Un vacío se reintenta 5 veces (1-2-4-8-16 s) y luego una reanudación automática.</div>
  </div>

  <div class="nota" style="border:0;padding:0">
    Lo que no está en ningún flujo porque no existe: buses, automatización, medidores en vivo, exportación de stems o de proyecto.
    Arquitectura y deuda: <code>docs/ARCHITECTURE.md</code> · capas: <code>docs/esquema-arquitectura.html</code>.
  </div>

</div>
</body>
</html>
"""
    # el flujo 2 lleva el bucle dibujado dentro de su SVG
    salida = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "flujo-aplicacion.html")
    with open(salida, "w", encoding="utf-8", newline="") as f:
        f.write(doc)
    print("escrito", salida, len(doc), "chars")
    print("flujo1:", len(nodos1), "nodos ·", len(tabla1), "chars de tabla")
    print("flujo2:", len(nodos2), "nodos")


if __name__ == "__main__":
    main()
