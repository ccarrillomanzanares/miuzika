"""Comprueba la pista de saxo creada y cuenta zonas del .sf2 y regiones del .sfz."""
import json
import os
import struct

PROY = 'proyecto.json'
SF2 = 'instrumentos/saxo-tenor-prueba.sf2'
SFZ = os.path.join('..', '..', 'catalogo', 'VCSL-1.2.2-RC', 'Aerophones',
                   'Reed Aerophones', 'Tenor Saxophone - Non-Vibrato.sfz')


def zonas_sf2(ruta):
    with open(ruta, 'rb') as f:
        data = f.read()
    assert data[:4] == b'RIFF' and data[8:12] == b'sfbk', 'no es un SF2'
    # recorre chunks de primer nivel
    pos = 12
    pdta = None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        sz = struct.unpack('<I', data[pos + 4:pos + 8])[0]
        if cid == b'LIST' and data[pos + 8:pos + 12] == b'pdta':
            pdta = (pos + 12, pos + 8 + sz)
            break
        pos += 8 + sz + (sz & 1)
    assert pdta, 'sin pdta'
    ini, fin = pdta
    p = ini
    chunks = {}
    while p + 8 <= fin:
        cid = data[p:p + 4]
        sz = struct.unpack('<I', data[p + 4:p + 8])[0]
        chunks[cid] = data[p + 8:p + 8 + sz]
        p += 8 + sz + (sz & 1)
    phdr = chunks[b'phdr']
    pbag = chunks[b'pbag']
    pgen = chunks[b'pgen']
    ninst = len(phdr) // 38 - 1          # el ultimo registro es EOP
    nbag = len(pbag) // 4 - 1
    ngen = len(pgen) // 4
    return ninst, nbag, ngen


def regiones_sfz(ruta):
    n = 0
    with open(ruta, 'r', encoding='utf-8', errors='replace') as f:
        for ln in f:
            if ln.strip().lower().startswith('<region'):
                n += 1
    return n


print('--- SF2 ---')
ninst, nbag, ngen = zonas_sf2(SF2)
print('instrumentos:', ninst, '| zonas (bags):', nbag, '| generadores:', ngen)
print('tamano sf2: %.1f MB' % (os.path.getsize(SF2) / 1e6))

print('--- SFZ ---')
print('regiones <region>:', regiones_sfz(SFZ))

print('--- PROYECTO ---')
with open(PROY, 'r', encoding='utf-8') as f:
    prj = json.load(f)['proyecto']
print('pistas totales:', len(prj['tracks']))
for t in prj['tracks']:
    notas = len(t.get('notes', []) or [])
    print(' -', t['name'], '|', t['kind'], '| notas:', notas,
          '| instrumento:', t.get('instrument'))
