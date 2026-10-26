"""cancion.py - datos musicales del tema: tempo, estructura, armonia, letra y melodias."""
import re
import numpy as np

BPM = 90.0
SPB = 60.0 / BPM          # 0.6667 s por negra
BAR = 4 * SPB             # 2.6667 s por compas
TOTAL_BARS = 140
DUR = TOTAL_BARS * BAR    # 373.33 s = 6:13.3

# ---------------------------------------------------------------- estructura
# (nombre, compas_ini, compas_fin, segundo_ini)
SECCIONES = [
    ('intro',      0,  11),
    ('estrofa1',  11,  34),
    ('estrofa2',  34,  60),
    ('estribillo', 60,  90),
    ('breakdown', 90, 116),
    ('outro',    116, 140),
]
SEC = {n: (a, b) for n, a, b in SECCIONES}

def bar_de(t):
    return t / BAR

def t_de(bar):
    return bar * BAR

# ---------------------------------------------------------------- armonia
# acordes: (root_bajo_midi, [voces_organo])
ACORDES = {
    'Am': (33, [57, 60, 64]),
    'F':  (29, [53, 57, 60]),
    'E':  (28, [52, 56, 59]),
    'Dm': (26, [50, 53, 57]),
    'Bb': (34, [58, 62, 65]),
    'G':  (31, [55, 59, 62]),
}

CICLO_ESTROFA = ['Am', 'Am', 'F', 'E', 'Am', 'Am', 'Dm', 'E']
CICLO_ESTRIBILLO = ['Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'E', 'E']
CICLO_BREAK = ['Am', 'Am', 'Bb', 'Bb', 'Am', 'Am', 'E', 'E']
CICLO_OUTRO = ['Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'E', 'E']

def acorde_de(bar):
    if bar < 11:
        return 'Am'
    if bar < 34:
        return CICLO_ESTROFA[bar % 8]
    if bar < 60:
        return CICLO_ESTROFA[bar % 8]
    if bar < 90:
        return CICLO_ESTRIBILLO[bar % 8]
    if bar < 116:
        return CICLO_BREAK[bar % 8]
    return CICLO_OUTRO[bar % 8]

# patron de bajo: 8 corcheas por compas, semitonos respecto a la raiz
PATRON_BAJO = [0, 0, 3, 0, None, -2, 0, 1]
DUR_BAJO = [0.42, 0.42, 0.30, 0.42, 0.0, 0.30, 0.42, 0.30]

# ---------------------------------------------------------------- letra
# Letra original. Autodesprecio y obsesion disfrazados de intimidad.
LETRA = {
    'L1':  'Dejo la puerta abierta por si vuelves',
    'L2':  'no pregunto nada ya se la respuesta',
    'L3':  'me se tu nombre mejor que el mio',
    'L4':  'lo digo bajito como una oracion',
    'L5':  'Toco la pared donde te apoyabas',
    'L6':  'y la pared contesta con tu misma voz',
    'L7':  'cuento las veces que dije que no',
    'L8':  'y cuento las veces que me quede',
    'L9':  'No hay nadie en casa y hablo contigo',
    'L10': 'la luz del pasillo me sabe a tu piel',
    'L11': 'repito tu nombre hasta que se gaste',
    'L12': 'y luego lo digo otra vez',
    'C1':  'Quiereme despacio como se quiere una herida',
    'C2':  'quiereme despacio que no se cierre nunca',
    'C3':  'quiereme despacio con la boca y con la culpa',
    'C4':  'quiereme despacio hasta que se me olvide el nombre',
    'C5':  'Quiereme despacio que la fe se me esta acabando',
    'C6':  'quiereme despacio y no me lo digas claro',
    'C7':  'quiereme despacio que prefiero no saberlo',
    'C8':  'quiereme despacio hasta que se me olvide el nombre',
}

VOCALES = 'aeiou'

def silabas(palabra):
    w = palabra.lower()
    w = w.replace('ch', 'ĉ').replace('ll', 'ŀ').replace('rr', 'ř').replace('qu', 'k')
    w = re.sub(r'[^a-zĉŀřáéíóúüñ]', '', w)
    if not w:
        return []
    grupos = []
    i = 0
    while i < len(w):
        if w[i] in 'aeiouáéíóúü':
            j = i
            while j < len(w) and w[j] in 'aeiouáéíóúü':
                j += 1
            grupos.append((i, j))
            i = j
        else:
            i += 1
    if not grupos:
        return [w]
    out = []
    start = 0
    for gi in range(1, len(grupos)):
        pa, pb = grupos[gi - 1]
        a, b = grupos[gi]
        cons = w[pb:a]
        if len(cons) <= 1:
            cut = pb
        elif len(cons) == 2 and cons[0] in 'lr' and cons[1] not in 'lr':
            cut = pb
        elif len(cons) == 2 and cons in ('pr', 'br', 'tr', 'dr', 'kr', 'cr', 'fr', 'gr',
                                         'pl', 'bl', 'kl', 'cl', 'fl', 'gl'):
            cut = pb
        else:
            cut = pb + 1
        out.append(w[start:cut])
        start = cut
    out.append(w[start:])
    return [s for s in out if s]

def desglosar(texto):
    """devuelve [(vocal, consonante_inicial)] por silaba"""
    res = []
    for pal in texto.split():
        for s in silabas(pal):
            v = ''
            for ch in s:
                if ch in 'aeiouáéíóúü':
                    v = ch
            v = {'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u'}.get(v, v)
            if not v:
                v = 'e'
            c = ''
            for ch in s:
                if ch in 'aeiouáéíóúü':
                    break
                c = ch
            c = {'ĉ': 'ch', 'ŀ': 'l', 'ř': 'r', 'ñ': 'ñ'}.get(c, c)
            if c not in ('b', 'p', 'd', 't', 'g', 'k', 'f', 'v', 's', 'z', 'j', 'ch',
                         'm', 'n', 'l', 'r', 'y', 'w', 'h', 'x', 'ñ'):
                c = ''
            res.append((v, c))
    return res

# ---------------------------------------------------------------- melodia vocal
# contornos en grados MIDI; se reescalan al numero de silabas
CONT_ESTROFA = [45, 45, 43, 45, 45, 46, 45, 43, 41, 43, 45, 45, 43, 45, 46, 45]
CONT_ESTROFA2 = [45, 45, 46, 45, 43, 41, 43, 45, 45, 43, 41, 43, 45, 45, 43, 45]
CONT_ESTRIBILLO = [52, 52, 50, 52, 53, 52, 50, 48, 50, 52, 53, 55, 53, 52, 50, 52]
CONT_ESTRIBILLO2 = [53, 53, 52, 53, 55, 53, 52, 50, 52, 53, 55, 57, 55, 53, 52, 53]

PESOS = [1.0, 0.62, 0.62, 0.86]

def ajustar(cont, n):
    if n <= 0:
        return []
    if n <= len(cont):
        idx = np.linspace(0, len(cont) - 1, n).round().astype(int)
        return [cont[i] for i in idx]
    out = list(cont)
    while len(out) < n:
        out.append(cont[-1])
    return out[:n]

def linea(texto, bar, beats, cont, vel=1.0):
    """devuelve [(t_seg, dur_seg, midi, vocal, cons, vel)]"""
    sil = desglosar(texto)
    n = len(sil)
    if n == 0:
        return []
    pit = ajustar(cont, n)
    w = np.array([PESOS[i % len(PESOS)] for i in range(n)], float)
    w = w / w.sum() * beats
    t0 = bar * BAR
    out = []
    t = t0
    for i, (v, c) in enumerate(sil):
        d = float(w[i]) * SPB
        out.append((t, d * 0.94, pit[i], v, c, vel))
        t += d
    return out

# (clave, compas, beats, contorno, velocidad)
LINEAS = [
    ('L1', 13, 8, CONT_ESTROFA, 1.00),
    ('L2', 15, 8, CONT_ESTROFA2, 1.00),
    ('L3', 17, 8, CONT_ESTROFA, 0.95),
    ('L4', 19, 8, CONT_ESTROFA2, 0.95),
    ('L5', 22, 8, CONT_ESTROFA, 1.00),
    ('L6', 24, 8, CONT_ESTROFA2, 1.00),
    ('L7', 26, 8, CONT_ESTROFA, 0.95),
    ('L8', 28, 8, CONT_ESTROFA2, 0.95),
    ('L1', 31, 8, CONT_ESTROFA, 0.85),
    ('L9', 36, 8, CONT_ESTROFA, 1.00),
    ('L10', 38, 8, CONT_ESTROFA2, 1.00),
    ('L11', 40, 8, CONT_ESTROFA, 1.00),
    ('L12', 42, 8, CONT_ESTROFA2, 0.95),
    ('L5', 45, 8, CONT_ESTROFA, 1.00),
    ('L6', 47, 8, CONT_ESTROFA2, 1.00),
    ('L7', 49, 8, CONT_ESTROFA, 1.00),
    ('L8', 51, 8, CONT_ESTROFA2, 1.00),
    ('L9', 54, 8, CONT_ESTROFA, 1.00),
    ('L10', 56, 8, CONT_ESTROFA2, 1.00),
    ('L11', 58, 8, CONT_ESTROFA, 1.00),
    ('C1', 60, 8, CONT_ESTRIBILLO, 1.00),
    ('C2', 62, 8, CONT_ESTRIBILLO, 1.00),
    ('C3', 64, 8, CONT_ESTRIBILLO, 1.00),
    ('C4', 66, 8, CONT_ESTRIBILLO, 1.00),
    ('C1', 69, 8, CONT_ESTRIBILLO2, 1.00),
    ('C2', 71, 8, CONT_ESTRIBILLO2, 1.00),
    ('C3', 73, 8, CONT_ESTRIBILLO2, 1.00),
    ('C4', 75, 8, CONT_ESTRIBILLO2, 1.00),
    ('C5', 78, 8, CONT_ESTRIBILLO, 1.00),
    ('C6', 80, 8, CONT_ESTRIBILLO, 1.00),
    ('C7', 82, 8, CONT_ESTRIBILLO, 1.00),
    ('C8', 84, 8, CONT_ESTRIBILLO2, 1.00),
    ('C4', 87, 8, CONT_ESTRIBILLO2, 0.90),
]

def silabas_voz():
    out = []
    for (k, bar, beats, cont, vel) in LINEAS:
        out += linea(LETRA[k], bar, beats, cont, vel)
    return out

# ---------------------------------------------------------------- guitarra
# bucle de 4 compases, esporadico, crujiente, sin riffear
GUITARRA = [
    (0.0, 0.22, 45, 0.9, True),
    (1.5, 0.18, 45, 0.7, True),
    (3.0, 0.55, 48, 0.8, False),
    (6.5, 0.22, 45, 0.75, True),
    (8.0, 0.20, 45, 0.85, True),
    (9.5, 0.18, 46, 0.7, True),
    (11.0, 0.70, 45, 0.8, False),
    (14.0, 0.30, 41, 0.75, True),
]

# ---------------------------------------------------------------- piano final
PIANO_MEL = [76, 75, 74, 72, 71, 69, 68, 67, 65, 64, 62, 61, 60, 59, 57, 57]

# ---------------------------------------------------------------- percusion metalica
METAL_PAT = [(0.0, 1.0), (1.75, 0.55), (2.5, 0.7), (3.25, 0.45)]
